import { gradeCard, METRICS } from '../kpi.js'
import { Router } from 'express'
import { all, get, run, batch, publicUser, tashkentDay, dayISO, getSkipTiers, tierFor, getMakerGrades, gradeFor, PAY_SCHEMES, PAY_SCHEME_KEYS, schemeOf, CONTENT_TYPES } from '../db.js'
import { authRequired, adminOnly, isFullAdmin, wrap } from '../auth.js'
import { resolveGates, phasesOf, phasePassed } from '../deadlines.js'
import { buildReport, monthSeries, dataHealth, pieceFacts, stepsOf, designStep } from '../stats.js'
import { goalsOf, periodOf } from '../paygoals.js'
import { repostIds } from '../reposts.js'

const router = Router()

// ---- who did what ----------------------------------------------------------
// The report used to count one thing: the piece's ASSIGNEE, on the day the
// whole piece was published. That is the planner's number. It made the crew
// invisible — an editor who cut forty videos in a month appeared to have done
// nothing at all, because the assignee line had somebody else's name on it.
//
// So every hat is counted, each on the day THAT person's work actually left
// their hands, and the report is asked which hat it is looking through.
//
//   assignee   done_at    the piece went out, and it was theirs to see out
//   operator   shot_at    the footage was handed to the editor
//   editor     edited_at  the cut was handed to review
//   designer   done_at    (there is no separate designed_at — the artwork has
//                          no handover stage of its own, so it is credited
//                          when the piece goes out)
//   reviewer   done_at    they signed it off and it was published
//
// The FIELD each hat is read from, and the timestamp that dates the work.
export const HATS = {
  assignee: { column: 'assignees',   at: 'done_at',   phase: 'review', due: 'release_date',     label: 'Ran the piece' },
  operator: { column: 'operator_id', at: 'shot_at',   phase: 'shoot',  due: 'recording_date',   label: 'Shot it' },
  editor:   { column: 'editor_id',   at: 'edited_at', phase: 'edit',   due: 'edit_ready_date',  label: 'Edited it' },
  designer: { column: 'designer_id', at: 'done_at',   phase: null,     due: 'design_ready_date', label: 'Designed it' },
  reviewer: { column: 'reviewers',   at: 'done_at',   phase: 'review', due: 'release_date',     label: 'Signed it off' },
  // Being in the piece. The board has recorded who stood in front of the
  // camera since the day it had a face field, and has never once paid them
  // for it — on a target video that is half the job and all of the nerve.
  face:     { column: 'faces',       at: 'done_at',   phase: null,     due: 'release_date',     label: 'Appeared in it' },
}

// The three hats a piece can hand to several people at once. Each carries a list
// and a single mirror column holding the first of them, so a report written
// before the list existed still reads correctly.
const LIST_HATS = { assignees: 'assignee_id', reviewers: 'reviewer_id', faces: 'face_id' }

const parseList = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }

// Everyone who wore `hat` on this task. Review is shared, so it is a list.
function wearers(row, hat) {
  const f = HATS[hat]
  if (!f) return []
  const mirror = LIST_HATS[f.column]
  if (mirror) {
    const list = parseList(row[f.column]).map(Number).filter(Boolean)
    if (list.length) return [...new Set(list)]
    return row[mirror] ? [row[mirror]] : []
  }
  return row[f.column] ? [row[f.column]] : []
}

// ---- when the content maker's part is done -----------------------------------
// The maker's line on a payslip used to be dated by the day the piece went out,
// which made their pay wait on everybody after them and vanish altogether if
// the piece was killed. The owner's rule, from 1 October 2026:
//
//   a filmed piece, or a designed post   the day it reached Editing — the brief
//                                        is written and the work is handed on
//                                        (a post cannot get there without its
//                                        ТЗ: see `must` in getTaskFields)
//   a written piece (Telegram)           the day it was published; the writing
//                                        IS the piece, and Editing there only
//                                        means somebody has started
//
// So a piece that reached Editing is a paying task whether it is published
// next month or killed next week — the same rule the operator and the editor
// have always been paid by: the part you finished is yours.
//
// "Reached Editing" is the handover stamp (shot_at, written by the move that
// crosses the gate), or for a card created already past the gate, the day it
// was created. A card pulled BACK in front of the gate waits until it returns;
// one that was killed keeps the day it earned.
//
// Anything that reached Editing before the rule began is paid the old way, on
// the day it goes out, so no piece falls between a month that has been paid
// and one that has not.
export const MAKER_RULE_FROM = '2026-10-01'
function makerDay(r, written, resolved) {
  const went = r.done_at ? tashkentDay(r.done_at) : null
  if (written) return went
  const gate = resolved.gates?.edit
  const at = (resolved.ordered || []).findIndex((st) => st.id === r.status_id)
  const killed = (resolved.deadIds || []).includes(r.status_id)
  const past = !!gate && at >= gate.index
  let reached = null
  if (r.shot_at) reached = past || killed ? tashkentDay(r.shot_at) : null
  else if (!went && r.created_at && (past || (killed && (r.edited_at || r.ready_at)))) reached = tashkentDay(r.created_at)
  return reached && reached >= MAKER_RULE_FROM ? reached : went
}

// Every task, once, with the columns any hat might need. Kept in one place so
// the report and the pay run can never disagree about what happened.
//
// `pay` dates the maker's hat by the day their part was done (makerDay) — for
// the payslip and the tallies that have to add up to it. Without it the maker
// is credited on the day the piece went out, which is what "published" means
// on every page that counts publications.
export async function contributions({ from, to, channel, type, pay = false }) {
  const statuses = await all('SELECT * FROM statuses')
  const resolved = resolveGates(statuses)
  const textChannels = pay
    ? new Set((await all("SELECT key FROM channels WHERE format IN ('text', 'short')")).map((c) => c.key))
    : null
  // A repost (server/reposts.js) is the same video posted again. It counts
  // for the person who posts it, on the day it goes out — and for nobody
  // else: whoever shot, cut, designed or appeared in the video was credited
  // on the source task, once, and a repost is never editing work.
  const reposts = await repostIds()
  const rows = (await all(`
    SELECT id, title, channels, type, status_id, assignee_id, assignees, operator_id, editor_id, designer_id,
           reviewer_id, reviewers, face_id, faces, recording_date, edit_ready_date, design_ready_date, release_date,
           edit_due_revised, review_due_revised, shot_at, edited_at, ready_at, done_at, created_at, views, skip_rate,
           telegram_type, is_guiding
    FROM content
  `)).map((r) => ({ ...r, channels: parseList(r.channels) }))

  const out = []          // { hat, userId, row, day, late }
  for (const r of rows) {
    if (channel && !r.channels.includes(channel)) continue
    if (type && r.type !== type) continue
    // Was any of it late? Derived exactly as the board derives it everywhere
    // else, never stored — see server/deadlines.js.
    let phases = null
    const repost = reposts.has(Number(r.id))
    for (const hat of Object.keys(HATS)) {
      if (repost && hat !== 'assignee') continue
      const f = HATS[hat]
      // The handover timestamp, if there is one. shot_at is stamped when the
      // footage reaches the EDITOR — so an operator who filmed twenty pieces
      // this month that no editor has picked up yet had, by that column
      // alone, done nothing. Round 72 settled this everywhere else: a card
      // that has reached Shot HAS finished its shoot, whatever the timestamps
      // say. The report and the payroll have to agree with the rest of the
      // board, so when the stage says the phase is behind us and no timestamp
      // exists, the work is credited on the day it was due.
      const stamp = r[f.at]
      let day = stamp ? tashkentDay(stamp) : null
      if (!day && f.phase && phasePassed(r, f.phase, resolved)) day = r[f.due] || null
      if (pay && hat === 'assignee')
        day = makerDay(r, repost || (r.channels.length > 0 && r.channels.every((c) => textChannels.has(c))), resolved)
      if (!day) continue
      if (from && day < from) continue
      if (to && day > to) continue
      const who = wearers(r, hat)
      if (!who.length) continue
      if (phases === null) phases = phasesOf(r, undefined, resolved)
      // "Late" here means delivered after the day that was promised — which
      // is what phaseState already decides, excuses included: an editor who
      // got the footage after their own date had gone is 'excused', not late,
      // and is not docked for somebody else's slip.
      //
      // Artwork has no phase of its own (no designed_at, no handover stage),
      // so it is judged directly against the day it was due — by the day the
      // ARTWORK was in (the piece reaching Ready), exactly as the statistics
      // read it (designStep), not by the day somebody else published it.
      let late = false
      if (f.phase) {
        const ph = phases.find((p) => p.phase === f.phase)
        late = !!ph && ph.state === 'late'
      } else if (hat === 'designer') {
        late = designStep(r).state === 'late'
      }
      for (const userId of who) out.push({ hat, userId, row: r, day, late })
    }
  }
  return out
}

router.use(authRequired)

// ---- the report, and the words it is written in -----------------------------
// One window, one scope, and every figure in it counted by server/stats.js —
// which is the only place on this board that decides what "went out", "on
// time" or "missed" mean. Two pages disagreeing about the size of a month is
// not a display problem to be papered over with a longer caption; it is two
// definitions, and there is now one.
//
// The window is read three ways at once, on purpose:
//   what went OUT in it        publications, dated by the day they went out
//   what was PROMISED for it   pieces whose release day falls inside it
//   what came DUE in it        steps — shoots, cuts, artwork, reviews
// They are different questions and they get different numbers, so each one is
// returned under its own name instead of being averaged into a single figure
// nobody can take apart again.
function statsRange(q) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q?.to || '') ? q.to : dayISO()
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q?.from || '') ? q.from : `${to.slice(0, 7)}-01`
  return { from, to }
}

// Every column any report here reads off a piece, in one place so the report,
// the months beside it and the health check cannot be looking at different
// halves of the same row.
const REPORT_COLUMNS = `
  SELECT id, title, channels, type, status_id, campaign_id, assignee_id, assignees,
         operator_id, editor_id, designer_id, reviewer_id, reviewers,
         recording_date, edit_ready_date, design_ready_date, release_date,
         edit_due_revised, review_due_revised, shot_at, edited_at, ready_at, done_at, views,
         script, tz, reference_text, reference_links, miss_blame, miss_blame_note, post_link, created_at
  FROM content`

// Who wore any hat on this piece — the question "is this mine?" is asked of
// every scoped report and must be asked the same way each time.
const holdsAHat = (row, userId) => {
  if (!userId) return true
  if (row.assignee_id === userId || row.operator_id === userId || row.editor_id === userId
    || row.designer_id === userId || row.reviewer_id === userId) return true
  return parseList(row.assignees).includes(userId) || parseList(row.reviewers).map(Number).includes(userId)
}

// The rows a report is allowed to count, and the scope that was applied to get
// them — returned together so the page can say out loud whose numbers these
// are rather than leaving the reader to assume.
async function scopedRows(req) {
  const statuses = await all('SELECT * FROM statuses')
  const resolved = resolveGates(statuses)
  const dead = new Set(statuses.filter((s) => /^deleted$/i.test(s.label)).map((s) => s.id))
  const finalId = (statuses.find((s) => s.is_final) || {}).id ?? null

  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null
  const type = req.query.type && req.query.type !== 'all' ? String(req.query.type) : null
  const project = Number(req.query.project) || null
  // A person may always read their own numbers; only an admin may read
  // somebody else's. Asking for another person's without the right to it is
  // not refused — it is answered with your own, because the page that asks is
  // the page everybody opens.
  const isAdmin = req.user.role === 'admin'
  const asked = Number(req.query.person) || null
  const person = isAdmin ? asked : (asked && asked !== req.user.id ? req.user.id : asked)

  let campaignsInProject = null
  if (project) {
    const camps = await all('SELECT id FROM campaigns WHERE project_id = ?', project)
    campaignsInProject = new Set(camps.map((c) => c.id))
  }

  const rows = (await all(REPORT_COLUMNS))
    .map((r) => ({ ...r, channels: parseList(r.channels) }))
    .filter((r) => !dead.has(r.status_id)
      && (!channel || r.channels.includes(channel))
      && (!type || r.type === type)
      && (!campaignsInProject || campaignsInProject.has(r.campaign_id))
      && holdsAHat(r, person))

  return { rows, resolved, statuses, finalId, channel, type, project, person, isAdmin }
}

router.get('/stats', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const today = dayISO()
  const { rows, resolved, channel, type, project, person, isAdmin } = await scopedRows(req)

  const users = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => users.find((u) => u.id === id)?.name || null
  const channels = await all('SELECT key, label FROM channels ORDER BY sort, id')

  // What each person made in the window, counted exactly as the payroll counts
  // it, so "who is carrying it" and "who gets paid for it" can never be two
  // different lists.
  const ids = new Set(rows.map((r) => r.id))
  const credits = (await contributions({ from, to, channel, type })).filter((c) => ids.has(c.row.id))

  const report = buildReport({ rows, resolved, from, to, today, nameOf, channels, credits })
  const months = Math.min(24, Math.max(2, Number(req.query.months) || 6))
  // The months beside the window end where it ends and, for the first of them,
  // start where it starts: a custom window from the 15th draws its first month
  // from the 15th, so that bar and the tiles above it are the same count. A
  // month, three months or a year is month-aligned and nothing moves.
  const series = monthSeries({ rows, resolved, months, today, start: from, end: to, nameOf, channels })

  // The board as it stands, which belongs to no window: what is open, and what
  // is behind. The front page used to work this out for itself — so the front
  // page said 58 were past their day while the register on the statistics page
  // said 50, and both were right about a question they had each invented.
  const now = { open: 0, behind: 0, late_steps: 0 }
  for (const row of rows) {
    if (row.done_at) continue
    now.open += 1
    let behind = false
    for (const st of stepsOf(row, today, resolved)) {
      if (st.state === 'late' && !st.delivered_day) { now.late_steps += 1; behind = true }
    }
    if (behind) now.behind += 1
  }

  // Names are the admin's to read. Everybody else gets the team's totals — the
  // shape of the month is not a secret — and, of the per-person rows, their
  // own: the page has always said "the whole team" to an admin and "assigned
  // to you" to everyone else, and now the numbers under it agree.
  const mineOnly = (list, ownerKey) => (isAdmin ? list
    : list.filter((x) => (ownerKey === 'id' ? x.id === req.user.id : (x.owner_ids || []).includes(req.user.id))))

  // What the window MADE, by kind — every piece created in it, whatever stage
  // it has reached. The type mix is a question about the work coming in, not
  // only about what happened to get published.
  //
  // Dated by the TASHKENT day it was made, like every other day on this page.
  // created_at is a UTC stamp, and its first ten characters put a piece made
  // at 03:00 on the 1st into the month before — so the pie and the tiles
  // above it disagreed about the edges of every month. And any type the board
  // does not know is counted as 'other' rather than dropped: the pie, its
  // total and the spreadsheet are then the same set of pieces.
  const dayOf = (iso) => (Number.isFinite(Date.parse(iso || '')) ? tashkentDay(iso) : '')
  const by_type = {}
  for (const row of rows) {
    const day = dayOf(row.created_at)
    if (!day || day < from || day > to) continue
    const k = CONTENT_TYPES.includes(row.type) ? row.type : 'other'
    by_type[k] = (by_type[k] || 0) + 1
  }
  // Change requests nobody had answered by the END of the window, on the work
  // in this scope — the backlog the window closed on. It used to be a count
  // for right now whatever the window, which put today's number, in red,
  // under a January of 2015. For the month that is running it is still
  // today's count: nothing asked for has been answered after today.
  const inScope = new Set(rows.map((r) => r.id))
  const revisions_open = (await all('SELECT content_id, created_at, resolved_at FROM revisions'))
    .filter((r) => {
      if (!inScope.has(r.content_id)) return false
      const asked = dayOf(r.created_at)
      if (asked && asked > to) return false
      // A stamp nobody can read is an answer all the same: it was never open
      // in the old count either.
      return !r.resolved_at || dayOf(r.resolved_at) > to
    }).length

  res.json({
    ...report,
    by_type,
    revisions_open,
    now,
    window: { from, to, days: Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1 },
    // The scope as it was APPLIED, not as it was asked for — a member asking
    // for somebody else is answered with their own — and named, so the page
    // can say whose numbers these are without a list of the team to look
    // the id up in (a member is never sent one).
    scope: { channel, type, project, person, person_name: person ? nameOf(person) : null, whole_team: !person, admin: isAdmin },
    months: series,
    people: mineOnly(report.people, 'id'),
    misses: mineOnly(report.misses, 'owner_ids').slice(0, 60),
    // How many there ARE; the list above is only how many are drawn.
    misses_total: mineOnly(report.misses, 'owner_ids').length,
  })
}))

// ---- the register -----------------------------------------------------------
// The same steps the report counts, listed instead of totalled, with no window
// at all: everything still outstanding and everything that was finished late.
//
// The statistics page used to work this list out for itself, on the client,
// from rules of its own — which is why the register under the numbers could
// say 310 while the numbers above it said 80, and why a missed SHOOT appeared
// in neither: the client's version only knew about releases, cuts and artwork.
// One model, counted once, on the server.
router.get('/misses', wrap(async (req, res) => {
  const { rows, resolved, isAdmin } = await scopedRows(req)
  const today = dayISO()
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => users.find((u) => u.id === id)?.name || null

  const out = []
  for (const row of rows) {
    for (const st of stepsOf(row, today, resolved)) {
      if (st.state !== 'late') continue
      // Everybody sees their own; an admin sees the whole board.
      if (!isAdmin && !st.owner_ids.includes(req.user.id)) continue
      out.push({
        id: row.id, title: row.title, type: row.type, channels: row.channels,
        step: st.phase, label: st.label, side: st.side, why: st.blame_why,
        due: st.due, promised: st.promised, revised: st.revised,
        done_day: st.delivered_day || null, days_late: st.days_late,
        open: !st.delivered_day,
        owner_ids: st.owner_ids, who: st.owner_ids.map(nameOf).filter(Boolean),
      })
    }
  }
  out.sort((a, b) => String(b.due).localeCompare(String(a.due)))
  res.json({ count: out.length, today, misses: out.slice(0, 800) })
}))

// ---- what the numbers are standing on ---------------------------------------
// Admins only, because every answer it gives is a list of somebody's unfinished
// paperwork. It is the one page on the board that reports on the board itself.
router.get('/health', adminOnly, wrap(async (req, res) => {
  const { rows, resolved, finalId } = await scopedRows(req)
  res.json({ today: dayISO(), checks: dataHealth({ rows, resolved, today: dayISO(), finalId }) })
}))

// ---- the day it actually went out -------------------------------------------
// The board stamps "went out" when somebody moves the card, and cards are moved
// in batches long after the posts went up — which is why a team that publishes
// on the day reads as 17% on time. This is the correction, and it is a WRITE:
// it moves the day these pieces count as published, and the statistics, the
// charts and the pay run all move with it. So it is an admin's deliberate act,
// one batch at a time, and each piece keeps a line in its own log saying what
// the day used to be and who changed it.
router.post('/health/went-out', adminOnly, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean).slice(0, 200) : []
  const day = String(req.body?.day ?? 'release')
  if (!ids.length) return res.status(400).json({ error: 'Nothing was picked' })
  if (day !== 'release' && !/^\d{4}-\d{2}-\d{2}$/.test(day))
    return res.status(400).json({ error: 'A day is YYYY-MM-DD, or “release” to use each piece’s own release day' })
  const today = dayISO()
  if (day !== 'release' && day > today) return res.status(400).json({ error: 'That day has not happened yet' })

  const rows = await all(`SELECT id, title, release_date, done_at, created_at FROM content WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const paidMonths = new Set((await all('SELECT DISTINCT month FROM payouts')).map((r) => r.month))
  let changed = 0
  const skipped = []
  for (const row of rows) {
    if (!row.done_at) { skipped.push({ id: row.id, why: 'it has not gone out' }); continue }
    const want = day === 'release' ? row.release_date : day
    if (!want) { skipped.push({ id: row.id, why: 'it has no release day to use' }); continue }
    if (want > today) { skipped.push({ id: row.id, why: 'that day has not happened yet' }); continue }
    // Noon Tashkent: a day, written as the moment in the middle of it, so it
    // reads as that day from either side of midnight.
    const stamp = `${want}T07:00:00.000Z`
    // Deliberately NOT refused for being older than the card: catching the
    // board up is half of what this board is used for, and a post from July
    // typed in during August is a card that was created after the day it is
    // being corrected to. A floor of two years is enough to catch a typo in
    // the year without calling the ordinary case an error.
    if (want < dayISO(-730)) { skipped.push({ id: row.id, why: 'that day is more than two years ago' }); continue }
    if (stamp === row.done_at) { skipped.push({ id: row.id, why: 'it already says that' }); continue }
    // The pay run follows this day. A month already recorded as paid cannot
    // take a piece in afterwards: its record is frozen, so nobody would be
    // paid for the piece at all.
    if (paidMonths.has(want.slice(0, 7)) && want.slice(0, 7) !== tashkentDay(row.done_at).slice(0, 7)) {
      skipped.push({ id: row.id, why: 'that month is recorded as paid — re-open it first' }); continue
    }
    await run('UPDATE content SET done_at = ? WHERE id = ?', stamp, row.id)
    await run(`INSERT INTO activity (content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at)
               VALUES (?, ?, ?, ?, 'updated', 'went_out', ?, ?, ?)`,
    row.id, row.title || '', req.user.id, req.user.name || '', row.done_at, stamp, new Date().toISOString())
    changed += 1
  }
  res.json({ changed, skipped })
}))


// ---- the KPI card ----------------------------------------------------------
// One person, one month, a set of ladders. What each band pays is the admin's
// and lives in the row; this file grades a month against it and never carries
// a number of its own.
//
// "This month" is Tashkent's month, like every other month on this board. It
// used to be the server's UTC one, so for the first five hours of every month
// the KPI card answered for the month that had just ended while the pay card
// beside it answered for the new one — and the head of the card added the two
// together.
const monthOf = (v) => (MONTH_RE.test(String(v || '')) ? String(v) : dayISO().slice(0, 7))
const cardFor = async (userId, month) =>
  (await get('SELECT * FROM kpi_cards WHERE user_id = ? AND month = ?', userId, month)) || null

// The month a card is graded against, measured off the same pay run the
// payslip uses, so the two can never disagree about how many pieces were late.
// For one person, or — `only` left out — for everybody in one run, which is
// how the nightly pass below measures the whole board without a run per card.
const monthStats = async (month, only = null) => {
  const from = `${month}-01`
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
  // skipKpi, because this is the call a KPI card is graded FROM: letting the
  // run grade cards here would be the run asking itself for its own answer.
  const { people } = await payRun({ from, to, only, skipKpi: true })
  return new Map((people || []).map((p) => [p.id, p.stats || {}]))
}
const statsFor = async (userId, month) => (await monthStats(month, userId)).get(Number(userId)) || {}

// ---- when the board last measured the cards --------------------------------
// A card is graded live on every load, off the same run the payslip uses, so
// the grade on screen and the money in the total can never disagree — and
// that stays exactly as it is. What nobody could say was how fresh the board's
// half of it was. So the nightly tick walks every card that reads the board,
// grades it once more off one fresh run of the month, and writes the minute it
// did so down: one meta key per month it covered, and one for the pass itself.
//
// A card read only from numbers somebody typed in has nothing to sync, and is
// never given a time; neither is a card made after the pass, which the pass
// never saw. What it returns is a count and never a name or a figure: the
// tick's answer is logged in plain text on the server.
const readsTheBoard = (card) => {
  let ladders = []
  try { ladders = JSON.parse(card?.ladders || '[]') } catch { ladders = [] }
  return (Array.isArray(ladders) ? ladders : []).some((l) =>
    METRICS[l?.metric]?.auto || METRICS[l?.gate?.metric]?.auto)
}
const SYNC_KEY = 'kpi_synced_at'
export async function syncKpiCards() {
  const at = new Date().toISOString()
  // Yesterday's month as well as today's: the 00:05 run on the 1st is the
  // last one that sees the month just ended whole, and a card still waiting
  // to be paid is read in the first days of the next.
  const months = [...new Set([dayISO(-1).slice(0, 7), dayISO().slice(0, 7)])]
  let graded = 0
  for (const month of months) {
    const cards = (await all('SELECT * FROM kpi_cards WHERE month = ?', month)).filter(readsTheBoard)
    if (!cards.length) continue
    const statsOf = await monthStats(month)
    for (const c of cards) if (gradeCard(c, statsOf.get(Number(c.user_id)) || {}).board_measured) graded += 1
  }
  const upsert = 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  await batch([[upsert, SYNC_KEY, at], ...months.map((m) => [upsert, `${SYNC_KEY}:${m}`, at])])
  return graded
}
// When THIS card's board readings were last measured by the nightly pass, or
// null when there is nothing to say: a card with no board reading on it, a
// month no pass has covered, or a card made since.
async function kpiSyncedAt(card, graded) {
  if (!card || !graded?.board_measured) return null
  const at = (await get('SELECT value FROM meta WHERE key = ?', `${SYNC_KEY}:${card.month}`))?.value || null
  return at && String(card.created_at || '') <= at ? at : null
}
// A graded card with its sync time on it — on the card as well as beside it,
// because the card is the thing a page keeps.
const kpiAnswer = async (month, card, stats) => {
  if (!card) return { month, frozen: false, kpi_synced_at: null, card: null }
  const graded = gradeCard(card, stats)
  const at = await kpiSyncedAt(card, graded)
  return { month, frozen: false, kpi_synced_at: at, card: { ...graded, kpi_synced_at: at } }
}

router.get('/kpi/mine', wrap(async (req, res) => {
  const month = monthOf(req.query.month)
  // A month that has been closed and paid on its KPI card is read from what
  // was written down the day it closed, not graded again: a ladder re-graded
  // in October can disagree with the KPI that September was actually paid.
  // Months closed before the card was frozen with them have nothing to read,
  // and are graded live as they always were.
  const paid = await get('SELECT breakdown FROM payouts WHERE user_id = ? AND month = ?', req.user.id, month)
  let kept = null
  try { kept = JSON.parse(paid?.breakdown || '{}')?.kpi || null } catch { kept = null }
  if (kept && Array.isArray(kept.ladders)) return res.json({ month, frozen: true, kpi_synced_at: null, card: { ...kept, kpi_synced_at: null } })
  const card = await cardFor(req.user.id, month)
  res.json(await kpiAnswer(month, card, card ? await statsFor(req.user.id, month) : {}))
}))

// ---- what one person earned -------------------------------------------------
// Declared BEFORE the admin gate below, deliberately: a person may see their
// own pay and nobody else's. Express runs middleware in the order it is
// declared, so this route escapes `adminOnly` and the rest do not.
router.get('/pay/mine', wrap(async (req, res) => {
  const { from, to } = req.query
  // This runs on every dashboard load, for everybody. Until somebody has set
  // rates there is nothing to work out and nothing to show, so it answers
  // without reading the board at all — the card stays hidden either way.
  const { pick } = await rateCards()
  if (pick(req.user.id).source === 'none') return res.json({ source: 'none' })
  const runOut = await payRun({ from, to, only: req.user.id })
  const me = runOut.people[0] || null
  if (!me) return res.json(null)
  // Whether this month has been closed and paid, or is still being worked out.
  const month = String(to || dayISO()).slice(0, 7)
  const row = await get('SELECT * FROM payouts WHERE user_id = ? AND month = ?', req.user.id, month)
  res.json({ ...me, payout: row ? publicPayout(row) : null })
}))

// ---- a person's own track record -------------------------------------------
// One number, once a month, told nobody anything about whether they were
// doing better than last time. Six months of it is a shape — and a shape is
// the thing that makes somebody want to beat it.
//
// A CLOSED month is read from what was written down when it closed; an open
// one is worked out live. Those are different kinds of fact and the answer
// says which is which, because a figure that can still move should never be
// drawn as though it were settled.
router.get('/pay/mine/history', wrap(async (req, res) => {
  res.json(await payHistory(req.user.id, Number(req.query.months) || 6))
}))

// ---- one person's month, job by job ----------------------------------------
// The payroll could say what a month came to; nobody could ever ask it what it
// came to FOR THAT PIECE. So the question people actually arrive with — "what
// was I paid for the video I cut on the 12th?" — was answered by nobody, and
// an argument about one job became an argument about the total.
//
// Every job is a line here: which piece, which hat, what it paid and why it
// paid that — the flat rate, the thousands it earned, or a figure an admin
// wrote in by hand with a reason attached.
//
// Declared before the admin gate: a person may read their own, an admin of the
// whole board may read anybody's, and nobody may read somebody else's.
//
// "An admin" means the one the rest of the payroll means. A channel admin runs
// the content on their own channels; the payroll is the whole board's, and
// this was the one door into it that still asked only for the word 'admin' —
// so somebody who runs the YouTube channel could open any person's month,
// rates, KPI card and the reasons written against their pay. /pay, /kpi/:id
// and every write already refused them; this now does too.
const payMonth = (q) => (MONTH_RE.test(String(q?.month || '')) ? String(q.month) : dayISO().slice(0, 7))

// What a closed month's record has only carried since the freeze was taught
// to keep it (the pillow bar since 0f2c171; the rest since the arrangement and
// its KPI ladders were frozen with the month).
const KEPT_SINCE = {
  pillowProgress: null, scheme: null, schemeRule: null,
  earned: null, pillow: null, pillowTopUp: null, kpi: null,
}

router.get('/pay/person/:id', wrap(async (req, res) => {
  const id = Number(req.params.id)
  if (!id) return res.status(404).json({ error: 'No such person' })
  if (!isFullAdmin(req.user) && req.user.id !== id) {
    return res.status(403).json({ error: 'That is somebody else’s pay' })
  }
  const month = payMonth(req.query)
  const from = monthStartOf(month)
  const to = monthEndOf(month)
  const out = await payRun({ from, to, only: id })
  const person = out.people[0] || null
  if (!person) return res.status(404).json({ error: 'No such person' })
  const closed = await get('SELECT * FROM payouts WHERE user_id = ? AND month = ?', id, month)
  const paid = closed ? publicPayout(closed) : null
  // A month that has been paid is READ from what was written down, not worked
  // out again. The total was frozen the day it closed; itemising it with
  // figures that are still being re-derived is how a payslip somebody has
  // already been paid against stops adding up.
  //
  // The fields the freeze only learnt to keep later are blanked first, so a
  // month closed before then says "not recorded" instead of borrowing today's
  // pillow, today's arrangement and today's KPI grades to explain a figure
  // that was settled without them.
  const frozen = paid?.breakdown && Object.keys(paid.breakdown).length
    ? { ...person, ...KEPT_SINCE, ...paid.breakdown, total: paid.total, frozen: true }
    : person
  res.json({
    month, from, to, person: frozen,
    payout: paid,
    // Only somebody who could actually save a change is offered the pencil;
    // every write below refuses a channel admin, so the button would only
    // ever have answered with an error.
    can_edit: isFullAdmin(req.user),
  })
}))

// ---- the monthly delivery report --------------------------------------------
// "Did I edit 15 reels this month or 16?" The payslip says what a month came
// to; it never gave anybody the plain tally to check it against, so people
// counted their own cards on the board at the end of every month.
//
// This is that tally, and it is built from the SAME list the pay run is
// (`contributions`) — one hat at a time, each piece on the day that person's
// work actually left their hands (the cut handed to review, the footage
// handed over, the piece published), never the day it was planned for. A cut
// due on the 29th and handed in on the 2nd is in the month it was handed in.
//
// COUNTED means the piece has got at least as far as Ready — it passed the
// revision loop, or went out. A piece credited to this month that is not
// there yet (a shoot whose cut is still being made, a cut sent back for a
// pravka) is listed apart as `pending`, so this tally and the payslip can be
// reconciled line by line instead of quietly disagreeing. A piece that was
// killed after somebody finished their part of it is paid for that part, so it
// is listed too — under pending, with the stage it ended on — rather than left
// out of the tally and found on the payslip.
//
// Grouped by hat, then by what the piece is: the kinds pay prices (reel,
// YouTube, target, post), and for a written piece its Telegram item type —
// plus the guiding posts, which are a flag on top and so are counted again
// in a row of their own. A hat nobody wore that month has no block at all.
const DELIVERY_HATS = ['editor', 'operator', 'designer', 'assignee', 'reviewer', 'face']
const DELIVERY_KINDS = ['reel', 'youtube', 'target', 'post', 'other']
const DELIVERY_TG = ['just_post', 'post_plus', 'webinar']
async function deliveryReport(userId, month) {
  const from = monthStartOf(month)
  const to = monthEndOf(month)
  const statuses = await all('SELECT * FROM statuses')
  const resolved = resolveGates(statuses)
  const at = (id) => (resolved.ordered || []).findIndex((st) => st.id === id)
  const readyAt = Number.isInteger(resolved.gates?.review?.index)
    ? resolved.gates.review.index
    : (resolved.ordered || []).findIndex((st) => /^ready$/i.test(String(st.label || '')))
  const reachedReady = (r) => !!r.done_at || (readyAt >= 0 && at(r.status_id) >= readyAt)
  const stageOf = (r) => statuses.find((st) => st.id === r.status_id)?.label || null

  const paid = await paidJobs([userId])
  const mine = (await contributions({ from, to, pay: true })).filter((c) => c.userId === userId
    && !paidInAnotherMonth(paid, c, from, to))
  const blocks = []
  for (const hat of DELIVERY_HATS) {
    const list = mine.filter((c) => c.hat === hat).sort((a, b) => String(a.day).localeCompare(String(b.day)) || a.row.id - b.row.id)
    if (!list.length) continue
    const item = (c) => ({ id: c.row.id, title: c.row.title, day: c.day })
    const counted = list.filter((c) => reachedReady(c.row))
    const rows = new Map()
    const add = (key, c) => { if (!rows.has(key)) rows.set(key, []); rows.get(key).push(item(c)) }
    for (const c of counted) {
      // What somebody WROTE is told apart by its Telegram item type, which is
      // what the copywriter is paid by; everything else by the kind of piece.
      if (hat === 'assignee' && c.row.telegram_type) add(`tg:${c.row.telegram_type}`, c)
      else add(bucketOf(c.row), c)
      if (hat === 'assignee' && c.row.is_guiding) add('guiding', c)
    }
    const order = [...DELIVERY_KINDS, ...DELIVERY_TG.map((k) => `tg:${k}`), 'guiding']
    blocks.push({
      hat,
      total: counted.length,
      rows: order.filter((k) => rows.has(k)).map((k) => ({ key: k, count: rows.get(k).length, items: rows.get(k) })),
      pending: list.filter((c) => !reachedReady(c.row)).map((c) => ({ ...item(c), stage: stageOf(c.row) })),
    })
  }
  return { month, from, to, blocks }
}

// Their own.
router.get('/delivery/mine', wrap(async (req, res) => {
  res.json(await deliveryReport(req.user.id, payMonth(req.query)))
}))
// Somebody else's — for whoever may read that person's pay (the same door as
// /pay/person/:id: a full admin, or the person themselves).
router.get('/delivery/person/:id', wrap(async (req, res) => {
  const id = Number(req.params.id)
  const person = id ? await get('SELECT id, name FROM users WHERE id = ?', id) : null
  if (!person) return res.status(404).json({ error: 'No such person' })
  if (!isFullAdmin(req.user) && req.user.id !== id) {
    return res.status(403).json({ error: 'That is somebody else’s work report' })
  }
  res.json({ ...(await deliveryReport(id, payMonth(req.query))), person })
}))

// A person's own numbers, and where this month puts them on the ladder.
// Declared BEFORE the admin gate for the same reason `/pay/mine` is: it
// exists so somebody can read their OWN, and below the gate it answered
// "Admins only" to every one of them — silently, because the card that
// asks for it treats a failure as "nothing to show".
// One person's own month: what they made, and which rung of the ladder it puts
// them on. Separate from the pay card because the ladder is not pay — a board
// that has set no rates still has a ladder, and somebody should be able to see
// where they are on it.
router.get('/work/mine', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const grades = await getMakerGrades()
  const rows = await all(`
    SELECT id, status_id, assignee_id, assignees, done_at, operator_id, editor_id, face_id, faces
    FROM content WHERE done_at IS NOT NULL`)
  const me = req.user.id
  let filmed = 0, edited = 0, both = 0, faced = 0, forMe = 0
  for (const r of rows) {
    if (dead.has(r.status_id)) continue
    const day = tashkentDay(r.done_at)
    if (day < from || day > to) continue
    if (r.operator_id === me && r.editor_id === me) both += 1
    else {
      if (r.operator_id === me) filmed += 1
      if (r.editor_id === me) edited += 1
    }
    if (wearers(r, 'face').includes(me)) faced += 1
    let list = []
    try { list = JSON.parse(r.assignees || '[]') } catch { list = [] }
    if ((list.length ? list : (r.assignee_id ? [r.assignee_id] : [])).includes(me)) forMe += 1
  }
  res.json({ from, to, filmed, edited, both, faced, made_for: forMe, ...gradeFor(grades, forMe || (filmed + edited + both)), ladder: grades })
}))

// A person's own PACE: what they made, month by month, by what it was — so a
// planner can answer "what would it take to earn X" from what this person
// has actually been doing rather than from a rate card in the abstract.
// Declared before the admin gate for the same reason /work/mine is.
//
// Buckets are what the board sells: a reel (type reel), a YouTube video (type
// video on the youtube channel — YouTube is a channel here, not a type), a
// target (type target), and the rest. A piece counts in a bucket once per
// month if this person had any hat on it; alongside, how OFTEN they filmed,
// cut or ran a piece of that kind, because tier pay is per hat and a person
// who only ever cuts YouTube videos is paid the cut, not the filming.
//
// The window is the last N COMPLETE months (this month so far is reported
// separately, so a half month never drags an average down), and it starts at
// the person's first delivered piece, so a newcomer's zero months before they
// joined are not counted against them either.
// `channels` reaches this from two directions — raw off the row as a JSON
// string, and already parsed into an array by contributions() — and
// JSON.parse of an array throws, so parsing blind quietly returned no channels
// at all. That is what filed a YouTube cut as "other work" and paid it the
// flat rate: the only kind whose test needs the channel was the only kind that
// could not see one.
const chanList = (v) => (Array.isArray(v) ? v : parseList(v))
// A post is its own kind now, not "other work". It is the kind this team
// publishes most of and the one whose pay depends most on how it did, and it
// was being filed in the drawer marked everything else.
const bucketOf = (r) => (r.type === 'reel' ? 'reel'
  : r.type === 'post' ? 'post'
  : r.type === 'target' ? 'target'
  : r.type === 'video' && chanList(r.channels).includes('youtube') ? 'youtube'
  : 'other')
const PACE_BUCKETS = ['post', 'reel', 'youtube', 'target', 'other']
router.get('/work/mine/pace', wrap(async (req, res) => {
  const months = Math.min(6, Math.max(1, Number(req.query.months) || 3))
  const me = req.user.id
  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = await all(`
    SELECT id, type, channels, status_id, assignee_id, assignees, done_at, operator_id, editor_id, skip_rate
    FROM content WHERE done_at IS NOT NULL`)
  const thisMonth = dayISO(0).slice(0, 7)
  const keys = []
  { let [y, m] = thisMonth.split('-').map(Number); for (let i = 0; i < months; i++) { m -= 1; if (m === 0) { m = 12; y -= 1 } keys.unshift(`${y}-${String(m).padStart(2, '0')}`) } }
  const blank = () => ({ pieces: 0, filmed: 0, edited: 0, made: 0 })
  const by = Object.fromEntries(PACE_BUCKETS.map((b) => [b, { months: Object.fromEntries(keys.map((k) => [k, blank()])) }]))
  const current = Object.fromEntries(PACE_BUCKETS.map((b) => [b, 0]))
  const total = blank()
  let skipSum = 0, skipN = 0, first = null
  for (const r of rows) {
    if (dead.has(r.status_id)) continue
    const filmed = r.operator_id === me, edited = r.editor_id === me
    const made = (parseList(r.assignees).length ? parseList(r.assignees) : (r.assignee_id ? [r.assignee_id] : [])).includes(me)
    if (!filmed && !edited && !made) continue
    const month = tashkentDay(r.done_at).slice(0, 7)
    if (!first || month < first) first = month
    const b = bucketOf(r)
    if (month === thisMonth) { current[b] += 1; continue }
    const slot = by[b].months[month]
    if (!slot) continue // older than the window
    slot.pieces += 1; total.pieces += 1
    if (filmed) { slot.filmed += 1; total.filmed += 1 }
    if (edited) { slot.edited += 1; total.edited += 1 }
    if (made) { slot.made += 1; total.made += 1 }
    if (r.skip_rate !== null && r.skip_rate !== undefined && Number.isFinite(Number(r.skip_rate))) { skipSum += Number(r.skip_rate); skipN += 1 }
  }
  // Average over the months since this person started, never over months
  // before they were here — and never over zero months.
  const active = keys.filter((k) => !first || k >= first)
  const div = Math.max(1, active.length)
  const shares = (t) => (t.pieces ? { film: t.filmed / t.pieces, edit: t.edited / t.pieces, made: t.made / t.pieces } : null)
  for (const b of PACE_BUCKETS) {
    const sum = Object.values(by[b].months).reduce((acc, m) => ({ pieces: acc.pieces + m.pieces, filmed: acc.filmed + m.filmed, edited: acc.edited + m.edited, made: acc.made + m.made }), blank())
    by[b].pieces = sum.pieces
    by[b].avg = Math.round((sum.pieces / div) * 10) / 10
    by[b].shares = shares(sum)
  }
  res.json({
    months: keys, since: first, active_months: active.length,
    by, current: { month: thisMonth, ...current },
    pieces: total.pieces, shares: shares(total),
    skip_avg: skipN ? Math.round(skipSum / skipN) : null, skip_counted: skipN,
  })
}))

// ---- when the team actually works ------------------------------------------
// Every number on the statistics page is a total for a month, and a total for
// a month cannot answer the question people keep asking out loud: when are we
// flat out, and when is nothing happening. Twenty pieces in a month is a
// steady four a week or it is nineteen in the last three days, and those are
// different teams with different problems — but they are the same twenty.
//
// So this returns the work as a series of DAYS: one reading per day per
// craft, counted the same way the payroll counts it, so the picture and the
// money can never disagree about what happened.
//
// A craft with nothing in the window is left out rather than drawn as a flat
// line along the floor. An empty band in a stack is a band you have to read
// the legend to dismiss.
const CRAFT = {
  operator: { key: 'filmed',    label: 'Filmed',    color: 'var(--chart-1)' },
  editor:   { key: 'edited',    label: 'Edited',    color: 'var(--chart-2)' },
  designer: { key: 'designed',  label: 'Designed',  color: 'var(--chart-3)' },
  assignee: { key: 'published', label: 'Published', color: 'var(--chart-4)' },
}
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

router.get('/activity', wrap(async (req, res) => {
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && Number.isFinite(Date.parse(`${v}T00:00:00Z`))
  const to = isDay(req.query.to) ? String(req.query.to) : dayISO()
  // Either a rolling window of days, or a named span with a start of its own —
  // the front page asks for a calendar month now, and a month is 28, 30 or 31
  // days depending on which one you are standing in.
  const asked = isDay(req.query.from) ? String(req.query.from) : null
  const span = asked && asked <= to
    ? Math.min(400, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${asked}T00:00:00Z`)) / 86400000) + 1)
    : Math.max(7, Math.min(365, Number(req.query.days) || 90))
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (span - 1))
  const from = start.toISOString().slice(0, 10)
  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null

  // Every day in the window, including the empty ones. A chart drawn only
  // from the days that had work in them puts Monday next to Friday and calls
  // the gap between them a straight line.
  const days = []
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }
  const slot = Object.fromEntries(days.map((d, i) => [d, i]))

  const list = await contributions({ from, to, channel })
  const counts = {}
  const weekday = Array(7).fill(0)
  const byPerson = new Map()
  let late = 0
  // One step per craft per PIECE. A piece made for two people is credited to
  // each of them (`people`) and is still one Published step on the chart.
  const stepSeen = new Set()
  for (const c of list) {
    const craft = CRAFT[c.hat]
    if (!craft) continue
    const i = slot[c.day]
    if (i === undefined) continue
    byPerson.set(c.userId, (byPerson.get(c.userId) || 0) + 1)
    if (stepSeen.has(`${c.row.id}:${c.hat}`)) continue
    stepSeen.add(`${c.row.id}:${c.hat}`)
    ;(counts[craft.key] ||= Array(days.length).fill(0))[i] += 1
    weekday[new Date(`${c.day}T00:00:00Z`).getUTCDay()] += 1
    if (c.late) late += 1
  }

  const series = Object.values(CRAFT)
    .filter((c) => counts[c.key]?.some((n) => n > 0))
    .map((c) => ({ key: c.key, label: c.label, color: c.color, values: counts[c.key] }))

  const totals = days.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))
  const done = totals.reduce((a, b) => a + b, 0)
  // The busiest day, and the longest run of days with nothing on them. Both
  // are the shape of the month rather than its size, which is the half a
  // total never says.
  let peak = null
  totals.forEach((n, i) => { if (n > 0 && (!peak || n > peak.n)) peak = { day: days[i], n } })
  // A quiet stretch only means something when there is a rhythm to break.
  // Four pieces all delivered on one day gives an eighty-nine day "quiet
  // stretch", which is arithmetically true and tells nobody anything.
  const activeDays = totals.filter((n) => n > 0).length
  // The days of the window that have happened. A calendar month still running
  // ends on days that are not here yet, and a day that has not happened is
  // neither a quiet day nor one to average the month's work over.
  const lived = Math.max(1, days.filter((d) => d <= dayISO()).length)
  let quiet = 0, run = 0
  if (activeDays >= 3) {
    for (const n of totals.slice(0, lived)) { run = n === 0 ? run + 1 : 0; if (run > quiet) quiet = run }
  }

  const users = Object.fromEntries((await all('SELECT * FROM users')).map((u) => [u.id, publicUser(u)]))
  const people = [...byPerson.entries()]
    .map(([id, n]) => ({ id, name: users[id]?.name || `#${id}`, color: users[id]?.color || null, n }))
    .sort((a, b) => b.n - a.n)

  // The chart counts STEPS — one per craft per piece — and the front page used
  // to print that total under the word "delivered", which is how a month of
  // fifty-three published pieces was reported to the team as five hundred and
  // thirty-nine. The pieces are counted here, once each, and returned beside
  // the steps under a name that cannot be mistaken for them.
  const statuses = await all('SELECT id, label FROM statuses')
  const killed = new Set(statuses.filter((s) => /^deleted$/i.test(s.label)).map((s) => s.id))
  const outRows = (await all(`SELECT id, status_id, channels, release_date, done_at FROM content WHERE done_at IS NOT NULL`))
    .map((r) => ({ ...r, channels: parseList(r.channels) }))
    .filter((r) => !killed.has(r.status_id) && (!channel || r.channels.includes(channel)))
    .map(pieceFacts)
    .filter((f) => f.out >= from && f.out <= to)
  const pieces = {
    out: outRows.length,
    on_time: outRows.filter((f) => f.verdict === 'on_time').length,
    late: outRows.filter((f) => f.verdict === 'late').length,
    no_day: outRows.filter((f) => f.verdict === 'no_day').length,
  }

  res.json({
    from, to, days, series, totals,
    done, late, pieces,
    active_days: activeDays,
    // Below one a day the figure rounds to nought and reads as "nothing
    // happened", so the rate is reported in the unit it is actually legible
    // in. The client is told which unit rather than guessing from the size.
    rate: done === 0 ? null
      : done / lived >= 1
        ? { n: Math.round((done / lived) * 10) / 10, per: 'day' }
        : done / lived >= 1 / 7
          ? { n: Math.round((done / lived) * 70) / 10, per: 'week' }
          : { n: Math.round((done / lived) * 300) / 10, per: 'month' },
    peak,
    quiet_run: quiet,
    weekday: weekday.map((n, i) => ({ key: String(i), label: WEEKDAY[i], value: n })),
    // Who did how much, by name, is the admin's to read — as on /stats, where
    // everybody else is answered with their own row and nobody else's.
    people: req.user.role === 'admin' ? people : people.filter((p) => p.id === req.user.id),
  })
}))

router.use(adminOnly)

router.get('/', wrap(async (req, res) => {
  const { from, to, type } = req.query
  const hat = HATS[req.query.hat] ? req.query.hat : 'assignee'
  const list = (await contributions({ from, to, type })).filter((c) => c.hat === hat)

  const users = (await all('SELECT * FROM users')).map(publicUser)
  const byUser = {}
  const byChannel = {} // the channel-side view of the exact same contributions
  // People are counted per person; PIECES are counted once. A hat several
  // people wear on one piece (made for two, signed off by two) gives each of
  // them a row, and is one "task completed" for the board and for its channel.
  const pieceSeen = new Set()
  for (const c of list) {
    const r = c.row
    const e = (byUser[c.userId] = byUser[c.userId] || { total: 0, late: 0, byChannel: {}, byType: {}, items: [] })
    e.total += 1
    if (c.late) e.late += 1
    for (const ch of r.channels) {
      e.byChannel[ch] = (e.byChannel[ch] || 0) + 1
      const cc = (byChannel[ch] = byChannel[ch] || { total: 0, byType: {}, byPerson: {} })
      cc.byPerson[c.userId] = (cc.byPerson[c.userId] || 0) + 1
      if (pieceSeen.has(`${ch}:${r.id}`)) continue
      pieceSeen.add(`${ch}:${r.id}`)
      cc.total += 1
      if (r.type && r.type !== 'other') cc.byType[r.type] = (cc.byType[r.type] || 0) + 1
    }
    if (r.type && r.type !== 'other') e.byType[r.type] = (e.byType[r.type] || 0) + 1
    e.items.push({ id: r.id, title: r.title, channel: r.channels[0], channels: r.channels, done_at: r.done_at, day: c.day, late: c.late })
  }
  const report = users
    .filter((u) => u.role !== 'admin' || byUser[u.id])
    .map((u) => ({
      id: u.id, name: u.name, color: u.color, avatar: u.avatar, role: u.role,
      total: byUser[u.id]?.total || 0,
      late: byUser[u.id]?.late || 0,
      byChannel: byUser[u.id]?.byChannel || {},
      byType: byUser[u.id]?.byType || {},
      items: (byUser[u.id]?.items || []).sort((a, b) => String(b.day).localeCompare(String(a.day))),
    }))
    .sort((a, b) => b.total - a.total)
  res.json({ hat, report, totalDone: new Set(list.map((c) => c.row.id)).size, byChannel })
}))

// Closing a month: everything that went out in it is marked paid, once, with
// who said so. Paying happens outside this system — this records that it was
// done, the same way the sprint board records who dropped a task rather than
// pretending the system did it.
router.post('/work/paid', adminOnly, wrap(async (req, res) => {
  const month = String(req.body?.month ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'A month is YYYY-MM' })
  const stamp = new Date().toISOString()
  const rows = await all('SELECT id, done_at, paid_month FROM content WHERE done_at IS NOT NULL')
  const due = rows.filter((r) => !r.paid_month && tashkentDay(r.done_at).slice(0, 7) === month)
  for (const r of due) {
    await run('UPDATE content SET paid_month = ?, paid_at = ?, paid_by = ? WHERE id = ?', month, stamp, req.user.id, r.id)
  }
  res.json({ month, marked: due.length })
}))

// Re-opening one, for the month somebody closed by mistake. Only what THAT
// month stamped comes back — a piece paid in an earlier month is left alone.
router.post('/work/unpaid', adminOnly, wrap(async (req, res) => {
  const month = String(req.body?.month ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'A month is YYYY-MM' })
  const rows = await all('SELECT id FROM content WHERE paid_month = ?', month)
  for (const r of rows) await run('UPDATE content SET paid_month = NULL, paid_at = NULL, paid_by = NULL WHERE id = ?', r.id)
  res.json({ month, reopened: rows.length })
}))

// ---- what each person actually made this month -----------------------------
// The delivery report says whether work was on time. It never said WHAT
// anybody made — and for an operator or an editor, that is the whole question:
// how many did I film, how many did I cut, and how many did I do both ends of.
// Both ends matters on its own: a piece somebody shot AND edited is one piece
// of work, not two half ones, and counting it in both columns and nowhere else
// hides the people carrying whole pieces alone.
//
// And under the counts, the register the numbers came from — one row per
// piece, numbered, with where it went live and whether it has been paid — so
// anybody can check the total rather than take it.
router.get('/work', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null

  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => users.find((u) => u.id === id)?.name || null
  const tiers = await getSkipTiers()
  const grades = await getMakerGrades()

  const rows = (await all(`
    SELECT id, title, channels, type, status_id, assignee_id, assignees, done_at, release_date,
           operator_id, editor_id, designer_id, face_id, faces, views, skip_rate, post_link, paid_month
    FROM content
  `)).map((r) => ({ ...r, channels: parseList(r.channels) }))

  // A piece counts in the window by the day it went out — the day the work
  // was finished, not the day it was planned.
  const made = rows.filter((r) => {
    if (dead.has(r.status_id)) return false
    if (channel && !r.channels.includes(channel)) return false
    if (!r.done_at) return false
    const day = tashkentDay(r.done_at)
    return day >= from && day <= to
  })

  const zero = () => ({ filmed: 0, edited: 0, both: 0, faced: 0, made_for: 0, views: 0, tier_pay: 0 })
  const people = {}
  const seat = (id) => (people[id] ||= zero())

  for (const r of made) {
    const shot = r.operator_id
    const cut = r.editor_id
    const tier = tierFor(tiers, r.skip_rate)
    // Both ends counted ONCE, as one piece carried alone — not as a film and
    // an edit that happen to share a name.
    if (shot && cut && shot === cut) seat(shot).both += 1
    else {
      if (shot) seat(shot).filmed += 1
      if (cut) seat(cut).edited += 1
    }
    if (shot && tier) seat(shot).tier_pay += tier.per_film
    if (cut && tier) seat(cut).tier_pay += tier.per_edit
    for (const id of wearers(r, 'face')) seat(id).faced += 1
    for (const id of (() => { try { const a = JSON.parse(r.assignees || '[]'); return a.length ? a : (r.assignee_id ? [r.assignee_id] : []) } catch { return r.assignee_id ? [r.assignee_id] : [] } })()) {
      const p = seat(id)
      p.made_for += 1
      if (r.views != null) p.views += Number(r.views) || 0
    }
  }

  res.json({
    from,
    to,
    tiers,
    people: Object.entries(people).map(([id, p]) => ({
      user_id: Number(id),
      name: nameOf(Number(id)) || 'Someone who left',
      ...p,
      // Which rung of the ladder their delivered count puts them on.
      ...gradeFor(grades, p.made_for || (p.filmed + p.edited + p.both)),
    })).sort((a, b) => (b.filmed + b.edited + b.both) - (a.filmed + a.edited + a.both)),
    // The register the counts came from, numbered, newest last so the numbers
    // read the way a spreadsheet reads.
    sheet: made
      .sort((a, b) => String(a.done_at).localeCompare(String(b.done_at)))
      .map((r, i) => ({
        n: i + 1,
        id: r.id,
        title: r.title,
        type: r.type,
        channels: r.channels,
        day: tashkentDay(r.done_at),
        filmed_by: nameOf(r.operator_id),
        edited_by: nameOf(r.editor_id),
        face: wearers(r, 'face').map(nameOf).filter(Boolean).join(', ') || null,
        post_link: r.post_link || '',
        views: r.views == null ? null : Number(r.views),
        skip_rate: r.skip_rate == null ? null : Number(r.skip_rate),
        tier: tierFor(tiers, r.skip_rate)?.name || null,
        // Paid is a fact somebody recorded, not a guess from the calendar.
        paid: !!r.paid_month,
        paid_month: r.paid_month || null,
      })),
  })
}))

// ---- what it all got watched -----------------------------------------------
// The board knew what went out and when, and nothing about whether anybody
// watched it. A month of twenty pieces and a month of three are the same month
// to a delivery report, which is a strange thing for a marketing board to
// believe.
//
// The numbers are typed in by hand on the task (nobody is plugged into
// Instagram's API here), so this only adds them up — by type, by channel, by
// the person the piece was for — and says plainly how much of the month has
// actually been counted, because a total drawn from a third of the pieces is
// a number that will be read as if it were all of them.
//
// A piece counts in the window by the day it went out, which is the day its
// views started being earned.
router.get('/views', wrap(async (req, res) => {
  const { from, to } = statsRange(req.query)
  const channel = req.query.channel && req.query.channel !== 'all' ? String(req.query.channel) : null

  const statuses = await all('SELECT * FROM statuses')
  const dead = new Set(statuses.filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const channels = await all('SELECT key, label FROM channels ORDER BY sort, id')
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const nameOf = (id) => users.find((u) => u.id === id)?.name || null

  const rows = (await all(`
    SELECT id, title, channels, type, status_id, assignee_id, assignees, done_at, release_date, views, views_at
    FROM content
  `)).map((r) => ({ ...r, channels: parseList(r.channels) }))

  const out = rows.filter((r) => {
    if (dead.has(r.status_id)) return false
    if (channel && !r.channels.includes(channel)) return false
    if (!r.done_at) return false
    const day = tashkentDay(r.done_at)
    return day >= from && day <= to
  })

  const zero = () => ({ pieces: 0, counted: 0, views: 0 })
  const add = (bucket, r) => {
    bucket.pieces += 1
    if (r.views !== null && r.views !== undefined) { bucket.counted += 1; bucket.views += Number(r.views) || 0 }
  }
  const totals = zero()
  const byType = {}
  const byChannelMap = {}
  const byPersonMap = new Map()
  for (const r of out) {
    add(totals, r)
    const ty = r.type || 'other'
    add((byType[ty] = byType[ty] || zero()), r)
    for (const ch of r.channels) add((byChannelMap[ch] = byChannelMap[ch] || zero()), r)
    // The people the piece was FOR. One piece, several makers, is counted for
    // each of them — the same way the delivery report counts it.
    let made = []
    try { made = JSON.parse(r.assignees || '[]').map(Number).filter(Boolean) } catch { made = [] }
    if (!made.length && r.assignee_id) made = [r.assignee_id]
    for (const uid of made) {
      if (!byPersonMap.has(uid)) byPersonMap.set(uid, { id: uid, name: nameOf(uid), ...zero() })
      add(byPersonMap.get(uid), r)
    }
  }

  const withAvg = (b) => ({ ...b, avg: b.counted > 0 ? Math.round(b.views / b.counted) : null })
  res.json({
    from,
    to,
    channel,
    totals: withAvg(totals),
    // How much of the month is actually measured. A total nobody can weigh is
    // a number that gets read as the whole truth.
    uncounted: totals.pieces - totals.counted,
    byType: Object.entries(byType)
      .map(([key, b]) => ({ key, ...withAvg(b) }))
      .sort((a, b) => b.views - a.views || a.key.localeCompare(b.key)),
    byChannel: channels
      .map((c) => ({ key: c.key, label: c.label, ...withAvg(byChannelMap[c.key] || zero()) }))
      .filter((c) => c.pieces > 0)
      .sort((a, b) => b.views - a.views),
    byPerson: [...byPersonMap.values()].map(withAvg).sort((a, b) => b.views - a.views),
    // The pieces themselves, best first — the answer to "what actually worked".
    top: out
      .filter((r) => r.views !== null && r.views !== undefined)
      .sort((a, b) => Number(b.views) - Number(a.views))
      .slice(0, 20)
      .map((r) => ({
        id: r.id, title: r.title, type: r.type, channels: r.channels,
        views: Number(r.views) || 0, day: tashkentDay(r.done_at),
      })),
  })
}))

// ---- pay --------------------------------------------------------------------
// The board already knows, to the day, what every person delivered and how
// much of it landed on the day they promised. Payroll was being rebuilt from
// that by hand, in a spreadsheet, once a month.
//
// The RATES are not in this file and never will be: they change, they differ
// per person, and hard-coding somebody's wage into a git repository is how a
// pay rise becomes a deploy. They live in `pay_rules` — one default card
// everybody starts from, and a card per person that overrides it — and are
// edited in Admin → Pay. This file only does the arithmetic.
export const RATE_FIELDS = [
  'base', 'per_shoot', 'per_edit', 'per_design', 'per_publish', 'per_review',
  'quota', 'quota_bonus', 'ontime_bonus', 'ontime_target', 'late_penalty',
  // What the work was WORTH, not just how much of it there was. A month of
  // twenty pieces nobody watched and a month of three that half the city saw
  // are the same month to a piece-rate card, which is why this one counts
  // views too: per thousand, and a target that pays whole when it is reached.
  'per_1k_views', 'views_target', 'views_bonus',
  // What a piece pays depends on WHAT IT IS, not only on which hat you wore.
  // A YouTube video is a day's shoot and a week's cut; a reel is an afternoon.
  // One `per_shoot` for both was the board quietly paying the same for two
  // different jobs, so shooting and editing are priced per kind of work.
  // A kind left at 0 falls back to the flat rate above, so a board that has
  // not set them keeps working exactly as it did and can adopt them one at a
  // time. "Shot AND edited it" needs no rate of its own: the person wore both
  // hats, so they are paid for both.
  'per_shoot_reel', 'per_edit_reel',
  'per_shoot_youtube', 'per_edit_youtube',
  'per_shoot_target', 'per_edit_target',
  // Standing in front of the camera is a job with a rate, priced the same way.
  'per_face', 'per_face_reel', 'per_face_youtube', 'per_face_target',
  // The safety pillow: a floor under the whole month. Work fills it; the
  // arrangement that stands over it is `scheme`, which is not a number and so
  // is carried beside this list rather than in it.
  'pillow',
]
const BLANK_RATES = {
  currency: 'UZS', base: 0, per_shoot: 0, per_edit: 0, per_design: 0, per_publish: 0,
  per_review: 0, quota: 0, quota_bonus: 0, ontime_bonus: 0, ontime_target: 90, late_penalty: 0,
  per_1k_views: 0, views_target: 0, views_bonus: 0,
  per_shoot_reel: 0, per_edit_reel: 0,
  per_shoot_youtube: 0, per_edit_youtube: 0,
  per_shoot_target: 0, per_edit_target: 0,
  per_face: 0, per_face_reel: 0, per_face_youtube: 0, per_face_target: 0,
  kind_rules: {},
}
// What a hand-made line on the month is called when nobody named it.
const ADJUST_LABEL = { bonus: 'Bonus', fine: 'Fine', advance: 'Advance paid', correction: 'Correction' }
export const ADJUST_KINDS = Object.keys(ADJUST_LABEL)
const HAT_RATE = {
  operator: 'per_shoot', editor: 'per_edit', designer: 'per_design',
  assignee: 'per_publish', reviewer: 'per_review', face: 'per_face',
}
// The kinds of work the board prices apart, and which rate field each one
// reads for each hat. Shooting, editing and appearing are split by kind;
// designing and signing off do not change shape with the format.
const KINDS = ['post', 'reel', 'youtube', 'target']
const KIND_LABEL = { post: 'posts', reel: 'reels', youtube: 'YouTube', target: 'targets', other: 'other work' }
const KIND_RATE = {
  operator: { reel: 'per_shoot_reel', youtube: 'per_shoot_youtube', target: 'per_shoot_target' },
  editor: { reel: 'per_edit_reel', youtube: 'per_edit_youtube', target: 'per_edit_target' },
  face: { reel: 'per_face_reel', youtube: 'per_face_youtube', target: 'per_face_target' },
}

// ---- what a piece is worth, by what kind of piece it is ---------------------
// The maker's side of the card. A flat per-piece rate pays the same for a post
// half the city read and a post nobody opened, which is the one thing a
// content board should never be indifferent to — so each kind carries a rule
// of its own: a flat rate, a gate in views, and what a thousand views is worth
// once the gate is cleared.
//
// Over the gate, the thousands are the WHOLE payment for that piece. Under it,
// the flat rate and nothing else. And a kind with no rule set is paid exactly
// as it always was, by the flat per-piece rate for the hat — which is what
// lets this be adopted one kind at a time without anybody's pay moving.
export const kindRule = (rates, kind) => {
  const r = (rates?.kind_rules || {})[kind]
  if (!r) return null
  const flat = Number(r.flat) || 0
  const gate = Number(r.gate) || 0
  const per1k = Number(r.per_1k) || 0
  return flat || per1k ? { flat, gate, per_1k: per1k } : null
}

// One piece, under one rule. `views` is what somebody counted; a piece nobody
// has counted yet cannot have cleared a gate, so it is paid the flat rate and
// says so rather than being called a zero-view piece.
export function pieceWorth(rule, views) {
  const seen = views === null || views === undefined || views === '' || !Number.isFinite(Number(views))
    ? null : Number(views)
  if (rule.per_1k > 0 && seen !== null && seen >= rule.gate) {
    return { amount: Math.round((seen / 1000) * rule.per_1k), by: 'views', views: seen, gate: rule.gate }
  }
  return {
    amount: rule.flat, by: seen === null ? 'uncounted' : 'flat', views: seen, gate: rule.gate,
    // How far this piece is from being paid by the thousand instead — the one
    // number that makes a maker open the analytics tab.
    to_gate: rule.per_1k > 0 && rule.gate > 0 && seen !== null ? Math.max(0, rule.gate - seen) : null,
  }
}

// ---- whose card is this ----------------------------------------------------
// Three places a rate can come from, in order: the person's own card, the card
// their ROLE is on, and the board-wide default. Role cards are why the pay
// sheet stopped being thirty-five copies of the same numbers — set the editor
// card once and every editor is on it, with anybody who negotiated their own
// terms overriding it in the one place that says so.
//
// A person's role for pay is the craft they are actually paid for. The account
// role says "member" for half the team, so a crew role wins where there is
// one: an editor who is a member of the team is paid the editor card.
const PAY_ROLE_ORDER = ['operator', 'editor', 'designer', 'reviewer', 'ambassador']
export function payRoleOf(user) {
  const crew = Array.isArray(user?.crew_roles) ? user.crew_roles : []
  for (const r of PAY_ROLE_ORDER) if (crew.includes(r)) return r
  return user?.role || null
}

const parseRules = (v) => {
  if (!v) return {}
  if (typeof v === 'object') return v
  try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch { return {} }
}

async function rateCards(users = null) {
  const rows = await all('SELECT * FROM pay_rules')
  const team = users || (await all('SELECT * FROM users')).map(publicUser)
  const byId = new Map(team.map((u) => [u.id, u]))
  const fallback = rows.find((r) => !r.user_id && !r.role) || null
  const byRole = new Map(rows.filter((r) => !r.user_id && r.role).map((r) => [r.role, r]))
  const mine = new Map(rows.filter((r) => r.user_id).map((r) => [r.user_id, r]))
  const pick = (userId) => {
    const role = payRoleOf(byId.get(userId))
    const own = mine.get(userId) || null
    const template = role ? byRole.get(role) || null : null
    const row = own || template || fallback
    if (!row) return { ...BLANK_RATES, source: 'none', role: role || null }
    const card = {
      currency: row.currency || 'UZS',
      source: own ? 'own' : template ? 'role' : 'default',
      role: role || null,
      from_role: own ? null : template ? row.role : null,
      scheme: schemeOf(row.scheme),
    }
    for (const f of RATE_FIELDS) card[f] = Number(row[f]) || 0
    card.kind_rules = parseRules(row.kind_rules)
    return card
  }
  return { pick, hasDefault: !!fallback, roleCards: [...byRole.keys()] }
}

// The card one person is on — their own, their role's template, or the board
// default — for a page that shows somebody their own rates and nothing else.
export async function rateCardFor(userId) {
  return (await rateCards()).pick(userId)
}
export const RATE_KINDS = KINDS

// One person's month, or everybody's. `only` restricts it to one id, which is
// how a person sees their own pay without seeing the payroll.
// ---- a closed month --------------------------------------------------------
// Rows come back with the frozen figures unpacked, so a caller never has to
// know that the breakdown rides as text.
function publicPayout(row) {
  let breakdown = {}
  try { breakdown = JSON.parse(row.breakdown || '{}') } catch { breakdown = {} }
  return {
    user_id: row.user_id, month: row.month, currency: row.currency || 'UZS',
    total: Number(row.total) || 0, note: row.note || '',
    paid_at: row.paid_at || null, marked_by: row.marked_by || null,
    closed_at: row.created_at, breakdown,
  }
}

// The jobs the CLOSED months' records carry for these people:
// "person:piece:hat" → the months that paid it.
async function paidJobs(ids) {
  const out = new Map()
  if (!ids.length) return out
  const rows = await all(`SELECT user_id, month, breakdown FROM payouts WHERE user_id IN (${ids.map(() => '?').join(',')})`, ...ids)
  for (const row of rows) {
    for (const it of publicPayout(row).breakdown.items || []) {
      const k = `${row.user_id}:${it.id}:${it.hat}`
      out.set(k, (out.get(k) || new Set()).add(row.month))
    }
  }
  return out
}
// A job's day can move after it was paid — a piece un-published and published
// again is stamped afresh — and a job paid in September is not owed again in
// October. So a job is left out when a closed month paid it, that month is
// not the one its day stands in now, and that month lies outside the range
// being worked out. Judged job by job: a range of two months, or of all time,
// still shows every closed month's own work, and a job that moved from one
// month of the range to another once.
const paidInAnotherMonth = (paid, c, from, to) => {
  const months = paid.get(`${c.userId}:${c.row.id}:${c.hat}`)
  if (!months || months.has(String(c.day).slice(0, 7))) return false
  const inRange = (m) => (!from || m >= String(from).slice(0, 7)) && (!to || m <= String(to).slice(0, 7))
  return ![...months].some(inRange)
}
// The other side of that rule. A record about to be deleted may be the ONLY
// one paying a job whose day has since moved into another closed month — that
// month was recorded without it, on the strength of this record. Returns
// those months: re-opened first and recorded again, they take the job in.
async function strandedBy(records) {
  const jobs = new Map()
  for (const row of records) {
    for (const it of publicPayout(row).breakdown.items || []) jobs.set(`${row.user_id}:${it.id}:${it.hat}`, row.month)
  }
  if (!jobs.size) return []
  const ids = [...new Set(records.map((r) => r.user_id))]
  const paid = await paidJobs(ids)
  const closed = new Set((await all(`SELECT user_id, month FROM payouts WHERE user_id IN (${ids.map(() => '?').join(',')})`, ...ids))
    .map((r) => `${r.user_id}:${r.month}`))
  const months = new Set()
  for (const c of await contributions({ pay: true })) {
    const k = `${c.userId}:${c.row.id}:${c.hat}`
    const own = String(c.day).slice(0, 7)
    if (!jobs.has(k) || jobs.get(k) === own) continue
    if (closed.has(`${c.userId}:${own}`) && !paid.get(k).has(own)) months.add(own)
  }
  return [...months].sort()
}

const monthStartOf = (m) => `${m}-01`
const monthEndOf = (m) => {
  const d = new Date(`${m}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}
const monthsBack = (n, from = dayISO()) => {
  const out = []
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  for (let i = 0; i < n; i++) { out.unshift(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1) }
  return out
}

// The last n months for one person. One pass over the board covers all of
// them: contributions are dated, so the whole span is fetched once and each
// month takes the slice that belongs to it.
async function payHistory(userId, n = 6) {
  const months = monthsBack(Math.max(1, Math.min(24, n)))
  const spanFrom = monthStartOf(months[0])
  const today = dayISO()
  const spanTo = today
  const list = await contributions({ from: spanFrom, to: spanTo, pay: true })
  const closed = await all('SELECT * FROM payouts WHERE user_id = ?', userId)
  const byMonth = new Map(closed.map((r) => [r.month, publicPayout(r)]))
  const out = []
  for (const m of months) {
    const from = monthStartOf(m)
    const to = monthEndOf(m) < today ? monthEndOf(m) : today
    const paid = byMonth.get(m) || null
    if (paid) { out.push({ month: m, total: paid.total, currency: paid.currency, settled: true, payout: paid }); continue }
    const slice = list.filter((c) => String(c.day).slice(0, 7) === m)
    const run = await payRun({ from, to, only: userId, list: slice })
    const p = run.people[0]
    // A month with nothing delivered in it is a month this board has no record
    // of this person working, and there are two ways it lies if drawn as data.
    // With a base salary on the card the calculator reports a full month's pay
    // — "whatever the count" — including for months before they joined. With
    // no base it reports a confident nought, which reads as "you earned
    // nothing in April" rather than "April is not on the record". Both are
    // marked, and the chart draws neither as a bar.
    const delivered = p?.delivered || 0
    out.push({
      month: m, total: p ? Math.round(p.total) : 0, currency: p?.currency || 'UZS',
      settled: false, payout: null, delivered,
      assumed: delivered === 0,
      running: m === today.slice(0, 7),
    })
  }
  return { months: out, currency: out.find((m) => m.total > 0)?.currency || 'UZS' }
}

async function payRun({ from, to, only, list: given, skipKpi = false }) {
  const list = given || await contributions({ from, to, pay: true })
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const { pick } = await rateCards(users)
  const wanted = only ? users.filter((u) => u.id === Number(only)) : users
  // The month these figures land in, which is what a hand-made correction is
  // filed against.
  const month = String(to || dayISO()).slice(0, 7)
  const ids = wanted.map((u) => u.id)
  const holes = ids.map(() => '?').join(',') || '0'
  const overrides = ids.length
    ? await all(`SELECT * FROM pay_overrides WHERE month = ? AND user_id IN (${holes})`, month, ...ids)
    : []
  const overrideOf = new Map(overrides.map((o) => [`${o.user_id}:${o.content_id}:${o.hat}`, o]))
  const adjustments = ids.length
    ? await all(`SELECT * FROM pay_adjustments WHERE month = ? AND user_id IN (${holes}) ORDER BY id`, month, ...ids)
    : []
  const paid = await paidJobs(ids)

  const counted = {}
  for (const c of list) {
    if (paidInAnotherMonth(paid, c, from, to)) continue
    const e = (counted[c.userId] = counted[c.userId] || { hats: {}, byKind: {}, late: 0, done: 0, views: 0, counted: 0, items: [], skipSum: 0, skipN: 0, seenSkip: new Set() })
    e.hats[c.hat] = (e.hats[c.hat] || 0) + 1
    // …and again split by what the piece was, which is what the per-kind
    // rates are priced against. Same classifier the pace report uses, so the
    // planner's answer and the payslip never disagree about what a reel is.
    const kind = bucketOf(c.row)
    e.byKind[c.hat] = e.byKind[c.hat] || {}
    e.byKind[c.hat][kind] = (e.byKind[c.hat][kind] || 0) + 1
    e.done += 1
    if (c.late) e.late += 1
    // Views belong to the person the piece was FOR — the content maker — and
    // are counted once even though they wear several hats on the same task.
    // A piece nobody has counted yet adds nothing rather than adding zero.
    if (c.hat === 'assignee' && Number.isFinite(Number(c.row.views)) && c.row.views !== null) {
      e.views += Number(c.row.views)
      e.counted += 1
    }
    // The skip rate is a fact about the PIECE, so it is averaged once per
    // piece however many hats this person wore on it.
    if (!e.seenSkip.has(c.row.id) && c.row.skip_rate !== null && c.row.skip_rate !== undefined && Number.isFinite(Number(c.row.skip_rate))) {
      e.seenSkip.add(c.row.id); e.skipSum += Number(c.row.skip_rate); e.skipN += 1
    }
    e.items.push({
      id: c.row.id, title: c.row.title, hat: c.hat, kind, day: c.day, late: c.late,
      views: c.row.views ?? null,
    })
  }

  const people = wanted.map((u) => {
    const e = counted[u.id] || { hats: {}, byKind: {}, late: 0, done: 0, views: 0, counted: 0, items: [], skipSum: 0, skipN: 0, seenSkip: new Set() }
    const rates = pick(u.id)

    // ---- what each job on each piece paid ----------------------------------
    // Priced ONE JOB AT A TIME rather than count × rate, for three reasons a
    // month has taught this board: a post is worth what its own views make it,
    // an admin needs to be able to overrule a single line without hand-editing
    // a total, and a person asking "what was I paid for this?" deserves the
    // answer for that piece rather than a bar chart of the month.
    const items = []
    const byKindViews = {}
    let blanketViews = 0   // views on pieces whose kind has no rule of its own
    for (const it of e.items) {
      const rule = it.hat === 'assignee' ? kindRule(rates, it.kind) : null
      let amount = 0
      let rate = 0
      let by = 'rate'
      let gate = null
      let toGate = null
      // WHICH FIELD OF THE CARD PRICED IT, carried out beside the figure so a
      // payslip can state the rule it was paid under instead of guessing:
      // `rate_key` is the field itself, `rate_scope` says what kind of field
      // that is — the kind's own rule, a per-kind rate for this hat, or the
      // hat's flat rate a kind falls back to when nobody set one. A page
      // working that out for itself would need its own copy of KIND_RATE,
      // and a copy is the thing that drifts. Nothing below reads either.
      let rateKey = null
      let rateScope = null
      if (rule) {
        const worth = pieceWorth(rule, it.views)
        amount = worth.amount
        rate = worth.by === 'views' ? rule.per_1k : rule.flat
        by = worth.by
        gate = worth.gate || null
        toGate = worth.to_gate ?? null
        rateKey = 'kind_rule'
        rateScope = 'rule'
      } else {
        // The old way, unchanged: the per-kind rate for this hat where the
        // board set one, the flat rate for the hat where it did not.
        const perKind = KIND_RATE[it.hat]
        const field = (perKind && perKind[it.kind]) || HAT_RATE[it.hat]
        rate = Number(rates[field]) || Number(rates[HAT_RATE[it.hat]]) || 0
        amount = rate
        rateKey = Number(rates[field]) ? field : (HAT_RATE[it.hat] || null)
        rateScope = rateKey && rateKey !== HAT_RATE[it.hat] ? 'kind' : 'hat'
      }
      // Views are counted per kind and never in one lump: post views and reel
      // views are different money and the payslip now says so. The blanket
      // per-thousand rate keeps paying, but only on the kinds nobody has
      // priced — otherwise the same view would be paid for twice.
      if (it.hat === 'assignee' && it.views !== null && Number.isFinite(Number(it.views))) {
        byKindViews[it.kind] = (byKindViews[it.kind] || 0) + Number(it.views)
        if (!rule) blanketViews += Number(it.views)
      }
      const o = overrideOf.get(`${u.id}:${it.id}:${it.hat}`)
      const line = {
        ...it, rate, amount: Math.round(amount), by, gate, to_gate: toGate,
        rate_key: rateKey, rate_scope: rateScope,
        label: HATS[it.hat]?.label || it.hat,
      }
      if (o) {
        line.was = line.amount
        line.amount = Math.round(Number(o.amount) || 0)
        line.override = { id: o.id, note: o.note || '', by: o.created_by, at: o.updated_at }
      }
      items.push(line)
    }

    // ---- and the same jobs, gathered into the lines of a payslip -----------
    const grouped = new Map()
    for (const it of items) {
      const perKind = KIND_RATE[it.hat]
      const split = !!(perKind && perKind[it.kind]) || it.by !== 'rate'
      const key = split ? `${it.hat}:${it.kind}` : it.hat
      if (!grouped.has(key)) {
        grouped.set(key, {
          hat: it.hat, kind: split ? it.kind : null,
          label: split ? `${HATS[it.hat]?.label || it.hat} · ${KIND_LABEL[it.kind] || it.kind}` : (HATS[it.hat]?.label || it.hat),
          count: 0, amount: 0, rate: it.rate, by_views: 0, by_flat: 0, uncounted: 0,
          rate_key: it.rate_key, rate_scope: it.rate_scope,
          // How many of the jobs on this line an admin changed by hand, and
          // what the calculator itself made of the line before they did. A
          // line reading "4 × 50 000" beside an amount of 255 000 is a line
          // that does not multiply out; these are what let it say why.
          overridden: 0, calc: 0,
        })
      }
      const g = grouped.get(key)
      g.count += 1
      g.amount += it.amount
      if (it.override) g.overridden += 1
      g.calc += it.was ?? it.amount
      if (it.by === 'views') g.by_views += 1
      else if (it.by === 'flat') g.by_flat += 1
      else if (it.by === 'uncounted') g.uncounted += 1
      if (g.rate !== it.rate) g.rate = null // mixed rates inside one line
      if (g.rate_key !== it.rate_key) g.rate_key = null // …and so, mixed fields
      if (g.rate_scope !== it.rate_scope) g.rate_scope = null
    }
    const lines = [...grouped.values()]
    const piecework = lines.reduce((t, l) => t + l.amount, 0)

    // Nothing that earned nothing is drawn: a line reading "0 edits · 0 UZS"
    // is a fact about the rate card, not about the person, and it is exactly
    // the row people scroll past to find the ones that matter.
    const earning = lines.filter((l) => l.count > 0 && l.amount > 0)
    const onTime = e.done - e.late
    // A share of nothing is not 0% — it is "nothing to judge". Somebody who
    // delivered nothing this month has not failed a punctuality target.
    const onTimePct = e.done ? Math.round((onTime / e.done) * 100) : null
    const onTimeBonus = (rates.ontime_bonus && onTimePct !== null && onTimePct >= (rates.ontime_target || 0))
      ? rates.ontime_bonus : 0
    // How much, and was it enough. The two questions are deliberately paid
    // apart: somebody can hit the quota and still be late with all of it, and
    // somebody can be perfectly punctual with three pieces when the job asks
    // for twenty. Rewarding only punctuality quietly rewards doing less.
    const quota = rates.quota || 0
    const quotaMet = quota > 0 && e.done >= quota
    const quotaBonus = quotaMet ? (rates.quota_bonus || 0) : 0
    const penalty = e.late * (rates.late_penalty || 0)
    // The views KPI: paid by the thousand on everything the per-kind rules did
    // not already pay for, and a target that pays whole when the month's views
    // reach it. Both are 0 on a card nobody has set, so a board that does not
    // care about views never sees either.
    const views = e.views
    const viewsPay = Math.round((blanketViews / 1000) * (rates.per_1k_views || 0))
    const viewsTarget = rates.views_target || 0
    const viewsMet = viewsTarget > 0 && views >= viewsTarget
    const viewsBonus = viewsMet ? (rates.views_bonus || 0) : 0
    const bonus = onTimeBonus + quotaBonus + viewsBonus
    // What the piecework side of the card comes to. Under most arrangements
    // this IS the month; under some it is only one of the things that could
    // be. The scheme decides, below and after the KPI card is known.
    const pieceTotal = (rates.base || 0) + piecework + viewsPay + bonus - penalty
    const total = pieceTotal
    // Which pieces are within reach of paying by the thousand instead of flat
    // — the one prompt on this whole page that makes somebody go and look at
    // what a post actually did.
    const nearGate = items
      .filter((it) => it.to_gate !== null && it.to_gate > 0)
      .sort((a, b) => a.to_gate - b.to_gate)
      .slice(0, 5)
      .map((it) => ({ id: it.id, title: it.title, kind: it.kind, views: it.views, gate: it.gate, to_gate: it.to_gate }))
    return {
      id: u.id, name: u.name, color: u.color, avatar: u.avatar, role: u.role, crew_roles: u.crew_roles,
      currency: rates.currency, source: rates.source, pay_role: rates.role, from_role: rates.from_role, rates,
      delivered: e.done, late: e.late, onTime, onTimePct,
      quota, quotaMet, quotaLeft: quota > 0 ? Math.max(0, quota - e.done) : null,
      views, viewsCounted: e.counted, viewsPay, viewsPayOn: blanketViews, viewsTarget, viewsMet,
      viewsLeft: viewsTarget > 0 ? Math.max(0, viewsTarget - views) : null,
      // Views, per kind of piece, never added together. "Do not add the views
      // of the posts to the overall views" was the whole request, and it is
      // the honest shape anyway: a post and a reel are watched differently.
      viewsByKind: KINDS.map((k) => ({
        kind: k, label: KIND_LABEL[k],
        views: byKindViews[k] || 0,
        pieces: (e.byKind.assignee || {})[k] || 0,
        rule: kindRule(rates, k),
      })).filter((k) => k.views > 0 || k.pieces > 0 || k.rule),
      nearGate,
      // What the month MEASURED, keyed the way a KPI ladder names it. A metric
      // nobody took a reading for is null rather than 0: an average skip rate
      // over no reels is not a skip rate of nothing.
      stats: {
        delivered: e.done,
        late: e.late,
        on_time_pct: onTimePct,
        views: e.counted > 0 ? e.views : null,
        skip_rate: e.skipN > 0 ? Math.round((e.skipSum / e.skipN) * 10) / 10 : null,
        // Measured per kind as well, so a ladder can be set on "posts
        // published" or "views on reels" rather than on one lump.
        ...Object.fromEntries(KINDS.flatMap((k) => [
          [`pieces_${k}`, (e.byKind.assignee || {})[k] || 0],
          [`views_${k}`, byKindViews[k] || 0],
        ])),
        filmed: e.hats.operator || 0,
        edited: e.hats.editor || 0,
        designed: e.hats.designer || 0,
        faced: e.hats.face || 0,
      },
      lines: earning, base: rates.base || 0, piecework,
      onTimeBonus, quotaBonus, viewsBonus, bonus, penalty, total, pieceTotal,
      scheme: rates.scheme, pillow: rates.pillow || 0,
      // What is still winnable, and what it would take — worked out here so
      // the browser only has to draw it, and so none of it can be nudged by
      // anything a browser sends.
      ...(Number.isFinite(Date.parse(`${from}T00:00:00Z`)) && Number.isFinite(Date.parse(`${to}T00:00:00Z`))
        ? goalsOf({ rates, delivered: e.done, late: e.late, onTime, views, from, to, today: dayISO() })
        : { period: null, goals: [] }),
      items: items.sort((a, b) => String(b.day).localeCompare(String(a.day))),
      adjustments: adjustments.filter((a) => a.user_id === u.id).map((a) => ({
        id: a.id, kind: a.kind, label: a.label, amount: Number(a.amount) || 0,
        note: a.note || '', at: a.updated_at, by: a.created_by,
      })),
    }
  })

  // ---- and now the arrangement each of them is on ---------------------------
  //
  // Done as a second pass, after the piecework is worked out, for one reason
  // that matters: a KPI card is graded against the month's stats, and those
  // stats come from the pay run. Reaching for them the other way round —
  // statsFor() calls payRun() — is how this recurses for ever. Everything the
  // grading needs is already in hand by here.
  //
  // `skipKpi` is set by the one caller that is itself inside that loop.
  for (const p of people) {
    const S = PAY_SCHEMES[p.scheme] || PAY_SCHEMES.piece
    // The KPI card, where the arrangement is one that pays on it.
    if (S.kpi && !skipKpi) {
      const card = await get('SELECT * FROM kpi_cards WHERE user_id = ? AND month = ?', p.id, month)
      p.kpi = card ? gradeCard(card, p.stats) : null
    } else {
      p.kpi = null
    }
    const kpiTotal = p.kpi?.total || 0
    // Where this month's earnings come from.
    const earned = S.earns === 'base' ? (p.rates.base || 0)
      : S.earns === 'kpi' ? kpiTotal
        : S.earns === 'base+kpi' ? (p.rates.base || 0) + kpiTotal
          : p.pieceTotal
    // …and whether a pillow stands under them. A floor, never a bonus: work
    // fills it, and a month that ran past it is paid for what was done.
    const pillow = S.floor ? (p.pillow || 0) : 0
    // …and only an arrangement that HAS a pillow reports one. The card keeps
    // whatever pillow was typed into it when somebody switches the scheme
    // away and back, and passing that on under piecework or a fixed salary
    // printed "4 000 000 guaranteed" over a month that guaranteed nothing.
    // The figure above is what pays; this is only what is said.
    p.pillow = pillow
    p.earned = Math.round(earned)
    p.pillowTopUp = pillow > earned ? Math.round(pillow - earned) : 0
    p.pillowMet = pillow > 0 && earned >= pillow
    // HOW MUCH OF THE PILLOW IS FILLED, and what it would take to fill the
    // rest. "Guaranteed 4 000 000" tells somebody they cannot lose; it does
    // not tell them they are 1 200 000 short of earning it, which is the
    // number that decides whether they take another job this week. At the
    // month's own average per piece, because that is the only honest guess
    // this board can make about what the next one is worth.
    if (pillow > 0) {
      const perPiece = p.delivered > 0 ? earned / p.delivered : 0
      p.pillowProgress = {
        pillow: Math.round(pillow),
        // What the month earned, whole — so a bar can be drawn at the exact
        // ratio, earned ÷ pillow, rather than off `pct`, which is rounded to
        // a whole percent and capped (99.6% reads as 100 while money is
        // still to fill). `pct` stays as it was for everything that reads it.
        earned: Math.round(earned),
        filled: Math.round(Math.min(earned, pillow)),
        left: Math.round(Math.max(0, pillow - earned)),
        pct: pillow > 0 ? Math.min(100, Math.round((earned / pillow) * 100)) : null,
        // Null rather than Infinity when the month has nothing to average.
        pieces_left: perPiece > 0 && earned < pillow ? Math.ceil((pillow - earned) / perPiece) : null,
        per_piece: perPiece > 0 ? Math.round(perPiece) : null,
        past: earned > pillow ? Math.round(earned - pillow) : 0,
      }
    } else {
      p.pillowProgress = null
    }
    // Hand-made lines on the month: a bonus somebody agreed, a fine, an
    // advance already handed over. They sit OUTSIDE the pillow deliberately —
    // a bonus is not something a floor should swallow, and an advance is money
    // that has already left, whatever the floor says.
    p.adjustmentTotal = Math.round((p.adjustments || []).reduce((t, a) => t + (Number(a.amount) || 0), 0))
    p.total = Math.round(Math.max(earned, pillow)) + p.adjustmentTotal
    // Whether the KPI card is already inside that total. The payslip used to
    // add it on afterwards, unconditionally, which under these arrangements
    // would count it twice.
    p.kpiCounted = !!S.kpi && !skipKpi
    p.schemeLabel = S.label
    // What the arrangement MEANS, for the person it is theirs: where the
    // month's earnings come from, whether a pillow stands under them, whether
    // the KPI card is paid. Their own, on their own payslip — the list of
    // every arrangement stays behind the admin gate. Without it a payslip
    // lists piece lines under a fixed salary as though they had been paid.
    p.schemeRule = { earns: S.earns, floor: !!S.floor, kpi: !!S.kpi, hint: S.hint }
    // WHAT THE TOTAL IS MADE OF, said by whoever worked it out.
    //
    // The payroll drew a bar of base + piecework + bonus, which is the shape
    // of one arrangement out of six. On a pillow card it showed "Piecework
    // 1 200 000" under a total of 4 000 000 — a bar that does not add up to
    // the number beside it — and on a KPI card it drew nothing at all. The
    // parts are listed here instead, so the thing that decided the total is
    // the thing that explains it.
    //
    // Fixed money and earned money are named apart, always: "what I get
    // whatever happens" and "what this month made me" are two different
    // questions, and a single total answers neither.
    p.parts = []
    if (S.earns === 'piece') {
      if (p.base > 0) p.parts.push({ key: 'base', label: 'Fixed', amount: p.base, fixed: true })
      const piece = p.piecework + (p.viewsPay || 0)
      if (piece > 0) p.parts.push({ key: 'piece', label: 'Piecework', amount: piece })
      if (p.bonus > 0) p.parts.push({ key: 'bonus', label: 'Bonus', amount: p.bonus })
    } else if (S.earns === 'base' || S.earns === 'base+kpi') {
      if (p.rates.base > 0) p.parts.push({ key: 'base', label: 'Fixed', amount: p.rates.base, fixed: true })
    }
    if (S.kpi && kpiTotal > 0) p.parts.push({ key: 'kpi', label: 'KPI', amount: kpiTotal })
    if (p.penalty > 0 && S.earns === 'piece') p.parts.push({ key: 'penalty', label: 'Late penalty', amount: -p.penalty })
    if (p.pillowTopUp > 0) p.parts.push({ key: 'pillow', label: 'Safety pillow', amount: p.pillowTopUp })
    for (const a of p.adjustments || []) {
      p.parts.push({ key: `adj-${a.id}`, label: a.label || ADJUST_LABEL[a.kind] || 'Adjustment', amount: a.amount, adjustment: a.kind })
    }
    // The two halves people actually ask about, each as one number.
    p.fixedPart = p.parts.filter((x) => x.fixed).reduce((t, x) => t + x.amount, 0)
      + (p.pillowTopUp || 0)
    p.kpiPart = kpiTotal
    p.earnedPart = p.total - p.fixedPart - p.kpiPart
  }
  return { from: from || null, to: to || null, people }
}

router.get('/pay', wrap(async (req, res) => {
  const { from, to } = req.query
  const out = await payRun({ from, to })
  const { hasDefault } = await rateCards()
  // The KPI component of pay went with the KPIs in round 82, and this line kept
  // reading p.kpis — which payRun stopped producing, so every call to the
  // payroll answered 500. Nobody with no card and nothing delivered clutters
  // the payroll; that is the whole of the rule now.
  out.people = out.people.filter((p) => p.source !== 'none' || p.delivered > 0)
  out.people.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  // Which of these have already been paid for the month the range sits in.
  // A payroll that cannot tell you what has gone out is a spreadsheet.
  const month = String(to || dayISO()).slice(0, 7)
  const closed = (await all('SELECT * FROM payouts WHERE month = ?', month)).map(publicPayout)
  const byUser = new Map(closed.map((r) => [r.user_id, r]))
  out.people = out.people.map((p) => ({ ...p, payout: byUser.get(p.id) || null }))
  res.json({
    ...out, hasDefault, month,
    settled: closed.length, settledTotal: closed.reduce((a, r) => a + r.total, 0),
    currency: out.people[0]?.currency || 'UZS',
  })
}))

router.get('/kpi/:userId', adminOnly, wrap(async (req, res) => {
  const month = monthOf(req.query.month)
  const userId = Number(req.params.userId)
  const card = await cardFor(userId, month)
  const stats = await statsFor(userId, month)
  const graded = card ? await kpiAnswer(month, card, stats) : null
  res.json({
    month,
    stats,
    // When the nightly pass last measured this card's board readings, for the
    // admin as for the person — null on a card read only by hand.
    kpi_synced_at: graded?.kpi_synced_at ?? null,
    // Every metric a ladder can be set on, sent rather than kept in step by
    // hand: the editor used to carry its own list of five, so the ones the
    // board learnt to measure later could not be graded on.
    metrics: Object.entries(METRICS).map(([key, m]) => ({
      key, label: m.label, unit: m.unit, auto: m.auto, dir: m.dir,
    })),
    // The admin edits the shape, so they get it raw as well as graded.
    raw: card ? { ...card, ladders: JSON.parse(card.ladders || '[]'), readings: JSON.parse(card.readings || '{}') } : null,
    card: graded?.card || null,
  })
}))

router.put('/kpi/:userId/:month', adminOnly, wrap(async (req, res) => {
  const userId = Number(req.params.userId)
  const month = monthOf(req.params.month)
  if (!(await get('SELECT 1 AS x FROM users WHERE id = ?', userId))) return res.status(404).json({ error: 'No such person' })
  const b = req.body || {}
  const ladders = Array.isArray(b.ladders) ? b.ladders : []
  for (const l of ladders) {
    if (!l || !l.key) return res.status(400).json({ error: 'Every ladder needs a key' })
    if (!METRICS[l.metric] && l.metric !== 'manual') return res.status(400).json({ error: `No such metric: ${l.metric}` })
    if (!Array.isArray(l.bands) || !l.bands.length) return res.status(400).json({ error: `«${l.key}» has no bands` })
    for (const band of l.bands) {
      if (band.pays !== undefined && !Number.isFinite(Number(band.pays)))
        return res.status(400).json({ error: 'A band pays a number, or nothing' })
    }
  }
  const fixed = Number(b.fixed) || 0
  if (fixed < 0) return res.status(400).json({ error: 'Fixed pay is zero or more' })
  const now = new Date().toISOString()
  const existing = await cardFor(userId, month)
  const vals = [
    String(b.currency || existing?.currency || 'UZS').slice(0, 8),
    fixed,
    JSON.stringify(ladders),
    JSON.stringify(b.readings && typeof b.readings === 'object' ? b.readings : {}),
    String(b.note || '').slice(0, 2000),
    req.user.id, now,
  ]
  if (existing) {
    await run('UPDATE kpi_cards SET currency=?, fixed=?, ladders=?, readings=?, note=?, updated_by=?, updated_at=? WHERE id=?', ...vals, existing.id)
  } else {
    await run(`INSERT INTO kpi_cards (user_id, month, currency, fixed, ladders, readings, note, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, userId, month, ...vals.slice(0, 5), req.user.id, now, now)
  }
  const saved = await cardFor(userId, month)
  const { kpi_synced_at, card } = await kpiAnswer(month, saved, await statsFor(userId, month))
  res.json({ month, kpi_synced_at, card })
}))

// The arrangements there are, and what each one means, in the words the admin
// reads. Served rather than copied into the browser: the card that OFFERS an
// arrangement and the run that PAYS on it have to agree about what it does.
router.get('/pay/schemes', wrap(async (_req, res) => {
  // Everything the pay sheet needs to draw itself: the arrangements, the kinds
  // of piece that can be priced apart, the jobs a piece carries, and the roles
  // this team actually has — so the editor offers "editor" and "operator"
  // because there are editors and operators, not because a constant said so.
  const users = (await all('SELECT * FROM users')).map(publicUser)
  const roles = [...new Set(users.map(payRoleOf).filter(Boolean))].sort()
  res.json({
    schemes: PAY_SCHEMES,
    keys: PAY_SCHEME_KEYS,
    kinds: KINDS.map((k) => ({ key: k, label: KIND_LABEL[k] })),
    hats: Object.fromEntries(Object.entries(HATS).map(([k, v]) => [k, v.label])),
    roles,
    adjust_kinds: ADJUST_KINDS,
  })
}))

router.get('/pay/rules', wrap(async (_req, res) => {
  const rows = await all('SELECT * FROM pay_rules ORDER BY user_id IS NOT NULL, role IS NOT NULL, user_id')
  // The per-kind rules ride as text in the row; nobody downstream should have
  // to know that.
  res.json(rows.map((r) => {
    let kind_rules = {}
    try { kind_rules = JSON.parse(r.kind_rules || '{}') || {} } catch { kind_rules = {} }
    return { ...r, kind_rules }
  }))
}))

// `userId` is a number, the word "default" for the card everybody who has no
// card of their own is paid on, or "role:editor" for the card every editor is
// paid on unless they have one of their own.
//
// Three layers, and they are worth keeping straight: a personal card beats a
// role card, and a role card beats the default. The pay sheet was thirty-five
// copies of the same numbers before role cards existed, which is why half of
// them were out of date.
router.put('/pay/rules/:userId', wrap(async (req, res) => {
  const key = String(req.params.userId)
  const isDefault = key === 'default'
  const roleCard = key.startsWith('role:') ? key.slice(5).trim().slice(0, 40) : null
  const userId = isDefault || roleCard ? null : Number(key)
  if (!isDefault && !roleCard && (!userId || !(await get('SELECT 1 AS x FROM users WHERE id = ?', userId)))) {
    return res.status(404).json({ error: 'No such person' })
  }
  if (roleCard !== null && !roleCard) return res.status(400).json({ error: 'Which role is this card for?' })
  const body = req.body || {}
  const vals = {}
  for (const f of RATE_FIELDS) {
    const raw = body[f]
    const n = raw === '' || raw === null || raw === undefined ? 0 : Number(raw)
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${f} must be a number, zero or more` })
    vals[f] = n
  }
  if (vals.ontime_target > 100) return res.status(400).json({ error: 'ontime_target is a percentage — 100 at most' })
  const currency = String(body.currency || 'UZS').trim().slice(0, 8) || 'UZS'
  // How this person is paid, as opposed to at what rates. Anything
  // unrecognised is piecework, which is what every card was before schemes
  // existed — a bad value can only ever mean "as before".
  const scheme = schemeOf(body.scheme)

  // What a piece is worth by what kind of piece it is. Validated kind by kind
  // rather than taken whole: a rule with a gate and no per-thousand rate is a
  // gate that can never open, and it is better refused than quietly paying the
  // flat rate for ever.
  const rules = {}
  const given = body.kind_rules && typeof body.kind_rules === 'object' ? body.kind_rules : {}
  for (const [kind, raw] of Object.entries(given)) {
    if (!KINDS.includes(kind)) return res.status(400).json({ error: `${kind} is not a kind of piece this board knows` })
    if (!raw || typeof raw !== 'object') continue
    const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v))
    const flat = num(raw.flat), gate = num(raw.gate), per1k = num(raw.per_1k)
    for (const [name, v] of [['flat', flat], ['gate', gate], ['per 1,000', per1k]]) {
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${KIND_LABEL[kind]}: ${name} must be a number, zero or more` })
    }
    if (gate > 0 && per1k <= 0) {
      return res.status(400).json({ error: `${KIND_LABEL[kind]}: a view target with no per-1,000 rate can never pay — set the rate, or clear the target` })
    }
    // A cliff pointing the wrong way. Clearing the target replaces the flat
    // rate, so if the thousands at the target come to less than the flat, a
    // piece would earn LESS for doing better — and somebody would find that
    // out on payday rather than here.
    if (gate > 0 && per1k > 0 && flat > 0 && (gate / 1000) * per1k < flat) {
      const atGate = Math.round((gate / 1000) * per1k)
      return res.status(400).json({
        error: `${KIND_LABEL[kind]}: at ${gate.toLocaleString()} views this pays ${atGate.toLocaleString()}, which is less than the flat ${flat.toLocaleString()} — a piece would earn less for doing better. Raise the per-1,000 rate, raise the target, or lower the flat rate.`,
      })
    }
    if (flat || gate || per1k) rules[kind] = { flat, gate, per_1k: per1k }
  }
  const kindRules = JSON.stringify(rules)

  const now = new Date().toISOString()
  const existing = isDefault
    ? await get('SELECT id FROM pay_rules WHERE user_id IS NULL AND role IS NULL')
    : roleCard
      ? await get('SELECT id FROM pay_rules WHERE user_id IS NULL AND role = ?', roleCard)
      : await get('SELECT id FROM pay_rules WHERE user_id = ?', userId)
  const cols = RATE_FIELDS.map((f) => `${f}=?`).join(', ')
  if (existing) {
    await run(`UPDATE pay_rules SET currency=?, scheme=?, kind_rules=?, role=?, ${cols}, updated_by=?, updated_at=? WHERE id=?`,
      currency, scheme, kindRules, roleCard, ...RATE_FIELDS.map((f) => vals[f]), req.user.id, now, existing.id)
    return res.json(await get('SELECT * FROM pay_rules WHERE id = ?', existing.id))
  }
  const info = await run(
    `INSERT INTO pay_rules (user_id, role, currency, scheme, kind_rules, ${RATE_FIELDS.join(', ')}, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ${RATE_FIELDS.map(() => '?').join(', ')}, ?, ?, ?)`,
    userId, roleCard, currency, scheme, kindRules, ...RATE_FIELDS.map((f) => vals[f]), req.user.id, now, now)
  res.status(201).json(await get('SELECT * FROM pay_rules WHERE id = ?', info.lastInsertRowid))
}))

// Dropping a person's own card puts them back on the card their role is on,
// or on the default one where their role has none.
router.delete('/pay/rules/:userId', wrap(async (req, res) => {
  const key = String(req.params.userId)
  if (key === 'default') return res.status(400).json({ error: 'The default card cannot be removed — set it to zero instead' })
  if (key.startsWith('role:')) {
    await run('DELETE FROM pay_rules WHERE user_id IS NULL AND role = ?', key.slice(5))
    return res.json({ ok: true })
  }
  await run('DELETE FROM pay_rules WHERE user_id = ?', Number(key))
  res.json({ ok: true })
}))

// ---- a hand on the scales, with a name on it --------------------------------
//
// Two kinds of correction, because months go wrong in two different shapes.
//
// An OVERRIDE is about one job: the rate was wrong for that piece, or the job
// was twice the work it looked like. The calculated figure is kept beside the
// new one, so the payslip can show both and nobody has to take the change on
// trust.
//
// An ADJUSTMENT is about the month: a bonus, a fine, an advance already handed
// over in cash. It belongs to no piece, so it is its own line.
//
// Both carry a reason and the name of whoever made them. An admin who cannot
// explain a change in the box provided will explain it in a meeting instead.
const ADJUST_SET = new Set(ADJUST_KINDS)

router.put('/pay/override', wrap(async (req, res) => {
  const b = req.body || {}
  const userId = Number(b.user_id)
  const contentId = Number(b.content_id)
  const hat = String(b.hat || '')
  const month = String(b.month || '')
  if (!userId || !contentId) return res.status(400).json({ error: 'Which person, and which piece?' })
  if (!HATS[hat]) return res.status(400).json({ error: 'That is not one of the jobs on a piece' })
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'A month is YYYY-MM' })
  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'An amount is a number, zero or more' })
  const note = String(b.note ?? '').trim().slice(0, 300)
  if (!note) return res.status(400).json({ error: 'Say why — a changed figure with no reason is the one nobody can defend later', field: 'note' })
  const was = Number(b.was) || 0
  const now = new Date().toISOString()
  const existing = await get('SELECT id FROM pay_overrides WHERE user_id = ? AND content_id = ? AND hat = ?', userId, contentId, hat)
  if (existing) {
    await run('UPDATE pay_overrides SET amount=?, note=?, month=?, created_by=?, updated_at=? WHERE id=?',
      amount, note, month, req.user.id, now, existing.id)
    return res.json(await get('SELECT * FROM pay_overrides WHERE id = ?', existing.id))
  }
  const info = await run(
    `INSERT INTO pay_overrides (user_id, content_id, hat, month, amount, was, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, contentId, hat, month, amount, was, note, req.user.id, now, now)
  res.status(201).json(await get('SELECT * FROM pay_overrides WHERE id = ?', info.lastInsertRowid))
}))

// Removing one puts that job back on what the calculator says it is worth.
router.delete('/pay/override/:id', wrap(async (req, res) => {
  await run('DELETE FROM pay_overrides WHERE id = ?', Number(req.params.id))
  res.json({ ok: true })
}))

router.post('/pay/adjust', wrap(async (req, res) => {
  const b = req.body || {}
  const userId = Number(b.user_id)
  const month = String(b.month || '')
  const kind = ADJUST_SET.has(String(b.kind)) ? String(b.kind) : 'bonus'
  if (!userId || !(await get('SELECT 1 AS x FROM users WHERE id = ?', userId))) return res.status(404).json({ error: 'No such person' })
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'A month is YYYY-MM' })
  let amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'An amount is a number, and not zero' })
  // A fine and an advance take money off the month whichever way they were
  // typed: nobody means "add a fine of 200 000".
  if (kind === 'fine' || kind === 'advance') amount = -Math.abs(amount)
  // The name may be left off — it falls back to what kind of line it is. The
  // REASON may not, for the same reason a changed job needs one: a fine or a
  // bonus on somebody's month with nothing to say why is the line nobody can
  // defend later, and the person it is on is the one who reads it. Rows made
  // before this rule keep whatever they were saved with and still read.
  const label = String(b.label ?? '').trim().slice(0, 80)
  const note = String(b.note ?? '').trim().slice(0, 300)
  if (!note) return res.status(400).json({ error: 'Say why — a line on the month with no reason is the one nobody can defend later', field: 'note' })
  const now = new Date().toISOString()
  const info = await run(
    `INSERT INTO pay_adjustments (user_id, month, kind, label, amount, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, month, kind, label, amount, note, req.user.id, now, now)
  res.status(201).json(await get('SELECT * FROM pay_adjustments WHERE id = ?', info.lastInsertRowid))
}))

router.delete('/pay/adjust/:id', wrap(async (req, res) => {
  await run('DELETE FROM pay_adjustments WHERE id = ?', Number(req.params.id))
  res.json({ ok: true })
}))

// ---- closing a month --------------------------------------------------------
// Admin only, and past this point in the file everything is.
//
// Recording a month as paid does two things at once, and they are worth
// naming apart. It answers "was I paid for August?" — which nothing on this
// board could answer before. And it FREEZES August: from then on the figures
// come from the row rather than from a fresh sweep of the tasks, so editing an
// old task in October no longer quietly rewrites a payslip somebody has
// already been paid against.
//
// Idempotent per person per month, so two admins pressing it at the same
// moment record one payment, not two.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

router.get('/pay/payouts', wrap(async (req, res) => {
  const month = MONTH_RE.test(String(req.query.month || '')) ? String(req.query.month) : dayISO().slice(0, 7)
  const rows = await all('SELECT * FROM payouts WHERE month = ?', month)
  res.json({ month, payouts: rows.map(publicPayout) })
}))

router.post('/pay/payouts', wrap(async (req, res) => {
  const body = req.body || {}
  const month = MONTH_RE.test(String(body.month || '')) ? String(body.month) : null
  if (!month) return res.status(400).json({ error: 'A month, as YYYY-MM' })
  const today = dayISO()
  if (month > today.slice(0, 7)) return res.status(400).json({ error: 'That month has not happened yet' })
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.paid_at || '')) ? String(body.paid_at) : today
  const note = String(body.note || '').slice(0, 400)

  const from = monthStartOf(month)
  const end = monthEndOf(month)
  const to = end < today ? end : today
  const run_ = await payRun({ from, to })
  // Only people the payroll actually pays. Somebody with no rate card and
  // nothing delivered is not a payment of zero — they are not a payment.
  let people = run_.people.filter((p) => p.source !== 'none' && (p.total !== 0 || p.delivered > 0))
  if (Array.isArray(body.user_ids) && body.user_ids.length) {
    const want = new Set(body.user_ids.map(Number))
    people = people.filter((p) => want.has(p.id))
  }
  const now = new Date().toISOString()
  const written = []
  let kept = 0
  for (const p of people) {
    // The WHOLE payslip, not the total and half the reasons for it. Freezing
    // a figure and leaving its itemisation to a live re-derivation is the
    // worst of both: a number that cannot move, broken down by numbers that
    // can, which stop adding up to it the first time anybody edits an old
    // task — the exact failure the freeze exists to prevent, reintroduced one
    // level down. The rates ride along, so a card rewritten in November
    // cannot relabel what September was paid on, and so do the pieces,
    // because "which work was I paid for" is the other half of a payslip.
    const breakdown = JSON.stringify({
      base: p.base, piecework: p.piecework, viewsPay: p.viewsPay, bonus: p.bonus,
      quotaBonus: p.quotaBonus, onTimeBonus: p.onTimeBonus, viewsBonus: p.viewsBonus,
      penalty: p.penalty, delivered: p.delivered, late: p.late, onTimePct: p.onTimePct,
      views: p.views, viewsCounted: p.viewsCounted, viewsTarget: p.viewsTarget,
      quota: p.quota, rates: p.rates, lines: p.lines, items: p.items,
      // …and the parts the payslip is now told in: the views split by kind of
      // piece, the hand-made lines on the month, and which of the total was
      // fixed, earned and KPI. Frozen with the rest, for the same reason —
      // a month that cannot move should not be itemised by numbers that can.
      viewsByKind: p.viewsByKind, viewsPayOn: p.viewsPayOn,
      adjustments: p.adjustments, adjustmentTotal: p.adjustmentTotal,
      fixedPart: p.fixedPart, earnedPart: p.earnedPart, kpiPart: p.kpiPart,
      pillowProgress: p.pillowProgress, parts: p.parts, schemeLabel: p.schemeLabel,
      // …and the arrangement itself, with what the month earned against the
      // pillow and what the pillow put on top — so a settled month explains
      // its own top-up from its own record instead of from today's card —
      // and the KPI card as it was graded and paid, ladder by ladder, where
      // the arrangement paid on one.
      scheme: p.scheme, schemeRule: p.schemeRule,
      earned: p.earned, pillow: p.pillow, pillowTopUp: p.pillowTopUp,
      kpi: p.kpi || null,
    })
    const existing = await get('SELECT id FROM payouts WHERE user_id = ? AND month = ?', p.id, month)
    // Already closed for this person: the record stands as it was written
    // down. Re-opening the month is the only way to change it (DELETE below).
    if (existing) { kept += 1; continue }
    await run(`INSERT INTO payouts (user_id, month, currency, total, breakdown, note, paid_at, marked_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id, month, p.currency, Math.round(p.total), breakdown, note, paidAt, req.user.id, now, now)
    written.push(p.id)
  }
  // A press that wrote nothing down is not answered "recorded".
  if (!written.length && kept)
    return res.status(409).json({ error: 'Everybody here is already recorded as paid for this month, and a recorded payslip is not rewritten. Re-open the month first if it has to be worked out again.' })
  const rows = await all('SELECT * FROM payouts WHERE month = ?', month)
  res.status(201).json({ month, paid_at: paidAt, recorded: written.length, kept, payouts: rows.map(publicPayout) })
}))

// Re-opening a month. The row goes and the calculator takes over again — the
// only honest way back, because a frozen figure that can be edited in place is
// a figure nobody can trust.
router.delete('/pay/payouts/:month/:userId', wrap(async (req, res) => {
  const month = String(req.params.month)
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'A month, as YYYY-MM' })
  const one = req.params.userId === 'all' ? null : Number(req.params.userId)
  const going = one === null
    ? await all('SELECT * FROM payouts WHERE month = ?', month)
    : await all('SELECT * FROM payouts WHERE month = ? AND user_id = ?', month, one)
  // Work this record paid may stand in another recorded month by now, left
  // out of that month because THIS record carries it (paidInAnotherMonth).
  // Deleting this one alone would leave it in neither.
  const first = await strandedBy(going)
  if (first.length) {
    const words = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    return res.status(409).json({ error: `Re-open ${first.map(words).join(' and ')} first. ${words(month)} paid for work whose day has since moved there, and ${first.length > 1 ? 'those months were' : 'that month was'} recorded as paid without it — re-opening ${words(month)} alone would leave that work in neither record.` })
  }
  if (one === null) await run('DELETE FROM payouts WHERE month = ?', month)
  else await run('DELETE FROM payouts WHERE month = ? AND user_id = ?', month, one)
  res.json({ ok: true, month })
}))

export default router

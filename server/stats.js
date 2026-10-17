// What the words mean.
//
// Every page that showed a number used to work it out where it was shown, and
// no two of them worked it out the same way. The front page said 539
// delivered; the statistics page said 53 went out; the line above them both
// said 50 finished late, which was not a count at all but the length of a list
// that stops at fifty. None of the three was wrong about its own arithmetic.
// They were answering different questions with the same words, and a reader
// with no way to tell which question they had been given reads the smallest
// number as the truth and stops opening the page.
//
// So the arithmetic lives here, once, and the words are fixed:
//
//   PIECE      one item of content. Counted once, however many channels it
//              goes out on and however many people touched it.
//   WENT OUT   the piece was published — dated by the day it went out, on the
//              team's Tashkent clock.
//   PLANNED    its release day falls inside the window. That is the plan: the
//              board's own promise, not a number anybody types in.
//   ON TIME    it went out on or before its release day. A piece with no
//              release day is not on time and not late — it is unjudgeable,
//              and it is counted and named as that rather than quietly
//              rounded into the good column.
//   STEP       one person's part of one piece: the shoot, the cut, the
//              artwork, the review. A piece has up to four, each with its own
//              day and its own owner, and each is judged on its own.
//   MISSED     a step finished after its day, or still not finished with the
//              day gone. Charged to whoever owned it.
//   KNOCK-ON   a step that could only start after its own day had gone,
//              because the step before it handed over late. Never charged to
//              anybody: it is the same delay, seen a second time, and adding
//              it to the missed count is how one late shoot became three
//              people's problem.
//
// Every window here is read the same way: a piece belongs to the window its
// release day falls in, a publication to the window it went out in, and a STEP
// to the window ITS OWN day falls in. A September report is what September
// promised and what September was owed — never a step that came due in August
// on a piece that happens to go out now.
import { tashkentDay, dayISO } from './db.js'
import { phasesOf, PHASE_LABEL } from './deadlines.js'

export const STEPS = ['shoot', 'edit', 'design', 'review']
export const STEP_LABEL = { ...PHASE_LABEL, design: 'Design' }

const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
const inWin = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to)
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)

// ---- the artwork's own day --------------------------------------------------
// deadlines.js reads the three phases of filmed work — shoot, cut, review —
// because those are the three that hand over to each other. The artwork hands
// over to nobody: a designer is given a day and the piece either carries their
// work by then or it does not. It was left out of every report because of
// that, which meant a designer's missed day appeared in the register below the
// numbers and in none of the numbers themselves.
export function designStep(task, today = dayISO()) {
  const due = task.design_ready_date || null
  const owner_ids = task.designer_id ? [task.designer_id] : []
  const deliveredIso = task.ready_at || task.done_at || null
  const delivered = deliveredIso ? tashkentDay(deliveredIso) : null
  const decided = task.miss_blame === 'production' || task.miss_blame === 'make'
  const base = {
    phase: 'design', label: STEP_LABEL.design, role: 'designer',
    side: decided ? task.miss_blame : 'make',
    blame_why: decided ? (task.miss_blame_note || 'an admin decided this one')
      : 'the artwork was not handed back on its day',
    blame_decided: decided,
    owner_id: owner_ids[0] || null, owner_ids,
    promised: due, revised: null, due,
    started: null, started_day: null,
    delivered: deliveredIso, delivered_day: delivered,
    days_late: 0,
  }
  if (!due) return { ...base, state: 'none' }
  const state = delivered ? (delivered <= due ? 'ok' : 'late') : (today > due ? 'late' : 'pending')
  return { ...base, state, days_late: state === 'late' ? Math.max(0, dayDiff(delivered || today, due)) : 0 }
}

// All four steps of one piece, in the order the work is done.
export function stepsOf(task, today = dayISO(), resolved = null) {
  const three = phasesOf(task, today, resolved)
  const design = designStep(task, today)
  return [three[0], three[1], design, three[2]].filter(Boolean)
}

// ---- one piece, read once ---------------------------------------------------
export function pieceFacts(row) {
  const out = row.done_at ? tashkentDay(row.done_at) : null
  const due = row.release_date || null
  return {
    id: row.id, title: row.title, type: row.type, channels: row.channels || [],
    out, due,
    // A piece that went out: on time, late, or with nothing to judge it by.
    verdict: !out ? null : !due ? 'no_day' : out <= due ? 'on_time' : 'late',
    days_late: out && due && out > due ? dayDiff(out, due) : 0,
  }
}

const blankSteps = () => Object.fromEntries(STEPS.map((k) => (
  [k, { step: k, label: STEP_LABEL[k], due: 0, on_time: 0, late: 0, knock_on: 0, open: 0, days_lost: 0 }]
)))

// ---- the report -------------------------------------------------------------
// One window, one scope, every number in it counted from the same rows. The
// route hands in what it has already loaded, so this stays a function of its
// arguments and a test can put four rows in and read the arithmetic out.
export function buildReport({
  rows, resolved, from, to, today = dayISO(), nameOf = () => null, channels = [], credits = [],
}) {
  const pieces = {
    out: 0, on_time: 0, late: 0, no_day: 0, days_late: 0,
    planned: 0, planned_out: 0, planned_overdue: 0, planned_to_come: 0,
    due_so_far: 0, due_so_far_out: 0,
    // What the month was actually for. A content team is not paid to be
    // punctual, it is paid to be watched — and the board holds the view counts
    // already. `counted` says how much of the month has been looked up at all,
    // because a total is a lie the moment half the pieces have an empty box.
    views: 0, views_counted: 0, views_missing: 0,
  }
  const watched = []
  const by_step = blankSteps()
  const steps = { due: 0, on_time: 0, late: 0, knock_on: 0, open: 0, days_lost: 0 }
  const by_side = { production: 0, make: 0 }
  const misses = []
  const people = new Map()
  const person = (id) => {
    if (!people.has(id)) {
      people.set(id, {
        id, name: nameOf(id), late: 0, on_time: 0, knock_on: 0, days_lost: 0,
        steps: Object.fromEntries(STEPS.map((k) => [k, 0])),
        work: { filmed: 0, edited: 0, designed: 0, published: 0, total: 0 },
      })
    }
    return people.get(id)
  }
  const perChannel = new Map()
  const chan = (key) => {
    if (!perChannel.has(key)) {
      perChannel.set(key, {
        key, label: channels.find((c) => c.key === key)?.label || key,
        planned: 0, out: 0, on_time: 0, late: 0, no_day: 0, overdue: 0, to_come: 0, late_steps: 0, views: 0,
      })
    }
    return perChannel.get(key)
  }

  for (const row of rows) {
    const f = pieceFacts(row)
    if (inWin(f.out, from, to)) {
      pieces.out += 1
      pieces[f.verdict] += 1
      pieces.days_late += f.days_late
      const seen = Number.isFinite(Number(row.views)) && row.views !== null && row.views !== ''
        ? Number(row.views) : null
      if (seen === null) pieces.views_missing += 1
      else { pieces.views += seen; pieces.views_counted += 1; watched.push({ id: row.id, title: row.title, views: seen, channels: f.channels }) }
      for (const key of f.channels) { const c = chan(key); c.out += 1; c[f.verdict] += 1; if (seen !== null) c.views += seen }
    }
    if (inWin(f.due, from, to)) {
      pieces.planned += 1
      const state = f.out ? 'out' : f.due < today ? 'overdue' : 'to_come'
      if (state === 'out') pieces.planned_out += 1
      else if (state === 'overdue') pieces.planned_overdue += 1
      else pieces.planned_to_come += 1
      // "Kept so far" — the honest reading of a month that is still running.
      // Half of September cannot have gone out yet, and a completion figure
      // that counts the days still to come as failures reads 35% on a month
      // that is being kept perfectly.
      if (f.due <= today) {
        pieces.due_so_far += 1
        if (f.out) pieces.due_so_far_out += 1
      }
      for (const key of f.channels) {
        const c = chan(key)
        c.planned += 1
        if (state === 'overdue') c.overdue += 1
        else if (state === 'to_come') c.to_come += 1
      }
    }

    for (const st of stepsOf(row, today, resolved)) {
      if (!inWin(st.due, from, to) || st.state === 'none') continue
      const slot = by_step[st.phase]
      // Not yet due, or not yet handed to its owner: nothing has been missed
      // and nothing has been kept. Counting these as "judged" is what put 74
      // under a figure of 34 and left the reader to guess what the other 40
      // were.
      if (st.state === 'pending' || st.state === 'waiting') { slot.open += 1; steps.open += 1; continue }
      slot.due += 1; steps.due += 1
      if (st.state === 'excused') { slot.knock_on += 1; steps.knock_on += 1; for (const id of st.owner_ids) person(id).knock_on += 1; continue }
      if (st.state !== 'late') {
        slot.on_time += 1; steps.on_time += 1
        for (const id of st.owner_ids) { const p = person(id); p.on_time += 1 }
        continue
      }
      slot.late += 1; slot.days_lost += st.days_late
      steps.late += 1; steps.days_lost += st.days_late
      by_side[st.side] = (by_side[st.side] || 0) + 1
      for (const key of row.channels || []) chan(key).late_steps += 1
      misses.push({
        id: row.id, title: row.title, step: st.phase, label: st.label,
        due: st.due, promised: st.promised, revised: st.revised,
        days_late: st.days_late, side: st.side, why: st.blame_why, decided: st.blame_decided,
        open: !st.delivered_day,
        owner_ids: st.owner_ids, who: st.owner_ids.map(nameOf).filter(Boolean),
        channels: row.channels || [], type: row.type,
      })
      for (const id of st.owner_ids) {
        const p = person(id)
        p.late += 1; p.days_lost += st.days_late; p.steps[st.phase] += 1
      }
    }
  }

  // What each person actually made in the window, beside what they missed. A
  // table of misses alone is a table that says the person who did nothing had
  // a perfect month.
  const WORK = { operator: 'filmed', editor: 'edited', designer: 'designed', assignee: 'published' }
  for (const c of credits) {
    const field = WORK[c.hat]
    if (!field || !inWin(c.day, from, to)) continue
    const p = person(c.userId)
    p.work[field] += 1
    p.work.total += 1
  }

  return {
    from, to, today,
    pieces,
    steps: { ...steps, by_side, by_step: STEPS.map((k) => by_step[k]) },
    channels: [...perChannel.values()].sort((a, b) => (b.planned - a.planned) || (b.out - a.out) || a.label.localeCompare(b.label)),
    people: [...people.values()].sort((a, b) => (b.work.total - a.work.total) || (b.late - a.late)),
    misses: misses.sort((a, b) => (b.days_late - a.days_late) || String(a.due).localeCompare(String(b.due))),
    watched: watched.sort((a, b) => b.views - a.views).slice(0, 8),
    rates: {
      on_time: pct(pieces.on_time, pieces.on_time + pieces.late),
      plan: pct(pieces.planned_out, pieces.planned),
      kept_so_far: pct(pieces.due_so_far_out, pieces.due_so_far),
      steps_kept: pct(steps.on_time, steps.on_time + steps.late),
    },
    // Flat aliases, so a reader of the raw JSON — or a suite — never has to
    // know which pocket a headline number lives in.
    planned: pieces.planned,
    delivered: pieces.out,
    plan_pct: pct(pieces.planned_out, pieces.planned),
    on_time_pct: pct(pieces.on_time, pieces.on_time + pieces.late),
  }
}

// ---- month by month ---------------------------------------------------------
// A month on its own has nothing to be read against. The same figures for the
// months before it are what turn "53 went out" into "and that is the worst
// month since July".
export const monthEdges = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}
export const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const made = (r, k) => (r.steps.by_step || [])
  .filter((s) => s.step === 'edit' || s.step === 'design')
  .reduce((n, s) => n + (s[k] || 0), 0)

// `start` and `end` are the window the months are drawn beside. Only the two
// months they fall INSIDE are cut to them — a custom window from the 15th to
// the 10th draws its first month from the 15th and its last up to the 10th,
// so the bars at its edges and the tiles above them count the same days. Every
// month between is whole, and a window that starts and ends on a month's edges
// changes nothing. `start` is taken out by name so it never reaches
// buildReport through `rest`.
export function monthSeries({ rows, resolved, months = 6, today = dayISO(), start = null, end = null, ...rest }) {
  const last = (end || today).slice(0, 7)
  const keys = []
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonth(last, -i))
  // Months before the board had anything in it are not quiet months, they are
  // months that did not happen here. Drawn as bars of zero they read as a
  // collapse at the left-hand edge of every chart.
  //
  // "Anything" is every day a month's row counts by: the day a piece went
  // out, its release day, and the day each of its steps came due — the
  // re-promised one where there is one, as buildReport judges it. Reading only
  // the first two left off the month a cut came due in whenever the piece went
  // out the month after: a new editor's August cut, late, and a series that
  // began in September — no red bar anywhere, under a tile that said 100%.
  // The moment a piece was made, on the Tashkent clock, is the last resort,
  // for a piece with no day of any kind.
  const dayOf = (iso) => (Number.isFinite(Date.parse(iso || '')) ? tashkentDay(iso) : null)
  const born = rows.reduce((first, r) => {
    const days = [
      dayOf(r.done_at), r.release_date, r.recording_date,
      r.edit_due_revised || r.edit_ready_date, r.design_ready_date, r.review_due_revised,
    ].filter(Boolean).sort()
    const day = days[0] || dayOf(r.created_at)
    return day && (!first || day < first) ? day : first
  }, null)
  const live = born ? keys.filter((k) => k >= born.slice(0, 7)) : keys
  return (live.length ? live : keys.slice(-1)).map((month) => {
    const e = monthEdges(month)
    const from = start && start > e.from && start <= e.to ? start : e.from
    const to = end && end < e.to && end >= e.from ? end : e.to
    const r = buildReport({ rows, resolved, from, to, today, ...rest })
    return {
      month,
      // The days this row actually counts — the whole month, or the part of it
      // inside the window — so a cut month can say so where it is drawn.
      from, to,
      out: r.pieces.out, on_time: r.pieces.on_time, late: r.pieces.late, no_day: r.pieces.no_day,
      planned: r.pieces.planned, planned_out: r.pieces.planned_out,
      overdue: r.pieces.planned_overdue, to_come: r.pieces.planned_to_come,
      late_steps: r.steps.late, knock_on: r.steps.knock_on, days_lost: r.steps.days_lost,
      views: r.pieces.views, views_counted: r.pieces.views_counted, views_missing: r.pieces.views_missing,
      on_time_pct: r.rates.on_time, plan_pct: r.rates.plan,
      // The made work — cuts and artwork — against their own days (the
      // re-promised day where there is one, as every step here is judged):
      // the Statistics chart's on-time-versus-late bars. The knock-ons came
      // due as well and are in neither bar, so they are counted beside them;
      // without it a month's bar is short of what came due by a number
      // nobody can see.
      made_on_time: made(r, 'on_time'), made_late: made(r, 'late'), made_knock_on: made(r, 'knock_on'),
      // Still being counted: the month we are in, up to a day not yet here. A
      // custom window that stops on the 10th of this month has a last row
      // that is finished — it says "so far" about nothing.
      running: month === today.slice(0, 7) && to >= today,
    }
  })
}

// ---- what the numbers are standing on ---------------------------------------
// A statistic is a reading of the board, and the board is filled in by people
// with a shoot to get to. Where it is thin, the number above it is thin in
// exactly the same place — so the page says so, names the pieces, and offers
// the one-click fix where there is one, instead of printing a confident
// percentage over a hole.
//
// The largest of these by far: the board stamps "went out" at the moment
// somebody moves the card, and cards get moved in batches days or weeks after
// the posts actually went up. Every on-time figure the board has ever shown is
// really a figure about card-moving.
export function dataHealth({ rows, resolved, today = dayISO(), finalId = null }) {
  const out = []
  const push = (key, title, why, list, extra = {}) => {
    if (!list.length) return
    out.push({
      key, title, why, count: list.length,
      pieces: list.slice(0, 60).map((r) => ({ id: r.id, title: r.title, day: r.release_date || null })),
      ...extra,
    })
  }

  // 1. Caught up in a batch: many pieces marked published on one day, long
  //    after the days they were promised for.
  const byDay = new Map()
  for (const row of rows) {
    const f = pieceFacts(row)
    if (!f.out || !f.due || f.days_late < 3) continue
    if (!byDay.has(f.out)) byDay.set(f.out, [])
    byDay.get(f.out).push({ ...row, lag: f.days_late })
  }
  const batches = [...byDay.entries()]
    .filter(([, list]) => list.length >= 4)
    .map(([day, list]) => {
      const lags = list.map((r) => r.lag).sort((a, b) => a - b)
      return {
        day, count: list.length,
        median_lag: lags[Math.floor(lags.length / 2)],
        first_release: list.map((r) => r.release_date).sort()[0],
        last_release: list.map((r) => r.release_date).sort().at(-1),
        ids: list.map((r) => r.id),
        pieces: list.slice(0, 60).map((r) => ({ id: r.id, title: r.title, day: r.release_date, lag: r.lag })),
      }
    })
    .sort((a, b) => b.count - a.count)
  if (batches.length) {
    out.push({
      key: 'caught_up',
      title: 'The board was caught up in batches',
      why: 'On these days a pile of pieces was marked published at once, days or weeks after the day each one was promised for. The posts almost certainly went out on time; the board only heard about it later — and every on-time figure counts the day the card moved.',
      count: batches.reduce((a, b) => a + b.count, 0),
      batches,
      fixable: true,
    })
  }

  // 2. Went out with no day to judge it by.
  push('no_release_day', 'Published with no release day',
    'Nothing to compare the day it went out against, so these can be neither on time nor late. They sit outside every punctuality figure on the page.',
    rows.filter((r) => r.done_at && !r.release_date))

  // 3. In the last column, but never stamped.
  if (finalId != null) {
    push('final_no_stamp', 'In Published, but not recorded as out',
      'The card sits in the final stage with no moment of going out on it, so no report counts it. Move it out and back in, or tick it done.',
      rows.filter((r) => !r.done_at && r.status_id === finalId))
  }

  // 4. Open work carrying no day at all.
  push('no_dates', 'Open with no day of any kind',
    'No shoot day, no edit day, no release day. It cannot be late, cannot be planned for, and appears in no forecast — it is invisible to every number here.',
    rows.filter((r) => !r.done_at && !r.release_date && !r.recording_date && !r.edit_ready_date && !r.design_ready_date))

  // 5. Footage with nobody cutting it.
  push('no_editor', 'Filmed work with no editor',
    'The edit has a deadline and nobody answering for it, so a missed edit lands on no one and the editing figures are short by exactly these.',
    rows.filter((r) => !r.done_at && ['reel', 'video'].includes(r.type) && !r.editor_id && (r.edit_ready_date || r.shot_at)))

  // 6. Long overdue and still open.
  push('stale', 'Overdue by more than a month',
    'Promised over thirty days ago and still not out. Either it is still coming and needs a real day, or it is not coming and should be closed — while it is neither, it counts against every month it touches.',
    rows.filter((r) => !r.done_at && r.release_date && dayDiff(today, r.release_date) > 30))

  return out
}

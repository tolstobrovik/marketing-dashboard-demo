import { Router } from 'express'
import { all, get, run } from '../db.js'
import bcrypt from 'bcryptjs'
import { authRequired, wrap, isFullAdmin, isAdminOn } from '../auth.js'
import { ambassadorTasks, ambassadorBrief, ambassadorFootage, ambassadorEditors, ambassadorVideoTasks, ambassadorEditTask } from './content.js'
import { rateCardFor, RATE_KINDS } from './reports.js'

// The ambassador programme.
//
// ISOLATION. This router owns three tables — ambassadors, ambassador_cards,
// ambassador_payouts — and reads exactly one thing outside them: the users
// table, for a name. It writes to nothing else. An ambassador card is not a
// content task: it never reaches a channel board, is counted in no company
// total, and its money is not Finance. Delete these three tables and the rest
// of the dashboard is unchanged.
//
// ONE WINDOW OUT (Ambassador 2.0). A content task can be GIVEN to an
// ambassador — an admin adds them as its owner — and then they need its days,
// its brief and a place to say the footage is in. `/me/tasks…` is that
// window, and `/me/rates` shows them the rate card they are on. The reading
// and the one write are done by functions that live with the tables they
// touch (routes/content.js, routes/reports.js); this router only decides who
// is asking. Nothing here lets an ambassador see a task that is not theirs,
// change a brief, or move a stage.
//
// AND ONE WAY IN (the Ambassadors calendar, October 2026). A video that came
// in can be handed to an editor: that makes an ordinary editing task, and the
// card keeps only its id (task_id). Making the task, and reading back whether
// it is with the editor or out, are content.js's (ambassadorEditTask,
// ambassadorVideoTasks) for the same reason as above.
//
// PERMISSION. Two audiences and no third. An ambassador sees their own cards
// and nothing else; whoever RUNS THE PROGRAMME sees everyone.
//
// Running it used to mean being an admin of the whole board, which made the
// job impossible to hand to the person actually doing it: checking students'
// posts and signing new ones up does not need the power to delete a channel
// or rewrite the pipeline. It is a permission now — `manage_ambassadors`,
// off by default — so an admin can give exactly this job away and nothing
// else with it. A full admin still has it by virtue of being one.
//
// The refusal that keeps an ambassador out of the rest of the dashboard is in
// auth.js, at the one place every authenticated request passes through — not
// here, and not in a sidebar.
const router = Router()
router.use(authRequired)

const now = () => new Date().toISOString()
const isAdmin = (user) => isFullAdmin(user) || !!(user?.permissions && user.permissions.manage_ambassadors)

// The states, and the only moves between them. A card that is paid is
// finished for ever: there is no way back and no route that offers one.
//
//   waiting        the idea is with us
//   needs_changes  the IDEA came back with a comment
//   can_film       the script is approved and the price agreed
//   review         they filmed it and sent the VIDEO — with us, not public
//   reshoot        the VIDEO came back with a comment. Loops to review, as
//                  many times as it takes
//   to_post        the video is approved and it is theirs to post
//   posted         it is live and the link is in — waiting for us to look
//   done / paid    unchanged
//
// review, reshoot and to_post are new, and they are the point. The flow used
// to run can_film → posted: the only way to tell us a video existed was to
// say it was already public, so nothing could be checked before the world saw
// it, and "send it back" meant asking somebody to take down a published post.
const STATES = ['waiting', 'needs_changes', 'can_film', 'review', 'reshoot', 'to_post', 'posted', 'done', 'paid']

// The trail, read back. Attached to the cards it belongs to, because a history
// nobody can see from the card is a table, not a history.
async function withEvents(cards) {
  if (!cards.length) return cards
  const ids = cards.map((c) => c.id)
  const rows = await all(
    `SELECT * FROM ambassador_card_events WHERE card_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids)
  const byCard = {}
  for (const e of rows) {
    (byCard[e.card_id] ||= []).push({
      id: e.id, kind: e.kind, by_id: e.by_id, text: e.text || '', url: e.url || '',
      version: e.version, at: e.created_at,
    })
  }
  return cards.map((c) => ({ ...c, events: byCard[c.id] || [] }))
}

// The trail. Every submission and every answer, in order, kept for good.
const logEvent = (cardId, kind, { by = null, text = '', url = '', version = 1 } = {}) =>
  run(`INSERT INTO ambassador_card_events (card_id, kind, by_id, text, url, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, cardId, kind, by, text, url, version, now())

// Tashkent, like every other date on this board. A month is what somebody in
// the office would call today, not what UTC would.
const TZ_OFFSET = 5 * 3600e3
const monthNow = () => new Date(Date.now() + TZ_OFFSET).toISOString().slice(0, 7)
const dayNow = () => new Date(Date.now() + TZ_OFFSET).toISOString().slice(0, 10)
// The office month a stored (UTC) timestamp falls in — the first five hours of
// the 1st are still "last month" in UTC.
const monthOf = (iso) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + TZ_OFFSET).toISOString().slice(0, 7) : ''
}

// 31 February parses — as 3 March — so a day is only a day if it reads back
// the same.
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
  && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v
const clean = (v, max) => String(v ?? '').trim().slice(0, max)
// A reference is optional, but a reference that is not a link is not a
// reference — it is a word somebody typed into the wrong box.
const linkProblem = (v) => {
  try {
    const u = new URL(String(v))
    return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'A link has to start with http:// or https://'
  } catch { return 'A link has to start with http:// or https://' }
}

// ---- who is asking -----------------------------------------------------------
const meAsAmbassador = (userId) => get('SELECT * FROM ambassadors WHERE user_id = ?', userId)

const cardOut = (c) => ({
  id: c.id,
  ambassador_id: c.ambassador_id,
  format: c.format,
  script: c.script,
  reference_url: c.reference_url,
  planned_date: c.planned_date,
  state: c.state,
  version: c.version,
  we_edit: !!c.we_edit,
  posts_own: !!c.posts_own,
  collaborator: !!c.collaborator,
  terms_other: c.terms_other || '',
  amount: c.amount == null ? null : Number(c.amount),
  approved_by: c.approved_by,
  approved_at: c.approved_at,
  feedback: c.feedback,
  video_url: c.video_url || '',
  who_posts: c.who_posts || '',
  video_ok_at: c.video_ok_at || null,
  main_video_url: c.main_video_url,
  story_clip_url: c.story_clip_url,
  posted_at: c.posted_at,
  checked_at: c.checked_at,
  paid_month: c.paid_month,
  task_id: c.task_id > 0 ? c.task_id : null,
  created_at: c.created_at,
  updated_at: c.updated_at,
})

const personOut = (a, user) => ({
  id: a.id,
  user_id: a.user_id,
  name: user?.name || 'Someone who left',
  // What they type to sign in. Never shown anywhere before, which turned
  // "I have forgotten what I gave them" into an account nobody could get back
  // into. The PASSWORD is not here and cannot be: it is a bcrypt hash, which
  // is one-way by design — see the reset route instead.
  username: user?.username || '',
  university: a.university,
  telegram: a.telegram,
  status: a.status,
  default_we_edit: !!a.default_we_edit,
  default_posts_own: !!a.default_posts_own,
  default_collaborator: !!a.default_collaborator,
  default_terms_other: a.default_terms_other || '',
  // The bytes are never sent with a list. The file is fetched by its own
  // route when somebody actually opens it.
  contract_name: a.contract_name || '',
  has_contract: !!a.contract_data,
  created_at: a.created_at,
})

// The month a card counts for, and the money in it. Both sides read this so
// the two numbers on the ambassador's page and the admin's arithmetic can
// never disagree.
const inMonth = (cards, month) => cards.filter((c) => String(c.paid_month || '') === month)
const earned = (cards) => cards.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

// ---- the ambassador's own page -----------------------------------------------
// One request builds their whole screen: their two numbers, their cards, and
// their details. Nobody else's anything.
router.get('/me', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(404).json({ error: 'You are not set up as an ambassador yet' })
  const cards = await withEvents((await all(
    'SELECT * FROM ambassador_cards WHERE ambassador_id = ? ORDER BY created_at DESC, id DESC', me.id)).map(cardOut))
  const month = monthNow()
  const posted = cards.filter((c) => ['posted', 'done', 'paid'].includes(c.state) && String(c.paid_month || month) === month)
  res.json({
    person: personOut(me, req.user),
    month,
    posted_this_month: cards.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month).length,
    earned_this_month: earned(inMonth(cards, month)),
    cards,
    // Unused by the page, kept so the shape does not change under step two.
    open_posted: posted.length,
  })
}))

// ---- the tasks they were given (Ambassador 2.0) ------------------------------
// Their days: when each task is filmed, and when its cut is due. The page
// draws the next two weeks as a calendar and all of them as a list.
router.get('/me/tasks', wrap(async (req, res) => {
  res.json(await ambassadorTasks(req.user.id))
}))

// One task's brief — the ТЗ, the script and the references, read-only.
router.get('/me/tasks/:id(\\d+)', wrap(async (req, res) => {
  const brief = await ambassadorBrief(req.user.id, Number(req.params.id))
  if (!brief) return res.status(404).json({ error: 'Not found' })
  res.json(brief)
}))

// The footage, handed in. Saved as written — see ambassadorFootage for why
// this is deliberately not the crew's strict hand-in.
router.post('/me/tasks/:id(\\d+)/footage', wrap(async (req, res) => {
  // The relaxed hand-in is the student's alone. Staff hand in through
  // PATCH /content/:id, which holds them to their rights and to a real link.
  if (req.user.role !== 'ambassador') return res.status(403).json({ error: 'Hand the footage in from the task itself' })
  const out = await ambassadorFootage(req, Number(req.params.id), req.body?.link)
  if (out.error) return res.status(out.status).json({ error: out.error })
  res.json({ ok: true, task: out.task })
}))

// What they are paid: the card they are on (their own, or the ambassador
// role's), read-only and in the board's own terms — a flat rate per kind of
// piece, the views a piece has to reach, and what a thousand views pays once
// it has. The arithmetic is Pay's and is not repeated here.
router.get('/me/rates', wrap(async (req, res) => {
  const card = await rateCardFor(req.user.id)
  const kinds = RATE_KINDS
    .map((kind) => ({ kind, ...(card.kind_rules?.[kind] || {}) }))
    .filter((k) => k.flat || k.gate || k.per_1k)
    .map((k) => ({ kind: k.kind, flat: Number(k.flat) || 0, gate: Number(k.gate) || 0, per_1k: Number(k.per_1k) || 0 }))
  res.json({
    currency: card.currency || 'UZS',
    source: card.source,           // own | role | default | none
    kinds,
    per_publish: card.per_publish || 0,
    per_1k_views: card.per_1k_views || 0,
    views_target: card.views_target || 0,
    views_bonus: card.views_bonus || 0,
  })
}))

// Sending an idea. Four fields, one of which is optional.
router.post('/me/cards', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(403).json({ error: 'You are not set up as an ambassador yet' })
  if (me.status !== 'active') return res.status(403).json({ error: 'Your account is paused' })
  const b = req.body || {}
  const format = clean(b.format, 60)
  const script = clean(b.script, 20000)
  const reference = clean(b.reference_url, 500)
  const planned = clean(b.planned_date, 10)
  if (!format) return res.status(400).json({ error: 'Say what kind of video this is' })
  if (script.length < 40) return res.status(400).json({ error: 'Tell us what happens in the video — a few sentences' })
  if (reference) { const bad = linkProblem(reference); if (bad) return res.status(400).json({ error: bad }) }
  if (planned && !isDay(planned)) return res.status(400).json({ error: 'A date is YYYY-MM-DD' })
  const stamp = now()
  await run(`
    INSERT INTO ambassador_cards (ambassador_id, format, script, reference_url, planned_date, state, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'waiting', 1, ?, ?)
  `, me.id, format, script, reference || '', planned || null, stamp, stamp)
  res.status(201).json({ ok: true })
}))

// Sending it again after a change was asked for. The SAME card: version goes
// up and it returns to waiting, so the whole argument stays in one place
// instead of leaving a trail of abandoned rows nobody can line up afterwards.
router.patch('/me/cards/:id', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(403).json({ error: 'You are not set up as an ambassador yet' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card || card.ambassador_id !== me.id) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'needs_changes')
    return res.status(409).json({ error: 'This one is not waiting on you' })
  const b = req.body || {}
  const format = clean(b.format ?? card.format, 60)
  const script = clean(b.script ?? card.script, 20000)
  const reference = clean(b.reference_url ?? card.reference_url, 500)
  const planned = clean(b.planned_date ?? card.planned_date ?? '', 10)
  if (!format) return res.status(400).json({ error: 'Say what kind of video this is' })
  if (script.length < 40) return res.status(400).json({ error: 'Tell us what happens in the video — a few sentences' })
  if (reference) { const bad = linkProblem(reference); if (bad) return res.status(400).json({ error: bad }) }
  if (planned && !isDay(planned)) return res.status(400).json({ error: 'A date is YYYY-MM-DD' })
  await run(`
    UPDATE ambassador_cards
       SET format = ?, script = ?, reference_url = ?, planned_date = ?,
           state = 'waiting', version = version + 1, feedback = '', updated_at = ?
     WHERE id = ?
  `, format, script, reference || '', planned || null, now(), card.id)
  res.json({ ok: true })
}))

// ---- the video, before anybody posts anything --------------------------------
// "I FILMED IT." Not "I posted it" — the difference is the whole point of
// this half of the flow. Nothing is public yet: the ambassador sends us the
// video, we watch it, and it goes back and forth until it is right. Sending a
// video back is an ordinary part of the work; asking somebody to delete a
// published post is not.
//
// Allowed from can_film (the first cut) and from reshoot (every cut after).
router.post('/me/cards/:id(\\d+)/filmed', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(403).json({ error: 'You are not set up as an ambassador yet' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card || card.ambassador_id !== me.id) return res.status(404).json({ error: 'No such card' })
  if (!['can_film', 'reshoot'].includes(card.state))
    return res.status(409).json({ error: 'This one is not waiting on a video from you' })
  const url = clean(req.body?.video_url, 500)
  if (!url) return res.status(400).json({ error: 'Paste the link to the video — that is what we watch' })
  const bad = linkProblem(url)
  if (bad) return res.status(400).json({ error: bad })
  const stamp = now()
  // The cut number is what makes a second video visibly a second video. It was
  // the missing thing: one column held the link, the next submission
  // overwrote it, and nobody could tell a resubmission from the original.
  const cut = Number(card.version) || 1
  await run(`
    UPDATE ambassador_cards
       SET state = 'review', video_url = ?, feedback = '', updated_at = ?
     WHERE id = ?
  `, url, stamp, card.id)
  await logEvent(card.id, 'video', { url, version: cut })
  res.json({ ok: true })
}))

// NOT RIGHT YET. Back to them with a reason, and the reason is REQUIRED —
// this is the message that never arrived before, because it was written onto a
// state the ambassador's page did not display it on.
router.post('/cards/:id(\\d+)/video-changes', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'review') return res.status(409).json({ error: 'There is no video waiting on this one' })
  const feedback = clean(req.body?.feedback, 2000)
  if (!feedback) return res.status(400).json({ error: 'Say what needs changing — they cannot guess' })
  const stamp = now()
  // version counts the rounds. The next video they send is cut 2, then 3 —
  // five rounds is a normal number here and each one keeps its own row.
  await run(`
    UPDATE ambassador_cards
       SET state = 'reshoot', feedback = ?, version = version + 1, updated_at = ?
     WHERE id = ?
  `, feedback, stamp, card.id)
  await logEvent(card.id, 'sent_back', { by: req.user.id, text: feedback, version: Number(card.version) || 1 })
  res.json({ ok: true })
}))

// THE VIDEO IS GOOD. Who posts it is decided HERE and not before: some deals
// the ambassador posts and tags us, some we post it ourselves, and which one
// applies can change after somebody has actually seen the video. The card's
// saved terms pre-select the answer; the person approving makes the call.
//
//   them → to_post, and they are asked for the post link
//   us   → done. There is nothing left for them to do, so they are not asked
//          for a link they cannot produce, and it counts for the month now.
router.post('/cards/:id(\\d+)/video-ok', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'review') return res.status(409).json({ error: 'There is no video waiting on this one' })
  const who = req.body?.who_posts === 'us' ? 'us' : 'them'
  const stamp = now()
  const nextState = who === 'us' ? 'done' : 'to_post'
  await run(`
    UPDATE ambassador_cards
       SET state = ?, who_posts = ?, video_ok_at = ?, video_ok_by = ?, feedback = '',
           checked_by = CASE WHEN ? = 'done' THEN ? ELSE checked_by END,
           checked_at = CASE WHEN ? = 'done' THEN ? ELSE checked_at END,
           paid_month = CASE WHEN ? = 'done' THEN COALESCE(paid_month, ?) ELSE paid_month END,
           updated_at = ?
     WHERE id = ?
  `, nextState, who, stamp, req.user.id,
     nextState, req.user.id, nextState, stamp, nextState, monthNow(), stamp, card.id)
  await logEvent(card.id, 'approved', {
    by: req.user.id,
    text: who === 'us' ? 'Video approved — we post it' : 'Video approved — they post it',
    version: Number(card.version) || 1,
  })
  res.json({ ok: true })
}))

// ---- it is live ---------------------------------------------------------------
// Only reachable once the video has been approved, which is what stops a post
// going up before anybody has seen it.
router.post('/me/cards/:id(\\d+)/posted', wrap(async (req, res) => {
  const me = await meAsAmbassador(req.user.id)
  if (!me) return res.status(403).json({ error: 'You are not set up as an ambassador yet' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card || card.ambassador_id !== me.id) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'to_post')
    return res.status(409).json({ error: 'Wait until the video has been approved — do not post before then' })
  const main = clean(req.body?.main_video_url, 500)
  const story = clean(req.body?.story_clip_url, 500)
  if (!main) return res.status(400).json({ error: 'Paste the link to the post' })
  const bad = linkProblem(main)
  if (bad) return res.status(400).json({ error: bad })
  if (story) { const b2 = linkProblem(story); if (b2) return res.status(400).json({ error: b2 }) }
  const stamp = now()
  await run(`
    UPDATE ambassador_cards
       SET state = 'posted', main_video_url = ?, story_clip_url = ?, posted_at = ?, feedback = '', updated_at = ?
     WHERE id = ?
  `, main, story, stamp, stamp, card.id)
  await logEvent(card.id, 'post', { url: main, version: Number(card.version) || 1 })
  res.json({ ok: true })
}))

// ---- checking it, and paying for it ------------------------------------------
// DONE. Somebody opened the link and it is really there. This is the moment
// the card counts for a month and for somebody's money, so the month is
// stamped HERE and never moves again — a card checked in September belongs to
// September however long the payment takes.
router.post('/cards/:id(\\d+)/done', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'posted') return res.status(409).json({ error: 'This card has not been posted yet' })
  const stamp = now()
  await run(`
    UPDATE ambassador_cards
       SET state = 'done', checked_by = ?, checked_at = ?, paid_month = COALESCE(paid_month, ?), updated_at = ?
     WHERE id = ?
  `, req.user.id, stamp, monthNow(), stamp, card.id)
  res.json({ ok: true })
}))

// NOT RIGHT. The post is up but it is not what was agreed — the wrong tag, the
// wrong account, the wrong caption. Back to to_post, NOT to can_film: the
// video itself was already approved and does not need filming again, so
// sending it back here asks them to fix the POST. Re-filming is a different
// button and a different state.
router.post('/cards/:id(\\d+)/repost', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'posted') return res.status(409).json({ error: 'This card has not been posted yet' })
  const feedback = clean(req.body?.feedback, 2000)
  if (!feedback) return res.status(400).json({ error: 'Say what is wrong with it' })
  await run(`
    UPDATE ambassador_cards SET state = 'to_post', feedback = ?, updated_at = ? WHERE id = ?
  `, feedback, now(), card.id)
  await logEvent(card.id, 'sent_back', { by: req.user.id, text: feedback, version: Number(card.version) || 1 })
  res.json({ ok: true })
}))

// PAID. Paying happens outside this system; this records that somebody said it
// had been. There is no way back from here, on purpose.
router.post('/cards/:id(\\d+)/paid', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'done') return res.status(409).json({ error: 'Only a checked video can be marked paid' })
  await run("UPDATE ambassador_cards SET state = 'paid', updated_at = ? WHERE id = ?", now(), card.id)
  res.json({ ok: true })
}))

// ---- one person, whole ---------------------------------------------------------
// Everything about one ambassador in one request: their details and every card
// they have ever sent. This is what "let me look at their account" means here
// — the same rows they see, read-only, without anybody having to log in as
// somebody else. Signing in as another person is a thing that should not be
// buildable on a board that records who did what.
router.get('/person/:userId(\\d+)/cards', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'That person is not set up yet' })
  const u = await get('SELECT id, name, username FROM users WHERE id = ?', a.user_id)
  const cards = await withEvents((await all(
    'SELECT * FROM ambassador_cards WHERE ambassador_id = ? ORDER BY created_at DESC, id DESC', a.id)).map(cardOut))
  const month = monthNow()
  res.json({
    person: personOut(a, u),
    month,
    cards,
    // The two numbers their own page shows them, worked out the same way, so
    // the admin and the ambassador are never looking at different totals.
    posted_this_month: cards.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month).length,
    earned_this_month: earned(inMonth(cards, month)),
    earned_all_time: earned(cards.filter((c) => ['done', 'paid'].includes(c.state))),
    done_all_time: cards.filter((c) => ['done', 'paid'].includes(c.state)).length,
  })
}))

// ---- the contract --------------------------------------------------------------
// Uploaded as a data URL, the way person_docs does it. A contract is the one
// piece of paper this programme actually has, and there was no way to put it
// anywhere.
const CONTRACT_MAX = 8 * 1024 * 1024   // 8MB of base64, about 6MB of file
router.put('/person/:userId(\\d+)/contract', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'Set this person up first' })
  const name = clean(req.body?.name, 200)
  const data = String(req.body?.data || '')
  if (!name || !data) return res.status(400).json({ error: 'Pick a file' })
  if (!/^data:[^;]*;base64,/.test(data)) return res.status(400).json({ error: 'That file did not come through' })
  if (data.length > CONTRACT_MAX) return res.status(413).json({ error: 'That file is too big — 6MB is the limit' })
  const mime = clean(req.body?.mime, 120) || (data.match(/^data:([^;]*);/) || [])[1] || ''
  await run(`
    UPDATE ambassadors SET contract_name = ?, contract_mime = ?, contract_data = ?,
           contract_size = ?, contract_at = ?, updated_at = ? WHERE id = ?
  `, name, mime, data, data.length, now(), now(), a.id)
  res.json({ ok: true })
}))

router.delete('/person/:userId(\\d+)/contract', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'No such ambassador' })
  await run(`
    UPDATE ambassadors SET contract_name = '', contract_mime = '', contract_data = NULL,
           contract_size = 0, contract_at = NULL, updated_at = ? WHERE id = ?
  `, now(), a.id)
  res.json({ ok: true })
}))

// Their contract, opened in a new tab. An ambassador may fetch their own; an
// admin may fetch anybody's. Nobody may fetch somebody else's.
router.get('/:id(\\d+)/contract', wrap(async (req, res) => {
  const a = await get('SELECT * FROM ambassadors WHERE id = ?', req.params.id)
  if (!a) return res.status(404).json({ error: 'No such ambassador' })
  if (!isAdmin(req.user) && a.user_id !== req.user.id)
    return res.status(403).json({ error: 'That is not yours' })
  if (!a.contract_data) return res.status(404).json({ error: 'No contract has been uploaded yet' })
  res.json({ name: a.contract_name, mime: a.contract_mime, data: a.contract_data })
}))

// ---- the calendar: which videos came in, and which still need an editor -------
// One card a video, on the day it came in (its latest cut), in one of three
// states read off the task made from it — never stored:
//
//   new      no task yet. Late (the one ruby) once it has waited over 2 days
//   editing  a task exists and is not out
//   done     that task is published
//
// Not drawn unless it already has a task: a video they post on their own
// account (approved as "they post it") and one sent back to be filmed again.
// Nobody here edits either, and each would sit as a late "new" for ever.
const dayOf = (iso) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + TZ_OFFSET).toISOString().slice(0, 10) : ''
}
const daysFrom = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5)

async function videosOf(where = '', ...args) {
  const cards = await all(`SELECT * FROM ambassador_cards WHERE video_url <> '' ${where}`, ...args)
  if (!cards.length) return []
  const people = new Map((await all('SELECT id, user_id, university FROM ambassadors')).map((a) => [a.id, a]))
  const names = new Map((await all('SELECT id, name FROM users')).map((u) => [u.id, u.name]))
  const sent = new Map((await all(`SELECT card_id, MAX(created_at) AS at FROM ambassador_card_events
    WHERE kind = 'video' GROUP BY card_id`)).map((e) => [e.card_id, e.at]))
  const tasks = await ambassadorVideoTasks(cards.map((c) => c.task_id))
  const today = dayNow()
  return cards.map((c) => {
    const task = tasks.get(c.task_id) || null
    if (!task && (c.who_posts === 'them' || c.state === 'reshoot')) return null
    const a = people.get(c.ambassador_id)
    const at = sent.get(c.id) || c.updated_at
    const day = dayOf(at)
    const state = !task ? 'new' : task.done ? 'done' : 'editing'
    const waited = Math.max(0, daysFrom(day, today))
    return {
      id: c.id, name: names.get(a?.user_id) || 'Someone who left', university: a?.university || '',
      format: c.format, url: c.video_url, cut: Number(c.version) || 1, sent_at: at, day, waited,
      state, late: state === 'new' && waited > 2, task,
    }
  }).filter(Boolean).sort((x, y) => String(x.sent_at).localeCompare(String(y.sent_at)) || x.id - y.id)
}

// Everything the calendar draws for one month, in one request: the month's
// videos, the new ones still waiting from before it ("Sent earlier"), and the
// channels this person may hand work out on, each with who edits there.
router.get('/videos', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month || '')) ? req.query.month : monthNow()
  const videos = await videosOf()
  res.json({
    month,
    today: dayNow(),
    videos: videos.filter((v) => v.day.slice(0, 7) === month),
    earlier: videos.filter((v) => v.state === 'new' && v.day < `${month}-01`),
    channels: (await ambassadorEditors()).filter((c) => isAdminOn(req.user, [c.key])),
  })
}))

// HAND IT TO AN EDITOR. Tap one is the card, tap two is the editor's button,
// and this is tap two: one ordinary task (content.js, ambassadorEditTask),
// for an admin of the channel it goes on. Once per video — a second press,
// from this page or another, is refused with the reason — and the board's own
// POST /content/:id/undo takes it back for ten seconds.
router.post('/cards/:id(\\d+)/assign', wrap(async (req, res) => {
  const channel = clean(req.body?.channel, 60)
  if (!isAdminOn(req.user, [channel]))
    return res.status(403).json({ error: 'Only an admin of that channel can give work to an editor on it' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (!card.video_url) return res.status(409).json({ error: 'No video has come in on this one yet' })
  const was = card.task_id ?? null
  if ((await ambassadorVideoTasks([was])).size)
    return res.status(409).json({ error: 'An editor is already set, so it can’t be assigned again. Change it inside the task.', task_id: was })
  // The claim: a token only this press holds, set only if the column still
  // says what was read above. Two presses at once — the second finds the
  // token and stops. updated_at is left alone: the inbox reads it as how long
  // the video has waited.
  const claim = -(1 + Math.floor(Math.random() * 1e9))
  const took = await run('UPDATE ambassador_cards SET task_id = ? WHERE id = ? AND COALESCE(task_id, 0) = ?', claim, card.id, was ?? 0)
  if (!took.changes) return res.status(409).json({ error: 'Somebody is giving this video to an editor right now' })
  const a = await get('SELECT user_id, university FROM ambassadors WHERE id = ?', card.ambassador_id)
  const name = (await get('SELECT name FROM users WHERE id = ?', a?.user_id))?.name || 'an ambassador'
  let out
  try {
    out = await ambassadorEditTask(req, {
      channel, editorId: req.body?.editor_id,
      title: `Ambassador video: ${name}${card.format ? ` — ${card.format}` : ''}`.slice(0, 200),
      link: card.video_url,
      description: `From ambassador ${name}${a?.university ? `, ${a.university}` : ''}. Their video: ${card.video_url}`
        + (card.script ? `\n\n${card.script}` : ''),
    })
  } catch (e) { out = { status: 500, error: e.message } }
  if (!out.id) {
    await run('UPDATE ambassador_cards SET task_id = ? WHERE id = ? AND task_id = ?', was, card.id, claim)
    return res.status(out.status).json({ error: out.error })
  }
  await run('UPDATE ambassador_cards SET task_id = ? WHERE id = ?', out.id, card.id)
  res.status(201).json({ ok: true, task_id: out.id, editor: out.editor, channel: out.channel })
}))

// ---- the admin's render ------------------------------------------------------
// Everything the admin page needs, in one request: the people, and the inbox.
router.get('/', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  // Removed people are not in the list — but their finished cards still are,
  // and those cards still need a name, so the row itself is kept and read
  // below rather than deleted.
  const allPeople = await all('SELECT * FROM ambassadors ORDER BY id')
  const people = allPeople.filter((p) => p.status !== 'ended')
  const users = await all("SELECT id, name, username, role FROM users WHERE role = 'ambassador' ORDER BY name")
  const byId = Object.fromEntries(users.map((u) => [u.id, u]))
  const cards = await withEvents((await all('SELECT * FROM ambassador_cards ORDER BY created_at, id')).map(cardOut))
  const tasks = await ambassadorVideoTasks(cards.map((c) => c.task_id))

  const month = monthNow()
  const perPerson = {}
  for (const c of cards) (perPerson[c.ambassador_id] ||= []).push(c)

  // Waiting on US, oldest first: how long somebody has been waiting is the
  // only thing that decides what to open next.
  //
  // TWO kinds wait on us, not one. An idea waiting for a yes, and a video
  // somebody has already filmed and posted, waiting for us to look at it. The
  // second kind was invisible here — which is why the programme appeared to
  // end at "you can film this" and the work nobody had checked simply piled
  // up where nobody was looking.
  // THREE kinds wait on us now, not two: an idea wanting a yes, a VIDEO
  // wanting to be watched, and a post wanting to be confirmed live. The middle
  // one is the one that did not exist — a filmed video had nowhere to sit
  // except "already public".
  const inbox = cards
    .filter((c) => ['waiting', 'review', 'posted'].includes(c.state))
    .map((c) => {
      const a = allPeople.find((p) => p.id === c.ambassador_id)
      return {
        ...c,
        kind: c.state === 'posted' ? 'posted' : c.state === 'review' ? 'video' : 'idea',
        name: byId[a?.user_id]?.name || 'Someone who left',
        university: a?.university || '',
        defaults: {
          we_edit: !!a?.default_we_edit,
          posts_own: !!a?.default_posts_own,
          collaborator: !!a?.default_collaborator,
          terms_other: a?.default_terms_other || '',
        },
        // The last three amounts this person was paid, as plain text beside
        // the box. Never pre-filled: a number that fills itself in is a number
        // nobody decided.
        recent_amounts: (perPerson[c.ambassador_id] || [])
          .filter((x) => x.amount != null)
          .sort((x, y) => String(y.approved_at || '').localeCompare(String(x.approved_at || '')))
          .slice(0, 3)
          .map((x) => x.amount),
        waiting_since: c.state === 'posted' ? (c.posted_at || c.updated_at) : c.updated_at,
      }
    })
    .sort((a, b) => String(a.waiting_since).localeCompare(String(b.waiting_since)))

  // What this costs, which the programme could not answer at all. It has a
  // queue of work to check and had no view of money to settle: "what do I owe
  // this month" was a question you answered by opening every person in turn
  // and adding it up yourself.
  //
  // A card is owed from the moment it is checked (done) until somebody says it
  // was paid. The month it counts for is stamped at that check and never
  // moves, so a video checked in September stays September's however long the
  // payment takes.
  const owedCards = cards.filter((c) => c.state === 'done')
  const owed = owedCards.map((c) => {
    const a = allPeople.find((p) => p.id === c.ambassador_id)
    return { ...c, name: byId[a?.user_id]?.name || 'Someone who left', university: a?.university || '' }
  }).sort((x, y) => String(x.paid_month || '').localeCompare(String(y.paid_month || '')) || x.id - y.id)

  res.json({
    month,
    today: dayNow(),
    money: {
      // Everything checked and not yet paid, whatever month it belongs to —
      // last month's unpaid work does not stop being owed because the calendar
      // turned over.
      owed_total: earned(owedCards),
      owed_count: owedCards.length,
      done_this_month: cards.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month).length,
      paid_this_month: earned(cards.filter((c) => c.state === 'paid' && c.paid_month === month)),
      cost_this_month: earned(cards.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month)),
    },
    owed,
    people: people.map((a) => {
      const mine = perPerson[a.id] || []
      return {
        ...personOut(a, byId[a.user_id]),
        sent: mine.filter((c) => monthOf(c.created_at) === month).length,
        // What we said yes to this month: an idea approved to film, or a
        // video handed to an editor — counted once a card, whichever came.
        approved: mine.filter((c) => monthOf(c.approved_at) === month
          || monthOf(tasks.get(c.task_id)?.created_at) === month).length,
        posted: mine.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month).length,
        // Their money, on their row, so the table answers "who am I paying and
        // how much" without opening anybody.
        earned_month: earned(mine.filter((c) => ['done', 'paid'].includes(c.state) && c.paid_month === month)),
        owed: earned(mine.filter((c) => c.state === 'done')),
      }
    }),
    // Accounts made in user management that nobody has set up yet. They are
    // not ambassadors until somebody says which university they are at.
    // …and never somebody who was removed: their login is dead on purpose.
    unset: users.filter((u) => !String(u.username || '').startsWith('removed_') && !people.some((a) => a.user_id === u.id))
      .map((u) => ({ user_id: u.id, name: u.name })),
    inbox,
  })
}))

// Setting somebody up, and changing their details afterwards. University,
// contract and status live here rather than in the user form: the user form
// makes an account, and an account is not a programme.
router.put('/person/:userId(\\d+)', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const userId = Number(req.params.userId)
  const u = await get('SELECT id, role FROM users WHERE id = ?', userId)
  if (!u) return res.status(404).json({ error: 'No such person' })
  if (u.role !== 'ambassador')
    return res.status(400).json({ error: 'That account is not an ambassador — change their role first' })
  const b = req.body || {}
  const status = ['active', 'paused', 'ended'].includes(b.status) ? b.status : 'active'
  const university = clean(b.university, 120)
  const telegram = clean(b.telegram, 80)
  const flags = [b.default_we_edit ? 1 : 0, b.default_posts_own ? 1 : 0, b.default_collaborator ? 1 : 0]
  const termsOther = clean(b.default_terms_other, 400)
  const existing = await get('SELECT id FROM ambassadors WHERE user_id = ?', userId)
  const stamp = now()
  if (existing) {
    await run(`
      UPDATE ambassadors SET university = ?, telegram = ?, default_we_edit = ?, default_posts_own = ?,
             default_collaborator = ?, default_terms_other = ?, status = ?, updated_at = ? WHERE id = ?
    `, university, telegram, ...flags, termsOther, status, stamp, existing.id)
  } else {
    await run(`
      INSERT INTO ambassadors (user_id, university, telegram, default_we_edit, default_posts_own,
                               default_collaborator, default_terms_other, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, userId, university, telegram, ...flags, termsOther, status, stamp, stamp)
  }
  res.json({ ok: true })
}))

// ---- the two decisions -------------------------------------------------------
// APPROVE. This is the moment the promise is made, so this is the moment the
// terms stop being editable. The amount and the three flags are COPIED onto
// the card; the ambassador record can be changed afterwards a hundred times
// and this card will still say what it said.
//
// There is no rate table and no arithmetic. The amount is typed by a person,
// every time, because a number a machine worked out is a number nobody has
// agreed to.
router.post('/cards/:id(\\d+)/approve', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'waiting') return res.status(409).json({ error: 'This card is not waiting for an answer' })
  const b = req.body || {}
  // Rounded BEFORE it is judged: 0.4 passed "more than nothing" and was then
  // stored as 0 — a card approved to film for no money.
  const amount = Math.round(Number(b.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9)
    return res.status(400).json({ error: 'Type the amount for this video' })
  await run(`
    UPDATE ambassador_cards
       SET state = 'can_film', we_edit = ?, posts_own = ?, collaborator = ?, terms_other = ?, amount = ?,
           approved_by = ?, approved_at = ?, feedback = '', version = 1, updated_at = ?
     WHERE id = ?
  `, b.we_edit ? 1 : 0, b.posts_own ? 1 : 0, b.collaborator ? 1 : 0, clean(b.terms_other, 400), Math.round(amount),
  req.user.id, now(), now(), card.id)
  res.json({ ok: true })
}))

// NEEDS CHANGES. The feedback is the whole point — a refusal with nothing
// behind it is a person left guessing — so the server asks for it too, and
// not just the form.
router.post('/cards/:id(\\d+)/changes', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const card = await get('SELECT * FROM ambassador_cards WHERE id = ?', req.params.id)
  if (!card) return res.status(404).json({ error: 'No such card' })
  if (card.state !== 'waiting') return res.status(409).json({ error: 'This card is not waiting for an answer' })
  const feedback = clean(req.body?.feedback, 2000)
  if (!feedback) return res.status(400).json({ error: 'Say what needs changing' })
  await run(`
    UPDATE ambassador_cards SET state = 'needs_changes', feedback = ?, updated_at = ? WHERE id = ?
  `, feedback, now(), card.id)
  await logEvent(card.id, 'sent_back', { by: req.user.id, text: feedback, version: Number(card.version) || 1 })
  res.json({ ok: true })
}))

// ---- removing somebody, and getting them back in ------------------------------

// REMOVE AN AMBASSADOR. There was no way to do this at all: the programme
// could sign people up and never let one go, so the list only ever grew and a
// student who finished stayed in the queue for ever.
//
// What goes and what stays is the whole design here. Their LOGIN goes, so they
// cannot sign in again, and they leave the list. Their FINISHED WORK stays:
// cards that reached done or paid are the record of money the business owes or
// has already paid, and deleting a person must never quietly rewrite that.
// Cards still in flight — an idea nobody answered, a video half-reviewed — go
// with them, because they are requests for work that will now never happen.
//
// The ambassador row itself is KEPT and marked ended, which is what lets the
// kept cards still say whose they were. A name on a payment record is the
// point of the payment record.
router.delete('/person/:userId(\\d+)', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'That person is not set up as an ambassador' })
  const u = await get('SELECT id, name, role FROM users WHERE id = ?', a.user_id)
  if (u && u.role !== 'ambassador') {
    return res.status(403).json({ error: 'That account is not an ambassador' })
  }
  if (Number(req.params.userId) === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove your own account' })
  }

  const kept = await all(
    "SELECT id FROM ambassador_cards WHERE ambassador_id = ? AND state IN ('done', 'paid')", a.id)
  const stamp = now()

  // In-flight cards and their trails go; finished ones stay, with theirs.
  await run(
    "DELETE FROM ambassador_card_events WHERE card_id IN (SELECT id FROM ambassador_cards WHERE ambassador_id = ? AND state NOT IN ('done', 'paid'))",
    a.id)
  await run("DELETE FROM ambassador_cards WHERE ambassador_id = ? AND state NOT IN ('done', 'paid')", a.id)
  await run("UPDATE ambassadors SET status = 'ended', updated_at = ? WHERE id = ?", stamp, a.id)

  // The login dies; the ROLE does not change.
  //
  // Changing it to something like 'removed' looked tidier and is a hole: the
  // gate in auth.js confines a student to their own page by checking for
  // exactly 'ambassador', so an unrecognised role is an account the gate does
  // not recognise either. They stay an ambassador, with a username nobody can
  // type and a password nobody holds — and their ambassador row now says
  // ended, which their own page refuses on anyway.
  const dead = `removed_${a.user_id}_${Math.random().toString(36).slice(2, 8)}`
  await run(
    'UPDATE users SET username = ?, password_hash = ? WHERE id = ?',
    dead,
    bcrypt.hashSync(`${Math.random()}${Math.random()}`, 10),
    a.user_id)

  res.json({ ok: true, kept_cards: kept.length })
}))

// A NEW PASSWORD, because the old one cannot be read back.
//
// Passwords here are bcrypt hashes and that is deliberate: the hash cannot be
// turned back into the password by this server or by anybody who steals the
// database. So "what password did I give them" has no answer and should not
// have one. What an admin actually needs is for the person to be able to sign
// in again, which is this: set a new one, read it off the screen once, hand it
// over.
router.post('/person/:userId(\\d+)/password', wrap(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'This is for whoever runs the ambassador programme' })
  const a = await get('SELECT * FROM ambassadors WHERE user_id = ?', req.params.userId)
  if (!a) return res.status(404).json({ error: 'That person is not set up as an ambassador' })
  const u = await get('SELECT id, role FROM users WHERE id = ?', a.user_id)
  if (!u || u.role !== 'ambassador') return res.status(403).json({ error: 'That account is not an ambassador' })
  const pw = clean(req.body?.password, 100)
  if (pw.length < 4) return res.status(400).json({ error: 'A password needs at least 4 characters' })
  await run('UPDATE users SET password_hash = ?, weak_password = 0 WHERE id = ?', bcrypt.hashSync(pw, 10), u.id)
  res.json({ ok: true })
}))

export default router

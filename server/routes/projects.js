import { Router } from 'express'
import { all, get, run } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'
import {
  METRICS, dayNow, cleanChecklist, parseList, campaignView, campaignStatus, cleanPhoto,
  bumpProject, usersMap, projectsMap, ownerProblem,
} from '../pcmodel.js'
import {
  cleanNumbers, cleanCriteria, cleanSteps, parseJson, STATUSES, NEEDS_REASON, tally, doneBlockers, normaliseStatus,
} from '../projectshape.js'

// Projects — permanent areas of the business. Everyone signed in can read;
// admins create and delete; the admin or the project's owner edits.
const router = Router()
router.use(authRequired)

const canWrite = (user, row) => user.role === 'admin' || (row.owner_id && row.owner_id === user.id)

// What one viewer is shown of a project.
//
// Everybody who can open the page sees every project: they are the team's
// goals, and seeing the rest is context rather than a leak. `mine` marks the
// ones this person owns or runs a campaign in — the same test that opens the
// page to them whatever their role (routes/auth.js) — and it is what the
// page's "Mine" button reads, so the two can never disagree about whose a
// project is.
//
// The budget is the owner's and the admin's. Hiding the PAGE never hid this:
// the API answers anybody signed in, whatever the page setting says. So the
// one figure that is not everybody's business is withheld here, where it
// actually leaves the server — by the same rule that decides who may edit it.
const forViewer = (user, p, camps, shown) => {
  const out = { ...shown, mine: p.owner_id === user.id || camps.some((c) => c.owner_id === user.id) }
  if (!canWrite(user, p)) delete out.budget
  return out
}

// There is no computed health any more. The board used to derive a badge
// (Needs you / Slipping / Not started / Done) from deadlines, ownership and
// silence, and show it beside a status somebody had also chosen — two answers
// to "how is this going", which is one too many. The status is now typed by a
// person, and At risk / Off track carry the reason in their own words.
// Progress is earned, not typed: every checklist item and every campaign of
// the project is one step; done steps fill the bar.
function progressOf(p, camps, today) {
  const list = parseList(p.checklist)
  const done = list.filter((i) => i.done).length
  const campsDone = camps.filter((c) => campaignStatus(c, today) === 'done').length
  const total = list.length + camps.length
  return {
    pct: total > 0 ? Math.round(((done + campsDone) / total) * 100) : 0,
    steps_done: done + campsDone,
    steps_total: total,
    checklist_done: done,
    checklist_total: list.length,
    campaigns_done: campsDone,
    campaigns_total: camps.length,
  }
}

function view(p, liveCount, today, camps = []) {
  const prog = progressOf(p, camps, today)
  const numbers = parseJson(p.numbers)
  const criteria = parseJson(p.criteria)
  return {
    id: p.id,
    name: p.name,
    owner_id: p.owner_id || null,
    metric: p.metric || '',
    target: Number(p.target) || 0,
    actual: Number(p.actual) || 0,
    start_date: p.start_date || null,
    deadline: p.deadline || null,
    status: p.status || 'on_track',
    status_reason: p.status_reason || '',
    numbers,
    criteria,
    tally: tally(numbers, criteria),
    done_blockers: doneBlockers(numbers, criteria),
    description: p.description || '',
    // Still served so nothing that read it breaks, and so the old wording is
    // recoverable from the API after the criteria have been edited.
    success: p.success || '',
    budget: p.budget ?? null,
    photo_thumb: p.photo_thumb || null,
    checklist: parseList(p.checklist),
    last_activity: p.last_activity || p.created_at || null,
    live_campaigns: liveCount,
    progress: prog,
    created_at: p.created_at,
  }
}

// What needs a person comes first; what is finished sinks to the bottom —
// the same order as before, now read from the status somebody set rather than
// from a guess about deadlines and silence.
const STATUS_ORDER = { off_track: 0, at_risk: 1, on_track: 2, done: 3, closed: 4 }

// Every metric this board offers is a count — Followers, Reach, Views, Leads,
// Applications, Enrollments, Attendees, Posts published, Engagement, Revenue —
// and none of them can run backwards. `Number(x) || 0` already turned typing
// into the box into a nought; it just never looked at the sign, so a stray
// minus stored −5 and the project read "−5%" against a bar that clamps at
// nothing. One helper for both write paths, so creating and editing a project
// cannot disagree about what a number is.
const count = (v) => Math.max(0, Math.round(Number(v) || 0))

// The two rules a status has to pass, wherever it is written from.
//
// Returned as a message rather than thrown: create and edit both answer 400
// with the same sentence, so the reason a status was refused does not depend
// on which screen asked for it.
function statusProblem(status, reason, numbers, criteria) {
  if (!STATUSES.includes(status)) return 'Unknown status'
  if (NEEDS_REASON.includes(status) && !String(reason || '').trim()) {
    return status === 'closed'
      ? 'Say in one line how it ended — e.g. “50 of 100 came, the venue capped it at 60”'
      : 'Say in one line why it is at risk or off track'
  }
  if (status === 'done') {
    const blockers = doneBlockers(numbers, criteria)
    if (blockers.length) {
      return `Not done yet — ${blockers.join('; ')}. If it has finished short of that, set it to Closed and say how it ended.`
    }
  }
  return null
}

// The metric names offered as SUGGESTIONS under a number's name box. A number
// may be called anything ("Visitors" is not on this list and has to work), so
// this is a starting point, never a constraint.
router.get('/metrics', wrap(async (req, res) => res.json(METRICS)))

// The landing table: what needs a person first.
router.get('/', wrap(async (req, res) => {
  const today = dayNow()
  const projects = await all('SELECT * FROM projects ORDER BY name')
  const camps = await all('SELECT * FROM campaigns')
  const liveByProject = {}
  const campsByProject = {}
  for (const c of camps) {
    if (!c.project_id) continue
    ;(campsByProject[c.project_id] ||= []).push(c)
    if (campaignStatus(c, today) === 'live') {
      liveByProject[c.project_id] = (liveByProject[c.project_id] || 0) + 1
    }
  }
  const users = await usersMap()
  const out = projects
    .map((p) => forViewer(req.user, p, campsByProject[p.id] || [], { ...view(p, liveByProject[p.id] || 0, today, campsByProject[p.id] || []), owner_name: users[p.owner_id]?.name || null, owner_color: users[p.owner_id]?.color || null }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      || (a.deadline ? (b.deadline ? a.deadline.localeCompare(b.deadline) : -1) : 1)
      || a.name.localeCompare(b.name))
  res.json(out)
}))

// The WHOLE of one project, as the project page reads it: the project, its
// campaigns, its notes.
//
// A function rather than a block inside the route, because anything that
// changes a project and answers with it has to answer with the SAME shape.
// The page takes what it is handed and draws it, so a route that replies with
// the list-shaped project hands it a project with no campaigns array and no
// notes — and the page falls over reading the length of something that was
// never there. One shape, one place.
async function detailFor(user, p) {
  const today = dayNow()
  const users = await usersMap()
  const projects = await projectsMap()
  const campRows = await all('SELECT * FROM campaigns WHERE project_id = ? ORDER BY start_date, id', p.id)
  const camps = campRows.map((c) => campaignView(c, today, users, projects))
  const liveCount = camps.filter((c) => c.status === 'live').length
  const notes = (await all("SELECT * FROM notes WHERE kind = 'project' AND ref_id = ? ORDER BY created_at DESC, id DESC", p.id))
    .map((n) => ({ ...n, author_name: users[n.author_id]?.name || null }))
  return forViewer(user, p, campRows, {
    ...view(p, liveCount, today, campRows),
    owner_name: users[p.owner_id]?.name || null,
    owner_color: users[p.owner_id]?.color || null,
    photo: p.photo || null,
    campaigns: camps,
    notes,
  })
}

// Detail: the project, its campaigns (campaign-list rows filtered to it), notes.
router.get('/:id', wrap(async (req, res) => {
  const p = await get('SELECT * FROM projects WHERE id = ?', req.params.id)
  if (!p) return res.status(404).json({ error: 'Project not found' })
  res.json(await detailFor(req.user, p))
}))

router.post('/', adminOnly, wrap(async (req, res) => {
  const b = req.body || {}
  const name = String(b.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Give the project a name' })
  { const bad = await ownerProblem(b.owner_id); if (bad) return res.status(400).json({ error: bad }) }
  const numbers = cleanNumbers(b.numbers, [], req.user.id)
  const criteria = cleanCriteria(b.criteria)
  const status = b.status === undefined ? 'on_track' : normaliseStatus(b.status)
  const statusReason = String(b.status_reason || '').trim().slice(0, 300)
  const bad = statusProblem(status, statusReason, numbers, criteria)
  if (bad) return res.status(400).json({ error: bad })
  const info = await run(`
    INSERT INTO projects (name, owner_id, metric, target, actual, start_date, deadline, status, status_reason, description, success, numbers, criteria, budget, checklist, photo, photo_thumb, last_activity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
  `,
    name,
    b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id),
    String(b.metric || ''),
    count(b.target),
    count(b.actual),
    /^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date || '')) ? b.start_date : null,
    /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null,
    status,
    statusReason,
    String(b.description || '').slice(0, 2000),
    String(b.success || '').slice(0, 1000),
    JSON.stringify(numbers),
    JSON.stringify(criteria),
    b.budget == null || b.budget === '' ? null : Number(b.budget),
    cleanPhoto(b.photo) ?? null, cleanPhoto(b.photo_thumb) ?? null,
    new Date().toISOString(), new Date().toISOString(),
  )
  const p = await get('SELECT * FROM projects WHERE id = ?', info.lastInsertRowid)
  res.status(201).json(view(p, 0, dayNow()))
}))

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM projects WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Project not found' })
  if (!canWrite(req.user, row)) return res.status(403).json({ error: 'Only the admin or the project owner can edit this' })
  const b = req.body || {}
  const patch = {}
  if (b.name !== undefined) {
    if (!String(b.name).trim()) return res.status(400).json({ error: 'Give the project a name' })
    patch.name = String(b.name).trim()
  }
  // Only when the owner actually CHANGES. The project form sends every field
  // it holds, owner included, so judging this on the key being present refused
  // the owner's own save of their own project — numbers, criteria and all —
  // with "Only the admin reassigns owners" about an owner nobody had touched.
  const nextOwner = b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id)
  if (b.owner_id !== undefined && nextOwner !== (row.owner_id ?? null)) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin reassigns owners' })
    { const bad = await ownerProblem(nextOwner); if (bad) return res.status(400).json({ error: bad }) }
    patch.owner_id = nextOwner
  }
  if (b.metric !== undefined) patch.metric = String(b.metric)
  if (b.target !== undefined) patch.target = count(b.target)
  if (b.actual !== undefined) patch.actual = count(b.actual) // the weekly human number
  if (b.deadline !== undefined) patch.deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null
  // Numbers, criteria and status are decided together, because the Done rule
  // reads all three. Patching a criterion and setting Done in one request has
  // to be judged on what the project will hold AFTER the write, not before.
  const nextNumbers = b.numbers !== undefined
    ? cleanNumbers(b.numbers, parseJson(row.numbers), req.user.id)
    : parseJson(row.numbers)
  const nextCriteria = b.criteria !== undefined ? cleanCriteria(b.criteria) : parseJson(row.criteria)
  if (b.numbers !== undefined) patch.numbers = JSON.stringify(nextNumbers)
  if (b.criteria !== undefined) patch.criteria = JSON.stringify(nextCriteria)
  // Done is earned, and it has to STAY earned: a number or a criterion changed
  // under a Done project goes back through the same gate, or the project
  // stays Done on targets it no longer meets.
  if (b.status !== undefined || b.status_reason !== undefined
      || (row.status === 'done' && (b.numbers !== undefined || b.criteria !== undefined))) {
    const status = b.status !== undefined ? normaliseStatus(b.status) : (row.status || 'on_track')
    // A reason already on the row stands unless this request replaces it, so
    // re-saving an at-risk project does not demand the reason be retyped.
    const reason = b.status_reason !== undefined
      ? String(b.status_reason).trim().slice(0, 300)
      : (row.status_reason || '')
    const bad = statusProblem(status, reason, nextNumbers, nextCriteria)
    if (bad) return res.status(400).json({ error: bad })
    patch.status = status
    // On track and Done carry no reason: leaving the old one under them would
    // read as a live warning about a project that no longer has one.
    patch.status_reason = NEEDS_REASON.includes(status) ? reason : ''
  }
  if (b.description !== undefined) patch.description = String(b.description).slice(0, 2000)
  // A day, or nothing — as POST and the deadline already insist. Junk stored
  // here reached the Projects page as a date it could not draw, and the page
  // fell over in render.
  if (b.start_date !== undefined) patch.start_date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.start_date || '')) ? b.start_date : null
  {
    const from = patch.start_date !== undefined ? patch.start_date : row.start_date
    const to = patch.deadline !== undefined ? patch.deadline : row.deadline
    if ((b.start_date !== undefined || b.deadline !== undefined) && from && to && to < from)
      return res.status(400).json({ error: 'The deadline is before the start date' })
  }
  if (b.success !== undefined) patch.success = String(b.success).slice(0, 1000)
  if (b.photo !== undefined) {
    const ph = cleanPhoto(b.photo)
    if (ph === undefined) return res.status(400).json({ error: 'The photo must be an image under ~700 KB' })
    patch.photo = ph
  }
  if (b.photo_thumb !== undefined) {
    const th = cleanPhoto(b.photo_thumb)
    if (th === undefined) return res.status(400).json({ error: 'Bad thumbnail' })
    patch.photo_thumb = th
  }
  if (b.budget !== undefined) {
    patch.budget = b.budget == null || b.budget === '' ? null : Number(b.budget)
    // NaN reached the database driver and came back a 500.
    if (patch.budget !== null && !Number.isFinite(patch.budget)) return res.status(400).json({ error: 'Budget must be a number' })
  }
  if (b.checklist !== undefined) patch.checklist = cleanChecklist(b.checklist)
  if (Object.keys(patch).length > 0) {
    patch.last_activity = new Date().toISOString()
    const keys = Object.keys(patch)
    await run(`UPDATE projects SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
      ...keys.map((k) => patch[k]), row.id)
  }
  const p = await get('SELECT * FROM projects WHERE id = ?', row.id)
  const today = dayNow()
  const camps = await all('SELECT * FROM campaigns WHERE project_id = ?', p.id)
  const liveCount = camps.filter((c) => campaignStatus(c, today) === 'live').length
  res.json(view(p, liveCount, today, camps))
}))

// ---- the little steps under a number ---------------------------------------
//
// A number is a destination — 500 downloads, 40 reviews — and says nothing
// about how anybody gets there. Steps are the way there, written down under
// the number they belong to.
//
// ANYBODY SIGNED IN MAY ADD AND TICK ONE, which is the whole point and is not
// an oversight. The person who will actually do the third step is rarely the
// person who owns the project; a list only they could write is a list that
// stays empty. Editing the NUMBER is still the owner's — a step cannot move a
// target, rename a metric or touch a budget, and each one carries the name of
// whoever added it and whoever ticked it, so an open list is not an anonymous
// one.
const stepsOwner = async (projectId, numberId) => {
  const row = await get('SELECT * FROM projects WHERE id = ?', projectId)
  if (!row) return { error: 404 }
  const numbers = parseJson(row.numbers)
  const n = numbers.find((x) => String(x.id) === String(numberId))
  if (!n) return { error: 'number' }
  return { row, numbers, number: n }
}
// Saving answers with the whole project, in the shape the project page reads
// — so ticking a step needs no second request and cannot hand the page a
// half-built project.
const saveSteps = async (user, row, numbers) => {
  await run('UPDATE projects SET numbers = ?, last_activity = ? WHERE id = ?',
    JSON.stringify(numbers), new Date().toISOString(), row.id)
  return detailFor(user, await get('SELECT * FROM projects WHERE id = ?', row.id))
}

router.post('/:id/numbers/:numberId/steps', wrap(async (req, res) => {
  const found = await stepsOwner(req.params.id, req.params.numberId)
  if (found.error === 404) return res.status(404).json({ error: 'Project not found' })
  if (found.error === 'number') return res.status(404).json({ error: 'That number is not on this project' })
  const text = String(req.body?.text ?? '').trim().slice(0, 200)
  if (!text) return res.status(400).json({ error: 'Write the step first' })
  const steps = cleanSteps(found.number.steps)
  if (steps.length >= 30) return res.status(400).json({ error: 'Thirty steps is enough for one number — tick some off, or make a second number' })
  steps.push({
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text, done: false,
    by: req.user.id, by_name: req.user.name || '', at: new Date().toISOString(),
    done_by: null, done_name: '', done_at: null,
  })
  found.number.steps = steps
  res.status(201).json(await saveSteps(req.user, found.row, found.numbers))
}))

// Ticking one, or fixing its wording. Ticking is the common case by far, so
// both live on the same route rather than making somebody choose.
router.patch('/:id/numbers/:numberId/steps/:stepId', wrap(async (req, res) => {
  const found = await stepsOwner(req.params.id, req.params.numberId)
  if (found.error === 404) return res.status(404).json({ error: 'Project not found' })
  if (found.error === 'number') return res.status(404).json({ error: 'That number is not on this project' })
  const steps = cleanSteps(found.number.steps)
  const step = steps.find((s) => String(s.id) === String(req.params.stepId))
  if (!step) return res.status(404).json({ error: 'That step is not under this number' })
  if (req.body?.text !== undefined) {
    const text = String(req.body.text ?? '').trim().slice(0, 200)
    if (!text) return res.status(400).json({ error: 'A step with no words is not a step — remove it instead' })
    step.text = text
  }
  if (req.body?.done !== undefined) {
    const done = !!req.body.done
    // Who ticked it, and when — kept only while it is ticked, so unticking
    // does not leave a name on something nobody has done.
    if (done !== step.done) {
      step.done = done
      step.done_by = done ? req.user.id : null
      step.done_name = done ? (req.user.name || '') : ''
      step.done_at = done ? new Date().toISOString() : null
    }
  }
  found.number.steps = steps
  res.json(await saveSteps(req.user, found.row, found.numbers))
}))

router.delete('/:id/numbers/:numberId/steps/:stepId', wrap(async (req, res) => {
  const found = await stepsOwner(req.params.id, req.params.numberId)
  if (found.error === 404) return res.status(404).json({ error: 'Project not found' })
  if (found.error === 'number') return res.status(404).json({ error: 'That number is not on this project' })
  const steps = cleanSteps(found.number.steps)
  found.number.steps = steps.filter((s) => String(s.id) !== String(req.params.stepId))
  res.json(await saveSteps(req.user, found.row, found.numbers))
}))

router.post('/:id/notes', wrap(async (req, res) => {
  const row = await get('SELECT id FROM projects WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Project not found' })
  const text = String(req.body?.text || '').trim().slice(0, 2000)
  if (!text) return res.status(400).json({ error: 'Write the note first' })
  const info = await run('INSERT INTO notes (kind, ref_id, author_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
    'project', row.id, req.user.id, text, new Date().toISOString())
  await bumpProject(row.id)
  const n = await get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid)
  res.status(201).json({ ...n, author_name: req.user.name })
}))

// A note's author (or the admin) can take it back.
router.delete('/:id/notes/:noteId', wrap(async (req, res) => {
  const n = await get("SELECT * FROM notes WHERE id = ? AND kind = 'project' AND ref_id = ?", req.params.noteId, req.params.id)
  if (!n) return res.status(404).json({ error: 'Note not found' })
  if (req.user.role !== 'admin' && n.author_id !== req.user.id)
    return res.status(403).json({ error: 'Only the author or an admin can delete a note' })
  await run('DELETE FROM notes WHERE id = ?', n.id)
  res.json({ ok: true })
}))

router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT id FROM projects WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Project not found' })
  await run('UPDATE campaigns SET project_id = NULL WHERE project_id = ?', row.id)
  await run("DELETE FROM notes WHERE kind = 'project' AND ref_id = ?", row.id)
  await run('DELETE FROM projects WHERE id = ?', row.id)
  res.json({ ok: true })
}))

export default router

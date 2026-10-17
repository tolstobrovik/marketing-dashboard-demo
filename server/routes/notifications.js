import { Router } from 'express'
import { all, run, dayISO } from '../db.js'
import { authRequired, wrap } from '../auth.js'
import { resolveGates, phasePassed } from '../deadlines.js'

// The bell. Two streams, one panel:
//  - events    — persisted rows written when someone ELSE moves a task you
//                are on through the pipeline;
//  - reminders — computed fresh on every read: your own deadlines standing
//                exactly a day and exactly a week away (Tashkent days), per
//                the hat you hold. Nothing to store, nothing to go stale.
const router = Router()
router.use(authRequired)

const isDeleted = (label) => /^deleted$/i.test(label || '')

router.get('/', wrap(async (req, res) => {
  const uid = req.user.id
  const events = await all(
    'SELECT id, kind, text, content_id, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', uid)

  const today = dayISO(0)
  const tomorrow = dayISO(1)
  const week = dayISO(7)
  const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
  const dead = new Set(statuses.filter((s) => isDeleted(s.label)).map((s) => s.id))
  const gates = resolveGates(statuses)
  const rows = await all(`SELECT id, title, assignee_id, assignees, operator_id, editor_id, designer_id,
    recording_date, edit_ready_date, edit_due_revised, design_ready_date, release_date, status_id,
    shot_at, edited_at FROM content WHERE done_at IS NULL`)

  const reminders = []
  const push = (t, field, date, what) => {
    if (date !== tomorrow && date !== week) return
    reminders.push({
      id: `rem-${t.id}-${field}-${date}`,
      kind: 'reminder',
      text: `«${t.title}» — ${what} ${date === tomorrow ? 'tomorrow' : 'in a week'}`,
      content_id: t.id,
      date,
    })
  }
  for (const t of rows) {
    if (dead.has(t.status_id)) continue
    let assignees = []
    try { assignees = JSON.parse(t.assignees || '[]') } catch { assignees = [] }
    const owns = assignees.includes(uid) || t.assignee_id === uid
    // A deadline still STANDING: not one already answered for (phasePassed,
    // the one place that question lives), and the cut's day as the rest of
    // the server reads it — the re-promise when a late handover wrote one.
    const cutDue = t.edit_due_revised || t.edit_ready_date
    if ((owns || t.operator_id === uid) && t.recording_date && !phasePassed(t, 'shoot', gates)) push(t, 'rec', t.recording_date, 'the shoot')
    if (t.editor_id === uid && cutDue && !phasePassed(t, 'edit', gates)) push(t, 'edit', cutDue, 'the edit is due')
    if (t.designer_id === uid && t.design_ready_date && !phasePassed(t, 'design', gates)) push(t, 'design', t.design_ready_date, 'the artwork is due')
    if (owns && t.release_date) push(t, 'rel', t.release_date, 'the release')
  }
  reminders.sort((a, b) => a.date.localeCompare(b.date))
  res.json({ events, reminders })
}))

router.post('/read-all', wrap(async (req, res) => {
  await run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
    new Date().toISOString(), req.user.id)
  res.json({ ok: true })
}))

export default router

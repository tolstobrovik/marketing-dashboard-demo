import { Router } from 'express'
import { all, get, run, batch } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

// The design board's columns.
//
// Deliberately a thinner thing than statuses.js: no is_final, and no stage
// rules. The content board's final stage is a wall — nothing reaches it
// without the published link — and its rules matrix answers "who may move
// work out of here", because a video passing between three pairs of hands
// needs that answered. Design work is one person's from brief to artwork, so
// a board that refused their moves would only be in the way. What the
// designer needs is somewhere to say "this is with the manager" or "this came
// back", and that is what these are.
//
// Everything else reads the same as the content stages on purpose — the admin
// panel drives both with one set of controls.
const router = Router()
router.use(authRequired)

router.get('/', wrap(async (req, res) => {
  res.json(await all('SELECT * FROM design_statuses ORDER BY sort, id'))
}))

router.post('/', adminOnly, wrap(async (req, res) => {
  const { label, color = '#8b8388' } = req.body || {}
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Name is required' })
  const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM design_statuses')).m
  const info = await run('INSERT INTO design_statuses (label, color, sort) VALUES (?, ?, ?)',
    String(label).trim(), color, maxSort + 1)
  res.status(201).json(await get('SELECT * FROM design_statuses WHERE id = ?', info.lastInsertRowid))
}))

router.patch('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM design_statuses WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Design stage not found' })
  const { label, color } = req.body || {}
  if (label !== undefined && !String(label).trim())
    return res.status(400).json({ error: 'Name is required' })
  await run('UPDATE design_statuses SET label = ?, color = ? WHERE id = ?',
    label !== undefined ? String(label).trim() : row.label,
    color ?? row.color,
    row.id,
  )
  res.json(await get('SELECT * FROM design_statuses WHERE id = ?', row.id))
}))

router.post('/reorder', adminOnly, wrap(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  await batch(ids.map((id, i) => ['UPDATE design_statuses SET sort = ? WHERE id = ?', i, id]))
  res.json({ ok: true })
}))

// Deleting a column never deletes the work standing in it: the cards move to
// the next column along (the one before it, when it was the last). It used to
// pick the FIRST column, so artwork halfway done went back to the start.
// The pipeline's own stages (statuses.js) keep falling back to the first: the
// next stage along there can be a handover gate or Published, and a card is
// not carried across one of those by somebody tidying the columns.
// One stage must survive, or the board has nowhere to put anything.
router.delete('/:id', adminOnly, wrap(async (req, res) => {
  const row = await get('SELECT * FROM design_statuses WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Design stage not found' })
  const fallback = await get(
    'SELECT id FROM design_statuses WHERE id != ? ORDER BY CASE WHEN sort > ? THEN 0 ELSE 1 END, ABS(sort - ?), id',
    row.id, row.sort, row.sort)
  if (!fallback) return res.status(400).json({ error: 'At least one design stage must remain' })
  await batch([
    ['UPDATE content SET design_status_id = ? WHERE design_status_id = ?', fallback.id, row.id],
    ['DELETE FROM design_statuses WHERE id = ?', row.id],
  ])
  res.json({ ok: true })
}))

export default router

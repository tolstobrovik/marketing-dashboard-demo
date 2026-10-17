import { Router } from 'express'
import { all, get, run, publicUser } from '../db.js'
import { authRequired, wrap, superadminOnly } from '../auth.js'
import { aliasMap, mask, unmask, leaks } from '../anon.js'
import { peopleSummary } from '../ai.js'

// The people board: what each month was actually like, per person.
//
// A year of somebody's work gets reviewed from memory, and memory is the last
// fortnight. So this is the written record those conversations start from —
// one note per person per month, in whoever's own words, kept.
//
// Who reads it: superadmins, and only them. NOT the person it is about, and
// not other admins. That is the whole design, and it is deliberate in a way
// worth stating plainly: a note its subject can read is a note that gets
// written diplomatically rather than honestly, and a diplomatic record is no
// use in the conversation it exists for. The rank is a column on users, not a
// permission — `can()` grants every admin every permission, so a permission
// would have opened this to all of them the day it shipped.
//
// Every route here is behind superadminOnly, including the ones that only
// read. Whether these notes EXIST is also none of anybody else's business.
const router = Router()
router.use(authRequired, superadminOnly)

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const nowIso = () => new Date().toISOString()

// Who can be written about: everybody on staff. Ambassadors are students with
// a login to one page, and removed accounts are nobody — neither belongs on a
// board about how the team is doing.
const staff = () => all(`SELECT id, name, username, role, color, avatar FROM users
  WHERE role != 'ambassador' AND substr(username, 1, 8) != 'removed_'
  ORDER BY name`)

const withAuthor = (rows, people) => {
  const by = new Map(people.map((p) => [p.id, p]))
  return rows.map((r) => ({
    ...r,
    author_name: by.get(r.author_id)?.name || 'Someone who has left',
    author_color: by.get(r.author_id)?.color || null,
    edited: !!r.updated_at,
  }))
}

// ---- the board ---------------------------------------------------------------
// Everyone, with how much has been written about them in the month being
// looked at and when anybody last wrote at all. The second number is the one
// that matters: a person nobody has written about since June is the failure
// this board exists to make visible.
router.get('/board', wrap(async (req, res) => {
  const month = MONTH.test(String(req.query.month || '')) ? String(req.query.month) : null
  const people = await staff()
  const counts = await all(`SELECT about_id, month, COUNT(*) AS n, MAX(created_at) AS last_at
    FROM person_notes GROUP BY about_id, month`)
  const byPerson = new Map()
  for (const c of counts) {
    const cur = byPerson.get(c.about_id) || { this_month: 0, total: 0, last_month: null, last_at: null }
    cur.total += c.n
    if (month && c.month === month) cur.this_month = c.n
    if (!cur.last_month || c.month > cur.last_month) { cur.last_month = c.month; cur.last_at = c.last_at }
    byPerson.set(c.about_id, cur)
  }
  res.json({
    month,
    people: people.map((p) => ({
      ...p,
      ...(byPerson.get(p.id) || { this_month: 0, total: 0, last_month: null, last_at: null }),
    })),
  })
}))

// Who holds the rank, for the panel that hands it out.
router.get('/superadmins', wrap(async (req, res) => {
  const rows = await all('SELECT * FROM users WHERE superadmin = 1 ORDER BY name')
  res.json(rows.map(publicUser))
}))

// Handing the rank out, and taking it back.
//
// Only a superadmin may do either — this route is behind superadminOnly like
// the rest, so an admin cannot grant it to themselves, and neither can the
// person who wrote this. The last one may not step down: a board nobody can
// open is a board whose history is gone, and there is no way back into it
// from inside the app.
router.put('/superadmins/:id', wrap(async (req, res) => {
  const id = Number(req.params.id)
  const want = !!req.body?.superadmin
  const target = await get('SELECT * FROM users WHERE id = ?', id)
  if (!target) return res.status(404).json({ error: 'No such person' })
  if (target.role === 'ambassador' || String(target.username || '').startsWith('removed_'))
    return res.status(400).json({ error: 'That account isn’t a colleague’s' })
  if (!want) {
    // Only holders who can still open the board count: an account that has
    // since become an ambassador, or was removed, cannot get past the gate.
    const others = (await get(`SELECT COUNT(*) AS n FROM users WHERE superadmin = 1 AND id != ?
      AND role != 'ambassador' AND substr(username, 1, 8) != 'removed_'`, id))?.n || 0
    if (!others) return res.status(400).json({ error: 'Somebody has to be able to open this board — hand it to someone else first' })
  }
  await run('UPDATE users SET superadmin = ? WHERE id = ?', want ? 1 : 0, id)
  res.json(publicUser(await get('SELECT * FROM users WHERE id = ?', id)))
}))

// ---- the notes ---------------------------------------------------------------
// One person. A month, or their whole record when no month is named.
router.get('/notes', wrap(async (req, res) => {
  const about = Number(req.query.about)
  if (!about) return res.status(400).json({ error: 'Which person?' })
  const month = MONTH.test(String(req.query.month || '')) ? String(req.query.month) : null
  const rows = month
    ? await all('SELECT * FROM person_notes WHERE about_id = ? AND month = ? ORDER BY created_at DESC', about, month)
    : await all('SELECT * FROM person_notes WHERE about_id = ? ORDER BY month DESC, created_at DESC', about)
  res.json(withAuthor(rows, await staff()))
}))

router.post('/notes', wrap(async (req, res) => {
  const about = Number(req.body?.about_id)
  const month = String(req.body?.month || '')
  const body = String(req.body?.body || '').trim()
  if (!about) return res.status(400).json({ error: 'Which person?' })
  if (!MONTH.test(month)) return res.status(400).json({ error: 'Which month? Give it as 2026-09' })
  if (!body) return res.status(400).json({ error: 'Write something first' })
  const who = await get('SELECT id, role, username FROM users WHERE id = ?', about)
  if (!who) return res.status(404).json({ error: 'No such person' })
  if (who.role === 'ambassador' || String(who.username || '').startsWith('removed_'))
    return res.status(400).json({ error: 'That account isn’t a colleague’s' })
  const info = await run(
    'INSERT INTO person_notes (about_id, month, body, author_id, created_at) VALUES (?, ?, ?, ?, ?)',
    about, month, body.slice(0, 8000), req.user.id, nowIso())
  const row = await get('SELECT * FROM person_notes WHERE id = ?', info.lastInsertRowid)
  res.status(201).json(withAuthor([row], await staff())[0])
}))

// Fixing your own words. The previous version is kept, always — see
// person_note_versions, and the history route below.
router.patch('/notes/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM person_notes WHERE id = ?', Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'No such note' })
  if (row.author_id !== req.user.id)
    return res.status(403).json({ error: 'Only whoever wrote a note can change it' })
  const body = String(req.body?.body || '').trim()
  if (!body) return res.status(400).json({ error: 'Write something first' })
  if (body === row.body) return res.json(withAuthor([row], await staff())[0])
  await run('INSERT INTO person_note_versions (note_id, body, saved_at, saved_by) VALUES (?, ?, ?, ?)',
    row.id, row.body, nowIso(), req.user.id)
  await run('UPDATE person_notes SET body = ?, updated_at = ? WHERE id = ?', body.slice(0, 8000), nowIso(), row.id)
  res.json(withAuthor([await get('SELECT * FROM person_notes WHERE id = ?', row.id)], await staff())[0])
}))

// A note written about the wrong person is the case this exists for; editing
// cannot move one. The versions go with it — a history of a note that is not
// there is a record of an accusation nobody can read the retraction of.
router.delete('/notes/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM person_notes WHERE id = ?', Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'No such note' })
  if (row.author_id !== req.user.id)
    return res.status(403).json({ error: 'Only whoever wrote a note can delete it' })
  await run('DELETE FROM person_note_versions WHERE note_id = ?', row.id)
  await run('DELETE FROM person_notes WHERE id = ?', row.id)
  res.json({ ok: true })
}))

router.get('/notes/:id/history', wrap(async (req, res) => {
  const row = await get('SELECT * FROM person_notes WHERE id = ?', Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'No such note' })
  const versions = await all('SELECT * FROM person_note_versions WHERE note_id = ? ORDER BY saved_at DESC', row.id)
  const people = await staff()
  const by = new Map(people.map((p) => [p.id, p.name]))
  res.json({
    now: { body: row.body, at: row.updated_at || row.created_at, by: by.get(row.author_id) || null },
    was: versions.map((v) => ({ body: v.body, at: v.saved_at, by: by.get(v.saved_by) || null })),
  })
}))

// ---- the summary -------------------------------------------------------------
// Reading a stack of notes back as one thing: one person's year, or what a
// month looked like across the team.
//
// The names come out before any of it leaves this server, and the last gate
// is leaks(): if anything identifying survived the masking, this refuses to
// send rather than sending it. A summary nobody gets is a bad afternoon; a
// name in somebody else's logs is not undoable.
router.post('/summary', wrap(async (req, res) => {
  const about = Number(req.body?.about_id) || null
  const month = MONTH.test(String(req.body?.month || '')) ? String(req.body.month) : null
  if (!about && !month) return res.status(400).json({ error: 'Summarise one person, or one month' })

  const rows = about
    ? await all('SELECT * FROM person_notes WHERE about_id = ? ORDER BY month', about)
    : await all('SELECT * FROM person_notes WHERE month = ? ORDER BY about_id', month)
  if (!rows.length) return res.json({ summary: '', points: [], provider: 'none', notes: 0 })

  const people = await staff()
  const map = aliasMap(people)
  // Only notes about somebody still on the staff list. A colleague who has
  // left is not in the map, so nothing can mask their name — in the notes
  // about them it is the commonest word there is — and the gate below only
  // knows the names it was given. Their notes stay here; they are not sent.
  const sendable = rows.filter((r) => map.byId.has(r.about_id))
  if (!sendable.length) return res.json({ summary: '', points: [], provider: 'none', notes: 0 })
  const payload = {
    reading: about ? 'one person across every month written about them' : `every person in ${month}`,
    notes: sendable.map((r) => ({
      month: r.month,
      about: map.byId.get(r.about_id) || 'Person unknown',
      said: mask(r.body, map),
    })),
  }

  // The gate. Checked on everything in the payload that came out of a note.
  // NOT on the payload's own keys: they are written in this file and name
  // nobody, and with them in, one colleague called Said matched the "said" key
  // and every summary was refused for as long as he was on the staff list.
  const survived = leaks(payload.notes.map((n) => `${n.about}\n${n.said}`).join('\n'), map)
  if (survived.length) {
    console.error(`people summary refused: ${survived.length} name(s) survived masking`)
    return res.status(500).json({ error: 'Couldn’t anonymise these notes safely, so nothing was sent. Nobody’s name left the server.' })
  }

  const out = await peopleSummary(payload, { lang: String(req.body?.lang || 'en') })
  res.json({
    ...out,
    summary: unmask(out.summary, map),
    points: (out.points || []).map((p) => ({ ...p, say: unmask(p.say, map) })),
    notes: sendable.length,
  })
}))

export default router

// The Google Drive door. Connecting (an admin of the whole board, once), and
// uploading a task's footage, cut or artwork into that task's folder.
//
// An upload is carried by a signed ticket rather than remembered here: the
// task, the job, the person, the folder and Google's session address, signed
// with the app's own secret. So an upload survives this server restarting
// under it (a deploy is a restart), and nobody can point a ticket at a task
// or a session that is not theirs.
import express, { Router } from 'express'
import { Readable } from 'stream'
import jwt from 'jsonwebtoken'
import { get, all, run, publicUser } from '../db.js'
import { authRequired, wrap, JWT_SECRET, isAdminOn, isFullAdmin, adminOnly, can } from '../auth.js'
import {
  driveConfigured, readConnection, consentUrl, connect, disconnect, taskFolder,
  startSession, sessionStatus, relayPiece, fileInfo, filesByTask, storageQuota, CHUNK_DIRECT, CHUNK_RELAY,
  makeDropFolders, thumbnail, canRead, openMedia, nameTaken, shapeDrop, trashFile,
} from '../drive.js'
import { dropFolders, setDropFolders, watchState, unmatchedDrops, attachDrop, claimDrop, folderFor, fileNameOf } from '../dropin.js'
import { taskFiles, mayOpen, driveRef, LINK_FIELDS } from '../taskfiles.js'
import { resolveGates } from '../deadlines.js'

const router = Router()

// Which seat on the task an upload is for, and the link column it fills.
const JOBS = {
  edit: { hat: 'editor_id', col: 'ready_link' },
  shoot: { hat: 'operator_id', col: 'shot_link' },
  design: { hat: 'designer_id', col: 'design_link' },
  // A reference video: anybody who works on the task, and it fills no box —
  // routes/content.js notes it in the task's references once it lands.
  reference: { hat: null, col: null, anyone: true },
  // The task window's Drive box: anybody who works on the task, into the
  // shared folder for the task's stage (Recording, Pravka or Ready — the same
  // answer as "Copy file name"), named after the task, and attached to it the
  // moment it lands (drive_drops), so the watcher never attaches it again.
  box: { hat: null, col: null, anyone: true, drop: true },
}
const MAX_BYTES = 100 * 1024 ** 3 // 100 GB: a day of raw footage, with room to spare

// Two answers every page open would otherwise ask Google for again: what is
// in the Drive, and how full it is. Held briefly, and dropped the moment an
// upload lands so the new file shows at once.
const memo = { files: null, filesAt: 0, quota: null, quotaAt: 0 }
const allFiles = async () => {
  if (!memo.files || Date.now() - memo.filesAt > 20000) { memo.files = await filesByTask(); memo.filesAt = Date.now() }
  return memo.files
}
const quotaNow = async () => {
  if (!memo.quota || Date.now() - memo.quotaAt > 60000) { memo.quota = await storageQuota(); memo.quotaAt = Date.now() }
  return memo.quota
}
const forget = () => { memo.files = null; memo.quota = null; listed.clear() }
// One task's Files list, held for half a minute: the window, its previews and
// each play or download ask for it, and only the first should reach Google.
const listed = new Map()
async function filesOf(row) {
  const hit = listed.get(row.id)
  if (hit && Date.now() - hit.at < 30000) return hit.list
  const own = (await allFiles().catch(() => ({})))[row.id] || []
  const list = await taskFiles(row, own)
  listed.set(row.id, { at: Date.now(), list })
  return list
}
// The people a task's files are for: the same people its paperwork is for —
// whoever is on it, whoever plans its channel, an admin over it.
const worksOn = (user, row) => {
  const chans = JSON.parse(row.channels || '[]')
  let assignees = []
  try { assignees = JSON.parse(row.assignees || '[]') } catch { assignees = [] }
  return isAdminOn(user, chans) || assignees.includes(user.id) || row.assignee_id === user.id
    || row.operator_id === user.id || row.editor_id === user.id || row.designer_id === user.id
    || chans.some((ch) => (user.departments || []).includes(ch))
}
const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`

// The page's own address. PUBLIC_URL wins (it is what Google has on record as
// the way back); otherwise the address the admin's browser says it is on.
const baseOf = (req) => (process.env.PUBLIC_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Google Drive failed' })

// ---- the way back from Google's consent screen ------------------------------
// A browser navigation, so no session header — the signed `state` is the proof
// that an admin of this board started it, fifteen minutes ago at most.
router.get('/callback', wrap(async (req, res) => {
  let st
  try { st = jwt.verify(String(req.query.state || ''), JWT_SECRET) } catch { st = null }
  if (!st || st.p !== 'drive') return res.status(400).send('This sign-in link has expired — go back to Admin → Google Drive and press Connect again.')
  const home = `${new URL(st.r).origin}/admin?tab=drive`
  if (req.query.error) return res.redirect(`${home}&drive=cancelled`)
  const who = await get('SELECT * FROM users WHERE id = ?', st.u)
  if (!who || !isFullAdmin(publicUser(who))) return res.redirect(`${home}&drive=refused`)
  try {
    await connect({ code: String(req.query.code || ''), redirectUri: st.r, by: who.name })
    // Drop-in's three folders, found again or made. If Google says no here
    // the connection still stands, and Admin → Google Drive says why drop-in
    // is not on (watchState) next to the button that fixes it.
    try { await setDropFolders(await makeDropFolders()) } catch (e) { console.error('drive drop folders failed:', e.message) }
    res.redirect(`${home}&drive=connected`)
  } catch (e) {
    res.redirect(`${home}&drive_error=${encodeURIComponent(e.message)}`)
  }
}))

// ---- a file's bytes, for the player and Download ----------------------------
// A <video> cannot send the sign-in header, so this one route is proved by a
// ticket instead: signed here a moment ago for ONE file and ONE person, good
// for ten minutes (the window asks for a fresh one if a long video outlives
// it). The bytes come from Google in the range the browser asks for, so a
// video can be scrubbed; nothing is written to this server's disk.
const PLAY_MINUTES = 10
router.get('/stream/:fileId', wrap(async (req, res) => {
  let t
  try { t = jwt.verify(String(req.query.t || ''), JWT_SECRET) } catch { t = null }
  if (!t || t.p !== 'play' || t.f !== req.params.fileId) return res.status(403).json({ error: 'This link to the file has expired — open the task again' })
  const ctrl = new AbortController()
  res.on('close', () => ctrl.abort())
  let up
  try { up = await openMedia(t.f, { range: req.get('range'), key: t.k, signal: ctrl.signal }) } catch (e) { return fail(res, e) }
  if (up.status !== 200 && up.status !== 206) {
    return res.status(up.status === 416 ? 416 : up.status === 404 || up.status === 403 ? 404 : 502)
      .json({ error: up.status === 416 ? 'That part of the file does not exist' : 'Google Drive would not hand over the file' })
  }
  const name = String(t.n || 'file').replace(/["\r\n]/g, '')
  const ascii = name.replace(/[^\x20-\x7e]/g, '_')
  res.status(up.status).set({
    'Content-Type': up.headers.get('content-type') || t.m || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store, no-transform',
    // nginx would otherwise hold a whole video before passing any of it on.
    'X-Accel-Buffering': 'no',
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    ...(up.headers.get('content-length') ? { 'Content-Length': up.headers.get('content-length') } : {}),
    ...(up.headers.get('content-range') ? { 'Content-Range': up.headers.get('content-range') } : {}),
  })
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res)
}))

router.use(authRequired)

// Everybody may ask whether uploading is possible (the Upload button hangs on
// it); only an admin of the whole board is told which account and where.
router.get('/status', wrap(async (req, res) => {
  const c = readConnection()
  const out = { configured: driveConfigured(), connected: driveConfigured() && !!c }
  // How full it is, for everybody who uploads — a number, not a secret.
  if (out.connected) out.quota = await quotaNow().catch(() => null)
  // Whether files dropped into the Drive folders are being picked up.
  out.drop = await watchState()
  if (isFullAdmin(req.user)) {
    Object.assign(out, {
      email: c?.email || null, folder_url: c?.root_folder_url || null,
      connected_at: c?.connected_at || null, connected_by: c?.connected_by || null,
      redirect_uri: `${baseOf(req)}/api/drive/callback`,
      can_read: canRead(c), drop_folders: out.connected ? await dropFolders() : null,
    })
  }
  res.json(out)
}))

router.post('/connect', adminOnly, wrap(async (req, res) => {
  if (!driveConfigured())
    return res.status(503).json({ error: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first (repository secrets → deploy)' })
  const redirectUri = `${baseOf(req)}/api/drive/callback`
  const state = jwt.sign({ p: 'drive', u: req.user.id, r: redirectUri }, JWT_SECRET, { expiresIn: '15m' })
  res.json({ url: consentUrl({ state, redirectUri }), redirect_uri: redirectUri })
}))

router.post('/disconnect', adminOnly, wrap(async (req, res) => {
  await disconnect()
  await setDropFolders(null)
  res.json({ ok: true })
}))

// ---- drop-in: files that found no task, and their previews -------------------
// The files dropped into the Drive folders whose names named no task (or one
// title held by several). An admin of the whole board attaches each by hand;
// attached, it leaves the list.
router.get('/drops/unmatched', wrap(async (req, res) => {
  if (!isFullAdmin(req.user)) return res.status(403).json({ error: 'Only an admin of the whole board sees the files nobody matched' })
  res.json({ files: await unmatchedDrops(), drop: await watchState() })
}))
router.post('/drops/:id/attach', wrap(async (req, res) => {
  if (!isFullAdmin(req.user)) return res.status(403).json({ error: 'Only an admin of the whole board attaches a file by hand' })
  const pick = Number(req.body?.task_id)
  const task = Number.isInteger(pick) && pick > 0 ? await get('SELECT id FROM content WHERE id = ?', pick) : null
  if (!task) return res.status(400).json({ error: 'Pick the task this file is for', field: 'task_id' })
  const d = await get('SELECT file_id FROM drive_drops WHERE id = ?', Number(req.params.id))
  const r = d ? await attachDrop(d.file_id, task.id, 'hand', req.user) : { why: 'missing' }
  if (r.why === 'missing') return res.status(404).json({ error: 'That file is not on the list any more' })
  if (r.why === 'taken') return res.status(409).json({ error: 'That file has already been attached to a task' })
  res.json({ ok: true, files: await unmatchedDrops() })
}))
// A dropped file's preview, through this server: for whoever may see the task
// it is on (an unmatched one, for an admin of the whole board). Asked of
// Google fresh each time, since the thumbnail's address expires.
router.get('/drops/:id/thumb', wrap(async (req, res) => {
  const d = await get('SELECT id, file_id, content_id FROM drive_drops WHERE id = ?', Number(req.params.id))
  if (!d) return res.status(404).json({ error: 'Not found' })
  const row = d.content_id
    ? await get('SELECT id, channels, assignee_id, assignees, operator_id, editor_id, designer_id FROM content WHERE id = ?', d.content_id)
    : null
  if (!(row ? worksOn(req.user, row) : isFullAdmin(req.user))) return res.status(404).json({ error: 'Not found' })
  if (!driveConfigured() || !readConnection()) return res.status(503).json({ error: 'Google Drive isn’t connected' })
  try {
    const t = await thumbnail(d.file_id)
    // What Google knows now — a video's length and its preview arrive after it is processed.
    await run('UPDATE drive_drops SET has_thumb = ?, duration_ms = COALESCE(?, duration_ms) WHERE id = ?', t.bytes ? 1 : 0, t.file.duration_ms, d.id)
    if (!t.bytes) return res.status(404).json({ error: 'Preview is being made by Google', pending: true })
    res.set({ 'Content-Type': t.type, 'Cache-Control': 'private, max-age=600', ...(t.file.duration_ms ? { 'X-Duration-Ms': String(t.file.duration_ms) } : {}) }).send(t.bytes)
  } catch (e) { fail(res, e) }
}))

// ---- one file, into one task's folder ---------------------------------------
router.post('/tasks/:id/uploads', wrap(async (req, res) => {
  const job = JOBS[req.body?.kind]
  if (!job) return res.status(400).json({ error: 'Say what the file is — footage, an edit or artwork' })
  const row = await get('SELECT id, title, channels, assignee_id, assignees, operator_id, editor_id, designer_id FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const chans = JSON.parse(row.channels || '[]')
  // The person in that seat, an admin over the task, or whoever plans the
  // channel — the same people who may paste its link.
  const mine = (job.anyone && worksOn(req.user, row))
    || (job.hat && row[job.hat] === req.user.id)
    || isAdminOn(req.user, chans)
    || (can(req.user, 'manage_content') && chans.some((ch) => (req.user.departments || []).includes(ch)))
  if (!mine) return res.status(403).json({ error: 'This isn’t yours to upload — only the person on this job, or its channel’s planners' })
  const name = String(req.body?.name || '').replace(/[\\/]/g, '-').trim().slice(0, 200)
  const size = Number(req.body?.size)
  if (!name) return res.status(400).json({ error: 'The file needs a name' })
  if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: 'That file is empty' })
  if (size > MAX_BYTES) return res.status(413).json({ error: 'That file is over 100 GB — split it, or share it from Drive yourself' })
  if (!driveConfigured() || !readConnection())
    return res.status(503).json({ error: 'Google Drive isn’t connected — an admin connects it in Admin → Google Drive' })
  try {
    // Said before the first byte, not forty minutes into the file.
    const room = await quotaNow().catch(() => null)
    if (room?.limit && room.usage + size > room.limit) {
      return res.status(507).json({ error: `Not enough room on the Google Drive — ${gb(Math.max(0, room.limit - room.usage))} free, and this file is ${gb(size)}` })
    }
    let folder
    let fileName = name
    if (job.drop) {
      const full = await get('SELECT * FROM content WHERE id = ?', row.id)
      const folders = await dropFolders()
      if (!folders) return res.status(503).json({ error: 'The Drive folders are not made yet — an admin reconnects Google Drive in Admin → Google Drive' })
      const resolved = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
      const open = await get('SELECT id FROM revisions WHERE content_id = ? AND resolved_at IS NULL LIMIT 1', row.id)
      const where = folders[folderFor(full, resolved, !!open)]
      folder = { id: where.id, webViewLink: where.url }
      // "<title> #<id>" and the file's own extension; " (2)" and on if taken.
      const ext = (/\.[A-Za-z0-9]{1,8}$/.exec(name) || [''])[0]
      const base = fileNameOf(full)
      fileName = `${base}${ext}`
      for (let n = 2; n < 100 && await nameTaken(folder.id, fileName); n++) fileName = `${base} (${n})${ext}`
    } else folder = await taskFolder(row)
    const session = await startSession({
      folderId: folder.id, name: fileName, size, mime: String(req.body?.mime || '') || 'application/octet-stream', origin: req.get('origin'),
    })
    const ticket = jwt.sign({ c: row.id, k: req.body.kind, u: req.user.id, f: folder.id, s: session, n: size, m: fileName }, JWT_SECRET, { expiresIn: '7d' })
    res.status(201).json({ ticket, session_url: session, chunk: CHUNK_DIRECT, relay_chunk: CHUNK_RELAY, folder_url: folder.webViewLink || null, name: fileName })
  } catch (e) { fail(res, e) }
}))

// The ticket, checked: signed here, for this person.
const ticketOf = (req) => {
  try {
    const t = jwt.verify(String(req.get('x-upload-ticket') || req.body?.ticket || ''), JWT_SECRET)
    return t && t.u === req.user.id && t.s ? t : null
  } catch { return null }
}

// Where the upload has got to — asked after a dropped connection, so it
// carries on from the last byte Google kept instead of starting again.
router.get('/uploads/status', wrap(async (req, res) => {
  const t = ticketOf(req)
  if (!t) return res.status(403).json({ error: 'That upload is not yours, or it has expired' })
  try { res.json(await sessionStatus(t.s, t.n)) } catch (e) { fail(res, e) }
}))

// A piece fed through here, when the browser cannot reach Google itself.
// Under nginx's 10 MB limit by design (CHUNK_RELAY is 8 MB).
router.put('/uploads/piece', express.raw({ type: () => true, limit: '9mb' }), wrap(async (req, res) => {
  const t = ticketOf(req)
  if (!t) return res.status(403).json({ error: 'That upload is not yours, or it has expired' })
  const start = Number(req.get('x-upload-offset'))
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  if (!Number.isInteger(start) || start < 0 || !buf.length || start + buf.length > t.n)
    return res.status(400).json({ error: 'That piece does not fit the file' })
  try { res.json(await relayPiece(t.s, buf, start, t.n)) } catch (e) { fail(res, e) }
}))

// The file is whole: check it is really in this task's folder, note it on the
// task's history, and hand back the link for the box it belongs in.
router.post('/uploads/finish', wrap(async (req, res) => {
  const t = ticketOf(req)
  if (!t) return res.status(403).json({ error: 'That upload is not yours, or it has expired' })
  try {
    const f = await fileInfo(String(req.body?.file_id || ''))
    if (!f?.id || f.trashed || !(f.parents || []).includes(t.f))
      return res.status(400).json({ error: 'That file is not in this task’s folder' })
    const row = await get('SELECT id, title FROM content WHERE id = ?', t.c)
    forget()
    // The History line (r11): whoever uploaded it can find it again to fix it.
    if (row) {
      await run(`INSERT INTO drive_uploads (file_id, content_id, user_id, kind, name, size, mime, link, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(file_id) DO NOTHING`,
      f.id, row.id, req.user.id, t.k, f.name || '', Number(f.size) || t.n, f.mimeType || '', f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, new Date().toISOString())
    }
    if (row && JOBS[t.k]?.drop) {
      // Claimed by its Drive id and attached here, by whoever uploaded it; if
      // the watcher saw it first, it is attached already and that is that.
      const folders = await dropFolders()
      const key = Object.keys(folders || {}).find((k) => k !== 'parent' && folders[k].id === t.f) || 'ready'
      await claimDrop(shapeDrop(f), key)
      await attachDrop(f.id, row.id, 'upload', req.user)
    } else if (row) {
      await run('INSERT INTO activity (content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        row.id, row.title, req.user.id, req.user.name || '', 'updated', 'document', null, `${f.name} (Google Drive)`, new Date().toISOString())
    }
    res.json({ id: f.id, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, name: f.name, size: Number(f.size) || t.n, column: JOBS[t.k]?.col })
  } catch (e) { fail(res, e) }
}))

// ---- History (r11, the owner) -----------------------------------------------
// What this person uploaded, newest first: the file, its task, whether it is
// the one handed in, and whether it was deleted since — so a wrong file is
// found and fixed (deleted, or replaced) days later. Tasks they no longer
// see are left out.
router.get('/history', wrap(async (req, res) => {
  const rows = await all(`SELECT u.*, c.title, c.channels, c.assignee_id, c.assignees, c.operator_id, c.editor_id, c.designer_id,
      c.shot_link, c.ready_link, c.design_link
    FROM drive_uploads u JOIN content c ON c.id = u.content_id
    WHERE u.user_id = ? ORDER BY u.created_at DESC, u.id DESC LIMIT 200`, req.user.id)
  res.json({
    uploads: rows.filter((r) => worksOn(req.user, r)).map((r) => ({
      file_id: r.file_id, content_id: r.content_id, title: r.title, kind: r.kind, name: r.name, size: Number(r.size) || 0,
      mime: r.mime, link: r.link, created_at: r.created_at, deleted_at: r.deleted_at || null,
      handed_in: LINK_FIELDS.some((k) => driveRef(r[k])?.id === r.file_id),
      can_remove: !r.deleted_at && mayRemove(req.user, r, { state: 'ok', source: 'upload' }),
    })),
  })
}))

// ---- what is already there, task by task ------------------------------------
// ?tasks=1,2,3 — the files in each of those tasks' folders, for the tasks this
// person works on (the rest are simply left out). One look at the Drive
// answers the whole page.
router.get('/files', wrap(async (req, res) => {
  if (!driveConfigured() || !readConnection()) return res.json({ files: {} })
  const ids = [...new Set(String(req.query.tasks || '').split(',').map(Number).filter(Boolean))].slice(0, 500)
  if (!ids.length) return res.json({ files: {} })
  const rows = await all(`SELECT id, channels, assignee_id, assignees, operator_id, editor_id, designer_id FROM content WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const mine = new Set(rows.filter((r) => worksOn(req.user, r)).map((r) => r.id))
  try {
    const every = await allFiles()
    const files = {}
    for (const id of mine) if (every[id]) files[id] = every[id]
    res.json({ files })
  } catch (e) { fail(res, e) }
}))


// ---- every Drive file a task points at ---------------------------------------
// For whoever works on the task (the same people its paperwork is for).
const taskRow = async (req) => {
  const row = await get('SELECT * FROM content WHERE id = ?', Number(req.params.id))
  return row && worksOn(req.user, row) ? row : null
}
// Who may delete a file the board put on the Drive (r11, the owner: "editor
// or operator can delete uploads"): whoever films, edits or designs the
// piece, its owner, and its channel's planners and admins — the people who
// may upload to it. A pasted link is somebody's own Drive file: never.
const mayRemove = (user, row, f) => {
  if (!f || f.state !== 'ok' || (f.source === 'link' && !f.ours)) return false
  const chans = JSON.parse(row.channels || '[]')
  let assignees = []
  try { assignees = JSON.parse(row.assignees || '[]') } catch { assignees = [] }
  return [row.operator_id, row.editor_id, row.designer_id, row.assignee_id].includes(user.id) || assignees.includes(user.id)
    || isAdminOn(user, chans) || (can(user, 'manage_content') && chans.some((ch) => (user.departments || []).includes(ch)))
}
router.get('/tasks/:id/files', wrap(async (req, res) => {
  const row = await taskRow(req)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!driveConfigured() || !readConnection()) return res.json({ connected: false, files: [], handled: [] })
  try {
    const list = await filesOf(row)
    res.json({ connected: true, ...list, files: list.files.map((f) => (mayRemove(req.user, row, f) ? { ...f, can_remove: true } : f)) })
  } catch (e) { fail(res, e) }
}))
// Delete one: to the Drive's bin, off the task's list, and out of any box on
// the task that pointed at it — a hand-in link to a binned file would only
// say "not shared". Noted on the task's history.
router.delete('/tasks/:id/files/:fileId', wrap(async (req, res) => {
  const row = await taskRow(req)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!driveConfigured() || !readConnection()) return res.status(503).json({ error: 'Google Drive isn’t connected' })
  try {
    listed.delete(row.id)
    const f = mayOpen(await filesOf(row), req.params.fileId)
    if (!f) return res.status(404).json({ error: 'That file is not on this task' })
    if (f.source === 'link' && !f.ours) return res.status(403).json({ error: 'This is somebody’s own Drive file — it can only be deleted in Drive' })
    if (!mayRemove(req.user, row, f)) return res.status(403).json({ error: 'Only whoever films, edits or designs this piece, its owner or its channel’s planners can delete its files' })
    await trashFile(f.id)
    await run('DELETE FROM drive_drops WHERE file_id = ?', f.id)
    await run('UPDATE drive_uploads SET deleted_at = ?, deleted_by = ? WHERE file_id = ? AND deleted_at IS NULL', new Date().toISOString(), req.user.id, f.id)
    const cleared = LINK_FIELDS.filter((k) => driveRef(row[k])?.id === f.id)
    for (const k of cleared) await run(`UPDATE content SET ${k} = NULL WHERE id = ?`, row.id)
    await run('INSERT INTO activity (content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.id, row.title, req.user.id, req.user.name || '', 'updated', 'document', `${f.name} (Google Drive)`, null, new Date().toISOString())
    forget()
    res.json({ ok: true, id: f.id, cleared })
  } catch (e) { fail(res, e) }
}))
router.get('/tasks/:id/files/:fileId/thumb', wrap(async (req, res) => {
  const row = await taskRow(req)
  const f = row && driveConfigured() && readConnection() ? mayOpen(await filesOf(row), req.params.fileId) : null
  if (!f) return res.status(404).json({ error: 'Not found' })
  try {
    const t = await thumbnail(f.id, f.key)
    if (!t.bytes) return res.status(404).json({ error: 'Preview is being made by Google', pending: true })
    res.set({ 'Content-Type': t.type, 'Cache-Control': 'private, max-age=600', ...(t.file.duration_ms ? { 'X-Duration-Ms': String(t.file.duration_ms) } : {}) }).send(t.bytes)
  } catch (e) { fail(res, e) }
}))
// The ticket for the player and Download: only for a file on this task's list,
// and never for a Google Doc (it has no bytes to hand over, only Drive's page).
router.get('/tasks/:id/files/:fileId/play', wrap(async (req, res) => {
  const row = await taskRow(req)
  const f = row && driveConfigured() && readConnection() ? mayOpen(await filesOf(row), req.params.fileId) : null
  if (!f) return res.status(404).json({ error: 'Not found' })
  if (/^application\/vnd\.google-apps\./.test(f.mime)) return res.status(409).json({ error: 'A Google Doc opens in Drive — it has no file to download' })
  const t = jwt.sign({ p: 'play', u: req.user.id, f: f.id, c: row.id, n: f.name, m: f.mime, k: f.key || null }, JWT_SECRET, { expiresIn: `${PLAY_MINUTES}m` })
  const url = `/api/drive/stream/${encodeURIComponent(f.id)}?t=${encodeURIComponent(t)}`
  res.json({ url, download: `${url}&download=1`, expires_in: PLAY_MINUTES * 60 })
}))

export default router

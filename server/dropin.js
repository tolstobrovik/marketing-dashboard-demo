// ---- Drive drop-in: files people put into Drive themselves -----------------
//
// The upload button sends a file through the browser into a task's own
// folder. Most of the crew already live in Google Drive, though — on a phone,
// on the office computer — so the other way in is to drop the file into one
// of three shared folders and let the board find it:
//
//   Recording   footage          SATashkent Marketing drop/Recording
//   Pravka      a fix            …/Pravka  (answers the task's open round)
//   Ready       the final file   …/Ready
//
// WHICH TASK. The file's name says. The task window's "Copy file name" gives
// `<title> #<id>`, and the last #<id> before the extension wins. With no #id,
// a name that is exactly the title of ONE open task is that task. Anything
// else waits in Unmatched (More → Unmatched files) for an admin to attach.
//
// WHAT IT CHANGES. Nothing but the task's list of files and its owner's bell.
// It never moves the stage, never fills a hand-in link, never closes a round:
// the person whose step it is still presses their button. The file stays in
// Drive; the board keeps its id, name, size, type, link, length and whether a
// preview exists.
//
// TWICE AT ONCE. Production can run two copies of this server, both watching.
// A file is CLAIMED with a row (insert-or-ignore on its Drive id) before it is
// attached or anybody is told, so whichever copy comes second does nothing.
//
// Every two minutes (DRIVE_WATCH_MS), all three folders are listed in full,
// page by page, and only ids never seen are looked at. Not "changed since":
// a file moved into a folder keeps the time it was made, and a cursor on that
// time would never see it.
import { all, get, run, batch } from './db.js'
import { resolveGates, phasePassed } from './deadlines.js'
import { VIDEO_TYPES } from './reposts.js'
import { driveConfigured, readConnection, canRead, folderFiles, DROP_SUBS } from './drive.js'

export const KIND_OF = { recording: 'footage', pravka: 'fix', ready: 'final' }
const FOLDERS_KEY = 'drive_drop_folders'

// ---- the folders, as the connection found or made them ---------------------
export async function dropFolders() {
  try {
    const v = JSON.parse((await get('SELECT value FROM meta WHERE key = ?', FOLDERS_KEY))?.value || 'null')
    return v && Object.keys(DROP_SUBS).every((k) => v[k]?.id) ? v : null
  } catch { return null }
}
export async function setDropFolders(v) {
  if (v) await run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', FOLDERS_KEY, JSON.stringify(v))
  else await run('DELETE FROM meta WHERE key = ?', FOLDERS_KEY)
}

// ---- is it watching, and if not, why ---------------------------------------
// DRIVE_WATCH=off stops it on a server; otherwise it needs a connection that
// was granted the read scope, and the folders to read.
export const watchSwitchedOn = () => !/^(off|0|false|no)$/i.test(String(process.env.DRIVE_WATCH ?? 'on').trim())
export async function watchState() {
  if (!watchSwitchedOn()) return { on: false, reason: 'off' }
  const c = driveConfigured() ? readConnection() : null
  if (!c) return { on: false, reason: 'disconnected' }
  if (!canRead(c)) return { on: false, reason: 'reconnect' }
  if (!(await dropFolders())) return { on: false, reason: 'folders' }
  return { on: true, reason: null }
}

// ---- the name to give a file -----------------------------------------------
// What Windows or Drive cannot hold in a file name goes; the rest is the title.
const BAD = /[/\\:*?"<>|\u0000-\u001f]/g
export const cleanTitle = (t) => String(t || '').replace(BAD, '').replace(/\s+/g, ' ').trim()
export const fileNameOf = (row) => `${cleanTitle(row.title) || 'Task'} #${row.id}`

// Which folder the task's next file goes in, by where it stands: a change sent
// back and not yet fixed → Pravka; a video not yet filmed → Recording;
// anything else → Ready. The same reading of "filmed" the lateness rules use.
export function folderFor(row, resolved, roundOpen) {
  if (roundOpen) return 'pravka'
  if (VIDEO_TYPES.includes(row.type) && !phasePassed(row, 'shoot', resolved)) return 'recording'
  return 'ready'
}
export async function dropOf(row, resolved, roundOpen) {
  const folder = folderFor(row, resolved, roundOpen)
  const f = await dropFolders()
  return { file_name: fileNameOf(row), folder, folder_name: DROP_SUBS[folder], folder_url: f?.[folder]?.url || null }
}

const DROP_COLUMNS = 'id, file_id, folder, name, size, mime, link, duration_ms, has_thumb, file_at, content_id, revision_id, matched_by, attached_name, attached_at, created_at'
const shape = (d) => ({ ...d, kind: KIND_OF[d.folder] || 'final', folder_name: DROP_SUBS[d.folder] || d.folder })
export const dropsOf = async (contentId) =>
  (await all(`SELECT ${DROP_COLUMNS} FROM drive_drops WHERE content_id = ? ORDER BY id DESC`, contentId)).map(shape)
export const unmatchedDrops = async () =>
  (await all(`SELECT ${DROP_COLUMNS} FROM drive_drops WHERE content_id IS NULL ORDER BY id DESC`)).map(shape)

// ---- which task a file is for ------------------------------------------------
const EXT = /\.[A-Za-z0-9]{1,8}$/
export const baseName = (name) => String(name || '').trim().replace(EXT, '').trim()
async function openTitles() {
  const dead = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses')).deadIds
  return (await all('SELECT id, title, status_id FROM content WHERE done_at IS NULL'))
    .filter((r) => !dead.includes(r.status_id))
}
export async function matchOf(name, titles) {
  const base = baseName(name)
  const ids = [...base.matchAll(/#(\d+)/g)]
  if (ids.length) {
    const id = Number(ids[ids.length - 1][1])
    if (await get('SELECT id FROM content WHERE id = ?', id)) return { id, by: 'id' }
  }
  if (!base) return null
  const hits = (await titles()).filter((r) => String(r.title || '').trim() === base || cleanTitle(r.title) === base)
  return hits.length === 1 ? { id: hits[0].id, by: 'title' } : null
}

// ---- attaching ---------------------------------------------------------------
// Keyed on the Drive file's id, never this database's row id, and every write
// after the first asks "did MY attach win?". Two reasons. Two server copies on
// one database: the WHERE lets only one attach. And GitHub storage, where a
// copy that lost the race has its writes replayed on top of the winner's
// database: a row id means a different file there, and a replayed bell line
// would ring twice — keyed and gated, a replay changes nothing.
// One transaction: attached, noted in the history and rung, or none of them.
const WON = 'EXISTS (SELECT 1 FROM drive_drops WHERE file_id = ? AND attached_at = ?)'
export async function attachDrop(fileId, contentId, by, person = null) {
  const d = await get('SELECT * FROM drive_drops WHERE file_id = ?', fileId)
  const row = await get('SELECT id, title, assignee_id FROM content WHERE id = ?', contentId)
  if (!d || !row) return { ok: false, why: 'missing' }
  if (d.content_id) return { ok: false, why: 'taken' }
  const round = d.folder === 'pravka'
    ? await get('SELECT id FROM revisions WHERE content_id = ? AND resolved_at IS NULL ORDER BY round DESC, id DESC LIMIT 1', row.id)
    : null
  const now = new Date().toISOString()
  const where = DROP_SUBS[d.folder] || d.folder
  const stmts = [
    [`UPDATE drive_drops SET content_id = ?, revision_id = ?, matched_by = ?, attached_by = ?, attached_name = ?, attached_at = ?
      WHERE file_id = ? AND content_id IS NULL`, row.id, round?.id ?? null, by, person?.id ?? null, person?.name || '', now, d.file_id],
    [`INSERT INTO activity (content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at)
      SELECT CAST(? AS INTEGER), CAST(? AS TEXT), CAST(? AS INTEGER), CAST(? AS TEXT), 'updated', 'document', NULL, CAST(? AS TEXT), CAST(? AS TEXT) WHERE ${WON}`,
    row.id, row.title, person?.id ?? null, person?.name || 'Google Drive', `${d.name} (Google Drive · ${where})`, now, d.file_id, now],
  ]
  // The owner's bell, the way a comment rings it. No Telegram: the bell is
  // where the board says "something arrived".
  if (row.assignee_id && row.assignee_id !== person?.id) {
    stmts.push([`INSERT INTO notifications (user_id, kind, text, content_id, created_at)
      SELECT CAST(? AS INTEGER), 'comment', CAST(? AS TEXT), CAST(? AS INTEGER), CAST(? AS TEXT) WHERE ${WON}`,
    row.assignee_id, `Google Drive: «${d.name}» arrived in ${where} for «${row.title}»`, row.id, now, d.file_id, now])
  }
  await batch(stmts)
  const after = await get('SELECT attached_at FROM drive_drops WHERE file_id = ?', d.file_id)
  return after?.attached_at === now ? { ok: true } : { ok: false, why: 'taken' }
}

// The claim itself: one row per Drive file, whoever sees it first — the
// watcher, or the task window's own upload (routes/drive.js) finishing.
// true when THIS call made the row.
export async function claimDrop(f, folder) {
  const r = await run(`INSERT INTO drive_drops (file_id, folder, name, size, mime, link, duration_ms, has_thumb, file_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(file_id) DO NOTHING`,
  f.id, folder, f.name, f.size, f.mime, f.link, f.duration_ms, f.has_thumb, f.at, new Date().toISOString())
  return !!r.changes
}

// ---- one look at the three folders --------------------------------------------
let busy = false
export async function watchTick() {
  if (busy) return { busy: true }
  busy = true
  try {
    const st = await watchState()
    if (!st.on) return { off: st.reason }
    const folders = await dropFolders()
    const known = new Set((await all('SELECT file_id FROM drive_drops')).map((r) => r.file_id))
    let titles = null
    const titlesOnce = async () => (titles = titles || await openTitles())
    const out = { claimed: 0, attached: 0, unmatched: 0 }
    for (const key of Object.keys(DROP_SUBS)) {
      for (const f of await folderFiles(folders[key].id)) {
        if (known.has(f.id)) continue
        known.add(f.id)
        if (!(await claimDrop(f, key))) continue
        out.claimed++
        // Claimed, it is this copy's to place. A database that is briefly
        // busy is asked again; a failure past that leaves the file in
        // Unmatched for an admin, never lost.
        const m = await matchOf(f.name, titlesOnce)
        let placed = false
        for (let i = 0; m && !placed && i < 3; i++) {
          try { placed = (await attachDrop(f.id, m.id, m.by)).ok; break } catch (e) {
            if (i === 2) console.error('drive drop-in could not attach', f.id, e.message)
            await new Promise((r) => setTimeout(r, 200 * (i + 1)))
          }
        }
        if (placed) out.attached++
        else out.unmatched++
      }
    }
    return out
  } finally { busy = false }
}

export function startDropWatch() {
  const every = Math.max(1000, Number(process.env.DRIVE_WATCH_MS) || 120000)
  const go = () => watchTick().catch((e) => console.error('drive drop-in failed:', e.message))
  const t = setInterval(go, every)
  t.unref?.()
  setTimeout(go, Math.min(every, 10000)).unref?.()
  return t
}

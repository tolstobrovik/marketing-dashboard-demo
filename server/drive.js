// ---- Google Drive, for the files too big for this server -------------------
//
// Footage and finished cuts are gigabytes. They cannot come through this app:
// nginx takes 10 MB a request, the box has not got the memory, and the
// database is a file in git. So they go to the team's Google Drive, straight
// from the browser, and the task keeps the link — which is what the board has
// always kept.
//
// HOW THE BYTES TRAVEL. The server opens a resumable upload session with
// Google (a single request, no file in it) and hands its address to the
// browser, which sends the file there in 32 MB pieces and watches its own
// progress bar. The session is created with the browser's Origin, which is
// what lets Google answer the browser's cross-site requests. Where a network
// refuses the direct route, the same session is fed through /api/drive in
// 8 MB pieces instead (under nginx's limit); the file is the same file either
// way.
//
// WHAT IT MAY TOUCH. Uploads write with drive.file — only the files and
// folders this app created. Drop-in (server/dropin.js) also needs to SEE the
// files people put into the three drop folders by hand, which drive.file
// cannot, so the connection asks for drive.readonly as well: it reads, it
// never writes, moves or deletes anything it did not make. Google lets the
// person untick a scope on the consent screen, so the scopes it actually
// granted are written down with the key, and drop-in stays off without the
// read one.
//
// WHERE THE KEY LIVES. Connecting is an admin pressing one button and signing
// in to Google themselves. What Google hands back — the refresh token — is
// written to a file of its own on the server (GOOGLE_DRIVE_TOKEN_FILE,
// default ~/.satashkent/google-drive.json, readable by the app's user only):
// outside the repository, outside the deploy's rsync, and outside DATA_DIR,
// whose database is synced to git. The app's own ID and secret come from the
// environment like every other secret (GOOGLE_CLIENT_ID / _SECRET).
//
// Every Google address is overridable, so the suites run against a mock.
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, chmodSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

const ACCOUNTS = () => process.env.GOOGLE_ACCOUNTS_BASE || 'https://accounts.google.com'
const OAUTH = () => process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com'
const API = () => process.env.GOOGLE_API_BASE || 'https://www.googleapis.com'
export const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export const SCOPES = [FILE_SCOPE, READ_SCOPE, 'openid', 'email']
const FOLDER = 'application/vnd.google-apps.folder'
export const ROOT_NAME = 'SATashkent Dashboard'
// A resumable piece must be a multiple of 256 KiB (the last one excepted).
export const CHUNK_DIRECT = 32 * 1024 * 1024
export const CHUNK_RELAY = 8 * 1024 * 1024

const clientId = () => process.env.GOOGLE_CLIENT_ID || ''
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || ''
export const tokenFile = () => process.env.GOOGLE_DRIVE_TOKEN_FILE || join(homedir(), '.satashkent', 'google-drive.json')

// Configured = the app has an identity with Google. Connected = somebody has
// also signed in and granted it a Drive.
export const driveConfigured = () => !!(clientId() && clientSecret())

export function readConnection() {
  try {
    const c = JSON.parse(readFileSync(tokenFile(), 'utf8'))
    return c && c.refresh_token && c.root_folder_id ? c : null
  } catch { return null }
}
export const driveConnected = () => driveConfigured() && !!readConnection()
// A connection made before drop-in has no list of scopes: it was drive.file.
export const canRead = (c) => !!c && Array.isArray(c.scopes) && c.scopes.includes(READ_SCOPE)

function writeConnection(c) {
  const f = tokenFile()
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  writeFileSync(f, JSON.stringify(c, null, 2), { mode: 0o600 })
  try { chmodSync(f, 0o600) } catch { /* Windows keeps its own ACLs */ }
}
function forgetConnection() {
  try { if (existsSync(tokenFile())) unlinkSync(tokenFile()) } catch { /* already gone */ }
  cached = null
}

// ---- signing in ----------------------------------------------------------------
export function consentUrl({ state, redirectUri }) {
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true', state,
  })
  return `${ACCOUNTS()}/o/oauth2/v2/auth?${q}`
}

const form = (o) => new URLSearchParams(o).toString()
async function tokenCall(params) {
  const r = await fetch(`${OAUTH()}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: clientId(), client_secret: clientSecret(), ...params }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || `Google refused the sign-in (${r.status})`)
    e.code = j.error
    throw e
  }
  return j
}
// The account's address, read from the ID token Google just handed over on a
// TLS connection this server opened — nothing to verify beyond reading it.
const emailOf = (idToken) => {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || '' } catch { return '' }
}

// The code from the consent screen → a refresh token, a root folder, and the
// file that remembers both. The folder is shared "anyone with the link can
// view", because a Drive link on this board has always been opened by people
// who are not signed in to this particular account.
//
// Connecting AGAIN (to grant drop-in its read scope) finds the root folder it
// made last time instead of making a second one: the task folders, and the
// files the Uploads page lists, are inside the old one.
export async function connect({ code, redirectUri, by }) {
  const t = await tokenCall({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  if (!t.refresh_token) throw new Error('Google did not hand over a lasting key — remove the app’s access in the Google account and connect again')
  cached = { token: t.access_token, rt: t.refresh_token, fresh: true, until: Date.now() + (Number(t.expires_in) || 3600) * 1000 - 60000 }
  const root = await findFolder(ROOT_NAME, 'root')
    || await gd('POST', '/drive/v3/files?fields=id,webViewLink', { name: ROOT_NAME, mimeType: FOLDER })
  await gd('POST', `/drive/v3/files/${root.id}/permissions`, { role: 'reader', type: 'anyone' }).catch(() => {})
  const c = {
    refresh_token: t.refresh_token, email: emailOf(t.id_token), root_folder_id: root.id,
    root_folder_url: root.webViewLink || `https://drive.google.com/drive/folders/${root.id}`,
    // What Google granted, not what was asked: either box can be unticked.
    scopes: String(t.scope || '').split(/\s+/).filter(Boolean),
    connected_at: new Date().toISOString(), connected_by: by || null,
  }
  writeConnection(c)
  if (cached) delete cached.fresh
  return c
}

export async function disconnect() {
  const c = readConnection()
  if (c?.refresh_token) {
    await fetch(`${OAUTH()}/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: c.refresh_token }),
    }).catch(() => {})
  }
  forgetConnection()
}

// ---- talking to Drive ----------------------------------------------------------
// Held against the key it came from: production can run two copies of this
// server, and the one that did not take the reconnect must not go on using an
// access token minted from the old key (with the old scopes) for an hour.
let cached = null // { token, rt, until }
async function accessToken() {
  const c = readConnection()
  // `fresh`: connect() itself, before the new key is written to the file.
  if (cached && cached.until > Date.now() && (cached.fresh || cached.rt === c?.refresh_token)) return cached.token
  if (!c) throw Object.assign(new Error('Google Drive isn’t connected — an admin connects it in Admin → Google Drive'), { status: 503 })
  try {
    const t = await tokenCall({ refresh_token: c.refresh_token, grant_type: 'refresh_token' })
    cached = { token: t.access_token, rt: c.refresh_token, until: Date.now() + (Number(t.expires_in) || 3600) * 1000 - 60000 }
    return cached.token
  } catch (e) {
    // Revoked in the Google account, or the password changed: the key is dead,
    // and saying "connected" any longer would be a lie.
    if (e.code === 'invalid_grant') forgetConnection()
    throw Object.assign(new Error('Google Drive has been disconnected — an admin connects it again in Admin → Google Drive'), { status: 503 })
  }
}

// An old "anyone with the link" file can need its resource key to be read.
const keyHeader = (id, key) => (key ? { 'X-Goog-Drive-Resource-Keys': `${id}/${key}` } : {})
async function gd(method, path, body, headers = {}) {
  const r = await fetch(`${API()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Google Drive answered ${r.status}`), { status: 502, gstatus: r.status })
  return j
}

// One folder per task, inside the root — found again by a private tag on it,
// so nothing has to be written into the database to remember it. Two uploads
// racing on a brand-new task share one lookup instead of making two folders.
const making = new Map()
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
// A folder by its name, inside a parent ('root' is the top of My Drive).
async function findFolder(name, parent) {
  const query = `mimeType='${FOLDER}' and trashed=false and name='${q(name)}' and '${q(parent)}' in parents`
  const r = await gd('GET', `/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,webViewLink)&pageSize=1`)
  return r.files?.[0] || null
}
const folderUrl = (f) => f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`
export function taskFolder(task) {
  if (making.has(task.id)) return making.get(task.id)
  const p = (async () => {
    const c = readConnection()
    const query = `mimeType='${FOLDER}' and trashed=false and '${q(c.root_folder_id)}' in parents`
      + ` and appProperties has { key='satashkent_task' and value='${q(task.id)}' }`
    const found = await gd('GET', `/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,webViewLink)&pageSize=1`)
    if (found.files?.[0]) return found.files[0]
    return gd('POST', '/drive/v3/files?fields=id,webViewLink', {
      name: `${String(task.title || 'Task').slice(0, 80)} · #${task.id}`, mimeType: FOLDER,
      parents: [c.root_folder_id], appProperties: { satashkent_task: String(task.id) },
    })
  })()
  making.set(task.id, p)
  p.finally(() => making.delete(task.id)).catch(() => {})
  return p
}

// Opens a resumable session for one file in the task's folder. `origin` is
// the page's own address: sent as the Origin of this request, it is what lets
// the browser feed the session directly.
export async function startSession({ folderId, name, size, mime, origin }) {
  const r = await fetch(`${API()}/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink,parents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime || 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  })
  const at = r.headers.get('location')
  if (!r.ok || !at) {
    const j = await r.json().catch(() => ({}))
    throw Object.assign(new Error(j.error?.message || `Google Drive would not start the upload (${r.status})`), { status: 502 })
  }
  return at
}

// Where a session has got to. 308 + "Range: bytes=0-N" means N+1 bytes are
// safe; no Range means none are; 200/201 means the file is whole.
const nextFrom = (r) => {
  const m = /bytes=0-(\d+)/.exec(r.headers.get('range') || '')
  return m ? Number(m[1]) + 1 : 0
}
export async function sessionStatus(session, total) {
  const r = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } })
  if (r.status === 200 || r.status === 201) return { done: true, file: await r.json(), next: total }
  if (r.status === 308) return { done: false, next: nextFrom(r) }
  throw Object.assign(new Error(`The upload session has expired (${r.status}) — start the upload again`), { status: 410 })
}
// One piece fed through this server, for networks where the browser cannot
// reach Google's upload address itself.
export async function relayPiece(session, buf, start, total) {
  const end = start + buf.length - 1
  const r = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end}/${total}` }, body: buf })
  if (r.status === 200 || r.status === 201) return { done: true, file: await r.json(), next: total }
  if (r.status === 308) return { done: false, next: nextFrom(r) }
  throw Object.assign(new Error(`Google Drive refused a piece of the file (${r.status})`), { status: 502 })
}

// Into the Drive's bin, not gone: Google keeps it there thirty days, so a
// file deleted by mistake is brought back from the Drive itself. The board
// may only bin what it put there (drive.file).
export const trashFile = (id) => gd('PATCH', `/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { trashed: true })
export const fileInfo = (id) =>
  gd('GET', `/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,size,mimeType,webViewLink,parents,trashed`)

// ---- what is already there ------------------------------------------------------
// Every file this app has put in the Drive, grouped by the task whose folder
// it sits in: the task folders (each carries its task id as a private tag),
// then the files inside them, forty folders a call. Asked folder by folder
// because the connection can now read the whole Drive (drop-in's read
// scope), and "every file I can see" would be every file in the account.
// Pages of a thousand; a board with more files than that has more pages.
async function listAll(query, fields) {
  const out = []
  let page = ''
  do {
    const r = await gd('GET', `/drive/v3/files?q=${encodeURIComponent(query)}&pageSize=1000&fields=nextPageToken,files(${fields})${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`)
    out.push(...(r.files || []))
    page = r.nextPageToken || ''
  } while (page)
  return out
}
export async function filesByTask() {
  const c = readConnection()
  if (!c) return {}
  const folders = await listAll(
    `mimeType='${FOLDER}' and trashed=false and '${q(c.root_folder_id)}' in parents`, 'id,appProperties')
  const taskOf = new Map(folders.map((f) => [f.id, Number(f.appProperties?.satashkent_task)]).filter(([, t]) => t))
  const ids = [...taskOf.keys()]
  const files = []
  for (let i = 0; i < ids.length; i += 40) {
    const within = ids.slice(i, i + 40).map((id) => `'${q(id)}' in parents`).join(' or ')
    files.push(...await listAll(`mimeType!='${FOLDER}' and trashed=false and (${within})`,
      'id,name,size,mimeType,webViewLink,createdTime,parents,hasThumbnail,videoMediaMetadata(durationMillis)'))
  }
  const out = {}
  for (const f of files) {
    const task = (f.parents || []).map((p) => taskOf.get(p)).find(Boolean)
    if (!task) continue
    ;(out[task] = out[task] || []).push({
      id: f.id, name: f.name, size: Number(f.size) || 0, mime: f.mimeType || '',
      link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, at: f.createdTime || null,
      has_thumb: f.hasThumbnail ? 1 : 0, duration_ms: Number(f.videoMediaMetadata?.durationMillis) || null,
    })
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return out
}

// How full the Drive is. A free Google account holds 15 GB for everything in
// it, and one raw shoot can be most of that — so the page says so before a
// forty-minute upload finds out the hard way.
export async function storageQuota() {
  const r = await gd('GET', '/drive/v3/about?fields=storageQuota')
  const s = r.storageQuota || {}
  return { limit: s.limit ? Number(s.limit) : null, usage: Number(s.usage) || 0 }
}

// ---- drop-in: the three folders people drop files into ---------------------
// One parent folder in the connected account's My Drive with Recording, Pravka
// and Ready inside, found again by name when they already exist (connecting
// twice must not make a second set). They are not shared from here: whoever
// drops files needs edit access, and that is given once, in Drive, by a person.
export const DROP_ROOT = 'SATashkent Marketing drop'
export const DROP_SUBS = { recording: 'Recording', pravka: 'Pravka', ready: 'Ready' }
export async function makeDropFolders() {
  const parent = await findFolder(DROP_ROOT, 'root')
    || await gd('POST', '/drive/v3/files?fields=id,webViewLink', { name: DROP_ROOT, mimeType: FOLDER })
  const out = { parent: { id: parent.id, url: folderUrl(parent) } }
  for (const [key, name] of Object.entries(DROP_SUBS)) {
    const f = await findFolder(name, parent.id)
      || await gd('POST', '/drive/v3/files?fields=id,webViewLink', { name, mimeType: FOLDER, parents: [parent.id] })
    out[key] = { id: f.id, url: folderUrl(f) }
  }
  return out
}

// Everything in one folder that is not in the bin and not a folder, every
// page of it. What a file is, as much as drop-in keeps: no bytes.
const DROP_FIELDS = 'id,name,size,mimeType,webViewLink,createdTime,hasThumbnail,videoMediaMetadata(durationMillis)'
export const shapeDrop = (f) => ({
  id: f.id, name: f.name || '', size: Number(f.size) || 0, mime: f.mimeType || '',
  link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
  duration_ms: Number(f.videoMediaMetadata?.durationMillis) || null,
  has_thumb: f.hasThumbnail ? 1 : 0, at: f.createdTime || null,
})
export async function folderFiles(folderId) {
  return (await listAll(`'${q(folderId)}' in parents and trashed=false and mimeType!='${FOLDER}'`, DROP_FIELDS)).map(shapeDrop)
}

// A preview, fetched fresh each time: a thumbnailLink lives for a few hours,
// so it is asked for when the picture is, and the picture is fetched with the
// key (a private file's thumbnail is private too). The key goes only to
// Google's own hosts, or to the address the suites point the API at.
const trusted = (url) => {
  try {
    const h = new URL(url).hostname
    return /(^|\.)(googleusercontent|googleapis|google)\.com$/.test(h) || new URL(url).origin === new URL(API()).origin
  } catch { return false }
}
export async function thumbnail(fileId, key = null) {
  const f = await gd('GET', `/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(DROP_FIELDS + ',thumbnailLink,trashed')}`, null, keyHeader(fileId, key))
  if (!f.thumbnailLink || !trusted(f.thumbnailLink)) return { file: shapeDrop(f), bytes: null }
  const r = await fetch(f.thumbnailLink.replace(/=s\d+$/, '=s480'), { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (!r.ok) return { file: shapeDrop(f), bytes: null }
  return { file: shapeDrop(f), bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' }
}

// ---- any file the team account can read: what it is, and its bytes ----------
// A link pasted on a task long before drop-in (a cut in somebody's Drive,
// shared by link) is read the same way as the team's own files: what it is,
// and — for the player and Download — its bytes, streamed through this server
// in the range the browser asks for. Nothing is kept on disk.
export const metaOf = (id, key = null) =>
  gd('GET', `/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${encodeURIComponent(DROP_FIELDS + ',trashed')}`, null, keyHeader(id, key))
export async function openMedia(id, { range, key, signal } = {}) {
  return fetch(`${API()}/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
    signal,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(range ? { Range: range } : {}), ...keyHeader(id, key) },
  })
}
// Is a name already taken in a folder? (A second upload of the same task's
// file gets " (2)", not a twin nobody can tell apart.)
export async function nameTaken(folderId, name) {
  const query = `'${q(folderId)}' in parents and trashed=false and name='${q(name)}'`
  return !!(await gd('GET', `/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`)).files?.length
}
export const FOLDER_MIME = FOLDER

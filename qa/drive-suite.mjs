// Google Drive uploads, end to end against a mock Google (qa/mock-gdrive.mjs).
//
// CONNECTING. Only an admin of the whole board starts it; the way back from
// Google's consent screen is proved by a signed state, not a session; what
// Google hands over is written to a file of its own — readable by the app
// alone, outside DATA_DIR (whose database is synced to git) and outside the
// repository — and the team's folder is made and shared view-by-link.
//
// UPLOADING. The person on the job (or the channel's planners) opens a
// session for one file; the browser feeds it straight to Google, or through
// /api/drive in 8 MB pieces where it cannot; a dropped piece is resumed from
// the last byte Google kept; and "finish" hands back the link only for a file
// that really is in that task's folder. A ticket is signed, and only its
// owner may use it.
//
// Boots its own instance on :4097 and the mock on :9988.
//
//   node qa/drive-suite.mjs
import { spawn } from 'child_process'
import { existsSync, readFileSync, rmSync, statSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startMockDrive } from './mock-gdrive.mjs'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const PORT = 4097
const BASE = `http://localhost:${PORT}`
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const dir = join(tmpdir(), `drive-suite-${process.pid}`)
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'data'), { recursive: true })
const TOKEN_FILE = join(dir, 'secrets', 'google-drive.json')

const mock = await startMockDrive(9988)
const child = spawn('node', ['server/index.js'], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    PORT: String(PORT), DATA_DIR: join(dir, 'data'), JWT_SECRET: 'drive-suite-secret',
    GOOGLE_CLIENT_ID: 'mock-client', GOOGLE_CLIENT_SECRET: 'mock-secret',
    GOOGLE_ACCOUNTS_BASE: mock.base, GOOGLE_OAUTH_BASE: mock.base, GOOGLE_API_BASE: mock.base,
    GOOGLE_DRIVE_TOKEN_FILE: TOKEN_FILE, PUBLIC_URL: BASE,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let said = ''
child.stdout.on('data', (d) => { said += d })
child.stderr.on('data', (d) => { said += d })
const bye = (code) => { child.kill(); mock.close(); rmSync(dir, { recursive: true, force: true }); process.exit(code) }
try {
  await new Promise((resolve, reject) => {
    const t = setInterval(() => { if (said.includes('API listening')) { clearInterval(t); resolve() } }, 100)
    child.on('exit', (c) => reject(new Error(`instance exited ${c}: ${said.slice(-400)}`)))
    setTimeout(() => reject(new Error(`instance start timeout: ${said.slice(-400)}`)), 20000)
  })
} catch (e) { console.log('✘ FAIL', e.message); bye(1) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const req = async (p, m = 'GET', b, t, extra = {}) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const state = async () => (await fetch(`${mock.base}/__state`)).json()
const A = await login('admin', 'admin123')
const CH = 'instagram_main'
const sfx = Date.now().toString(36).slice(-5)
const mk = async (b) => (await req('/users', 'POST', { password: 'pw123456', ...b }, A)).data
const smm = await mk({ name: 'Dilnoza Smm', username: 'ds' + sfx, role: 'member', departments: [CH], permissions: { manage_content: true } })
const ed = await mk({ name: 'Eldor Cuts', username: 'de' + sfx, role: 'editor' })
const other = await mk({ name: 'Ozod Elsewhere', username: 'do' + sfx, role: 'editor' })
const [ST, ET, OT] = [await login('ds' + sfx, 'pw123456'), await login('de' + sfx, 'pw123456'), await login('do' + sfx, 'pw123456')]
const task = (await req('/content', 'POST', { title: 'Drive: results reel', channels: [CH], type: 'reel', editor_id: ed.id }, A)).data
const task2 = (await req('/content', 'POST', { title: 'Drive: second reel', channels: [CH], type: 'reel', editor_id: ed.id }, A)).data
ok('(a task with an editor on it)', !!task.id && !!ed.id && !!ET)

// ===================== connecting =====================
let s = (await req('/drive/status', 'GET', null, A)).data
ok('before anybody signs in: configured, not connected', s.configured === true && s.connected === false, JSON.stringify(s))
ok('…and the admin is shown the exact address to register with Google', s.redirect_uri === `${BASE}/api/drive/callback`, s.redirect_uri)
ok('only an admin of the whole board may start connecting', (await req('/drive/connect', 'POST', {}, ST)).status === 403)
const c = await req('/drive/connect', 'POST', {}, A)
const url = new URL(c.data.url || 'http://x')
ok('Connect sends the admin to Google\'s own sign-in page', c.status === 200 && url.origin === mock.base && url.pathname === '/o/oauth2/v2/auth')
ok('…asking to write only the files this app makes (drive.file), and to READ the rest — the drop-in folders (drive.readonly)',
  url.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly openid email', url.searchParams.get('scope'))
ok('…for a lasting key', url.searchParams.get('access_type') === 'offline' && url.searchParams.get('prompt') === 'consent')
const forged = await fetch(`${BASE}/api/drive/callback?code=mock-code&state=not-a-real-state`, { redirect: 'manual' })
ok('a way back from Google that this board did not start is refused', forged.status === 400, String(forged.status))
ok('…and connects nothing', !existsSync(TOKEN_FILE))
const g = await fetch(url, { redirect: 'manual' })
const back = await fetch(g.headers.get('location'), { redirect: 'manual' })
ok('signing in lands back on Admin → Google Drive, connected', back.status === 302 && /\/admin\?tab=drive&drive=connected$/.test(back.headers.get('location') || ''),
  `${back.status} ${back.headers.get('location')}`)
ok('the key is written to a file of its own', existsSync(TOKEN_FILE) && !!JSON.parse(readFileSync(TOKEN_FILE, 'utf8')).refresh_token)
ok('…not inside DATA_DIR, whose database is synced to git', !TOKEN_FILE.startsWith(join(dir, 'data')))
if (process.platform !== 'win32') ok('…readable by the app alone', (statSync(TOKEN_FILE).mode & 0o077) === 0, (statSync(TOKEN_FILE).mode & 0o777).toString(8))
s = (await req('/drive/status', 'GET', null, A)).data
ok('the admin sees which account and the folder', s.connected && s.email === 'satashkent.test@gmail.com' && /folders\//.test(s.folder_url || ''), JSON.stringify(s))
const ms = (await req('/drive/status', 'GET', null, ET)).data
ok('everybody else is told only that uploading works', ms.connected === true && ms.email === undefined && ms.folder_url === undefined)
let st = await state()
const root = st.folders.find((f) => f.name === 'SATashkent Dashboard')
ok('the team folder is made', !!root)
ok('…and viewable by anyone with a link, as Drive links on this board always were',
  st.permissions.some((p) => p.file === root?.id && p.type === 'anyone' && p.role === 'reader'))

// ===================== uploading =====================
const MB = 1024 * 1024
const ORIGIN = BASE
const open = (t, id, body, token = ET) => req(`/drive/tasks/${id}/uploads`, 'POST', body, token, { Origin: ORIGIN })
ok('somebody not on the job may not upload to it', (await open(null, task.id, { kind: 'edit', name: 'x.mp4', size: 10 }, OT)).status === 403)
ok('a job the task does not have is refused', (await open(null, task.id, { kind: 'nonsense', name: 'x.mp4', size: 10 })).status === 400)
ok('an empty file is refused', (await open(null, task.id, { kind: 'edit', name: 'x.mp4', size: 0 })).status === 400)
const u1 = await open(null, task.id, { kind: 'edit', name: 'results cut.mp4', size: 20 * MB, mime: 'video/mp4' })
ok('the editor on the task opens an upload', u1.status === 201 && !!u1.data.ticket && u1.data.session_url?.startsWith(mock.base), `${u1.status} ${u1.data.error || ''}`)
ok('…in 32 MB pieces straight to Google, 8 MB through here', u1.data.chunk === 32 * MB && u1.data.relay_chunk === 8 * MB)
const pre = await fetch(u1.data.session_url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT' } })
ok('the session answers this page\'s browser across sites', pre.headers.get('access-control-allow-origin') === ORIGIN)
const bytes = Buffer.alloc(20 * MB, 7)
const put = (urlS, a, b) => fetch(urlS, { method: 'PUT', headers: { 'Content-Range': `bytes ${a}-${b - 1}/${bytes.length}` }, body: bytes.subarray(a, b) })
const p1 = await put(u1.data.session_url, 0, 16 * MB)
ok('a piece goes straight to Google, which says how far it has got', p1.status === 308 && p1.headers.get('range') === `bytes=0-${16 * MB - 1}`)
const p2 = await put(u1.data.session_url, 16 * MB, 20 * MB)
const f1 = await p2.json()
ok('…and the last piece makes the file', p2.status === 201 && !!f1.id)
const fin = await req('/drive/uploads/finish', 'POST', { ticket: u1.data.ticket, file_id: f1.id }, ET)
ok('"finish" hands back the file\'s Drive link for the box', fin.status === 200 && fin.data.link === `https://drive.google.com/file/d/${f1.id}/view`, `${fin.status} ${fin.data.error || ''}`)
ok('…naming the column it belongs in', fin.data.column === 'ready_link')
st = await state()
const folder = st.folders.find((f) => f.appProperties?.satashkent_task === String(task.id))
ok('the file sits in a folder of the task\'s own, inside the team folder', !!folder && folder.parents.includes(root.id) && st.files.find((f) => f.id === f1.id)?.parents.includes(folder.id))
const full = (await req(`/content/${task.id}`, 'GET', null, A)).data
ok('the upload is on the task\'s history', (full.activity || []).some((a) => /results cut\.mp4 \(Google Drive\)/.test(a.new_value || '')))

// the long way round: through /api/drive, in 8 MB pieces
const u2 = await open(null, task.id, { kind: 'edit', name: 'relay cut.mov', size: 9 * MB })
const relay = (ticket, a, b, buf = bytes, token = ET) => fetch(`${BASE}/api/drive/uploads/piece`, {
  method: 'PUT', body: buf.subarray(a, b),
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Upload-Ticket': ticket, 'X-Upload-Offset': String(a) },
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
const r1 = await relay(u2.data.ticket, 0, 8 * MB, bytes.subarray(0, 9 * MB))
ok('where the browser cannot reach Google, a piece goes through here', r1.status === 200 && r1.data.done === false && r1.data.next === 8 * MB, JSON.stringify(r1.data))
const r2 = await relay(u2.data.ticket, 8 * MB, 9 * MB, bytes.subarray(0, 9 * MB))
ok('…and the file is the same file', r2.data.done === true && !!r2.data.file?.id)
st = await state()
ok('the second upload on the task uses the same folder', st.folders.filter((f) => f.appProperties?.satashkent_task === String(task.id)).length === 1)
ok('a piece that does not fit the file is refused', (await relay(u2.data.ticket, 8 * MB, 10 * MB, bytes)).status === 400)

// a dropped piece, resumed
const u3 = await open(null, task.id, { kind: 'edit', name: 'flaky cut.mp4', size: 17 * MB })
const buf3 = bytes.subarray(0, 17 * MB)
await relay(u3.data.ticket, 0, 8 * MB, buf3)
const lost = await relay(u3.data.ticket, 8 * MB, 16 * MB, buf3)
ok('a piece lost on the way is said, not swallowed', lost.status === 502, String(lost.status))
const where = await req('/drive/uploads/status', 'GET', null, ET, { 'X-Upload-Ticket': u3.data.ticket })
ok('…and the upload knows where it stopped', where.status === 200 && where.data.next === 8 * MB, JSON.stringify(where.data))
await relay(u3.data.ticket, 8 * MB, 16 * MB, buf3)
const done3 = await relay(u3.data.ticket, 16 * MB, 17 * MB, buf3)
ok('…so it carries on from there instead of starting again', done3.data.done === true)

// tickets
ok('somebody else\'s ticket is refused', (await req('/drive/uploads/status', 'GET', null, OT, { 'X-Upload-Ticket': u3.data.ticket })).status === 403)
ok('a made-up ticket is refused', (await req('/drive/uploads/finish', 'POST', { ticket: 'x.y.z', file_id: f1.id }, ET)).status === 403)
const u4 = await open(null, task2.id, { kind: 'edit', name: 'other.mp4', size: 1 * MB })
ok('"finish" will not hand over a file from another task\'s folder', (await req('/drive/uploads/finish', 'POST', { ticket: u4.data.ticket, file_id: f1.id }, ET)).status === 400)
const byPlanner = await open(null, task2.id, { kind: 'shoot', name: 'raw.mp4', size: 1 * MB }, ST)
ok('the channel\'s planner may upload footage to it', byPlanner.status === 201, `${byPlanner.status} ${byPlanner.data.error || ''}`)

// ===================== what is there, and how much room =====================
const listed = await req(`/drive/files?tasks=${task.id},${task2.id}`, 'GET', null, ET)
const onTask = listed.data.files?.[task.id] || []
ok('the Uploads page gets every task\'s files, under the task, in one call', listed.status === 200
  && onTask.some((f) => f.id === f1.id && f.size === 20 * MB && /\/file\/d\//.test(f.link)), JSON.stringify(listed.data).slice(0, 200))
ok('…all three uploads on it, the newest first', onTask.length === 3 && onTask[0].at >= onTask[2].at, JSON.stringify(onTask.map((f) => f.name)))
const yt = await mk({ name: 'Yulduz Elsewhere', username: 'dy' + sfx, role: 'member', departments: ['youtube'], permissions: { manage_content: true } })
const YT = await login('dy' + sfx, 'pw123456')
ok('somebody who does not work on a task is not shown its files',
  !!yt.id && Object.keys((await req(`/drive/files?tasks=${task.id}`, 'GET', null, YT)).data.files || {}).length === 0)
ok('…the channel\'s planner is, to watch them', ((await req(`/drive/files?tasks=${task.id}`, 'GET', null, ST)).data.files?.[task.id] || []).length === 3)
const room = (await req('/drive/status', 'GET', null, ET)).data.quota
ok('everybody who uploads is told how full the Drive is', room && room.limit === 15 * 1024 ** 3 && room.usage >= 20 * MB, JSON.stringify(room))
// Shrink the Drive to just past what is in it, land one small file (which
// drops the remembered quota), and ask for room it has not got.
await fetch(`${mock.base}/__limit?bytes=${room.usage + 3 * MB}`, { method: 'POST' })
const tiny = await open(null, task2.id, { kind: 'edit', name: 'tiny.mp4', size: 1 * MB })
const tb = Buffer.alloc(MB, 1)
const tf = await (await fetch(tiny.data.session_url, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${MB - 1}/${MB}` }, body: tb })).json()
await req('/drive/uploads/finish', 'POST', { ticket: tiny.data.ticket, file_id: tf.id }, ET)
const tooBig = await open(null, task2.id, { kind: 'edit', name: 'too big.mp4', size: 10 * MB })
ok('a file bigger than the room left is refused before the first byte, saying how much there is', tooBig.status === 507 && /free/.test(tooBig.data.error || ''), `${tooBig.status} ${tooBig.data.error || ''}`)
await fetch(`${mock.base}/__limit?bytes=${15 * 1024 ** 3}`, { method: 'POST' })

// ===================== disconnecting =====================
ok('only an admin of the whole board may disconnect', (await req('/drive/disconnect', 'POST', {}, ST)).status === 403)
await req('/drive/disconnect', 'POST', {}, A)
st = await state()
ok('disconnecting gives the key back to Google', st.revoked.length === 1)
ok('…and forgets it here', !existsSync(TOKEN_FILE))
ok('…so the upload button is no longer offered', (await req('/drive/status', 'GET', null, ET)).data.connected === false)
ok('…and an upload says why', (await open(null, task.id, { kind: 'edit', name: 'late.mp4', size: 10 })).status === 503)

// ===================== the pages and the deploy =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const hand = src('client/src/components/HandIn.jsx')
ok('the hand-in offers "Upload to Google Drive" once it is connected', /startUpload\(/.test(hand) && /tx\('Upload to Google Drive'\)/.test(hand) && /\/drive\/status/.test(hand))
ok('…and closing it does not stop the upload', /Still uploading — follow it under Uploads/.test(hand) && !/The upload will stop/.test(hand))
const page = src('client/src/pages/Uploads.jsx')
ok('Uploads: one box to drop anything on, then pick its task', /Drop a file here/.test(page) && /Which task is «\{name\}» for\?/.test(page))
ok('…or drop it straight on the task', /dropProps\(t\.id, \(f\) => send\(t, f\)\)/.test(page))
ok('…every task\'s files listed under it, in one call', /\/drive\/files\?tasks=/.test(page))
ok('…and played right there, in Google\'s own player', /drive\.google\.com\/file\/d\/\$\{preview\.file\.id\}\/preview/.test(page) && /<iframe/.test(page))
ok('…with the Drive\'s free space said up top', /status\.quota/.test(page) && /free of/.test(page))
ok('…and "hand in this one" beside a file that is yours', /Hand in this one/.test(page) && /milestone: job\.milestone/.test(page))
const store = src('client/src/lib/uploads.js')
ok('an upload belongs to the tab, not the page: it keeps going across the board', /export function startUpload/.test(store) && /useSyncExternalStore/.test(store) && /beforeunload/.test(store))
ok('dropping the same file on the same task again carries on where Google stopped', /satashkent_upload:/.test(src('client/src/lib/driveUpload.js')) && /askWhere\(s\.ticket/.test(src('client/src/lib/driveUpload.js')))
ok('the menu offers Uploads, with how far the uploads have got', /key: 'uploads', to: '\/uploads'/.test(src('client/src/components/Sidebar.jsx'))
  && /nav-badge/.test(src('client/src/components/Sidebar.jsx')) && /to="\/uploads"/.test(src('client/src/components/Layout.jsx')))
ok('…with a progress bar, and the link filling the box', /role="progressbar"/.test(hand) && /setValue\(((\(v\) => )?v \|\| )?out\.link\)/.test(hand))
const lib = src('client/src/lib/driveUpload.js')
ok('the browser feeds Google itself, and goes the long way round only if it must', /x\.upload\.onprogress/.test(lib) && /\/api\/drive\/uploads\/piece/.test(lib) && /\/api\/drive\/uploads\/status/.test(lib))
const drive = src('server/drive.js')
ok('the app writes with drive.file and never asks for the whole Drive to write in', /auth\/drive\.file'/.test(drive) && /auth\/drive\.readonly'/.test(drive) && !/auth\/drive'/.test(drive))
const deploy = src('.github/workflows/deploy.yml')
ok('the deploy carries the app\'s identity and never a user\'s key',
  /GOOGLE_CLIENT_ID=\$GOOGLE_ID/.test(deploy) && /GOOGLE_CLIENT_SECRET=\$GOOGLE_SECRET/.test(deploy) && !/REFRESH/i.test(deploy))
ok('Admin has a Google Drive tab', /key: 'drive', label: 'Google Drive'/.test(src('client/src/pages/Admin.jsx')))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
bye(fails ? 1 : 0)

// Drive drop-in, end to end against the mock Google (qa/mock-gdrive.mjs).
//
// THE NAME. Every task offers "Copy file name": its title, without what a
// file name cannot hold, and #<id>; and the folder its stage sends files to,
// decided by the server.
//
// THE WATCHER. Files somebody drops into the three Drive folders find their
// task: the last #id in the name first, else a title held by exactly one open
// task, else Unmatched for an admin to attach by hand. The folder says what
// the file is (Recording footage, Pravka a fix, Ready the final), and nothing
// moves the stage. It stays off without the read scope, and with two server
// copies watching the same folders a file is attached — and rung — once.
//
// THE PREVIEW goes through a sign-in route, and /privacy is open to all.
//
// Boots two instances on :4141 and :4142 sharing one database, and the mock
// on :9974.
//
//   node qa/drive-drop-suite.mjs
import { spawn } from 'child_process'
import { rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startMockDrive } from './mock-gdrive.mjs'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const BASE = 'http://localhost:4141'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = join(tmpdir(), `drive-drop-suite-${process.pid}`)
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'data'), { recursive: true })
const mock = await startMockDrive(9974)
const kids = []
const boot = (port, extra = {}) => new Promise((resolve, reject) => {
  const child = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
      PORT: String(port), DATA_DIR: join(dir, 'data'), JWT_SECRET: 'drive-drop-suite-secret',
      GOOGLE_CLIENT_ID: 'mock-client', GOOGLE_CLIENT_SECRET: 'mock-secret',
      GOOGLE_ACCOUNTS_BASE: mock.base, GOOGLE_OAUTH_BASE: mock.base, GOOGLE_API_BASE: mock.base,
      GOOGLE_DRIVE_TOKEN_FILE: join(dir, 'secrets', 'google-drive.json'), PUBLIC_URL: BASE,
      DRIVE_WATCH_MS: '400', ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  kids.push(child)
  let said = ''
  child.stdout.on('data', (d) => { said += d; if (said.includes('API listening')) resolve(child) })
  child.stderr.on('data', (d) => { said += d; if (process.env.SUITE_LOGS) process.stderr.write(`[${port}] ${d}`) })
  child.on('exit', (c) => reject(new Error(`instance on ${port} exited ${c}: ${said.slice(-400)}`)))
  setTimeout(() => reject(new Error(`instance on ${port} did not start: ${said.slice(-400)}`)), 30000)
})
const bye = (code) => { for (const k of kids) k.kill(); mock.close(); setTimeout(() => { rmSync(dir, { recursive: true, force: true }); process.exit(code) }, 500) }
try { await boot(4141) } catch (e) { console.log('✘ FAIL', e.message); bye(1) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const req = async (p, m = 'GET', b, t, base = BASE) => {
  const r = await fetch(base + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }
}
const mockPost = (p, body) => fetch(`${mock.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const state = async () => (await fetch(`${mock.base}/__state`)).json()
const connectDrive = async (token) => {
  const c = await req('/drive/connect', 'POST', {}, token)
  const g = await fetch(c.data.url, { redirect: 'manual' })
  return fetch(g.headers.get('location'), { redirect: 'manual' })
}

// ===================== the privacy page =====================
const pv = await fetch(BASE + '/privacy')
const html = await pv.text()
ok('/privacy opens without signing in', pv.status === 200 && /text\/html/.test(pv.headers.get('content-type') || ''), String(pv.status))
ok('…as plain HTML, no script needed', !/<script/i.test(html) && /<h1>Privacy policy<\/h1>/.test(html))
ok('…says who runs it and how to reach them', /SATashkent marketing team/.test(html) && /satashkentmarketing@gmail\.com/.test(html))
ok('…which Google data, and that the files stay in Drive', /drive\.file/.test(html) && /drive\.readonly/.test(html) && /files themselves stay in Google Drive/.test(html))
ok('…the Limited Use statement, word for word', /adhere to the <a href="https:\/\/developers\.google\.com\/terms\/api-services-user-data-policy">Google API Services User Data Policy<\/a>, including the Limited Use requirements/.test(html))
ok('…no selling, no ads, and how to revoke', /do not sell/.test(html) && /advertising/.test(html) && /Third-party/.test(html) && /Disconnect/.test(html))
ok('the login page links to it', /href="\/privacy"/.test((await import('fs')).readFileSync(join(ROOT, 'client/src/pages/Login.jsx'), 'utf8')))

// ===================== people and tasks =====================
const A = await login('admin', 'admin123')
const CH = 'instagram_main'
const sfx = Date.now().toString(36).slice(-5)
const mk = async (b) => (await req('/users', 'POST', { password: 'pw123456', ...b }, A)).data
const maker = await mk({ name: 'Dilnoza Maker', username: 'dm' + sfx, role: 'member', departments: [CH], permissions: { manage_content: true } })
const ed = await mk({ name: 'Eldor Cuts', username: 'de' + sfx, role: 'editor' })
const stranger = await mk({ name: 'Ozod Elsewhere', username: 'do' + sfx, role: 'editor' })
const [MT, ET, OT] = [await login('dm' + sfx, 'pw123456'), await login('de' + sfx, 'pw123456'), await login('do' + sfx, 'pw123456')]
const task = async (title, type = 'reel') => (await req('/content', 'POST', { title, channels: [CH], type, editor_id: ed.id, assignee_id: maker.id, assignees: [maker.id] }, A)).data
const tA = await task('Drop: results reel')
const tB = await task('Drop: unique title')
const tC1 = await task('Drop: twin title')
const tC2 = await task('Drop: twin title')
const tD = await task('Bad / name: "x"?* <here> |', 'post')
const full = async (id, t = A) => (await req(`/content/${id}`, 'GET', null, t)).data

// ===================== the name to give a file =====================
let a = await full(tA.id)
ok('every task carries the name to give its file: the title and #id', a.drop?.file_name === `Drop results reel #${tA.id}`, a.drop?.file_name)
ok('…a video not filmed yet goes to Recording', a.drop?.folder === 'recording' && a.drop?.folder_name === 'Recording', JSON.stringify(a.drop))
const d = await full(tD.id)
ok('what a file name cannot hold is taken out, and the spaces with it', d.drop?.file_name === `Bad name x here #${tD.id}`, d.drop?.file_name)
ok('…a post, with nothing to film, goes to Ready', d.drop?.folder === 'ready', d.drop?.folder)

// ===================== off until it may read =====================
let s = (await req('/drive/status', 'GET', null, A)).data
ok('before connecting, drop-in is off, and says so', s.drop?.on === false && s.drop?.reason === 'disconnected', JSON.stringify(s.drop))
await mockPost(`/__grant?scopes=${encodeURIComponent('https://www.googleapis.com/auth/drive.file openid email')}`)
let back = await connectDrive(A)
ok('connecting with the read box unticked still connects', /drive=connected$/.test(back.headers.get('location') || ''), back.headers.get('location'))
s = (await req('/drive/status', 'GET', null, A)).data
ok('…but drop-in stays off, asking for a reconnect', s.connected && s.can_read === false && s.drop?.on === false && s.drop?.reason === 'reconnect', JSON.stringify(s.drop))
ok('…and the three folders are made already', !!(s.drop_folders?.recording?.id && s.drop_folders?.pravka?.id && s.drop_folders?.ready?.id && s.drop_folders?.parent?.url))
const F = s.drop_folders
let st = await state()
ok('…named for the team, inside one parent', st.folders.filter((f) => f.name === 'SATashkent Marketing drop').length === 1
  && ['Recording', 'Pravka', 'Ready'].every((n) => st.folders.some((f) => f.name === n && f.parents.includes(F.parent.id))))
const early = await mockPost('/__drop', { parent: F.ready.id, name: `Drop results reel #${tA.id}.mp4`, mimeType: 'video/mp4', size: 5000 })
await wait(1500)
ok('a file dropped meanwhile is left alone: no read scope, no watching', (await full(tA.id)).drive_drops?.length === 0
  && (await req('/drive/drops/unmatched', 'GET', null, A)).data.files?.length === 0)

await mockPost('/__grant?scopes=')
back = await connectDrive(A)
s = (await req('/drive/status', 'GET', null, A)).data
ok('reconnected with both boxes: drop-in is on', s.can_read === true && s.drop?.on === true, JSON.stringify(s.drop))
st = await state()
ok('…finding the same folders, not making a second set', st.folders.filter((f) => f.name === 'SATashkent Marketing drop').length === 1
  && st.folders.filter((f) => f.name === 'Ready').length === 1 && s.drop_folders.ready.id === F.ready.id)
ok('…and the same team folder the uploads live in', st.folders.filter((f) => f.name === 'SATashkent Dashboard').length === 1)
ok('a member is told whether drop-in is on, not where the folders are', (await req('/drive/status', 'GET', null, MT)).data.drop?.on === true
  && (await req('/drive/status', 'GET', null, MT)).data.drop_folders === undefined)

await wait(1500)
a = await full(tA.id)
const first = a.drive_drops?.find((x) => x.name === early.name)
ok('now the waiting file is picked up, by the #id in its name', !!first && first.matched_by === 'id', JSON.stringify(a.drive_drops))
ok('…as the final file, since it was dropped in Ready', first?.kind === 'final' && first?.folder === 'ready')
ok('…with what Drive says of it, and none of its bytes', first?.size === 5000 && first?.mime === 'video/mp4' && /drive\.google\.com\/file\/d\//.test(first?.link || ''))

// ===================== two watchers, many files =====================
let second
try { second = await boot(4142) } catch (e) { console.log('✘ FAIL', e.message); bye(1) }
await mockPost('/__page?size=2') // every listing comes two files a page
await req(`/content/${tB.id}/revisions`, 'POST', { note: 'The music is too loud at the start' }, A)
const beforeA = (await full(tA.id)).status_id
const drops = [
  { parent: F.recording.id, name: 'Drop: unique title.MOV', mimeType: 'video/quicktime' },
  { parent: F.pravka.id, name: `fixed music #${tB.id}.mp4` },
  { parent: F.ready.id, name: `Old #${tC1.id} then #${tA.id}.mp4` },
  { parent: F.ready.id, name: '  Drop: twin title  .mp4' },
  { parent: F.ready.id, name: 'nonsense.png', mimeType: 'image/png', thumb: true },
  ...Array.from({ length: 8 }, (_, i) => ({ parent: F.recording.id, name: `take ${i + 1} #${tA.id}.mp4` })),
]
const made = []
for (const x of drops) made.push(await mockPost('/__drop', x))
await wait(3500)

a = await full(tA.id)
const b = await full(tB.id)
const um = (await req('/drive/drops/unmatched', 'GET', null, A)).data.files || []
const all = [...(a.drive_drops || []), ...(b.drive_drops || []), ...((await full(tC1.id)).drive_drops || []), ...((await full(tC2.id)).drive_drops || []), ...um]
const once = made.every((m) => all.filter((x) => x.name === m.name).length === 1)
ok('with two server copies watching, every file is on the board exactly once', once && all.length === made.length + 1,
  `${all.length} rows for ${made.length + 1} files`)
const bell = (await req('/notifications', 'GET', null, MT)).data.events || []
const rung = made.filter((m) => !/twin|nonsense/.test(m.name)).map((m) => bell.filter((e) => e.text.includes(`«${m.name}»`)).length)
ok('…and the owner\'s bell rang once a file, never twice', rung.every((n) => n === 1), JSON.stringify(rung))
ok('…in the bell, not on Telegram', bell.some((e) => e.kind === 'comment' && /^Google Drive: «/.test(e.text) && e.content_id === tA.id))
ok('every page of a listing was read (two files a page)', a.drive_drops.filter((x) => /^take \d/.test(x.name)).length === 8)

const byTitle = b.drive_drops?.find((x) => x.name === 'Drop: unique title.MOV')
ok('no #id: a title held by one open task is that task', byTitle?.matched_by === 'title', JSON.stringify(byTitle))
ok('…and Recording makes it footage', byTitle?.kind === 'footage')
const fix = b.drive_drops?.find((x) => x.folder === 'pravka')
ok('Pravka makes it a fix…', fix?.kind === 'fix', JSON.stringify(fix))
ok('…answering the round that is open', !!fix?.revision_id && fix.revision_id === b.revisions.find((r) => !r.resolved_at)?.id)
ok('…and the round stays open: the person whose step it is still says it is fixed', b.revisions.some((r) => !r.resolved_at))
ok('the task with an open round sends its next file to Pravka', b.drop?.folder === 'pravka', b.drop?.folder)
ok('the LAST #id in a name wins', a.drive_drops.some((x) => x.name === `Old #${tC1.id} then #${tA.id}.mp4`))
const twin = um.find((x) => /twin/.test(x.name))
ok('a title two open tasks share is not guessed at: Unmatched', !!twin && twin.folder === 'ready')
ok('…nor is a name that says nothing', um.some((x) => x.name === 'nonsense.png'))
ok('nothing that arrived moved a stage', (await full(tA.id)).status_id === beforeA)

// The second copy has done its job. Two processes on one local SQLite file
// meet "database is locked" on any write that lands mid-read — true of every
// route on this board, not of drop-in — so the rest runs on one, as in dev.
second.kill()
await wait(300)

// ===================== previews =====================
const noThumb = a.drive_drops.find((x) => x.name === early.name)
let r = await fetch(`${BASE}/api/drive/drops/${noThumb.id}/thumb`)
ok('a preview is refused to somebody not signed in', r.status === 401, String(r.status))
r = await req(`/drive/drops/${noThumb.id}/thumb`, 'GET', null, OT)
ok('…and to somebody not on the task', r.status === 404, String(r.status))
r = await req(`/drive/drops/${noThumb.id}/thumb`, 'GET', null, MT)
ok('before Google has made one, the route says it is being made', r.status === 404 && r.data.pending === true && /being made by Google/.test(r.data.error))
await fetch(`${mock.base}/__thumb?id=${encodeURIComponent(early.id)}&ms=61000`, { method: 'POST' })
const img = await fetch(`${BASE}/api/drive/drops/${noThumb.id}/thumb`, { headers: { Authorization: `Bearer ${ET}` } })
ok('once it exists, whoever works on the task gets the picture', img.status === 200 && img.headers.get('content-type') === 'image/png', String(img.status))
ok('…kept private, never in a shared cache', /private/.test(img.headers.get('cache-control') || ''))
const later = (await full(tA.id)).drive_drops.find((x) => x.id === noThumb.id)
ok('…and the video\'s length is noted once Google knows it', later.duration_ms === 61000 && later.has_thumb === 1, JSON.stringify(later))
r = await req(`/drive/drops/${um.find((x) => x.name === 'nonsense.png').id}/thumb`, 'GET', null, MT)
ok('an Unmatched file\'s preview is for an admin of the whole board only', r.status === 404)
r = await req(`/drive/drops/${um.find((x) => x.name === 'nonsense.png').id}/thumb`, 'GET', null, A)
ok('…who sees it', r.status === 200)

// ===================== attaching by hand =====================
ok('only an admin of the whole board sees Unmatched', (await req('/drive/drops/unmatched', 'GET', null, MT)).status === 403)
ok('…or attaches from it', (await req(`/drive/drops/${twin.id}/attach`, 'POST', { task_id: tC2.id }, MT)).status === 403)
ok('a task must be picked', (await req(`/drive/drops/${twin.id}/attach`, 'POST', {}, A)).status === 400)
r = await req(`/drive/drops/${twin.id}/attach`, 'POST', { task_id: tC2.id }, A)
ok('an admin attaches the twin to the right one', r.status === 200 && !r.data.files.some((x) => x.id === twin.id), JSON.stringify(r.data).slice(0, 200))
const c2 = await full(tC2.id)
ok('…it is on that task now, attached by hand', c2.drive_drops.some((x) => x.id === twin.id && x.matched_by === 'hand' && !!x.attached_name))
ok('…and not on its twin', (await full(tC1.id)).drive_drops.length === 0)
ok('a second attach changes nothing', (await req(`/drive/drops/${twin.id}/attach`, 'POST', { task_id: tC1.id }, A)).status === 409)
await wait(1200)
ok('…and the watchers never list it again', (await req('/drive/drops/unmatched', 'GET', null, A)).data.files.every((x) => x.id !== twin.id))

// ===================== switched off =====================
mkdirSync(join(dir, 'data-off'), { recursive: true })
try { await boot(4145, { DRIVE_WATCH: 'off', DATA_DIR: join(dir, 'data-off') }) } catch (e) { console.log('✘ FAIL', e.message); bye(1) }
const off = (await req('/drive/status', 'GET', null, A, 'http://localhost:4145')).data
ok('DRIVE_WATCH=off turns it off on that server, and says so', off.drop?.on === false && off.drop?.reason === 'off', JSON.stringify(off.drop))
await req('/drive/disconnect', 'POST', {}, A)
s = (await req('/drive/status', 'GET', null, A)).data
ok('disconnected: off, and the folders forgotten', s.drop?.on === false && s.drop?.reason === 'disconnected' && !s.drop_folders, JSON.stringify(s.drop))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
bye(fails ? 1 : 0)

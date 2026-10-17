// The task window's Drive box and Files list, end to end against the mock
// Google (qa/mock-gdrive.mjs).
//
// THE BOX. A file dropped, pasted or picked in the task window goes from the
// browser to the team account's Drive — into the shared folder for the task's
// stage, named after the task (" (2)" when the name is taken) — and is
// attached to the task when it lands, once, however the watcher races it.
//
// THE LIST. Every Drive file a task points at — the box's, drop-in's, the old
// links in ready/shot/design in any of Google's address shapes, the files of a
// folder link — is listed with what it is, and plays and downloads through the
// board in the range the browser asks for. A link the team account cannot read
// says so; any other link stays a plain link. Only whoever works on the task,
// signed in, gets any of it.
//
// Boots its own instance on :4147 and the mock on :9982.
//
//   node qa/drive-box-suite.mjs
import { spawn } from 'child_process'
import { rmSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { startMockDrive } from './mock-gdrive.mjs'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const BASE = 'http://localhost:4147'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = join(tmpdir(), `drive-box-suite-${process.pid}`)
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'data'), { recursive: true })
const mock = await startMockDrive(9982)
const child = spawn('node', ['server/index.js'], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    PORT: '4147', DATA_DIR: join(dir, 'data'), JWT_SECRET: 'drive-box-suite-secret',
    GOOGLE_CLIENT_ID: 'mock-client', GOOGLE_CLIENT_SECRET: 'mock-secret',
    GOOGLE_ACCOUNTS_BASE: mock.base, GOOGLE_OAUTH_BASE: mock.base, GOOGLE_API_BASE: mock.base,
    GOOGLE_DRIVE_TOKEN_FILE: join(dir, 'secrets', 'google-drive.json'), PUBLIC_URL: BASE, DRIVE_WATCH_MS: '400',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let said = ''
child.stdout.on('data', (d) => { said += d })
child.stderr.on('data', (d) => { said += d; if (process.env.SUITE_LOGS) process.stderr.write(d) })
const bye = (code) => { child.kill(); mock.close(); setTimeout(() => { rmSync(dir, { recursive: true, force: true }); process.exit(code) }, 300) }
try {
  await new Promise((resolve, reject) => {
    const t = setInterval(() => { if (said.includes('API listening')) { clearInterval(t); resolve() } }, 100)
    child.on('exit', (c) => reject(new Error(`instance exited ${c}: ${said.slice(-400)}`)))
    setTimeout(() => reject(new Error(`instance start timeout: ${said.slice(-400)}`)), 30000)
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
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }
}
const mockPost = (p, body) => fetch(`${mock.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const state = async () => (await fetch(`${mock.base}/__state`)).json()

const A = await login('admin', 'admin123')
const CH = 'instagram_main'
const sfx = Date.now().toString(36).slice(-5)
const mk = async (b) => (await req('/users', 'POST', { password: 'pw123456', ...b }, A)).data
const maker = await mk({ name: 'Dilnoza Maker', username: 'bm' + sfx, role: 'member', departments: [CH], permissions: { manage_content: true } })
const ed = await mk({ name: 'Eldor Cuts', username: 'be' + sfx, role: 'editor' })
await mk({ name: 'Ozod Elsewhere', username: 'bo' + sfx, role: 'editor' })
const [MT, ET, OT] = [await login('bm' + sfx, 'pw123456'), await login('be' + sfx, 'pw123456'), await login('bo' + sfx, 'pw123456')]
const task = async (title, extra = {}) => (await req('/content', 'POST', { title, channels: [CH], type: 'reel', editor_id: ed.id, assignee_id: maker.id, assignees: [maker.id], ...extra }, A)).data
const files = async (id, t = MT) => req(`/drive/tasks/${id}/files`, 'GET', null, t)

// Connect, both scopes.
const c = await req('/drive/connect', 'POST', {}, A)
const g = await fetch(c.data.url, { redirect: 'manual' })
await fetch(g.headers.get('location'), { redirect: 'manual' })
const F = (await req('/drive/status', 'GET', null, A)).data.drop_folders
ok('Drive is connected with its three folders', !!F?.recording?.id && !!F?.ready?.id)

// ===================== the box =====================
const tA = await task('Box: campus / tour?')
const BYTES = Buffer.from(Array.from({ length: 300000 }, (_, i) => (i * 7) % 256))
const ORIGIN = BASE
const upload = async (id, name, t, bytes = BYTES, mime = 'video/quicktime') => {
  const s = await req(`/drive/tasks/${id}/uploads`, 'POST', { kind: 'box', name, size: bytes.length, mime }, t, { Origin: ORIGIN })
  if (s.status !== 201) return { open: s }
  const put = await fetch(s.data.session_url, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes })
  const file = await put.json()
  const fin = await req('/drive/uploads/finish', 'POST', { ticket: s.data.ticket, file_id: file.id }, t)
  return { open: s, file, fin }
}
const up1 = await upload(tA.id, 'IMG_0042.MOV', ET)
ok('the box opens an upload for whoever works on the task', up1.open.status === 201, `${up1.open.status} ${up1.open.data.error || ''}`)
ok('…named after the task, with the file\'s own extension', up1.open.data.name === `Box campus tour #${tA.id}.MOV`, up1.open.data.name)
let st = await state()
const f1 = st.files.find((f) => f.id === up1.file?.id)
ok('…into the folder for the task\'s stage (a reel not filmed yet → Recording)', f1?.parents?.includes(F.recording.id), JSON.stringify(f1?.parents))
ok('…and attached the moment it lands', up1.fin.status === 200, JSON.stringify(up1.fin.data).slice(0, 160))
const up2 = await upload(tA.id, 'IMG_0043.MOV', ET)
ok('a second file for the same task gets " (2)", never a twin', up2.open.data.name === `Box campus tour #${tA.id} (2).MOV`, up2.open.data.name)
ok('somebody not on the task may not use its box', (await req(`/drive/tasks/${tA.id}/uploads`, 'POST', { kind: 'box', name: 'x.mp4', size: 10 }, OT, { Origin: ORIGIN })).status === 403)
await wait(1500) // the watcher has looked at the folders several times by now
let a = (await req(`/content/${tA.id}`, 'GET', null, MT)).data
const mine = (a.drive_drops || []).filter((d) => [up1.file.id, up2.file.id].includes(d.file_id))
ok('each upload is on the task exactly once, though the watcher saw the folder too', mine.length === 2 && (a.drive_drops || []).length === 2, JSON.stringify(a.drive_drops?.map((d) => d.name)))
ok('…attached by its upload, as footage (the Recording folder)', mine.every((d) => d.matched_by === 'upload' && d.kind === 'footage' && d.attached_name === 'Eldor Cuts'))
const bell = (await req('/notifications', 'GET', null, MT)).data.events || []
ok('the task\'s owner hears once a file', [up1.open.data.name, up2.open.data.name].every((n) => bell.filter((e) => e.text.includes(`«${n}»`)).length === 1))
ok('nothing moved the stage', a.status_id === tA.status_id)
await req(`/content/${tA.id}/revisions`, 'POST', { note: 'Brighter, please' }, A)
const up3 = await upload(tA.id, 'fix.mp4', ET, Buffer.from('fixed'), 'video/mp4')
st = await state()
ok('with a change sent back, the box sends the file to Pravka', st.files.find((f) => f.id === up3.file?.id)?.parents?.includes(F.pravka.id))

// ===================== the list, the player, Download =====================
let L = await files(tA.id)
ok('the Files list carries the box\'s uploads', L.status === 200 && L.data.connected && [up1.file.id, up2.file.id, up3.file.id].every((id) => L.data.files.some((f) => f.id === id && f.source === 'drop')),
  JSON.stringify(L.data).slice(0, 200))
const play = await req(`/drive/tasks/${tA.id}/files/${up1.file.id}/play`, 'GET', null, MT)
ok('a play ticket is handed out for a file on the task', play.status === 200 && /^\/api\/drive\/stream\//.test(play.data.url || '') && play.data.expires_in <= 600)
const part = await fetch(BASE + play.data.url, { headers: { Range: 'bytes=0-9' } })
const got = Buffer.from(await part.arrayBuffer())
ok('the player gets the range it asks for: 206', part.status === 206 && part.headers.get('content-range') === `bytes 0-9/${BYTES.length}`, `${part.status} ${part.headers.get('content-range')}`)
ok('…the right bytes', got.equals(BYTES.subarray(0, 10)))
ok('…never cached anywhere but this browser, never re-encoded', /private/.test(part.headers.get('cache-control') || '') && /no-transform/.test(part.headers.get('cache-control') || ''))
const dl = await fetch(BASE + play.data.download)
const all = Buffer.from(await dl.arrayBuffer())
ok('Download hands the whole file over as an attachment', dl.status === 200 && /^attachment;/.test(dl.headers.get('content-disposition') || '') && all.equals(BYTES),
  dl.headers.get('content-disposition'))
ok('…under its name, spelled in full', (dl.headers.get('content-disposition') || '').includes(`filename*=UTF-8''${encodeURIComponent(up1.open.data.name)}`))

// ===================== who may =====================
ok('the list refuses somebody not signed in', (await fetch(`${BASE}/api/drive/tasks/${tA.id}/files`)).status === 401)
ok('…and somebody not on the task', (await files(tA.id, OT)).status === 404)
ok('a preview refuses somebody not signed in', (await fetch(`${BASE}/api/drive/tasks/${tA.id}/files/${up1.file.id}/thumb`)).status === 401)
ok('a play ticket is refused to somebody not on the task', (await req(`/drive/tasks/${tA.id}/files/${up1.file.id}/play`, 'GET', null, OT)).status === 404)
ok('the stream refuses an address without its ticket', (await fetch(`${BASE}/api/drive/stream/${up1.file.id}`)).status === 403)
const t2 = new URL(BASE + play.data.url).searchParams.get('t')
ok('…and a ticket used for another file', (await fetch(`${BASE}/api/drive/stream/${up2.file.id}?t=${encodeURIComponent(t2)}`)).status === 403)
const tOther = await task('Box: someone else')
ok('a file is played only through a task it is on', (await req(`/drive/tasks/${tOther.id}/files/${up1.file.id}/play`, 'GET', null, MT)).status === 404)

// ===================== old links =====================
const old = await mockPost('/__drop', { parent: 'elsewhere', name: 'Old cut final.mp4', mimeType: 'video/mp4', size: 5000, durationMillis: 42000, thumb: true })
const tB = await task('Box: an old cut')
const setLink = async (id, field, value) => req(`/content/${id}`, 'PATCH', { [field]: value }, A)
const pl = await setLink(tB.id, 'ready_link', `https://drive.google.com/file/d/${old.id}/view?usp=sharing`)
ok('(an old Drive link is on the task)', pl.status === 200, `${pl.status} ${pl.data.error || ''}`)
L = await files(tB.id)
const oe = L.data.files?.find((f) => f.id === old.id)
ok('an old Drive ready_link is read: name, length and size', oe?.source === 'link' && oe.field === 'ready_link' && oe.name === 'Old cut final.mp4' && oe.duration_ms === 42000 && oe.size === 5000,
  JSON.stringify(L.data).slice(0, 220))
ok('…and the window is told not to draw it again as a plain link', L.data.handled?.includes('ready_link'))
const oplay = await req(`/drive/tasks/${tB.id}/files/${old.id}/play`, 'GET', null, MT)
const opart = await fetch(BASE + oplay.data.url, { headers: { Range: 'bytes=100-104' } })
const ob = Buffer.from(await opart.arrayBuffer())
ok('…and plays through the board like the team\'s own files', opart.status === 206 && ob.length === 5 && ob[0] === 100 % 251)
const gets0 = (await state()).gets
const tB2 = await task('Box: same cut, another task')
await setLink(tB2.id, 'ready_link', `https://drive.google.com/open?id=${old.id}`)
L = await files(tB2.id)
ok('open?id= is read too', L.data.files?.some((f) => f.id === old.id))
ok('…from the cache: Google is not asked again about a link it answered', (await state()).gets === gets0, `${gets0} → ${(await state()).gets}`)
const pic = await mockPost('/__drop', { parent: 'elsewhere', name: 'poster.png', mimeType: 'image/png', size: 900 })
const doc = await mockPost('/__drop', { parent: 'elsewhere', name: 'Script', mimeType: 'application/vnd.google-apps.document', size: 0 })
const tC = await task('Box: shapes')
await setLink(tC.id, 'design_link', `https://drive.google.com/uc?id=${pic.id}&export=download`)
await setLink(tC.id, 'shot_link', `https://docs.google.com/document/d/${doc.id}/edit`)
L = await files(tC.id)
ok('uc?id= is read', L.data.files?.some((f) => f.id === pic.id && f.field === 'design_link'))
ok('…and a Docs link', L.data.files?.some((f) => f.id === doc.id && f.field === 'shot_link'))
ok('a Google Doc has no file to download: it opens in Drive', (await req(`/drive/tasks/${tC.id}/files/${doc.id}/play`, 'GET', null, MT)).status === 409)

const folder = await mockPost('/__drop', { parent: 'elsewhere', name: 'Shoot 12', folder: true })
const k1 = await mockPost('/__drop', { parent: folder.id, name: 'clip1.mp4', size: 100 })
const k2 = await mockPost('/__drop', { parent: folder.id, name: 'clip2.mp4', size: 200 })
const tD = await task('Box: a folder of footage')
await setLink(tD.id, 'shot_link', `https://drive.google.com/drive/folders/${folder.id}?usp=sharing`)
L = await files(tD.id)
ok('a folder link lists its files', [k1.id, k2.id].every((id) => L.data.files?.some((f) => f.id === id && f.field === 'shot_link' && f.folder_name === 'Shoot 12')),
  JSON.stringify(L.data.files?.map((f) => f.name)))
const tD2 = await task('Box: one file of a folder')
await setLink(tD2.id, 'shot_link', `https://drive.google.com/drive/folders/${folder.id} · clip2`)
L = await files(tD2.id)
ok('…only the one a delivery\'s label names, when it names one', L.data.files?.length === 1 && L.data.files[0].id === k2.id, JSON.stringify(L.data.files?.map((f) => f.name)))

const hid = await mockPost('/__drop', { parent: 'elsewhere', name: 'private.mp4', size: 10, hidden: true })
const tE = await task('Box: not shared')
const hidUrl = `https://drive.google.com/file/d/${hid.id}/view`
await setLink(tE.id, 'ready_link', hidUrl)
L = await files(tE.id)
const he = L.data.files?.find((f) => f.id === hid.id)
ok('a link the team account cannot read says so, with the link itself', he?.state === 'unshared' && he.url === hidUrl, JSON.stringify(he))
ok('…and can be neither played nor downloaded', (await req(`/drive/tasks/${tE.id}/files/${hid.id}/play`, 'GET', null, MT)).status === 404)
const tF = await task('Box: not Drive')
await setLink(tF.id, 'ready_link', 'https://www.dropbox.com/s/abc/cut.mp4')
L = await files(tF.id)
ok('any other link stays a plain link', L.data.files?.length === 0 && !L.data.handled?.includes('ready_link'))

// ===================== deleting (r11, the owner) =====================
// Whoever films, edits or designs the piece (and its owner and planners) may
// delete a file the board put on the Drive: into the Drive's bin, off the list,
// out of any box that pointed at it. Never a pasted link — somebody's own file.
L = await files(tA.id, ET)
ok('the editor is told the box uploads can be deleted', [up1.file.id, up2.file.id].every((id) => L.data.files.find((f) => f.id === id)?.can_remove))
L = await files(tB.id, MT)
ok('…never a pasted link', L.data.files.some((f) => f.id === old.id) && !L.data.files.find((f) => f.id === old.id)?.can_remove)
ok('…and deleting one is refused', (await req(`/drive/tasks/${tB.id}/files/${old.id}`, 'DELETE', null, MT)).status === 403)
ok('somebody not on the task may not delete', (await req(`/drive/tasks/${tA.id}/files/${up2.file.id}`, 'DELETE', null, OT)).status === 404)
await setLink(tA.id, 'ready_link', `https://drive.google.com/file/d/${up2.file.id}/view`)
const del = await req(`/drive/tasks/${tA.id}/files/${up2.file.id}`, 'DELETE', null, ET)
ok('the editor deletes an upload', del.status === 200, `${del.status} ${del.data.error || ''}`)
ok('…into the Drive\'s bin, not gone for good', (await state()).files.find((f) => f.id === up2.file.id)?.trashed === true)
L = await files(tA.id, MT)
ok('…off the task\'s list, the others kept', !L.data.files.some((f) => f.id === up2.file.id) && L.data.files.some((f) => f.id === up1.file.id))
a = (await req(`/content/${tA.id}`, 'GET', null, MT)).data
ok('…out of the box that pointed at it', !a.ready_link && del.data.cleared?.includes('ready_link'))
ok('…and noted on the task\'s history', (a.activity || []).some((e) => e.old_value === `${up2.open.data.name} (Google Drive)` && !e.new_value))

// ===================== History (r11, the owner) =====================
// Every upload is listed for whoever uploaded it, so a wrong file is found and
// fixed later; a deleted one stays on the list, marked, and cannot be deleted twice.
const H = (await req('/drive/history', 'GET', null, ET)).data.uploads || []
const h1 = H.find((u) => u.file_id === up1.file.id)
const h2 = H.find((u) => u.file_id === up2.file.id)
ok('History lists what this person uploaded, with its task', h1?.content_id === tA.id && h1.title === tA.title && h1.kind === 'box' && !h1.deleted_at, JSON.stringify(h1))
ok('…the deleted one still there, marked, no longer deletable', !!h2?.deleted_at && !h2.can_remove)
ok('…the others deletable', h1?.can_remove === true)
ok('…and nobody else\'s uploads', !((await req('/drive/history', 'GET', null, MT)).data.uploads || []).some((u) => u.file_id === up1.file.id))

// ===================== the window =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const ref = src('client/src/components/RefMedia.jsx')
const win = src('client/src/components/CoachTask.jsx')
ok('a picture pasted or dropped anywhere still goes to Photos and videos', /onOther/.test(ref) && /isPicture\(f\)/.test(ref))
ok('…and everything else to the Drive box', /onOther=\{/.test(win) && /DriveBox/.test(win))
ok('the old "Upload to Google Drive" is untouched', /kind: 'reference'/.test(ref) && /edit: \{ hat: 'editor_id', col: 'ready_link' \}/.test(src('server/routes/drive.js')))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
bye(fails ? 1 : 0)

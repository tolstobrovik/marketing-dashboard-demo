// A task's reference photos and videos (routes/content.js, /media).
//
// TWENTY A TASK, ADDED BY ANYBODY ON IT. The old album held eight photos, in
// the database, and only a planner could add one. Now whoever works on the
// task adds; the photo is a file on the server's disk (not the database that
// is pushed to GitHub), a video a link into the task's Drive folder. The old
// album's photos count towards the twenty.
//
// WHO REMOVES ONE. Whoever added it, or whoever plans the channel.
//
// THE CARD'S PICTURE. The boards and the gates read photo / photo_thumb as
// "there is a reference". While the old album is empty it is a copy of the
// first reference photo, and nothing once there are none.
//
// THE PAGE. RefMedia takes a paste or a drop anywhere over an open task, and
// both task windows show it.
//
//   node qa/media-suite.mjs           (expects a server on :4090)
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const DATA = process.env.DATA_DIR || ''
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, type: r.headers.get('content-type') || '', data: (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => ({})) : await r.arrayBuffer() }
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const photo = (name) => ({ name, photo: PNG, thumb: PNG })

const sfx = Date.now().toString(36).slice(-5)
const ch = 'instagram_main'
const op = (await req('/users', 'POST', { name: 'Ola Operator', username: 'mo' + sfx, password: 'pw123456', role: 'operator', departments: [ch] })).data
const out = (await req('/users', 'POST', { name: 'Ozod Outsider', username: 'mx' + sfx, password: 'pw123456', role: 'operator', departments: [] })).data
const OT = await login('mo' + sfx, 'pw123456')
const XT = await login('mx' + sfx, 'pw123456')
const task = (await req('/content', 'POST', { title: 'Media: the reel', channels: [ch], type: 'reel', operator_id: op.id })).data
ok('(a reel with an operator on it, and somebody who is not)', !!task.id && !!OT && !!XT)

// ---- adding ----
const a = await req(`/content/${task.id}/media`, 'POST', photo('frame.png'), OT)
ok('the operator on the task adds a reference photo', a.status === 201 && a.data.media?.length === 1 && a.data.media[0].kind === 'image',
  `${a.status} ${JSON.stringify(a.data).slice(0, 120)}`)
const mid = a.data.added
ok('somebody with no part in the task cannot', (await req(`/content/${task.id}/media`, 'POST', photo('x.png'), XT)).status === 404)
ok('a file that is not a picture is refused', (await req(`/content/${task.id}/media`, 'POST', { name: 'x', photo: 'data:text/html;base64,PGI+', thumb: PNG }, OT)).status === 400)

// ---- reading ----
const full = await req(`/content/media/${mid}`, 'GET', null, OT)
ok('the picture comes back as an image to whoever works on the task', full.status === 200 && full.type.startsWith('image/png') && full.data.byteLength > 50, `${full.status} ${full.type}`)
ok('…and its thumbnail', (await req(`/content/media/${mid}?thumb=1`, 'GET', null, OT)).status === 200)
ok('…but not to somebody with no part in it', (await req(`/content/media/${mid}`, 'GET', null, XT)).status === 404)
ok('the full task carries its media', (await req(`/content/${task.id}`)).data.media?.some((m) => m.id === mid))
if (DATA) ok('the photo is a file on the server, not a row of bytes', readdirSync(join(DATA, 'media')).some((f) => f.endsWith('.png')))

// ---- the card's picture ----
let row = (await req('/content')).data.find((c) => c.id === task.id)
ok('the card shows the first reference photo', row?.has_thumb === 1 && row?.photo_media_id === mid, JSON.stringify({ t: row?.has_thumb, m: row?.photo_media_id }))

// ---- removing ----
const b = await req(`/content/${task.id}/media`, 'POST', photo('admins.png'))
const adminsId = b.data.added
ok('the operator cannot remove a photo somebody else added', (await req(`/content/media/${adminsId}`, 'DELETE', null, OT)).status === 403)
ok('…the planner can', (await req(`/content/media/${adminsId}`, 'DELETE')).status === 200)
const own = await req(`/content/media/${mid}`, 'DELETE', null, OT)
ok('…and the operator removes their own', own.status === 200 && own.data.media.length === 0, String(own.status))
row = (await req('/content')).data.find((c) => c.id === task.id)
ok('with none left, the card has no picture', row?.has_thumb === 0 && row?.photo_media_id == null, JSON.stringify({ t: row?.has_thumb, m: row?.photo_media_id }))

// ---- videos ----
ok('a video is added by its Google Drive link only', (await req(`/content/${task.id}/media`, 'POST', { kind: 'video', name: 'v.mp4', link: 'https://example.com/v.mp4' }, OT)).status === 400)
const v = await req(`/content/${task.id}/media`, 'POST', { kind: 'video', name: 'pacing.mp4', size: 123456, link: 'https://drive.google.com/file/d/abcdefghijklmnop/view' }, OT)
ok('…and then it is listed', v.status === 201 && v.data.media.some((m) => m.kind === 'video' && m.name === 'pacing.mp4'), String(v.status))

// ---- twenty, the old album included ----
await req(`/content/${task.id}`, 'PATCH', { reference_photos: [{ photo: PNG, thumb: PNG }, { photo: PNG, thumb: PNG }] })
let n = (await req(`/content/${task.id}/media`)).data.length + 2
let last
while (n < 20) { last = await req(`/content/${task.id}/media`, 'POST', photo(`p${n}.png`)); n++ }
ok('twenty fit, the old album\'s photos counted', last?.status === 201, String(last?.status))
const over = await req(`/content/${task.id}/media`, 'POST', photo('one-too-many.png'))
ok('…and the twenty-first is refused, saying so', over.status === 400 && over.data.full === true, `${over.status} ${over.data.error || ''}`)
row = (await req('/content')).data.find((c) => c.id === task.id)
ok('while the old album has photos, it keeps the card\'s picture', row?.photo_media_id == null && row?.has_thumb === 1)

// ---- a deleted task takes its files ----
const files = DATA ? readdirSync(join(DATA, 'media')).length : 0
await req(`/content/${task.id}`, 'DELETE')
if (DATA) ok('a deleted task takes its photo files with it', readdirSync(join(DATA, 'media')).length < files, `${files} → ${readdirSync(join(DATA, 'media')).length}`)

// ---- the page, read from the source ----
const src = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const rm = src('client/src/components/RefMedia.jsx')
ok('a paste or a drop anywhere over the open task adds it, unless a box already took it',
  /document\.addEventListener\('paste', onPaste\)/.test(rm) && /window\.addEventListener\('drop', onDrop\)/.test(rm)
    && /if \(!catchAll \|\| e\.defaultPrevented\) return/.test(rm) && /if \(e\.defaultPrevented \|\| !hasFiles\(e\)\) return/.test(rm))
// Round 13 (the hunt, 15 Oct 2026): only the task's owner's drop is routed, but every open
// window still stops a stray file from opening in the tab and unloading the board.
ok('…and a file dropped beside a box never opens in the tab, for anybody',
  /const onOver = \(e\) => \{ if \(!hasFiles\(e\)\) return; e\.preventDefault\(\)/.test(rm)
    && /e\.preventDefault\(\)\s*\n\s*if \(catchAll && !route\(e\.dataTransfer\.files\)\)/.test(rm) && !/if \(!catchAll\) return undefined/.test(rm))
ok('…several files at once, photos and videos', /accept="image\/\*,video\/\*" multiple/.test(rm) && /startUpload\(\{\s*task, kind: 'reference'/.test(rm))
ok('both task windows show them', /<RefMedia /.test(src('client/src/components/CoachTask.jsx')) && /<RefMedia /.test(src('client/src/components/ContentModal.jsx')))
ok('a reference video goes into the task\'s Drive folder, for anybody on the task', /reference: \{ hat: null, col: null, anyone: true \}/.test(src('server/routes/drive.js')))
ok('the files live outside the database, under DATA_DIR', /export const MEDIA_DIR = join\(DATA_DIR, 'media'\)/.test(src('server/db.js')) && existsSync(join(ROOT, 'qa')))

await req(`/users/${op.id}`, 'DELETE')
await req(`/users/${out.id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

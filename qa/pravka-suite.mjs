// Pravka Mode 2.0 — rich media, three deliveries, and the reviewer's alert.
//
// THE ALERT. A cut landing on Ready is the reviewer's cue: the reviewer NAMED
// on the task hears it on Telegram, with which delivery this is — and nobody
// else on the channel does, because a cue meant for everybody is felt by
// nobody. A fixed pravka is a delivery too, and used to arrive in silence.
// The bell row is the `review` kind, which is what makes an open dashboard
// play notify.mp3 and toast "New work ready for review".
//
// RICH MEDIA. A screenshot pasted into a pravka, or a file dropped on it, is
// uploaded at once and comes back as the Markdown the note carries. The bytes
// sit behind the sign-in with the task's own reach; SVG and programs are not
// pictures or documents.
//
// THREE DELIVERIES. cycle = COUNT(revisions) + 1. With two rounds asked for,
// the third delivery is approved as it stands: a standard member asking for a
// third round — or trying to force one — gets 403, and so does the upload that
// would go with it. An admin on the channel is told the override exists (409,
// can_force) and gets past only by sending `force`, which goes on the record.
// Designers live by the same three deliveries as editors.
//
// APPROVE. The reviewer's yes keeps the piece at Ready, cleared for Published,
// and closes the loop for good: moving the card about does not reopen it,
// only an admin's override does.
//
// Boots its own API (4127) and Telegram mock (9927).
//   DASHB_ROOT=$PWD node qa/pravka-suite.mjs
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = fileURLToPath(new URL('.', import.meta.url))
const BASE = 'http://localhost:4127'
const MOCK = 'http://localhost:9927'
const TOKEN = 'pravka-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })

boot([join(SP, 'mock-tg.mjs')], { MOCK_PORT: '9927' })
boot([join(ROOT, 'server/index.js')], {
  DATA_DIR: join(tmpdir(), `pravka-${Date.now()}`), PORT: '4127',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
  GITHUB_DATA_TOKEN: '', GH_DATA_TOKEN: '', DATABASE_URL: '', TURSO_DATABASE_URL: '',
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('mock + API are up', (await up(MOCK + '/__sent')) && (await up(BASE + '/api/health')))

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const raw = (p, t) => fetch(BASE + p, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
const hook = (update) => fetch(BASE + '/api/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})
const sentList = async () => (await (await fetch(MOCK + '/__sent')).json())
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })

const statuses = (await req('/statuses')).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const READY = sid(/^ready$/i)
const EDITING = sid(/^editing$/i)
const chans = (await req('/channels')).data
const chKey = chans[0]?.key
const otherKey = chans.find((c) => c.key !== chKey)?.key

// The people: a named reviewer, a second SMM on the same channel who is NOT
// named, an editor, and somebody from another channel.
const mk = async (name, username, role, departments) =>
  (await req('/users', 'POST', { name, username, password: 'probe1234', role, departments })).data
const rev = await mk('Rana Reviewer', 'pk_rev', 'member', [chKey])
const smm = await mk('Sami Other', 'pk_smm', 'member', [chKey])
const ed = await mk('Eldor Editor', 'pk_ed', 'editor', [])
const out = await mk('Oysha Outside', 'pk_out', 'member', otherKey ? [otherKey] : [])
// The task's owner is somebody else again, and has no Telegram: an owner is
// crew and hears a delivery as crew, which is not what is being tested here.
const own = await mk('Orzu Owner', 'pk_own', 'member', [chKey])
const RT = await login('pk_rev', 'probe1234')
const ST = await login('pk_smm', 'probe1234')
const ET = await login('pk_ed', 'probe1234')
const OT = await login('pk_out', 'probe1234')
const CHAT = { admin: 700, rev: 701, smm: 702, ed: 703 }
for (const [tok, chat] of [[T, CHAT.admin], [RT, CHAT.rev], [ST, CHAT.smm], [ET, CHAT.ed]]) {
  const l = (await req('/telegram/link', 'POST', {}, tok)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}
const bell = async (tok, taskId, kind) =>
  ((await req('/notifications', 'GET', null, tok)).data.events || []).filter((e) => e.content_id === taskId && (!kind || e.kind === kind))
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 864e5))

// ===================== Phase 1: delivery and the alert =====================
const a = (await req('/content', 'POST', {
  title: 'Pravka: the cut', channels: [chKey], type: 'video', status_id: EDITING, assignee_ids: [own.id],
  editor_id: ed.id, reviewer_ids: [rev.id], recording_date: day(-2), release_date: day(5),
})).data
ok('a task with a named reviewer is made', !!a.id && a.status_id === EDITING, JSON.stringify(a).slice(0, 160))
await reset()
let r = await req(`/content/${a.id}`, 'PATCH', { ready_link: 'https://drive.google.com/pk-cut-1', milestone: 'edited' }, ET)
ok('the editor hands the cut in and it moves to Ready', r.status === 200 && r.data.status_id === READY, `${r.status} ${r.data.error || r.data.status_id}`)
let sent = await sentList()
const toRev = sent.find((s) => String(s.chat_id) === String(CHAT.rev) && /Work ready for review/.test(s.text || ''))
ok('the NAMED reviewer hears it on Telegram', !!toRev)
ok('…with the file in hand', !!toRev && toRev.text.includes('https://drive.google.com/pk-cut-1'))
ok('…and which delivery it is', !!toRev && /Delivery 1 of 3/.test(toRev.text), toRev?.text)
ok('an SMM who is not named is not rung — the cue is focused', !sent.some((s) => String(s.chat_id) === String(CHAT.smm) && /Work ready for review/.test(s.text || '')))
ok('…nor is every admin of the channel', !sent.some((s) => String(s.chat_id) === String(CHAT.admin) && /Work ready for review/.test(s.text || '')))
ok('the editor never hears their own delivery', !sent.some((s) => String(s.chat_id) === String(CHAT.ed) && /✅/.test(s.text || '')))
let revBell = await bell(RT, a.id, 'review')
ok('the reviewer’s bell carries a `review` line — the kind that dings an open dashboard', revBell.length === 1 && /→ Ready/.test(revBell[0].text), JSON.stringify(revBell))
ok('…and the unnamed SMM’s bell has none', (await bell(ST, a.id, 'review')).length === 0)

// A task nobody is named on still rings the channel, as it always did.
const lone = (await req('/content', 'POST', {
  title: 'Pravka: nobody named', channels: [chKey], type: 'video', status_id: EDITING, assignee_ids: [own.id],
  editor_id: ed.id, recording_date: day(-2),
})).data
await reset()
await req(`/content/${lone.id}`, 'PATCH', { ready_link: 'https://drive.google.com/pk-lone', milestone: 'edited' }, ET)
sent = await sentList()
ok('with nobody named, the channel’s reviewers hear it as before',
  sent.some((s) => String(s.chat_id) === String(CHAT.smm) && /Work ready for review/.test(s.text || ''))
  && sent.some((s) => String(s.chat_id) === String(CHAT.admin) && /Work ready for review/.test(s.text || '')))

// ===================== Phase 2: rich-media pravka =====================
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
r = await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'frame.png', data: PNG }, RT)
ok('a pasted screenshot uploads and comes back as Markdown', r.status === 201 && /^!\[image\]\(\/api\/content\/pravka-files\/\d+\)$/.test(r.data.md || ''), `${r.status} ${JSON.stringify(r.data)}`)
const shot = r.data
let res = await raw(shot.url, RT)
const bytes = Buffer.from(await res.arrayBuffer())
ok('…and the picture is served back, as a picture', res.status === 200 && /^image\/png/.test(res.headers.get('content-type') || '')
  && bytes.equals(Buffer.from(PNG.split(',')[1], 'base64')), `${res.status} ${res.headers.get('content-type')}`)
ok('…behind the sign-in', (await raw(shot.url)).status === 401)
ok('…to the crew on the task', (await raw(shot.url, ET)).status === 200)
if (otherKey) ok('…and to nobody who does not work on it — a voice note’s reach', (await raw(shot.url, OT)).status === 404)
r = await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'brief.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' }, RT)
ok('a dropped document becomes a file link', r.status === 201 && /^\[brief\.pdf\]\(\/api\/content\/pravka-files\/\d+\)$/.test(r.data.md || ''), JSON.stringify(r.data))
const doc = r.data
ok('an SVG is not a picture', (await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'x.svg', data: 'data:image/svg+xml;base64,PHN2Zy8+' }, RT)).status === 400)
ok('a program is not a document', (await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'x.exe', data: 'data:application/octet-stream;base64,TVo=' }, RT)).status === 400)
ok('a picture has to BE one', (await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'x.png', data: 'data:text/html;base64,PGI+' }, RT)).status === 400)
ok('the editor cannot write pravki on their own work', (await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'y.png', data: PNG }, ET)).status === 403)

await reset()
const note1 = `The logo is cut off at 0:12\n${shot.md}\nUse the fonts in here:\n${doc.md}`
r = await req(`/content/${a.id}/revisions`, 'POST', { note: note1, target: 'editor' }, RT)
ok('the pravka goes in, Markdown and all', r.status === 201 && r.data.status_id === EDITING, `${r.status} ${r.data.error || ''}`)
let full = (await req(`/content/${a.id}`)).data
ok('…the round keeps the note exactly as written', full.revisions?.length === 1 && full.revisions[0].note === note1)
sent = await sentList()
const toEd = sent.find((s) => String(s.chat_id) === String(CHAT.ed) && /Pravka requested on/.test(s.text || ''))
ok('the editor hears it on Telegram', !!toEd)
ok('…in words, not addresses nobody can open there', !!toEd && !toEd.text.includes('/api/content/pravka-files') && /🖼 ×1 · 📄 ×1/.test(toEd.text), toEd?.text)
ok('…exactly once (the Telegram diet)', sent.filter((s) => String(s.chat_id) === String(CHAT.ed)).length === 1,
  String(sent.filter((s) => String(s.chat_id) === String(CHAT.ed)).length))

// ===================== the fix is a delivery too =====================
const r1 = full.revisions[0]
await reset()
r = await req(`/content/revisions/${r1.id}/resolve`, 'POST', { link: 'https://drive.google.com/pk-cut-2' }, ET)
ok('the fix moves it back to Ready', r.status === 200 && r.data.task?.status_id === READY, `${r.status} ${r.data.error || ''}`)
sent = await sentList()
const fixCue = sent.find((s) => String(s.chat_id) === String(CHAT.rev) && /Work ready for review/.test(s.text || ''))
ok('…and the reviewer HEARS the fix — it used to arrive in silence', !!fixCue)
ok('…as delivery 2 of 3, one pravka left', !!fixCue && /Delivery 2 of 3 — one pravka left/.test(fixCue.text), fixCue?.text)
ok('…and the bell rings again', (await bell(RT, a.id, 'review')).length === 2)

// ===================== Phase 3: the limit =====================
await reset()
r = await req(`/content/${a.id}/revisions`, 'POST', { note: 'Music is too loud at the end', target: 'editor' }, RT)
ok('the second round is allowed', r.status === 201, `${r.status} ${r.data.error || ''}`)
sent = await sentList()
ok('…and tells the editor it is the last', sent.some((s) => String(s.chat_id) === String(CHAT.ed) && /last pravka/.test(s.text || '')))
await reset()
r = await req(`/content/${a.id}`, 'PATCH', { ready_link: 'https://drive.google.com/pk-cut-3', milestone: 'edited' }, ET)
ok('the third delivery lands on Ready', r.status === 200 && r.data.status_id === READY, `${r.status} ${r.data.error || ''}`)
sent = await sentList()
const third = sent.find((s) => String(s.chat_id) === String(CHAT.rev) && /Work ready for review/.test(s.text || ''))
ok('…and the reviewer is told it is approved as it stands', !!third && /Delivery 3 of 3/.test(third.text) && /approved as it stands/.test(third.text), third?.text)
r = await req(`/content/${a.id}/revisions`, 'POST', { note: 'One more thing', target: 'editor' }, RT)
ok('a third round is refused — 403 for a standard member', r.status === 403 && r.data.pravka_limit === true, `${r.status} ${JSON.stringify(r.data)}`)
ok('…in the spec’s words', r.data.error === 'Pravka limit reached. Task auto-approved.', r.data.error)
r = await req(`/content/${a.id}/revisions`, 'POST', { note: 'Forcing it', target: 'editor', force: true }, RT)
ok('…and forcing it through the API as a member is 403 too', r.status === 403, `${r.status} ${JSON.stringify(r.data)}`)
ok('…as is the upload that would go with it', (await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'z.png', data: PNG }, RT)).status === 403)
full = (await req(`/content/${a.id}`)).data
ok('the piece stays at Ready, cleared for Published', full.status_id === READY && full.revisions.length === 2)
r = await req(`/content/${a.id}/revisions`, 'POST', { note: 'Admin, not forcing', target: 'editor' })
ok('an admin who does not say "force" is told the override exists', r.status === 409 && r.data.can_force === true, `${r.status} ${JSON.stringify(r.data)}`)
ok('…and an admin can still put a picture in the pravka they are about to force',
  (await req(`/content/${a.id}/pravka-files`, 'POST', { name: 'force.png', data: PNG })).status === 201)
await reset()
r = await req(`/content/${a.id}/revisions`, 'POST', { note: 'The client changed the logo — one more pass', target: 'editor', force: true })
ok('Force Pravka (Override): the admin pushes a third round through', r.status === 201 && r.data.status_id === EDITING, `${r.status} ${r.data.error || ''}`)
full = (await req(`/content/${a.id}`)).data
ok('…on the record, by name', (full.activity || []).some((x) => x.field === 'pravka_override' && x.user_name === 'Admin'),
  JSON.stringify((full.activity || []).slice(0, 3).map((x) => x.field)))
sent = await sentList()
ok('…and the editor is told it is an override, not a normal round',
  sent.some((s) => String(s.chat_id) === String(CHAT.ed) && /admin override/.test(s.text || '')))

// ===================== Approve =====================
const b = (await req('/content', 'POST', {
  title: 'Pravka: approve me', channels: [chKey], type: 'video', status_id: EDITING, assignee_ids: [own.id],
  editor_id: ed.id, reviewer_ids: [rev.id], recording_date: day(-2),
})).data
ok('nothing that is not at Ready can be approved', (await req(`/content/${b.id}/approve`, 'POST', {}, RT)).status === 409)
await req(`/content/${b.id}`, 'PATCH', { ready_link: 'https://drive.google.com/pk-b1', milestone: 'edited' }, ET)
ok('the editor cannot approve their own cut', (await req(`/content/${b.id}/approve`, 'POST', {}, ET)).status === 403)
if (otherKey) ok('nor can somebody off the channel', (await req(`/content/${b.id}/approve`, 'POST', {}, OT)).status === 403)
await reset()
r = await req(`/content/${b.id}/approve`, 'POST', {}, RT)
ok('the reviewer approves it', r.status === 200 && !!r.data.approved_at && r.data.approved_name === 'Rana Reviewer' && r.data.status_id === READY,
  `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
sent = await sentList()
ok('…and the editor’s bell says there is nothing left to fix', (await bell(ET, b.id, 'status')).some((e) => /approved by Rana Reviewer/.test(e.text)))
ok('…which is good news, not a buzz — approvals stay off Telegram', !sent.some((s) => /approved by/.test(s.text || '')))
r = await req(`/content/${b.id}/revisions`, 'POST', { note: 'Changed my mind', target: 'editor' }, RT)
ok('an approved cut takes no pravka — the loop is closed', r.status === 403 && r.data.approved === true, `${r.status} ${JSON.stringify(r.data)}`)
await req(`/content/${b.id}`, 'PATCH', { status_id: EDITING })
full = (await req(`/content/${b.id}`)).data
ok('moving the card back does not reopen it — approved is permanent', !!full.approved_at && full.approved_name === 'Rana Reviewer', JSON.stringify([full.approved_at, full.approved_name]))
ok('…so the reviewer still cannot ask', (await req(`/content/${b.id}/revisions`, 'POST', { note: 'Now it needs work', target: 'editor' }, RT)).status === 403)
r = await req(`/content/${b.id}/revisions`, 'POST', { note: 'Override after approval', target: 'editor', force: true })
full = (await req(`/content/${b.id}`)).data
ok('only an admin’s override reopens it — and the cut it sends back is no longer approved', r.status === 201 && full.approved_at == null,
  `${r.status} ${full.approved_at}`)

// ===================== designers live by the same three =====================
const des = await mk('Dilnoza Designer', 'pk_des', 'designer', [])
const DT = await login('pk_des', 'probe1234')
const d = (await req('/content', 'POST', {
  title: 'Pravka: the artwork', channels: [chKey], type: 'post', status_id: EDITING, assignee_ids: [own.id],
  designer_id: des.id, reviewer_ids: [rev.id],
})).data
r = await req(`/content/${d.id}`, 'PATCH', { design_link: 'https://drive.google.com/pk-art-1', milestone: 'designed' }, DT)
ok('the designer hands the artwork in and it moves to Ready', r.status === 200 && r.data.status_id === READY, `${r.status} ${r.data.error || r.data.status_id}`)
for (const n of [2, 3]) {
  await req(`/content/${d.id}/revisions`, 'POST', { note: `Artwork pass ${n - 1}`, target: 'designer' }, RT)
  const open = (await req(`/content/${d.id}`)).data.revisions.find((v) => !v.resolved_at)
  await req(`/content/revisions/${open.id}/resolve`, 'POST', { link: `https://drive.google.com/pk-art-${n}` }, DT)
}
await reset()
full = (await req(`/content/${d.id}`)).data
ok('…two rounds and two fixes later it is back at Ready', full.status_id === READY && full.revisions.length === 2)
r = await req(`/content/${d.id}/revisions`, 'POST', { note: 'Artwork pass 3', target: 'designer' }, RT)
ok('…and a third round on the artwork is refused just the same', r.status === 403 && r.data.pravka_limit === true, `${r.status} ${JSON.stringify(r.data)}`)

// A deleted task takes its pravka files with it.
await req(`/content/${a.id}`, 'DELETE')
ok('deleting the task deletes its pictures', (await raw(shot.url, T)).status === 404)

// ===================== the page =====================
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const mp3 = join(ROOT, 'client/public/notify.mp3')
const head = existsSync(mp3) ? readFileSync(mp3).subarray(0, 3) : Buffer.alloc(0)
ok('client/public/notify.mp3 is an MP3', head.length === 3 && (head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)))
const sound = read('client/src/lib/sound.js')
ok('the ding is the HTML5 Audio API playing notify.mp3', /new Audio\(['"]\/notify\.mp3['"]\)/.test(sound) && /export function playNotify/.test(sound))
const bellSrc = read('client/src/components/NotificationsBell.jsx')
ok('the bell dings and toasts on a NEW review line', /kind === 'review'/.test(bellSrc) && /playNotify\(\)/.test(bellSrc) && /tx\('New work ready for review'\)/.test(bellSrc))
const box = read('client/src/components/PravkaBox.jsx')
ok('pasting a picture uploads it and appends its Markdown', /onPaste=\{onPaste\}/.test(box) && /pravka-files/.test(box) && /append\(note, out\.md\)/.test(box))
const modal = read('client/src/components/ContentModal.jsx')
// 13 Oct 2026: the review is the task window's step ("Accept" / "Ask for changes",
// offered while rounds are left — actOf in lib/coach.js); the override moved
// from the old sheet's ⋯ menu into the window's record.
const win = read('client/src/components/CoachTask.jsx')
const more = read('client/src/components/TaskMore.jsx')
ok('the task window offers Accept and Ask for changes, sent to the seat the asker picks',
  /api\.post\(`\/content\/\$\{t\.id\}\/approve`/.test(win) && /api\.post\(`\/content\/\$\{t\.id\}\/revisions`, \{\s+note: note\.trim\(\), target: sendTarget/.test(win)
  && !/onClick=\{approveCut\}|submitPravki/.test(modal))
ok('Force Pravka (Override) is under More details, for an admin on the channel, once the loop is closed',
  /tx\('Force Pravka \(Override\)'\)/.test(more) && /const mayForce = \/\^ready\$\/i\.test\(label\) && cleared && adminOn\(user, t\.channels\)/.test(more) && /force: true/.test(more))
const i18n = read('client/src/lib/i18n.jsx')
for (const [en, ru, uz] of [
  ['Approve (Ready)', 'Утвердить (Готово)', 'Tasdiqlash (Tayyor)'],
  ['Paste screenshot or drop file', 'Вставьте скриншот или файл', 'Skrinshot yoki faylni joylang'],
  ['Pravka limit reached. Task auto-approved.', 'Лимит правок исчерпан. Утверждено автоматически.', 'Tahrir limiti tugadi. Avtomatik tasdiqlandi.'],
  ['New work ready for review', 'Новая работа готова к проверке', 'Yangi ish tekshirish uchun tayyor'],
]) ok(`“${en}” reads as the spec wrote it`, i18n.includes(`"${en}": "${ru}"`) && i18n.includes(`"${en}": "${uz}"`))
ok('“Request Pravka” in all three', /'task\.requestchanges': 'Request Pravka'/.test(i18n)
  && /'task\.requestchanges': 'Отправить на правку'/.test(i18n) && /'task\.requestchanges': 'Tahrirga yuborish'/.test(i18n))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

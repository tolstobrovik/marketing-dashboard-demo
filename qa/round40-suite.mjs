// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Round 40: the messages grow up. Every Telegram line carries its task link
// IMMEDIATELY — before the admin ever presses Activate, the link borrows the
// address the triggering request arrived on; after activation the remembered
// public origin wins. New work names who handed it over and the release day;
// a comment that names somebody shows who spoke on what. (Stage moves and
// unnamed comments are the bell's since the Telegram diet.)
// Self-contained: 4098 + mock 9984.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'

// fileURLToPath, not .pathname: on Windows .pathname keeps the URL's leading
// slash — "/C:/…/qa/" — and nothing can spawn or mkdir that. Byte-identical
// on Linux, so CI reads exactly the same string it always did.
const SP = fileURLToPath(new URL('.', import.meta.url))
const BASE = 'http://localhost:4098'
const B = BASE + '/api'
const MOCK = 'http://localhost:9984'
const TOKEN = 'x40-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

boot([SP + 'mock-tg.mjs'], { MOCK_PORT: '9984' })
boot([ROOT + '/server/index.js'], {
  DATA_DIR: SP + 'tg40-' + Date.now(), PORT: '4098',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('mock + stack are up', (await up(MOCK + '/__sent')) && (await up(BASE + '/api/health')))

const login = async (u, p) => (await (await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const sentList = async () => (await (await fetch(MOCK + '/__sent')).json())
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const hook = async (update) => fetch(B + '/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})

const chKey = (await req('/channels')).data[0]?.key
const member = (await req('/users', 'POST', { name: 'X40 Member', username: 'x40m', password: 'probe123', role: 'member', departments: [chKey] })).data
const MT = await login('x40m', 'probe123')
const link = (await req('/telegram/link', 'POST', {}, MT)).data
await hook({ message: { chat: { id: 900 }, text: `/start ${link.code}` } })

// ---- links immediately: NO set-webhook has happened on this stack ----
// Fixtures park on Editing: real work, past the Idea stage, without booking a
// shoot these tests are not about (the shooting stage is a booking).
//
// Since the Telegram diet a stage move is the bell's alone, so the links are
// read off the messages that still go out: new work handed to somebody, and
// somebody named in a comment.
const shotId = (await req('/statuses')).data.find((s) => /^editing$/i.test(s.label)).id
const ideaId = (await req('/statuses')).data.find((s) => /^idea$/i.test(s.label)).id
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + 864e5))
await reset()
const task = (await req('/content', 'POST', {
  title: 'x40: rich video', channels: [chKey], type: 'video',
  assignee_ids: [member.id], status_id: shotId, release_date: tomorrow,
})).data
let m = (await sentList()).find((s) => String(s.chat_id) === '900' && /📌/.test(s.text || ''))
ok('the very first message already carries the link', !!m && m.text.includes(`http://localhost:4098/brief?task=${task.id}`), m?.text)
ok('…names who handed it over', !!m && /From Admin/.test(m.text))
const humanDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
ok('…and the release day, human-sized', !!m && m.text.includes(`release ${humanDate(tomorrow)}`))

// ---- a stage move is the bell's, not the phone's ----
await reset()
await req(`/content/${task.id}`, 'PATCH', { status_id: ideaId })
ok('moving the card sends nothing to Telegram', !(await sentList()).some((s) => String(s.chat_id) === '900'))
const bell40 = (await req('/notifications', 'GET', null, MT)).data.events || []
ok('…while the bell still logs it', bell40.some((e) => e.content_id === task.id && e.kind === 'status' && /→ Idea/.test(e.text)))

// ---- the comment cut: who spoke, on what, the words, the link ----
await reset()
await req(`/content/${task.id}/comments`, 'POST', { text: 'интро переснимаем завтра' })
ok('a comment nobody is named in stays in the bell', !(await sentList()).some((s) => String(s.chat_id) === '900' && /💬/.test(s.text || '')))
await reset()
await req(`/content/${task.id}/comments`, 'POST', { text: '@X40 Member интро переснимаем завтра' })
m = (await sentList()).find((s) => String(s.chat_id) === '900' && /💬/.test(s.text || ''))
ok('naming somebody reaches them — who spoke, on what', !!m && /💬 Admin wrote on .*«x40: rich video»/.test(m.text), m?.text)
ok('…quotes the words on their own line', !!m && /\n“@X40 Member интро переснимаем завтра”/.test(m.text))
ok('…and links the task', !!m && m.text.includes(`/brief?task=${task.id}`))

// ---- once activated, the remembered origin wins over the request host ----
await req('/telegram/set-webhook', 'POST', { url: 'https://team.example.org/api/telegram/webhook' })
await reset()
const task2 = (await req('/content', 'POST', {
  title: 'x40: second piece', channels: [chKey], type: 'video', assignee_ids: [member.id], status_id: shotId,
})).data
m = (await sentList()).find((s) => String(s.chat_id) === '900' && /📌/.test(s.text || ''))
ok('after Activate the public origin takes over', !!m && m.text.includes(`https://team.example.org/brief?task=${task2.id}`)
  && !m.text.includes('localhost:4098'), m?.text)

// The nightly tick sends NO digest. It used to: every linked member's phone
// rang at midnight with their deadlines whether or not anything had changed,
// and the team asked for it to stop — a board that speaks every day is a board
// people mute. The planned-update notice (Admin → Settings) took its place.
// The tick itself still runs, for the admin's own schedules and the auto-flag;
// nothing about deadlines leaves it, and the answer no longer carries a
// `reminded` count at all, so a client reading one is reading an old build.
await reset()
const cron = await (await fetch(BASE + '/api/cron/daily')).json()
m = (await sentList()).find((s) => String(s.chat_id) === '900' && /deadlines/i.test(s.text || ''))
ok('the nightly tick still answers, without a digest count', cron.ok === true && cron.reminded === undefined, JSON.stringify(cron))
ok('…and pushes no deadline digest to anybody', !m, m?.text?.slice(0, 80))

stop()
await new Promise((r) => setTimeout(r, 300))
console.log(fails === 0 ? '\nRound-40 suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails ? 1 : 0)

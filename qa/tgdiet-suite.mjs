// The Telegram diet: the bell logs everything, the phone buzzes for little.
//
// People stopped reading the bot because it spoke for every card dragged from
// Idea to To shoot, and the two messages that matter — a pravka, and a cut
// handed in — drowned in it. Telegram now carries only:
//
//   delivered  a hand-in: the cut or artwork to the reviewers, footage to the
//              editor who cuts it
//   pravka     to the one hat that fixes it (never the operator for a cut)
//   late       a piece past its deadline — its hat and the channel's admins
//   assigned   new work, a booking asked, and the crew's yes/no to the owner
//   mention    somebody named with @
//
// …in the reader's own language, and never about their own act. Everything
// else — stage moves one at a time or ten at once, publishing, approvals,
// date asks, comments nobody was named in — is the bell's alone, and the bell
// still logs it.
//
// Self-contained: API :4129, Telegram mock :9929.
//   DASHB_ROOT=$PWD node qa/tgdiet-suite.mjs
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = fileURLToPath(new URL('.', import.meta.url))
const BASE = 'http://localhost:4129'
const MOCK = 'http://localhost:9929'
const TOKEN = 'tgdiet-test-token'
const SECRET = createHash('sha256').update(`satashkent:${TOKEN}`).digest('hex').slice(0, 40)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (args, env) => { const p = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })

boot([join(SP, 'mock-tg.mjs')], { MOCK_PORT: '9929' })
boot([join(ROOT, 'server/index.js')], {
  DATA_DIR: join(tmpdir(), `tgdiet-${Date.now()}`), PORT: '4129',
  TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE: MOCK,
  GITHUB_DATA_TOKEN: '', GH_DATA_TOKEN: '', DATABASE_URL: '', CRON_SECRET: '',
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
const hook = (update) => fetch(BASE + '/api/telegram/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  body: JSON.stringify(update),
})
const sentList = async () => (await (await fetch(MOCK + '/__sent')).json()).filter((m) => (m.method || 'sendMessage') === 'sendMessage')
const reset = () => fetch(MOCK + '/__reset', { method: 'POST' })
const to = (sent, chat) => sent.filter((m) => String(m.chat_id) === String(chat))
const bell = async (tok, id) => ((await req('/notifications', 'GET', null, tok)).data.events || []).filter((e) => e.content_id === id)
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 864e5))

const statuses = (await req('/statuses')).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const IDEA = sid(/^idea$/i), EDITING = sid(/^editing$/i), READY = sid(/^ready$/i)
const FINAL = statuses.find((s) => s.is_final)?.id
const chKey = (await req('/channels')).data.find((c) => c.format === 'social')?.key

const mk = async (name, username, role, departments = [chKey]) =>
  (await req('/users', 'POST', { name, username, password: 'probe1234', role, departments })).data
const rev = await mk('Rana Reviewer', 'dt_rev', 'member')
const ed = await mk('Eldor Editor', 'dt_ed', 'editor', [])
const op = await mk('Otabek Operator', 'dt_op', 'operator', [])
const own = await mk('Orzu Owner', 'dt_own', 'member')
const smm = await mk('Sami Other', 'dt_smm', 'member')
const both = await mk('Bahrom Both', 'dt_both', 'member')
const tok = {}
for (const u of ['dt_rev', 'dt_ed', 'dt_op', 'dt_own', 'dt_smm', 'dt_both']) tok[u] = await login(u, 'probe1234')
const CHAT = { admin: 800, rev: 801, ed: 802, op: 803, own: 804, smm: 805, both: 806 }
for (const [t, chat] of [[T, CHAT.admin], [tok.dt_rev, CHAT.rev], [tok.dt_ed, CHAT.ed], [tok.dt_op, CHAT.op],
  [tok.dt_own, CHAT.own], [tok.dt_smm, CHAT.smm], [tok.dt_both, CHAT.both]]) {
  const l = (await req('/telegram/link', 'POST', {}, t)).data
  await hook({ message: { chat: { id: chat }, text: `/start ${l.code}` } })
}

// ===================== new work is worth a buzz =====================
await reset()
const a = (await req('/content', 'POST', {
  title: 'Diet: the cut', channels: [chKey], type: 'video', status_id: EDITING,
  editor_id: ed.id, operator_id: op.id, reviewer_ids: [rev.id], assignee_ids: [own.id],
})).data
let sent = await sentList()
ok('handing work to people reaches them (📌)', to(sent, CHAT.ed).some((m) => /📌/.test(m.text)) && to(sent, CHAT.op).some((m) => /📌/.test(m.text)), JSON.stringify(sent.map((m) => m.chat_id)))

// ===================== moving cards is silent =====================
await reset()
for (const s of [IDEA, EDITING, READY, EDITING]) await req(`/content/${a.id}`, 'PATCH', { status_id: s })
sent = await sentList()
ok('moving a task freely between stages sends 0 Telegram messages — Ready included', sent.length === 0, JSON.stringify(sent.map((m) => [m.chat_id, m.text?.slice(0, 30)])))
ok('…while the bell logs every move', (await bell(tok.dt_own, a.id)).filter((e) => e.kind === 'status').length >= 3)
ok('…and the reviewer’s bell still has the drag onto Ready (the dashboard ding)', (await bell(tok.dt_rev, a.id)).some((e) => e.kind === 'review'))

const ten = []
for (let i = 1; i <= 10; i++) ten.push((await req('/content', 'POST', { title: `Diet: bulk ${i}`, channels: [chKey], type: 'post', status_id: IDEA })).data)
await reset()
for (const t of ten) await req(`/content/${t.id}`, 'PATCH', { status_id: EDITING })
for (const t of ten) await req(`/content/${t.id}`, 'PATCH', { status_id: READY })
ok('an admin bulk-moving 10 tasks, twice, sends 0 Telegram messages', (await sentList()).length === 0, String((await sentList()).length))

// ===================== a hand-in reaches the reviewer, once =====================
await reset()
let r = await req(`/content/${a.id}`, 'PATCH', { ready_link: 'https://drive.google.com/diet-cut-1', milestone: 'edited' }, tok.dt_ed)
ok('the editor hands the cut in', r.status === 200 && r.data.status_id === READY, `${r.status} ${r.data.error || ''}`)
sent = await sentList()
ok('delivering the ready_link sends exactly 1 Telegram message…', sent.length === 1, JSON.stringify(sent.map((m) => m.chat_id)))
ok('…to the reviewer, in the spec’s words', to(sent, CHAT.rev).length === 1 && /✅ Work ready for review: <b>«Diet: the cut»<\/b>/.test(to(sent, CHAT.rev)[0].text), to(sent, CHAT.rev)[0]?.text)
ok('…with the file to watch', /diet-cut-1/.test(to(sent, CHAT.rev)[0]?.text || ''))

// ===================== a pravka reaches the fixer, once =====================
await reset()
r = await req(`/content/${a.id}/revisions`, 'POST', { note: 'The music is too loud at 0:40', target: 'editor' }, tok.dt_rev)
ok('the reviewer sends it back', r.status === 201, `${r.status} ${r.data.error || ''}`)
sent = await sentList()
ok('a pravka sends exactly 1 Telegram message…', sent.length === 1, JSON.stringify(sent.map((m) => m.chat_id)))
ok('…to the editor — not the operator on the same video', to(sent, CHAT.ed).length === 1 && to(sent, CHAT.op).length === 0)
ok('…in the spec’s words, the note with it', /📝 Pravka requested on: <b>«Diet: the cut»<\/b>/.test(to(sent, CHAT.ed)[0]?.text || '') && /too loud at 0:40/.test(to(sent, CHAT.ed)[0]?.text || ''),
  to(sent, CHAT.ed)[0]?.text)

// The fix is a delivery too — to the reviewer, once.
const open = (await req(`/content/${a.id}`)).data.revisions.find((v) => !v.resolved_at)
await reset()
await req(`/content/revisions/${open.id}/resolve`, 'POST', { link: 'https://drive.google.com/diet-cut-2' }, tok.dt_ed)
sent = await sentList()
ok('pressing "Fixed" reaches the reviewer once, and nobody else', sent.length === 1 && to(sent, CHAT.rev).length === 1, JSON.stringify(sent.map((m) => m.chat_id)))

// ===================== in the reader's language =====================
ok('a person can tell the server which language they read', (await req('/users/me', 'PATCH', { lang: 'ru' }, tok.dt_ed)).data.lang === 'ru')
ok('…and only a language the bot speaks', (await req('/users/me', 'PATCH', { lang: 'fr' }, tok.dt_ed)).status === 400)
await reset()
await req(`/content/${a.id}/revisions`, 'POST', { note: 'Субтитры съехали', target: 'editor' }, tok.dt_rev)
sent = await sentList()
ok('the editor who reads Russian gets the pravka in Russian', /📝 Новая правка: <b>«Diet: the cut»<\/b>/.test(to(sent, CHAT.ed)[0]?.text || '') && /Открыть задачу/.test(to(sent, CHAT.ed)[0]?.text || ''),
  to(sent, CHAT.ed)[0]?.text)

// ===================== nobody hears about their own act =====================
const b = (await req('/content', 'POST', {
  title: 'Diet: two hats', channels: [chKey], type: 'video', status_id: EDITING,
  editor_id: both.id, reviewer_ids: [both.id], assignee_ids: [own.id],
})).data
await reset()
r = await req(`/content/${b.id}`, 'PATCH', { ready_link: 'https://drive.google.com/diet-both', milestone: 'edited' }, tok.dt_both)
ok('the reviewer who is also the editor hands in', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and is not told about it', to(await sentList(), CHAT.both).length === 0)

// ===================== the rest is the bell's =====================
await reset()
await req(`/content/${a.id}/comments`, 'POST', { text: 'Looks good so far' }, tok.dt_rev)
ok('a comment nobody is named in: 0 Telegram messages', (await sentList()).length === 0)
await reset()
await req(`/content/${a.id}/comments`, 'POST', { text: '@Sami Other can you check the captions?' }, tok.dt_rev)
sent = await sentList()
ok('naming somebody in the Talk tab reaches exactly them — even off the task', sent.length === 1 && to(sent, CHAT.smm).length === 1, JSON.stringify(sent.map((m) => m.chat_id)))
{
  // A reminder rings the bell of the one person it names and of nobody else on the task.
  const before = (await bell(tok.dt_ed, a.id)).length
  const mine = (await bell(tok.dt_smm, a.id)).length
  await req(`/content/${a.id}/comments`, 'POST', { text: '@Sami Other — a reminder: this task is waiting for you.', remind: true }, tok.dt_rev)
  ok('a reminder rings only the person it names', (await bell(tok.dt_ed, a.id)).length === before && (await bell(tok.dt_smm, a.id)).length === mine + 1)
}

const c = (await req('/content', 'POST', {
  title: 'Diet: approve me', channels: [chKey], type: 'video', status_id: EDITING, editor_id: ed.id, reviewer_ids: [rev.id],
})).data
await req(`/content/${c.id}`, 'PATCH', { ready_link: 'https://drive.google.com/diet-c', milestone: 'edited' }, tok.dt_ed)
await reset()
await req(`/content/${c.id}/approve`, 'POST', {}, tok.dt_rev)
ok('an approval: 0 Telegram messages', (await sentList()).length === 0)
ok('…the editor’s bell has it', (await bell(tok.dt_ed, c.id)).some((e) => /approved by Rana Reviewer/.test(e.text)))
await reset()
await req(`/content/${c.id}`, 'PATCH', { status_id: FINAL, post_link: 'https://instagram.com/p/diet' })
ok('publishing: 0 Telegram messages', (await sentList()).length === 0)
const d = (await req('/content', 'POST', { title: 'Diet: a dated piece', channels: [chKey], type: 'post', status_id: EDITING, release_date: day(5) })).data
await reset()
r = await req(`/content/${d.id}/date-requests`, 'POST', { field: 'release_date', to: day(7), reason: 'The speaker moved the event' }, tok.dt_rev)
ok('asking to move a date: 0 Telegram messages (the admins have it in the bell)', r.status < 300 && (await sentList()).length === 0, `${r.status} ${r.data.error || ''}`)

// ===================== late =====================
const late = (await req('/content', 'POST', {
  title: 'Diet: the late cut', channels: [chKey], type: 'video', status_id: EDITING,
  editor_id: ed.id, operator_id: op.id, edit_ready_date: day(-4), release_date: day(2),
})).data
await reset()
await fetch(BASE + '/api/cron/daily')
sent = await sentList()
ok('a piece past its deadline warns its hat — in their language', /🚨 ПРОСРОЧЕНО: <b>«Diet: the late cut»<\/b>/.test(to(sent, CHAT.ed).map((m) => m.text).join('\n')),
  to(sent, CHAT.ed).map((m) => m.text).join(' | '))
ok('…and the admin', /🚨 LATE: <b>«Diet: the late cut»<\/b>/.test(to(sent, CHAT.admin).map((m) => m.text).join('\n')), to(sent, CHAT.admin).map((m) => m.text).join(' | '))
ok('…but not the operator, whose part is done', !to(sent, CHAT.op).some((m) => /Diet: the late cut/.test(m.text)))
void late

// ===================== bookings, and their answers =====================
const e = (await req('/content', 'POST', { title: 'Diet: the shoot', channels: [chKey], type: 'video', status_id: EDITING, assignee_ids: [own.id] })).data
await reset()
r = await req(`/content/${e.id}`, 'PATCH', { operator_id: op.id, recording_date: day(3), recording_time: '10:00', recording_end: '11:00' })
sent = await sentList()
ok('booking a shoot asks the operator', r.status === 200 && to(sent, CHAT.op).some((m) => /🗓|📌/.test(m.text)), `${r.status} ${r.data.error || ''} ${JSON.stringify(sent.map((m) => m.chat_id))}`)
await reset()
r = await req(`/content/${e.id}/confirm`, 'POST', { which: 'shoot', ok: true }, tok.dt_op)
sent = await sentList()
ok('the operator’s yes reaches the task’s owner', r.status === 200 && to(sent, CHAT.own).length === 1 && /confirmed/.test(to(sent, CHAT.own)[0].text), `${r.status} ${r.data.error || ''} ${JSON.stringify(sent.map((m) => m.chat_id))}`)
ok('…and only the owner — the admin has it in the bell', to(sent, CHAT.admin).length === 0)

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

// When a content maker is paid for a piece.
//
// The maker's line used to be dated by the day the piece went out, so their
// pay waited on everybody after them and disappeared if the piece was killed.
// The rule since 1 October 2026 (makerDay in server/routes/reports.js):
//
//   a filmed piece, or a designed post   the day it reached Editing
//   a written piece (Telegram)           the day it was published
//
// …and a part that was finished stays paid whatever happens to the piece
// afterwards: the maker's and the operator's on a piece killed in Editing, and
// the editor's too once the cut was handed in — but not before.
//
// A designed post cannot reach Editing without its ТЗ, which is the other
// half of the rule and is pinned here with it.
//
// Anything that reached Editing BEFORE the rule began keeps the old dating —
// the day it goes out — so no piece falls between two months. That half needs
// a stamp the API never takes from anybody, so it is written straight into
// the database and only runs when the suite is told where that is (DATA_DIR,
// the way statsviz-suite is handed it).
//
//   node qa/makerpay-suite.mjs                          (expects a server on :4090)
//   DATA_DIR=<that server's DATA_DIR> node qa/makerpay-suite.mjs
import { join } from 'path'

const BASE = process.env.BASE || 'http://localhost:4090'
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
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 864e5))
const monthStart = `${day().slice(0, 7)}-01`
const statuses = (await req('/statuses')).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const SHOOT = sid(/^to shoot$/i), EDITING = sid(/^editing$/i), READY = sid(/^ready$/i), DELETED = sid(/^deleted$/i)
const FINAL = statuses.find((s) => s.is_final)?.id
const chans = (await req('/channels')).data
const IG = chans.find((c) => c.format === 'social')?.key
const TG = chans.find((c) => c.format === 'text')?.key

const sfx = Date.now().toString(36).slice(-5)
const mk = async (name, u, body) => (await req('/users', 'POST', { name, username: u + sfx, password: 'pw123456', ...body })).data
const maker = await mk('Malika Maker', 'mm', { role: 'member', departments: [IG], permissions: { manage_content: true, move_tasks: true } })
const second = await mk('Sardor Second', 'ms', { role: 'member', departments: [IG] })
const writer = await mk('Wali Writer', 'mw', { role: 'member', departments: [TG], permissions: { manage_content: true, move_tasks: true, review_publish: true } })
const op = await mk('Olim Operator', 'mo', { role: 'operator' })
const ed = await mk('Ezgu Editor', 'me', { role: 'editor' })
const MT = await login('mm' + sfx, 'pw123456')
const WT = await login('mw' + sfx, 'pw123456')
// Each person reads their OWN payslip, the way the Payment page does.
const tokenOf = new Map([[maker.id, MT], [writer.id, WT]])
for (const [u, name] of [[second, 'ms'], [op, 'mo'], [ed, 'me']]) tokenOf.set(u.id, await login(name + sfx, 'pw123456'))

// A card of their own for each of them — not the board's default, which the
// other suites on this shared stack are entitled to find as they left it.
for (const u of [maker, second, writer, op, ed])
  await req(`/reports/pay/rules/${u.id}`, 'PUT', { currency: 'UZS', scheme: 'piece', per_publish: 100000, per_shoot: 40000, per_edit: 50000 })
const payOf = async (u) => (await req(`/reports/pay/mine?from=${monthStart}&to=${day()}`, 'GET', undefined, tokenOf.get(u.id))).data || {}
const lineOf = (pay, id, hat) => (pay.items || []).find((i) => i.id === id && i.hat === hat)

let n = 0
const reel = async (over = {}) => {
  n += 1
  const r = await req('/content', 'POST', {
    title: `MP reel ${n} ${sfx}`, channels: [IG], type: 'reel', assignee_ids: [maker.id], operator_id: op.id, editor_id: ed.id,
    recording_date: day(), recording_time: `${String(8 + n).padStart(2, '0')}:00`, recording_end: `${String(9 + n).padStart(2, '0')}:00`,
    edit_ready_date: day(2), release_date: day(5),
    script: `Take ${n} ${sfx}: open on the gate, three students answer one question each, close on the logo.`,
    tz: 'Cut to 45 seconds, subtitles in Uzbek, logo sting at the end.', reference_text: `https://instagram.com/p/mp-${n}-${sfx}`,
    ...over,
  })
  return r.data
}
const move = (t, status_id, extra = {}, tok = T) => req(`/content/${t.id}`, 'PATCH', { status_id, ...extra }, tok)

// ---- a filmed piece is the maker's from the day it reached Editing ----------
const live = await reel()
await move(live, SHOOT)
let pay = await payOf(maker)
ok('booked but not yet in Editing: nothing for the maker', !lineOf(pay, live.id, 'assignee'), JSON.stringify(lineOf(pay, live.id, 'assignee')))
let r = await move(live, EDITING, { shot_link: `https://drive.google.com/mp-raw-${sfx}` })
ok('(the reel reaches Editing)', r.status === 200 && r.data.status_id === EDITING, `${r.status} ${r.data.error || ''}`)
pay = await payOf(maker)
ok('in Editing, not published: the maker is paid for it', lineOf(pay, live.id, 'assignee')?.amount === 100000, JSON.stringify(lineOf(pay, live.id, 'assignee')))
ok('…dated today, the day it got there', lineOf(pay, live.id, 'assignee')?.day === day(), String(lineOf(pay, live.id, 'assignee')?.day))

// ---- pulled back in front of the gate, it waits; returned, it is back -------
await move(live, SHOOT)
ok('pulled back in front of Editing, the line waits', !lineOf(await payOf(maker), live.id, 'assignee'))
await move(live, EDITING)
ok('…and is back when the piece is', lineOf(await payOf(maker), live.id, 'assignee')?.amount === 100000)

// ---- killed in Editing: the finished parts stay paid -------------------------
const killed = await reel()
await move(killed, SHOOT); await move(killed, EDITING, { shot_link: `https://drive.google.com/mp-raw2-${sfx}` })
r = await move(killed, DELETED)
ok('(the reel is killed)', r.status === 200 && r.data.status_id === DELETED, `${r.status} ${r.data.error || ''}`)
ok('killed after Editing: the maker keeps the piece', lineOf(await payOf(maker), killed.id, 'assignee')?.amount === 100000)
ok('…the operator keeps the shoot', lineOf(await payOf(op), killed.id, 'operator')?.amount === 40000)
ok('…and the editor, who never handed in a cut, has nothing', !lineOf(await payOf(ed), killed.id, 'editor'))

const cutThenKilled = await reel()
await move(cutThenKilled, SHOOT); await move(cutThenKilled, EDITING, { shot_link: `https://drive.google.com/mp-raw3-${sfx}` })
await move(cutThenKilled, READY, { ready_link: `https://drive.google.com/mp-cut3-${sfx}` }); await move(cutThenKilled, DELETED)
ok('killed after the cut was in: the editor is paid for the cut', lineOf(await payOf(ed), cutThenKilled.id, 'editor')?.amount === 50000)

const d = (await req(`/reports/delivery/person/${maker.id}?month=${day().slice(0, 7)}`)).data
const listed = (d.blocks || []).find((b) => b.hat === 'assignee')
ok('the tally under the payslip lists the killed piece too', (listed?.pending || []).some((p) => p.id === killed.id && /deleted/i.test(p.stage || '')), JSON.stringify(listed?.pending))

// ---- two makers: each is paid in full ---------------------------------------
const shared = await reel({ assignee_ids: [maker.id, second.id] })
await move(shared, SHOOT); await move(shared, EDITING, { shot_link: `https://drive.google.com/mp-raw4-${sfx}` })
ok('two makers on one piece: the first is paid in full', lineOf(await payOf(maker), shared.id, 'assignee')?.amount === 100000)
ok('…and so is the second', lineOf(await payOf(second), shared.id, 'assignee')?.amount === 100000)

// ---- a designed post: its ТЗ, then Editing ----------------------------------
const post = (await req('/content', 'POST', { title: `MP post ${sfx}`, channels: [IG], type: 'post', release_date: day(4) }, MT)).data
r = await move(post, EDITING, {}, MT)
ok('a designed post with no ТЗ does not move to Editing', r.status === 400 && r.data.field === 'tz', `${r.status} ${r.data.error || ''}`)
r = await move(post, EDITING, { tz: '.' }, MT)
ok('…nor with a dot for one', r.status === 400, `${r.status} ${r.data.error || ''}`)
r = await move(post, EDITING, { tz: 'Square 1080, three slides, the deadline date set large on the first one.' }, MT)
ok('…and moves with a real one', r.status === 200 && r.data.status_id === EDITING, `${r.status} ${r.data.error || ''}`)
ok('…which makes it a paying task for its maker', lineOf(await payOf(maker), post.id, 'assignee')?.amount === 100000)

// ---- a written piece is paid when it goes out, not when writing starts ------
const tg = (await req('/content', 'POST', { title: `MP telegram ${sfx}`, channels: [TG], type: 'post', telegram_type: 'just_post', description: 'Weekly channel post' }, WT)).data
r = await move(tg, EDITING, {}, WT)
ok('a Telegram post moves into Writing with no ТЗ asked', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…and is not paid while it is being written', !lineOf(await payOf(writer), tg.id, 'assignee'))
r = await move(tg, FINAL, { post_link: `https://t.me/satashkent/mp-${sfx}` }, WT)
ok('(the post is published)', r.status === 200 && !!r.data.done_at, `${r.status} ${r.data.error || ''}`)
ok('…and is paid once it is out', lineOf(await payOf(writer), tg.id, 'assignee')?.amount === 100000)

// ---- before the rule began: the old dating, so nothing falls between months --
const dbFile = process.env.DATA_DIR ? join(process.env.DATA_DIR, 'dashboard.db') : null
if (dbFile) {
  const { createClient } = await import('@libsql/client')
  const db = createClient({ url: `file:${dbFile}`, intMode: 'number' })
  const old = await reel()
  await move(old, SHOOT); await move(old, EDITING, { shot_link: `https://drive.google.com/mp-raw5-${sfx}` })
  await db.execute({ sql: 'UPDATE content SET shot_at = ? WHERE id = ?', args: ['2026-09-20T08:00:00.000Z', old.id] })
  ok('reached Editing in September: not paid on that day', !lineOf(await payOf(maker), old.id, 'assignee'))
  await move(old, READY, { ready_link: `https://drive.google.com/mp-cut5-${sfx}` })
  r = await move(old, FINAL, { post_link: `https://instagram.com/p/mp-old-${sfx}` })
  ok('(it is published)', r.status === 200 && !!r.data.done_at, `${r.status} ${r.data.error || ''}`)
  const line = lineOf(await payOf(maker), old.id, 'assignee')
  ok('…paid the old way, on the day it went out', line?.amount === 100000 && line?.day >= monthStart, JSON.stringify(line))
  db.close()
} else console.log('· no DATA_DIR for the server at BASE — the check that needs a September stamp is skipped (CI passes it)')

console.log(fails ? `\n${fails} FAILED` : '\nMaker pay holds.')
process.exit(fails ? 1 : 0)

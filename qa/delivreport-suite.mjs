// The Monthly Delivery Report: what somebody delivered, counted.
//
// "Did I edit 15 reels this month or 16?" — the payslip gave a total and
// nobody the tally behind it. /reports/delivery/… is that tally, built from
// the same list the pay run is:
//
//   BY HAT, THEN BY KIND. A block per hat the person wore that month (edited,
//   filmed, designed, written/managed…), rows per kind of piece — and for a
//   written piece, its Telegram item type, with guiding posts in a row of
//   their own. A hat they did not wear has no block.
//
//   ON THE DAY IT WAS DELIVERED. A cut due last month and handed in today is
//   in THIS month. The planned day decides nothing.
//
//   COUNTED ONCE IT IS AT READY. A piece that has not got there — a shoot
//   whose cut is still being made, a cut sent back for a pravka — is listed
//   apart as pending, not counted. A cut never handed in is nowhere.
//
//   EVERY COUNT OPENS. Each row carries the task titles and days behind it.
//
//   node qa/delivreport-suite.mjs        (expects a server on :4090)
import { readFileSync } from 'fs'
import { join } from 'path'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
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
const thisMonth = day().slice(0, 7)
const lastMonth = (() => { const d = new Date(`${thisMonth}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) })()
const statuses = (await req('/statuses')).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const SHOOT = sid(/^to shoot$/i), EDITING = sid(/^editing$/i), READY = sid(/^ready$/i)
const FINAL = statuses.find((s) => s.is_final)?.id
const chans = (await req('/channels')).data
const IG = chans.find((c) => c.format === 'social')?.key
const YT = chans.find((c) => c.format === 'video')?.key
const TG = chans.find((c) => c.format === 'text')?.key

const sfx = Date.now().toString(36).slice(-5)
const mk = async (name, u, body) => (await req('/users', 'POST', { name, username: u + sfx, password: 'pw123456', ...body })).data
const ed = await mk('Ezoza Editor', 'de', { role: 'editor' })
const mh = await mk('Murod Multi', 'dm', { role: 'crew', crew_roles: ['operator', 'editor'] })
const cw = await mk('Charos Copywriter', 'dc', { role: 'member', departments: [TG] })
const out = await mk('Otabek Other', 'do', { role: 'member', departments: [IG] })
const ET = await login('de' + sfx, 'pw123456')
const MT = await login('dm' + sfx, 'pw123456')
const CT = await login('dc' + sfx, 'pw123456')
const OT = await login('do' + sfx, 'pw123456')

const task = async (body) => (await req('/content', 'POST', { channels: [IG], type: 'reel', status_id: EDITING, ...body })).data
const cut = (id, tok, n = 1) => req(`/content/${id}`, 'PATCH', { ready_link: `https://drive.google.com/dr-${id}-${n}`, milestone: 'edited' }, tok)

// ---- the editor's month ----
const t1 = await task({ title: 'DR reel one', editor_id: ed.id })
const t2 = await task({ title: 'DR youtube video', channels: [YT], type: 'video', editor_id: ed.id })
const t3 = await task({ title: 'DR reel due last month', editor_id: ed.id, edit_ready_date: `${lastMonth}-20` })
const t4 = await task({ title: 'DR reel never handed in', editor_id: ed.id })
const t5 = await task({ title: 'DR reel sent back', editor_id: ed.id })
for (const t of [t1, t2, t3, t5]) {
  const r = await cut(t.id, ET)
  if (r.status !== 200 || r.data.status_id !== READY) ok(`(hand-in of ${t.title})`, false, `${r.status} ${r.data.error || r.data.status_id}`)
}
await req(`/content/${t5.id}/revisions`, 'POST', { note: 'Recut the ending', target: 'editor' })

// ---- two hats on one person ----
const t6 = await task({ title: 'DR shot and cut', status_id: SHOOT, operator_id: mh.id, editor_id: ed.id, recording_date: day(0) })
const t7 = await task({ title: 'DR shot, cut pending', status_id: SHOOT, operator_id: mh.id, editor_id: ed.id, recording_date: day(0) })
for (const t of [t6, t7]) {
  const r = await req(`/content/${t.id}`, 'PATCH', { shot_link: `https://drive.google.com/dr-footage-${t.id}`, milestone: 'shot' }, MT)
  if (r.status !== 200) ok(`(footage hand-in of ${t.title})`, false, `${r.status} ${r.data.error || ''}`)
}
await cut(t6.id, ET)
const t8 = await task({ title: 'DR cut by the operator', editor_id: mh.id })
await cut(t8.id, MT)

// ---- the copywriter's month ----
const post = async (title, extra) => {
  const t = (await req('/content', 'POST', { title, channels: [TG], type: 'post', status_id: EDITING, assignee_ids: [cw.id], description: 'Weekly channel post', ...extra })).data
  const p = await req(`/content/${t.id}`, 'PATCH', { status_id: FINAL, post_link: `https://t.me/satashkent/${t.id}` })
  if (p.status !== 200) ok(`(publishing ${title})`, false, `${p.status} ${p.data.error || ''}`)
  return t
}
const p1 = await post('DR post plus, guiding', { telegram_type: 'post_plus', is_guiding: true })
const p2 = await post('DR just a post', { telegram_type: 'just_post' })
const p3 = await post('DR webinar', { telegram_type: 'webinar' })

// ===================== the editor reads their own =====================
let r = await req(`/reports/delivery/mine?month=${thisMonth}`, 'GET', null, ET)
const mine = r.data
const block = (d, hat) => (d.blocks || []).find((b) => b.hat === hat)
const row = (b, key) => (b?.rows || []).find((x) => x.key === key)
const titles = (x) => (x?.items || []).map((i) => i.title)
ok('the report answers for the month asked', r.status === 200 && mine.month === thisMonth, `${r.status} ${JSON.stringify(mine).slice(0, 120)}`)
const eb = block(mine, 'editor')
ok('Reels edited: counted, and every one of them named', row(eb, 'reel')?.count === 3
  && ['DR reel one', 'DR reel due last month', 'DR shot and cut'].every((t) => titles(row(eb, 'reel')).includes(t)), JSON.stringify(row(eb, 'reel')))
ok('YouTube videos are their own count', row(eb, 'youtube')?.count === 1 && titles(row(eb, 'youtube'))[0] === 'DR youtube video')
ok('each item carries the day it was delivered', row(eb, 'reel')?.items.every((i) => i.day === day(0)), JSON.stringify(row(eb, 'reel')?.items.map((i) => i.day)))
ok('a cut due LAST month and handed in today is in THIS month', titles(row(eb, 'reel')).includes('DR reel due last month'))
ok('a cut sent back for a pravka is not counted — it is listed as still in the works', !titles(row(eb, 'reel')).includes('DR reel sent back')
  && (eb?.pending || []).some((p) => p.title === 'DR reel sent back' && /editing/i.test(p.stage || '')), JSON.stringify(eb?.pending))
ok('a cut never handed in is nowhere', !JSON.stringify(mine).includes('DR reel never handed in'))
ok('the block’s total is what was counted', eb?.total === 4, String(eb?.total))
ok('a hat they did not wear has no block at all', !block(mine, 'operator') && !block(mine, 'designer') && !block(mine, 'assignee'), (mine.blocks || []).map((b) => b.hat).join(','))
r = await req(`/reports/delivery/mine?month=${lastMonth}`, 'GET', null, ET)
ok('last month has none of it — the planned day decides nothing', r.status === 200 && (r.data.blocks || []).length === 0, JSON.stringify(r.data.blocks))

// ===================== two hats, two tallies =====================
const multi = (await req(`/reports/delivery/mine?month=${thisMonth}`, 'GET', null, MT)).data
const ob = block(multi, 'operator'), mb = block(multi, 'editor')
ok('a crew member who filmed AND edited sees a block for each', !!ob && !!mb, (multi.blocks || []).map((b) => b.hat).join(','))
ok('…shoots filmed: the piece that reached Ready', row(ob, 'reel')?.count === 1 && titles(row(ob, 'reel'))[0] === 'DR shot and cut', JSON.stringify(ob?.rows))
ok('…the shoot whose cut is still being made waits in pending', (ob?.pending || []).some((p) => p.title === 'DR shot, cut pending'))
ok('…and their own edit, separately', row(mb, 'reel')?.count === 1 && titles(row(mb, 'reel'))[0] === 'DR cut by the operator')

// ===================== the copywriter =====================
const words = (await req(`/reports/delivery/mine?month=${thisMonth}`, 'GET', null, CT)).data
const ab = block(words, 'assignee')
ok('written work is told apart by its Telegram item type', row(ab, 'tg:just_post')?.count === 1 && row(ab, 'tg:post_plus')?.count === 1 && row(ab, 'tg:webinar')?.count === 1,
  JSON.stringify(ab?.rows?.map((x) => [x.key, x.count])))
ok('guiding posts are counted in a row of their own — on top, not instead', row(ab, 'guiding')?.count === 1 && titles(row(ab, 'guiding'))[0] === 'DR post plus, guiding' && ab?.total === 3)

// ===================== who may read whose =====================
r = await req(`/reports/delivery/person/${ed.id}?month=${thisMonth}`)
ok('an admin opening somebody’s pay sees THAT person’s tally', r.status === 200 && r.data.person?.name === 'Ezoza Editor'
  && row(block(r.data, 'editor'), 'reel')?.count === 3, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`)
ok('a colleague may not read it', (await req(`/reports/delivery/person/${ed.id}?month=${thisMonth}`, 'GET', null, OT)).status === 403)
ok('…but anybody may read their own through the same door', (await req(`/reports/delivery/person/${ed.id}?month=${thisMonth}`, 'GET', null, ET)).status === 200)
void out; void p1; void p2; void p3; void t4

// ===================== the page =====================
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const docs = read('client/src/pages/Docs.jsx')
ok('the report sits directly under the pay totals on the Payment page', docs.indexOf('<MyPay startOpen />') > 0 && docs.indexOf('<DeliveryReport />') > docs.indexOf('<MyPay startOpen />'))
const pr = read('client/src/components/PayReport.jsx')
ok('…and inside a person’s pay window, for that person and that month', /<DeliveryReport userId=\{userId\} month=\{month\} \/>/.test(pr))
const comp = read('client/src/components/DeliveryReport.jsx')
ok('a month dropdown, defaulting to the current payroll month', /monthOf\(todayISO\(\)\)/.test(comp) && /<select className="select dr-month"/.test(comp))
ok('every count has an expand control that opens the task list', /aria-expanded=\{open\}/.test(comp) && /tx\('Expand to verify'\)/.test(comp) && /dr-items/.test(comp))
const i18n = read('client/src/lib/i18n.jsx')
for (const [en, ru, uz] of [
  ['Monthly Delivery Report', 'Ежемесячный отчет по задачам', 'Oylik vazifalar hisoboti'],
  ['Reels edited', 'Смонтировано рилсов', 'Montaj qilingan reellar'],
  ['Shoots filmed', 'Проведено съемок', 'Suratga olingan videolar'],
  ['Expand to verify', 'Развернуть для проверки', 'Tekshirish uchun yoyish'],
]) ok(`“${en}” reads as the spec wrote it`, i18n.includes(`"${en}": "${ru}"`) && i18n.includes(`"${en}": "${uz}"`))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

// A person's work in their phone's calendar (server/routes/calendar.js).
//
// The owner, 13 Oct: "members' tasks go to Apple Calendar, automatically".
// Each person turns on one private iCalendar address (Profile → Calendar on
// your phone); Apple Calendar subscribes and fetches it again by itself.
//
//   1  THE LINK. Off until asked for; signed-in only; a new link kills the
//      old one; turning it off kills it; nonsense tokens are 404.
//   2  WHAT IS IN IT. The operator gets the shoot at its hours (Tashkent wall
//      clock written as UTC), tentative until they said yes; the editor the
//      edit's day; the designer the design's day; the maker the shoot and the
//      day it goes out. Nobody gets anybody else's work.
//   3  IT FOLLOWS THE BOARD. A moved shoot moves; a delivered part is ✓; a
//      deleted piece leaves; a removed person's link is dead.
//   4  IT IS A CALENDAR. CRLF, lines folded at 75 octets, text escaped.
//
//   node qa/calfeed-suite.mjs           (expects a server on :4090)
const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const A = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = A) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const feed = async (path) => { const r = await fetch(BASE + path); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() } }
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 86400000))
const ymd = (d) => d.replace(/-/g, '')
// The VEVENT for one task and kind, unfolded, as a map of its lines.
const eventOf = (ics, id, kind) => {
  const flat = ics.replace(/\r\n /g, '')
  const m = flat.split('BEGIN:VEVENT').find((b) => b.includes(`UID:task-${id}-${kind}@`))
  if (!m) return null
  return Object.fromEntries(m.split('\r\n').filter((l) => l.includes(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]))
}

const statuses = (await req('/statuses')).data
const idea = statuses.find((s) => /^idea$/i.test(s.label))
const deleted = statuses.find((s) => /^deleted$/i.test(s.label))
const CH = 'instagram_main'
const sfx = Date.now().toString(36).slice(-5)
const mk = async (b) => (await req('/users', 'POST', { password: 'pw123456', ...b })).data
const maker = await mk({ name: 'Calendar Maker', username: 'cm' + sfx, role: 'member', departments: [CH], permissions: { manage_content: true, move_tasks: true } })
const op = await mk({ name: 'Calendar Films', username: 'cf' + sfx, role: 'operator' })
const ed = await mk({ name: 'Calendar Edits', username: 'ce' + sfx, role: 'editor' })
const des = await mk({ name: 'Calendar Draws', username: 'cd' + sfx, role: 'designer' })
const stranger = await mk({ name: 'Calendar Elsewhere', username: 'cx' + sfx, role: 'editor' })
const MT = await login('cm' + sfx, 'pw123456'), OT = await login('cf' + sfx, 'pw123456')
const ET = await login('ce' + sfx, 'pw123456'), DT = await login('cd' + sfx, 'pw123456'), XT = await login('cx' + sfx, 'pw123456')
await req('/users/me', 'PATCH', { lang: 'ru' }, OT) // the operator reads Russian
ok('(a maker, an operator, an editor, a designer and somebody on none of it)', !!(maker.id && op.id && ed.id && des.id && stranger.id && MT && OT && ET && DT && XT))

// ===================== 1 the link =====================
ok('off until the person asks for it', (await req('/calendar/link', 'GET', null, OT)).data.path === null)
ok('only for somebody signed in', (await req('/calendar/link', 'GET', null, null)).status === 401)
const links = {}
for (const [k, t] of [['op', OT], ['ed', ET], ['des', DT], ['maker', MT], ['x', XT]]) links[k] = (await req('/calendar/link', 'POST', {}, t)).data.path
ok('turned on, it is a private .ics address', /^\/api\/calendar\/feed\/[\w-]{20,}\.ics$/.test(links.op || ''), links.op)
ok('and everybody gets their own', new Set(Object.values(links)).size === 5)
ok('a made-up token is nobody’s calendar', (await feed('/api/calendar/feed/' + 'x'.repeat(32) + '.ics')).status === 404 && (await feed('/api/calendar/feed/abc.ics')).status === 404)

// ===================== 2 what is in it =====================
const shoot = day(2), editDay = day(4), designDay = day(5), out = day(6)
const t1 = (await req('/content', 'POST', {
  channels: [CH], type: 'reel', title: `Calendar, test; reel ${sfx}`, assignee_ids: [maker.id],
  operator_id: op.id, editor_id: ed.id, recording_date: shoot, recording_time: '10:00', recording_end: '12:30',
  edit_ready_date: editDay, release_date: out, release_time: '18:00',
})).data
const t2 = (await req('/content', 'POST', {
  channels: [CH], type: 'post', title: `Calendar poster ${sfx}`, assignee_ids: [maker.id], designer_id: des.id,
  design_ready_date: designDay, release_date: out,
})).data
ok('(a reel with a shoot, an edit and a release; a post with a design)', !!(t1.id && t2.id), JSON.stringify([t1.error, t2.error]))

let O = await feed(links.op)
ok('the feed answers as a calendar', O.status === 200 && /^text\/calendar/.test(O.type) && O.text.startsWith('BEGIN:VCALENDAR\r\n') && O.text.trimEnd().endsWith('END:VCALENDAR'))
let e = eventOf(O.text, t1.id, 'shoot')
ok('the operator has the shoot at its hours — 10:00 to 12:30 in Tashkent, written as UTC',
  e && e.DTSTART === `${ymd(shoot)}T050000Z` && e.DTEND === `${ymd(shoot)}T073000Z`, JSON.stringify(e && [e.DTSTART, e.DTEND]))
ok('…tentative while nobody said yes, and it rings an hour before', e && e.STATUS === 'TENTATIVE' && /TRIGGER:-PT1H/.test(O.text))
ok('…in the operator’s language', e && /^Съёмка · /.test(e.SUMMARY) && /X-WR-CALNAME:Задачи SATashkent/.test(O.text), e?.SUMMARY)
ok('…with a link back to the task', e && /\/brief\?task=\d+$/.test(e.URL || ''))
ok('…and the text is escaped (a comma and a semicolon in the title)', e && e.SUMMARY.includes('Calendar\\, test\\; reel'))
ok('the operator does not get the edit or the release', !eventOf(O.text, t1.id, 'edit') && !eventOf(O.text, t1.id, 'out') && !eventOf(O.text, t2.id, 'design'))

const E = await feed(links.ed)
e = eventOf(E.text, t1.id, 'edit')
ok('the editor has the edit on its day, as a whole day', e && e['DTSTART;VALUE=DATE'] === ymd(editDay) && /^Edit due · /.test(e.SUMMARY))
ok('…and not the shoot', !eventOf(E.text, t1.id, 'shoot'))
const D = await feed(links.des)
e = eventOf(D.text, t2.id, 'design')
ok('the designer has the design on its day', e && e['DTSTART;VALUE=DATE'] === ymd(designDay))
const M = await feed(links.maker)
e = eventOf(M.text, t1.id, 'out')
ok('the maker has the shoot and the hour it goes out', eventOf(M.text, t1.id, 'shoot') && e && e.DTSTART === `${ymd(out)}T130000Z`)
ok('…and the post’s release day', !!eventOf(M.text, t2.id, 'out'))
const X = await feed(links.x)
ok('somebody on none of it sees none of it', !X.text.includes(`task-${t1.id}-`) && !X.text.includes(`task-${t2.id}-`))

// ===================== 3 it follows the board =====================
await req(`/content/${t1.id}`, 'PATCH', { recording_date: day(3), recording_time: '14:00', recording_end: '15:00' })
O = await feed(links.op)
e = eventOf(O.text, t1.id, 'shoot')
ok('a moved shoot moves in the calendar', e && e.DTSTART === `${ymd(day(3))}T090000Z`, e?.DTSTART)
await req(`/content/${t1.id}/confirm`, 'POST', { which: 'shoot', ok: true }, OT)
const ack = eventOf((await feed(links.op)).text, t1.id, 'shoot')
ok('a yes from the operator makes it confirmed', ack?.STATUS === 'CONFIRMED', ack?.STATUS)
await req(`/content/${t2.id}`, 'PATCH', { design_link: 'https://drive.google.com/file/d/1abcdefghijklmnop/view' })
e = eventOf((await feed(links.des)).text, t2.id, 'design')
ok('a delivered part stays, marked ✓', e && /^✓ /.test(e.SUMMARY), e?.SUMMARY)
await req(`/content/${t2.id}`, 'PATCH', { status_id: deleted?.id })
ok('a deleted piece leaves the calendar', deleted && !(await feed(links.maker)).text.includes(`task-${t2.id}-`))

// ===================== 4 it is a calendar =====================
const raw = (await feed(links.op)).text
ok('every line ends CRLF and none is longer than 75 octets',
  !/[^\r]\n/.test(raw) && raw.split('\r\n').every((l) => Buffer.byteLength(l) <= 75))

// ===================== 1 again: new link, off, removed =====================
const renewed = (await req('/calendar/link', 'POST', {}, OT)).data.path
ok('a new link kills the old one', renewed !== links.op && (await feed(links.op)).status === 404 && (await feed(renewed)).status === 200)
await req('/calendar/link', 'DELETE', null, ET)
ok('turned off, the link is dead', (await feed(links.ed)).status === 404 && (await req('/calendar/link', 'GET', null, ET)).data.path === null)
await req(`/users/${stranger.id}`, 'DELETE')
ok('a removed person’s calendar is gone with them', (await feed(links.x)).status === 404)

// ===================== tidy up =====================
for (const id of [t1.id, t2.id]) await req(`/content/${id}`, 'DELETE')
for (const u of [maker, op, ed, des]) await req(`/users/${u.id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nThe calendar feed holds.')
process.exit(fails ? 1 : 0)

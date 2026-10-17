// An admin's My Day: who does what today on one schedule, then the team's
// deadlines, folded (GET /content/day/team, components/CoachAdminDay.jsx).
//
// THE DEADLINES. Overdue now (every step past its day, whose, how late), due
// today (with the hour), and needs editing ASAP (footage in, the cut late or
// due within a day — a cut is said there and only there).
//
// THE TIMELINE. For a chosen day, one row per person with something on it: a
// shoot on the row of everyone in it, an editor's cut due, a maker's post going
// out, and their study timetable as busy time.
//
// Only an admin sees the team this way; everybody else keeps their own day.
//
//   node qa/adminday-suite.mjs           (expects a server on :4090)
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
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 86400000))
const statuses = (await req('/statuses')).data
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id

const sfx = Date.now().toString(36).slice(-5)
const ch = 'instagram_main'
const maker = (await req('/users', 'POST', { name: 'Mila Maker', username: 'am' + sfx, password: 'pw123456', role: 'member', departments: [ch] })).data
const op = (await req('/users', 'POST', { name: 'Otabek Operator', username: 'ao' + sfx, password: 'pw123456', role: 'operator', departments: [ch] })).data
const ed = (await req('/users', 'POST', { name: 'Elya Editor', username: 'ae' + sfx, password: 'pw123456', role: 'editor', departments: [ch] })).data
const face = (await req('/users', 'POST', { name: 'Farid Face', username: 'af' + sfx, password: 'pw123456', role: 'member', departments: [ch] })).data
const MT = await login('am' + sfx, 'pw123456')
const weekday = new Date(`${day(0)}T12:00:00Z`).getUTCDay()
await req(`/users/${op.id}`, 'PATCH', { study_blocks: [{ d: weekday, from: '09:00', to: '11:00', label: 'Lecture' }] })

const mk = (b) => req('/content', 'POST', { channels: [ch], assignee_ids: [maker.id], force: true, ...b })
// late: a shoot two days ago that never happened
const late = (await mk({ title: 'AD: late shoot', type: 'reel', status_id: sid('to shoot'), operator_id: op.id, recording_date: day(-2), recording_time: '10:00', release_date: day(3) })).data
// today: a shoot at 14:00 with somebody in it, and a post at 18:00
const shoot = (await mk({ title: 'AD: shoot today', type: 'reel', status_id: sid('to shoot'), operator_id: op.id, recording_date: day(0), recording_time: '14:00', recording_end: '15:00', face_ids: [face.id], release_date: day(4) })).data
const post = (await mk({ title: 'AD: post today', type: 'post', status_id: sid('ready'), release_date: day(0), release_time: '18:00' })).data
// edit ASAP: filmed, the cut due today
const cut = (await mk({ title: 'AD: cut due today', type: 'reel', status_id: sid('editing'), operator_id: op.id, editor_id: ed.id, recording_date: day(-1), edit_ready_date: day(0), release_date: day(2), shot_link: 'https://drive.google.com/file/d/adcut0000000/view' })).data
ok('(four tasks set up)', [late, shoot, post, cut].every((t) => t?.id), JSON.stringify([late, shoot, post, cut].map((t) => t?.id || t?.error)))

ok('a member does not get the team view', (await req('/content/day/team', 'GET', null, MT)).status === 403)
const d = (await req('/content/day/team')).data
const has = (list, id) => (list || []).find((x) => x.content_id === id)

const o = has(d.overdue, late.id)
ok('a shoot two days past its day is overdue, the operator\'s, two days late', o && o.phase === 'shoot' && o.owners.includes(op.id) && o.days_late === 2, JSON.stringify(o))
const t1 = has(d.dueToday, shoot.id)
ok('today\'s shoot is due today, with its hour', t1 && t1.phase === 'shoot' && t1.time === '14:00', JSON.stringify(t1))
const t2 = has(d.dueToday, post.id)
ok('today\'s post is due today, the maker\'s, at its hour', t2 && t2.phase === 'release' && t2.owners.includes(maker.id) && t2.time === '18:00', JSON.stringify(t2))
const e = has(d.editAsap, cut.id)
ok('a filmed piece whose cut is due today needs editing ASAP, the editor\'s', e && e.owners.includes(ed.id) && e.days_late === 0, JSON.stringify(e))
ok('…and a cut is said only there', ![...d.overdue, ...d.dueToday].some((x) => x.content_id === cut.id && x.phase === 'edit'))

const row = (uid) => d.timeline.find((p) => p.id === uid)
const opRow = row(op.id)
ok('the operator\'s row has today\'s shoot at its hours', opRow?.items.some((i) => i.kind === 'shoot' && i.content_id === shoot.id && i.from === '14:00' && i.to === '15:00'), JSON.stringify(opRow?.items))
ok('…and their lecture as busy time', opRow?.busy.some((b) => b.from === '09:00' && b.to === '11:00'), JSON.stringify(opRow?.busy))
ok('the same shoot is on the maker\'s row and on the row of whoever is in it',
  row(maker.id)?.items.some((i) => i.content_id === shoot.id) && row(face.id)?.items.some((i) => i.content_id === shoot.id))
ok('the maker\'s post goes out on their row at 18:00', row(maker.id)?.items.some((i) => i.kind === 'post' && i.content_id === post.id && i.from === '18:00'))
ok('the editor\'s cut due today is on their row', row(ed.id)?.items.some((i) => i.kind === 'cut' && i.content_id === cut.id))
// Round 14 (the admin's schedule, after Float): everyone=1 is a row for every
// member, the free ones too, each saying whether they film or edit.
const free = (await req('/users', 'POST', { name: 'Fay Free', username: 'ax' + sfx, password: 'pw123456', role: 'member', departments: [ch] })).data
const all1 = (await req(`/content/day/team?date=${day(1)}&everyone=1`)).data
ok('everyone=1 has a row for a member with nothing on, and none without it',
  all1.timeline.some((p) => p.id === free.id && p.items.length === 0)
    && !(await req(`/content/day/team?date=${day(1)}`)).data.timeline.some((p) => p.id === free.id))
ok('…and every row says the person\'s role', all1.timeline.every((p) => typeof p.role === 'string' && Array.isArray(p.crew_roles)))
const tomorrow = (await req(`/content/day/team?date=${day(1)}`)).data
ok('another day moves the timeline, not the deadlines', tomorrow.day === day(1) && !tomorrow.timeline.some((p) => p.items.some((i) => i.content_id === shoot.id))
  && tomorrow.dueToday.some((x) => x.content_id === shoot.id))

// ---- the page, read from the source ----
const src = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const brief = src('client/src/pages/Brief.jsx')
ok('an admin\'s My Day is the team\'s', /user\.role === 'admin' \? \(/.test(brief) && /<CoachAdminDay /.test(brief))
const ad = src('client/src/components/CoachAdminDay.jsx')
// Round 14 (the owner's Float pick): the schedule is the page, with what each
// person holds up beside their row; the three deadline groups are under it, folded.
ok('the schedule first, then the three deadline groups under it, folded',
  ad.indexOf("tx('Overdue now')") < ad.indexOf("tx('Due today')") && ad.indexOf("tx('Due today')") < ad.indexOf("tx('Needs editing ASAP')")
    && ad.indexOf('className="co-ad"') < ad.indexOf('{GROUPS.map(') && /<details className="co-card sd-fold co-ad-dl"/.test(ad)
    && /api\.get\(`\/content\/day\/team\?date=\$\{day\}&everyone=1`\)/.test(ad))
ok('channel tabs narrow all of it', /const on = \(x\) => chan === 'all' \|\| \(x\.channels \|\| \[\]\)\.includes\(chan\)/.test(ad))
ok('Overview is no longer in the menu', !/key: 'overview', to: '\/overview'/.test(src('client/src/components/Sidebar.jsx')))

for (const t of [late, shoot, post, cut]) if (t?.id) await req(`/content/${t.id}`, 'DELETE')
for (const u of [maker, op, ed, face, free]) await req(`/users/${u.id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

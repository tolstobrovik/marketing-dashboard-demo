// Statistics: who is late, and how late (GET /content/stats/people,
// pages/Missed.jsx).
//
// One month, one row a person, each judged on their own step: the operator on
// the shoot, the editor on the cut, the maker on posting it. A post counts by
// the real Instagram time read off its link; a late post whose cut never
// arrived on the board is "unclear", charged to nobody. A step counts in the
// month it was due. An admin sees the team, anybody else only themselves.
//
//   node qa/people-stats-suite.mjs       (expects a server on :4090)
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
const statuses = (await req('/statuses')).data
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id

// An Instagram link whose shortcode says the post went up at `iso` noon, Tashkent.
const AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
let jitter = 0n
const igAt = (iso) => {
  let id = (BigInt(Date.parse(`${iso}T07:00:00Z`) - 1314220021721) << 23n) + (jitter += 1n)
  let s = ''
  while (id > 0n) { s = AL[Number(id % 64n)] + s; id /= 64n }
  return `https://www.instagram.com/p/${s}/`
}
// A month well in the past, so "today" never moves a verdict.
const M = '2026-03'
const d = (n) => `${M}-${String(n).padStart(2, '0')}`

const sfx = Date.now().toString(36).slice(-5)
const ch = 'instagram_main'
const maker = (await req('/users', 'POST', { name: 'Sabina Stats', username: 'sm' + sfx, password: 'pw123456', role: 'member', departments: [ch] })).data
const op = (await req('/users', 'POST', { name: 'Oybek Stats', username: 'so' + sfx, password: 'pw123456', role: 'operator', departments: [ch] })).data
const ed = (await req('/users', 'POST', { name: 'Eldor Stats', username: 'se' + sfx, password: 'pw123456', role: 'editor', departments: [ch] })).data
const MT = await login('sm' + sfx, 'pw123456')

// A new task takes no post link; it is given the way the board gives it.
const mk = async ({ post_link, ...b }) => {
  const t = await req('/content', 'POST', { channels: [ch], assignee_ids: [maker.id], force: true, ...b })
  if (post_link && t.data?.id) {
    const p = await req(`/content/${t.data.id}`, 'PATCH', { post_link })
    if (p.status !== 200) return { data: { error: p.data.error } }
  }
  return t
}
const onTime = (await mk({ title: 'PS: on time', type: 'post', status_id: sid('ready'), release_date: d(10), post_link: igAt(d(10)) })).data
const late3 = (await mk({ title: 'PS: posted 3 days late', type: 'post', status_id: sid('ready'), release_date: d(11), post_link: igAt(d(14)) })).data
const unclear = (await mk({ title: 'PS: no cut on record', type: 'reel', status_id: sid('ready'), operator_id: op.id, editor_id: ed.id,
  recording_date: d(5), edit_ready_date: d(8), release_date: d(12), post_link: igAt(d(16)) })).data
const shoot = (await mk({ title: 'PS: shoot never filmed', type: 'reel', status_id: sid('to shoot'), operator_id: op.id, recording_date: d(20), release_date: '2026-04-02' })).data
const april = (await mk({ title: 'PS: due in April', type: 'post', status_id: sid('ready'), release_date: '2026-04-01', post_link: igAt('2026-04-09') })).data
const all = [onTime, late3, unclear, shoot, april]
ok('(five tasks set up)', all.every((t) => t?.id), JSON.stringify(all.map((t) => t?.id || t?.error)))

const r = (await req(`/content/stats/people?month=${M}`)).data
const of = (uid, cid, step) => r.people?.find((p) => p.id === uid)?.items.find((i) => i.content_id === cid && (!step || i.step === step))
ok('an admin sees the team, for the month asked', r.everyone === true && r.month === M)

const a = of(maker.id, onTime.id, 'posting')
ok('a post that went up on its day is on time, by its Instagram time', a?.state === 'ok' && a.done === d(10), JSON.stringify(a))
const b = of(maker.id, late3.id, 'posting')
ok('a post that went up three days after its day is three days late, the maker\'s', b?.state === 'late' && b.days_late === 3 && b.done === d(14), JSON.stringify(b))
ok('…and it carries its channels, for the channel tabs', b?.channels?.includes(ch))
const c = of(maker.id, unclear.id, 'posting')
ok('a late post whose cut never reached the board is unclear — charged to nobody', c?.state === 'unclear' && !c.days_late, JSON.stringify(c))
const s = of(op.id, shoot.id, 'shoot')
ok('a shoot past its day and never filmed is the operator\'s, late', s?.state === 'late' && s.done === null && s.days_late > 0, JSON.stringify(s))
ok('…and only the operator\'s: nobody else is charged for the shoot', !of(maker.id, shoot.id, 'shoot') && !of(ed.id, shoot.id))
ok('a step counts in the month it was due, not the month it was done', !of(maker.id, april.id)
  && (await req('/content/stats/people?month=2026-04')).data.people.find((p) => p.id === maker.id)?.items.some((i) => i.content_id === april.id && i.state === 'late'))

const mine = (await req(`/content/stats/people?month=${M}`, 'GET', null, MT)).data
ok('anybody else sees only themselves', mine.everyone === false && mine.people.length === 1 && mine.people[0].id === maker.id
  && mine.people[0].items.some((i) => i.content_id === late3.id), JSON.stringify(mine.people?.map((p) => p.id)))
ok('a bad month falls back to this one', /^\d{4}-\d{2}$/.test((await req('/content/stats/people?month=nope')).data.month))

// ---- the page, read from the source ----
const page = readFileSync(join(ROOT, 'client/src/pages/Missed.jsx'), 'utf8').replace(/\r\n/g, '\n')
ok('the page asks the one question, from the server', page.includes('/content/stats/people?month=') && !page.includes('<StatsReport'))
// Round 10: the row of channel tabs is one menu, as on every other page.
ok('month arrows and one channel menu, nothing else to press', page.includes('shiftMonth(m, -1)') && page.includes('co-chan-pick') && (page.match(/<select/g) || []).length === 1 && !/type="date"/.test(page))
ok('a row opens to the late ones only', page.includes("items.filter((i) => i.state === 'late')") && page.includes('p.late.map('))

for (const t of all) if (t?.id) await req(`/content/${t.id}`, 'DELETE')
for (const u of [maker, op, ed]) await req(`/users/${u.id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

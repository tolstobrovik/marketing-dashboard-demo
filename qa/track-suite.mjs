// Where people struggle (round 13): server/routes/track.js and lib/track.js.
//
// What a person did is posted about THEMSELVES (the token names them, never
// the body), kept a file a day beside the database, and read back by admins
// only — as a daily or weekly Markdown report that leads with what to improve,
// and as the dots of a heatmap. What anybody typed is never sent.
//
//   node qa/track-suite.mjs           (expects a server on :4090)
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
  const text = await r.text()
  let data = text
  try { data = JSON.parse(text) } catch { /* Markdown */ }
  return { status: r.status, data, type: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '' }
}
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date())
const sfx = Date.now().toString(36).slice(-5)
const me = (await req('/users', 'POST', { name: `Tara Tracked ${sfx}`, username: 'tt' + sfx, password: 'pw123456', role: 'member', departments: ['instagram_main'] })).data
const MT = await login('tt' + sfx, 'pw123456')

// ---- in ----
const now = Date.now()
const ev = (ty, o = {}) => ({ t: now, ty, p: '/brief', ...o })
const sent = await req('/track', 'POST', { events: [
  ev('page'),
  ev('open', { task: 9001 }),
  ...Array.from({ length: 7 }, () => ev('click', { el: 'Hand in the edit', tag: 'button', x: 400, y: 300, vw: 1280, vh: 800, w: 1, task: 9001 })),
  ev('change', { task: 9001 }),
  ev('close', { task: 9001, ms: 12000 }),
  ...Array.from({ length: 6 }, () => ev('click', { el: 'div.co-facts', tag: 'div', x: 100, y: 900, vw: 1280, vh: 800, dead: 1 })),
  ev('click', { el: 'Save', tag: 'button', x: 50, y: 50, vw: 1280, vh: 800, rage: 1 }),
  ev('click', { el: 'Save', tag: 'button', x: 50, y: 50, vw: 1280, vh: 800, rage: 1 }),
  ...Array.from({ length: 3 }, () => ev('error', { msg: 'Pick a person from the list' })),
  ev('search', { k: 0 }), ev('search', { k: 0 }),
  { ty: 'nonsense', p: '/x' },
  ev('click', { el: 'x'.repeat(500), name: 'Somebody Else', u: 1 }),
] }, MT)
ok('a person posts what they did', sent.status === 200 && sent.data.n === 25, JSON.stringify(sent.data))
ok('…an unknown kind of event is dropped', sent.data.n === 25)

const file = readFileSync(join(process.env.DATA_DIR || join(ROOT, 'data'), 'track', `${day}.ndjson`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.u === me.id)
ok('…kept a line each, beside the database, by the person the token names', file.length === 25 && file.every((e) => e.u === me.id && e.n === me.name), String(file.length))
ok('…the body cannot name somebody else', !file.some((e) => e.n === 'Somebody Else'))
ok('…and a long label is cut', Math.max(...file.map((e) => (e.el || '').length)) <= 80)

// ---- out: admins only ----
ok('a member cannot read the reports', (await req('/track/days', 'GET', null, MT)).status === 403 && (await req(`/track/report?day=${day}`, 'GET', null, MT)).status === 403)
ok('…nor the heatmap', (await req('/track/heat?path=/brief', 'GET', null, MT)).status === 403)
const days = await req('/track/days')
ok('an admin sees the days and the weeks', days.status === 200 && days.data.days.some((d) => d.day === day) && days.data.weeks.length >= 1)
const rep = await req(`/track/report?day=${day}`)
const md = String(rep.data)
ok('the day\'s report is Markdown', rep.status === 200 && /markdown/.test(rep.type) && md.startsWith('# How the board was used'))
ok('…it leads with what to improve', md.indexOf('## What to improve first') > 0 && md.indexOf('## What to improve first') < md.indexOf('## Who was on it'))
ok('…a thing pressed though it is no button is said to be fixed', md.includes('«div.co-facts» on /brief 6 times'))
ok('…so is a button pressed again and again', md.includes('«Save» on /brief was pressed again and again'))
ok('…and a "no" the board said three times', md.includes('«Pick a person from the list» 3 times'))
ok('…and searches that found nothing, by name', md.includes(`Searches that found nothing: ${me.name} 2`))
ok('…who was on it, by name', md.includes(`| ${me.name} | member |`))
ok('…where people reach inside a task window', md.includes('| Hand in the edit | 7 |'))
ok('…and how many presses moving a task took', md.includes('Presses before the first change (middle case): 7'))
const dl = await req(`/track/report?day=${day}&download=1`)
ok('the report can be downloaded as a file', /attachment; filename="board-usage-\d{4}-\d{2}-\d{2}\.md"/.test(dl.disp))
const wk = await req(`/track/report?week=${day}`)
ok('…and a week of them', wk.status === 200 && String(wk.data).startsWith('# How the board was used — the week of'))
ok('a report wants a day or a week', (await req('/track/report?day=yesterday')).status === 400)
const heat = await req('/track/heat?path=/brief&days=1')
ok('the heatmap has the presses of one page, as a share of the width', heat.status === 200 && heat.data.points.length >= 15 && heat.data.points.every((p) => p.x >= 0 && p.x <= 1))
ok('…with the presses on nothing marked', heat.data.points.some((p) => p.d === 1))

// ---- the hunt of 15 Oct 2026 ----
const more = await req('/track', 'POST', { events: [
  ev('click', { p: '//evil.example/look-alike', el: 'x', tag: 'a', x: 1, y: 1, vw: 1280, vh: 800 }),
  ev('page', { p: String.raw`/\evil` }),   // a backslash after the slash leaves the board too
  ev('error', { msg: '«my secret words» is a placeholder, not a reference' }),
  // two task windows in two tabs: each closes against its own opening
  ev('open', { task: 7001 }), ev('open', { task: 7002 }),
  ev('click', { el: 'Send', tag: 'button', w: 1, task: 7001, x: 1, y: 1, vw: 1280, vh: 800 }),
  ev('change', { task: 7001 }),
  ev('close', { task: 7001, ms: 5000 }), ev('close', { task: 7002, ms: 3000 }),
] }, MT)
const lines2 = readFileSync(join(process.env.DATA_DIR || join(ROOT, 'data'), 'track', `${day}.ndjson`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.u === me.id)
ok('a path that leaves the board is not kept', more.status === 200 && !lines2.some((e) => /evil/.test(e.p || '')))
ok('…and what a refusal quotes of the typed words is not kept', lines2.some((e) => e.msg === '«…» is a placeholder, not a reference') && !lines2.some((e) => /secret/.test(e.msg || '')))
ok('an impossible day is a 400, not a server error', (await req('/track/report?week=2026-02-31')).status === 400)
const md2 = String((await req(`/track/report?day=${day}`)).data)
ok('two task windows open at once are both counted', /Windows opened and closed: 3;/.test(md2), (md2.match(/Windows opened and closed: [^\n]*/) || [''])[0])

// ---- the browser side never sends what is typed ----
const src = readFileSync(join(ROOT, 'client/src/lib/track.js'), 'utf8')
ok('the browser names a box by its label, never its value', /placeholder/.test(src) && !/\.value\b/.test(src))
ok('…and the team is told in What changed', /records which pages you open and what you press/.test(readFileSync(join(ROOT, 'client/src/components/CoachParts.jsx'), 'utf8')))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

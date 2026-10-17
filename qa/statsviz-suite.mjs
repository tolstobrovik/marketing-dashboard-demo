// Statistics 2.0: the visual report.
//
// THE NUMBERS. /reports/stats carries what the charts draw, counted by the
// server's one step model (so the re-promised day is the day a step is judged
// against): the type mix of what the window made, the change requests still
// open when the window closed, and — month by month — the cuts and artwork
// that came in on time and late, with the knock-ons beside them. The scope it
// answers with is the scope it APPLIED: a member who names nobody is given the
// whole team's totals and is told so, and a member who names somebody else is
// given their own work, named.
//
// And the numbers are checked as NUMBERS, not only as integers: pieces whose
// answers are known — a cut handed in by its re-promised day, one handed in
// after it, one with no new day, a knock-on, artwork early and late — are put
// on the board under a person nobody else's work is filed under, and read back
// month by month. Two of the facts the page stands on are stamps the API never
// takes from anybody — the moment a piece was made, and when a change request
// was asked and answered — so those checks write them straight into the
// server's database, and only run when they are told where it is (DATA_DIR,
// which CI passes).
//
// THE PAGE. Read from the source: the tiles the spec names (Total published,
// Lateness Rate, Pending revisions), a bar chart and a pie drawn with
// Recharts, loaded on their own; "Download Report" as a spreadsheet of
// exactly the view; the empty state, decided on the window's own numbers;
// colours from theme tokens (light and dark) that are the type chips' own;
// and a layout that stacks on a phone. The Overview leads with the same two
// figures, read off the same answer and drawn without Recharts. The type
// mix's arithmetic is imported and run, not read.
//
//   node qa/statsviz-suite.mjs           (expects a server on :4090)
//   DATA_DIR=<that server's DATA_DIR> node qa/statsviz-suite.mjs
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json())
const admin = await login('admin', 'admin123')
const A = admin.token
const req = async (p, m = 'GET', b, t = A) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))
const T = day(0)
const monthFrom = `${T.slice(0, 7)}-01`
const CH = 'telegram_main'
const stats = async () => (await req(`/reports/stats?from=${monthFrom}&to=${T}&channel=${CH}&months=6`)).data

const before = await stats()
ok('the report carries the type mix of what the window made', before && typeof before.by_type === 'object', JSON.stringify(before?.by_type))
ok('…the change requests still open when the window closed', Number.isInteger(before.revisions_open))
ok('…and, month by month, the cuts and artwork on time and late, and the knock-ons beside them',
  Array.isArray(before.months) && before.months.every((m) => Number.isInteger(m.made_on_time) && Number.isInteger(m.made_late)
    && Number.isInteger(m.made_knock_on)))
ok('every month says which of its days it counts', before.months.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.from) && /^\d{4}-\d{2}-\d{2}$/.test(m.to)))

const made = []
for (const type of ['reel', 'reel', 'post']) {
  const r = await req('/content', 'POST', { title: `Stats viz ${type} ${made.length}`, channels: [CH], type })
  if (r.data?.id) made.push(r.data.id)
}
const after = await stats()
ok('a piece made in the window is counted under its type', (after.by_type.reel || 0) - (before.by_type.reel || 0) === 2
  && (after.by_type.post || 0) - (before.by_type.post || 0) === 1, JSON.stringify(after.by_type))
ok('the type mix only ever names a type the board knows', Object.keys(after.by_type)
  .every((k) => ['post', 'reel', 'story', 'video', 'target', 'other'].includes(k)), JSON.stringify(after.by_type))
const rv = await req(`/content/${made[0]}/revisions`, 'POST', { note: 'Tighten the first three seconds and add captions.' })
const withRev = await stats()
ok('a change request asked for and not yet made is counted as pending', rv.status < 300 && withRev.revisions_open === after.revisions_open + 1,
  `${rv.status} ${after.revisions_open} → ${withRev.revisions_open}`)
const empty = (await req('/reports/stats?from=2015-01-01&to=2015-01-31&months=2')).data
ok('a window with nothing in it has nothing in it', Object.keys(empty.by_type || {}).length === 0
  && (empty.months || []).every((m) => !m.made_on_time && !m.made_late))
// Pending revisions is the backlog the window closed on. A count for right
// now, whatever the window, put today's number — in red — under 2015.
ok('…and no change request was open at the end of a window from before any were asked for',
  empty.revisions_open === 0, String(empty.revisions_open))

// A window ahead of the board. Its own numbers are all zero, while the months
// drawn beside it are still there to draw: the page has to decide "no data
// for this period" on the window, never on the months.
const ahead = (await req('/reports/stats?from=2099-01-01&to=2099-01-31&months=12')).data
ok('a window with nothing in it says so in its own numbers, whatever the months beside it carry',
  ahead.pieces?.out === 0 && ahead.pieces?.planned === 0 && ahead.steps?.due === 0 && ahead.steps?.open === 0
    && Object.keys(ahead.by_type || {}).length === 0 && (ahead.months || []).length > 0,
  JSON.stringify({ out: ahead.pieces?.out, planned: ahead.pieces?.planned, due: ahead.steps?.due, open: ahead.steps?.open, months: ahead.months?.length }))

// ===================== the numbers, against work whose answer is known =====================
// Every check above would pass with made_late stuck at 0. So the board is
// handed pieces whose answers are known, each with the owner's hat held by a
// member made for this run — nobody else's work is filed under them — and the
// answers are read back through that person's scope, one piece at a time, so
// nothing else on the shared stack can move them.
const stamp = Date.now().toString(36)
const member = (await req('/users', 'POST', {
  name: `SV member ${stamp}`, username: `sv_member_${stamp}`, password: 'probe123', role: 'member', departments: [CH],
})).data
const M = (await login(member.username, 'probe123')).token
const stages = (await req('/statuses')).data
const stage = (re) => stages.find((s) => re.test(s.label))?.id
const [toShoot, editing, ready, published] = [/^to shoot$/i, /^editing$/i, /^ready$/i, /^published$/i].map(stage)
const noon = (iso) => `${iso}T07:00:00.000Z`
const ym = (iso) => iso.slice(0, 7)
const theirs = (from, to, t = A) => req(`/reports/stats?from=${from}&to=${to}&months=3&person=${member.id}`, 'GET', null, t)
const mine = async (over) => {
  const r = await req('/content', 'POST', { channels: [CH], assignee_id: member.id, ...over, title: `SV ${stamp} ${over.title}` })
  if (r.data?.id) made.push(r.data.id)
  return r.data || {}
}
const patch = (id, body) => req(`/content/${id}`, 'PATCH', body)

// What the last piece moved, month by month: "2026-09 made_late +1". Each
// check below names exactly one change, so a piece counted twice, counted in
// the wrong month or counted in the wrong bar fails by name.
const COUNTS = ['made_on_time', 'made_late', 'made_knock_on']
const rowsNow = async () => Object.fromEntries(((await theirs(monthFrom, T)).data.months || []).map((m) => [m.month, m]))
let seen = await rowsNow()
const moved = async () => {
  const now = await rowsNow()
  const diff = []
  for (const [m, row] of Object.entries(now)) {
    for (const k of COUNTS) {
      const d = row[k] - (seen[m]?.[k] || 0)
      if (d) diff.push(`${m} ${k} ${d > 0 ? '+' : ''}${d}`)
    }
  }
  seen = now
  return diff.join(', ')
}

// The artwork first. The series leaves off the months before a person's first
// dated piece — dated by any day a month counts, a step's own due day among
// them — so each piece below reaches it back to the month it falls due in,
// whatever day of the month this runs.
const artKept = await mine({ title: 'artwork early', type: 'post', status_id: published, post_link: 'https://example.com/sv-a',
  design_ready_date: day(-1), done_at: noon(day(-2)) })
let got = await moved()
ok('artwork handed back before its day is on time, in the month of its day', !!artKept.id && got === `${ym(day(-1))} made_on_time +1`, got)
await mine({ title: 'artwork late', type: 'post', status_id: published, post_link: 'https://example.com/sv-b',
  design_ready_date: day(-2), done_at: noon(day(-1)) })
got = await moved()
ok('artwork handed back after its day is late', got === `${ym(day(-2))} made_late +1`, got)

// A cut first promised three days ago and re-promised for today, handed in
// today — the handover stamps the hand-in, as it does on the board.
const kept = await mine({ title: 'cut, re-promised and kept', type: 'reel', status_id: editing, edit_ready_date: day(-3) })
await patch(kept.id, { edit_due_revised: T })
await patch(kept.id, { status_id: ready })
got = await moved()
ok('a cut handed in after its first day but by its re-promised one is on time', got === `${ym(T)} made_on_time +1`, got)
// The same hand-in with no new day agreed is late against the first one.
const unrevised = await mine({ title: 'cut, no new day', type: 'reel', status_id: editing, edit_ready_date: day(-1) })
await patch(unrevised.id, { status_id: ready })
got = await moved()
ok('…the same hand-in against a first day alone is late', got === `${ym(day(-1))} made_late +1`, got)
// Re-promised, and handed in after the new day as well. Late — not excused,
// because a new day was agreed — and in the month of the NEW day: the first
// one is forty days back, in a month this series does not even draw.
const missed = await mine({ title: 'cut, re-promised and missed', type: 'reel', status_id: editing, edit_ready_date: day(-40) })
await patch(missed.id, { edit_due_revised: day(-1) })
await patch(missed.id, { status_id: ready })
got = await moved()
ok('a cut handed in after its re-promised day is late, and counted in the month of that day', got === `${ym(day(-1))} made_late +1`, got)
// The footage only reached the editor today, two days after the cut was due,
// and nobody agreed a new day: a knock-on, in neither bar.
const knock = await mine({ title: 'cut, knock-on', type: 'reel', status_id: toShoot, edit_ready_date: day(-2) })
await patch(knock.id, { status_id: editing })
await patch(knock.id, { status_id: ready })
got = await moved()
ok('a cut that could only start after its day is a knock-on, beside the bars and in neither', got === `${ym(day(-2))} made_knock_on +1`, got)

// The bars are the tile: the month that is running, cut to the window's last
// day, counts what the window's own cuts and artwork count.
const whole = (await theirs(monthFrom, T)).data
const madeSum = (k) => (whole.steps?.by_step || []).filter((s) => s.step === 'edit' || s.step === 'design').reduce((n, s) => n + s[k], 0)
const running = (whole.months || []).find((m) => m.month === ym(T)) || {}
ok('…and the month that is running is the tile above it, count for count',
  running.to === T && running.made_on_time === madeSum('on_time') && running.made_late === madeSum('late')
    && running.made_knock_on === madeSum('knock_on'),
  JSON.stringify({ bar: COUNTS.map((k) => running[k]), tile: ['on_time', 'late', 'knock_on'].map(madeSum) }))
ok('…and it says it is still running, cut at today', running.running === true, JSON.stringify({ to: running.to, running: running.running }))
const own = (await theirs(monthFrom, T, M)).data
ok('a member reading their own work is given the numbers an admin is given for them',
  own.scope?.person === member.id && JSON.stringify(own.months) === JSON.stringify(whole.months)
    && JSON.stringify(own.steps) === JSON.stringify(whole.steps) && own.revisions_open === whole.revisions_open,
  JSON.stringify(own.scope))

// ---- the backlog the window closed on ----
// Pending revisions is the change requests nobody had answered by the END of
// the window. One asked today is open in this month, and was not open in a
// month that closed before it was asked.
const prevMonth = (() => { const [y, m] = T.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7) })()
const prevFrom = `${prevMonth}-01`
const prevTo = new Date(Date.UTC(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)), 0)).toISOString().slice(0, 10)
const asked = await mine({ title: 'asked for changes', type: 'story' })
const askedRv = await req(`/content/${asked.id}/revisions`, 'POST', { note: 'Swap the cover for the second frame.' })
const openNow = (await theirs(monthFrom, T)).data.revisions_open
const openThen = (await theirs(prevFrom, prevTo)).data.revisions_open
ok('a change request asked today is open at the end of this month, and was not open at the end of the last',
  askedRv.status < 300 && openNow === 1 && openThen === 0, `${askedRv.status} · ${monthFrom}–${T}: ${openNow} · ${prevFrom}–${prevTo}: ${openThen}`)

// ---- stamps the API never takes ----
const dbFile = process.env.DATA_DIR ? join(process.env.DATA_DIR, 'dashboard.db') : null
if (dbFile && existsSync(dbFile)) {
  const { createClient } = await import('@libsql/client')
  const db = createClient({ url: `file:${dbFile}`, intMode: 'number' })
  // Asked on the first of last month and answered today: it was waiting when
  // last month closed, and it is not waiting at the end of this one.
  await db.execute({
    sql: 'UPDATE revisions SET created_at = ?, resolved_at = ? WHERE content_id = ?',
    args: [noon(prevFrom), new Date().toISOString(), asked.id],
  })
  const thenOpen = (await theirs(prevFrom, prevTo)).data.revisions_open
  const nowOpen = (await theirs(monthFrom, T)).data.revisions_open
  ok('a change request answered after a window closed was still waiting at its end — and is not waiting now',
    thenOpen === 1 && nowOpen === 0, `${prevFrom}–${prevTo}: ${thenOpen} · ${monthFrom}–${T}: ${nowOpen}`)

  // Made at one in the morning on the first of this month, Tashkent time —
  // which is still the last day of last month in UTC — and of a type the board
  // no longer offers. It belongs to THIS month's pie, as 'other'.
  const odd = await mine({ title: 'made just after midnight', type: 'post' })
  await db.execute({
    sql: 'UPDATE content SET type = ?, created_at = ? WHERE id = ?',
    args: ['podcast', `${prevTo}T20:00:00.000Z`, odd.id],
  })
  // Everything else this person holds was made today: two posts of artwork,
  // four cuts and the story that was asked for changes.
  const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v).sort()))
  const thisMix = (await theirs(monthFrom, T)).data.by_type
  const lastMix = (await theirs(prevFrom, prevTo)).data.by_type
  ok('the type mix counts a piece by the Tashkent day it was made, not the UTC one',
    sorted(lastMix) === '{}' && (thisMix?.other || 0) + (thisMix?.podcast || 0) === 1,
    JSON.stringify({ [prevMonth]: lastMix, [ym(T)]: thisMix }))
  ok('…and a type the board does not know is counted as other, not dropped',
    sorted(thisMix) === sorted({ other: 1, post: 2, reel: 4, story: 1 }), JSON.stringify(thisMix))
  db.close()
} else console.log('· no DATA_DIR for the server at BASE — the checks that write a stamp the API never takes are skipped (CI passes it)')

// ===================== whose numbers =====================
// The page says whose numbers these are from the scope the server APPLIED.
// A member naming nobody is given the team's totals (the page's scoping, on
// purpose), and the line used to call them "your work".
const scopeQ = `/reports/stats?from=${monthFrom}&to=${T}&channel=${CH}&months=2`
const teamA = (await req(scopeQ)).data
const teamM = (await req(scopeQ, 'GET', null, M)).data
ok('a member who names nobody is given the whole team\'s totals — and the scope says so',
  teamM.scope?.whole_team === true && !teamM.scope.person && teamM.pieces.out === teamA.pieces.out
    && teamM.revisions_open === teamA.revisions_open && JSON.stringify(teamM.by_type) === JSON.stringify(teamA.by_type)
    && JSON.stringify(teamM.months) === JSON.stringify(teamA.months),
  JSON.stringify(teamM.scope))
const otherM = (await req(`${scopeQ}&person=${admin.user?.id}`, 'GET', null, M)).data
const selfM = (await req(`${scopeQ}&person=${member.id}`, 'GET', null, M)).data
ok('a member who names somebody else is given their own work, and the scope names them',
  otherM.scope?.person === member.id && otherM.scope.person_name === member.name && otherM.scope.whole_team === false
    && JSON.stringify(otherM.by_type) === JSON.stringify(selfM.by_type) && otherM.revisions_open === selfM.revisions_open
    && otherM.people.every((p) => p.id === member.id),
  JSON.stringify(otherM.scope))
ok('…and a member is sent nothing the admin\'s answer does not carry',
  Object.keys(otherM).every((k) => k in teamA), JSON.stringify(Object.keys(otherM).filter((k) => !(k in teamA))))

// ===================== the type mix, run =====================
// The pie, its legend and the spreadsheet all print lib/typemix.js; it
// imports nothing, so it is run here rather than read.
const { typeMix, TYPE_ORDER } = await import(pathToFileURL(join(ROOT, 'client/src/lib/typemix.js')).href)
const thirds = typeMix({ reel: 1, post: 1, story: 1 })
ok('the shares add up to 100, not 99', thirds.rows.reduce((n, r) => n + r.share, 0) === 100, JSON.stringify(thirds.rows))
const sliver = typeMix({ reel: 300, post: 1 })
ok('a slice too small to reach 1% says so, rather than "0%"',
  sliver.rows.find((r) => r.key === 'post')?.pct === '<1%' && sliver.rows.find((r) => r.key === 'reel')?.pct === '100%',
  JSON.stringify(sliver.rows))
const odd = typeMix({ reel: 2, podcast: 1, other: 1 }, (k) => `name:${k}`)
ok('a type the board does not know is counted as other, so no piece falls out of the total',
  odd.total === 4 && odd.rows.find((r) => r.key === 'other')?.value === 2, JSON.stringify(odd))
ok('…each type is named by the words handed in, in the pie\'s own order',
  odd.rows.every((r) => r.name === `name:${r.key}`)
    && typeMix({ other: 1, story: 1, reel: 1 }).rows.map((r) => r.key).join() === TYPE_ORDER.filter((k) => ['other', 'story', 'reel'].includes(k)).join())

// ===================== the page =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const report = src('client/src/components/StatsReport.jsx')
const charts = src('client/src/components/StatsCharts.jsx')
const constants = src('client/src/lib/constants.js')
const reportsRoute = src('server/routes/reports.js')
ok('the tiles the spec names: Total published, Lateness Rate, Pending revisions',
  /tx\('Total published'\)/.test(report) && /tx\('Lateness Rate'\)/.test(report) && /tx\('Pending revisions'\)/.test(report))
ok('lateness is the made work (cuts and artwork) against the step model, knock-ons left out',
  /st\.step === 'edit' \|\| st\.step === 'design'/.test(report) && /st\.on_time \+ st\.late/.test(report))
ok('whose numbers these are is read off the scope the server applied, not off the picker',
  /data\?\.scope/.test(report) && /scope\.whole_team \? tx\('the whole team'\)/.test(report))
ok('a bar chart and a pie, drawn with Recharts', /from 'recharts'/.test(charts) && /<BarChart/.test(charts) && /<PieChart/.test(charts))
ok('late is the one red, on time recedes', /--viz-late/.test(charts) && /--viz-ontime/.test(charts))
ok('the knock-ons and the span of months are said where the bars are drawn',
  /made_knock_on/.test(charts) && /tx\('\{n\} knock-on'/.test(charts) && /tx\('Last \{n\} months, by the month each step was due', \{ n: bars\.length \}\)/.test(charts))
// A scope with one month of history drew "Last 1 months" — and in Russian a
// plural adjective that cannot agree with one.
ok('…and one month is its own sentence, in both books',
  /bars\.length === 1 \? tx\('One month, by when each step was due'\)\s*: tx\('Last \{n\} months/.test(charts)
    && src('client/src/lib/i18n.jsx').includes('"One month, by when each step was due": "Один месяц — по сроку каждого этапа"')
    && src('client/src/lib/i18n.jsx').includes('"One month, by when each step was due": "Bir oy — har bir bosqich muddati bo\u02BByicha"'))
// The bars' surface stroke is painted a pixel inside every edge, so a late
// segment under ~2px (one late cut beside a hundred on time) was all stroke
// and no red. It is never drawn shorter than the stroke plus three pixels —
// asked by the row's index, since Recharts hands the callback the stack's top
// and not the segment's own value.
const lateBar = /<Bar dataKey="late"[\s\S]*?\/>/.exec(charts)?.[0] || ''
const lateMin = Number(/const LATE_MIN = (\d+)/.exec(charts)?.[1])
const lateStroke = Number(/strokeWidth=\{(\d+)\}/.exec(lateBar)?.[1] || 0)
ok('a late count is never too short to show red under the bars\' stroke',
  /minPointSize=\{\(_, i\) => \(bars\[i\]\?\.late > 0 \? LATE_MIN : 0\)\}/.test(lateBar) && lateMin - lateStroke >= 3,
  `${lateBar.replace(/\s+/g, ' ').slice(0, 160)} · LATE_MIN ${lateMin}, stroke ${lateStroke}`)
// The empty state moved from StatsCharts to StatsReport on purpose: it is
// decided there, on the window's own numbers, and replaces both pictures.
const empt = /const periodEmpty = ([\s\S]*?)\n\s*\/\//.exec(report)?.[1] || ''
ok('the empty state the spec asks for is decided on the window, never on the months beside it',
  /p\.out/.test(empt) && /p\.planned/.test(empt) && /steps\?\.due/.test(empt) && /by_type/.test(empt) && !/months/.test(empt)
    && /periodEmpty \? \(\s*<div className="card card-pad viz-empty" role="status">\{tx\('No data available for this period'\)\}/.test(report),
  empt.slice(0, 120))
ok('…and neither card inside the charts can say "no data" beside tiles that have some',
  !/No data available for this period/.test(charts) && /tx\('Nothing new was created in this period'\)/.test(charts))
// The front page leads with the same headline, from the same numbers: the
// month's row of the series and the report's own backlog — not the rule
// worked out a second time, and not the charting library on the admin's
// first page.
const ov = src('client/src/pages/Overview.jsx')
ok('the Overview carries the Statistics headline: Lateness Rate and Pending revisions',
  /<Stat label="Lateness Rate"/.test(ov) && /<Stat label="Pending revisions" value=\{rep \? \(rep\.revisions_open/.test(ov))
ok('…read off the server\'s row for the month, not worked out again, and with no Recharts',
  /rep\?\.months\?\.find\(\(m\) => m\.month === month\)/.test(ov) && /cur\.made_late \/ madeJudged/.test(ov)
    && /made_knock_on/.test(ov) && !/by_step|st\.step/.test(ov) && !/recharts|StatsCharts/.test(ov))
const dl = /const download = \(\) => \{([\s\S]*?)\n  \}\n/.exec(report)?.[1] || ''
ok('"Download Report" saves exactly this view as a spreadsheet', /tx\('Download Report'\)/.test(report) && /text\/csv/.test(dl) && /uFEFF/.test(dl))
ok('…with the scope as applied, the project, the months as the table shows them, the type mix in words and the channels',
  /Project: \{name\}/.test(dl) && /All projects/.test(dl) && /\.reverse\(\)/.test(dl) && /monthRowLabel\(m\) \+ \(m\.running/.test(dl)
    && /mix\.rows\.map/.test(dl) && /data\.channels\.map/.test(dl) && /data\.window\.from/.test(dl))
// A custom window's first and last months are cut to it, and every place a
// month's row is named says so the one way the chart's tooltip does — the
// spreadsheet printed "August 2026" over the 15th to the 31st. And the months
// are named from the board's own book: the browser's Uzbek for September is
// "M09", and the spreadsheet carried it.
const monthLib = src('client/src/lib/month.js')
const monthBars = src('client/src/components/MonthBars.jsx')
ok('a month cut to a custom window is named with its days, the same way wherever a row is named',
  /export const monthRowLabel = \(m\) =>/.test(monthLib) && /m\.from === e\.from && m\.to === e\.to/.test(monthLib)
    && /<td><b>\{monthRowLabel\(m\)\}<\/b>/.test(report) && /data-tip=\{`\$\{monthRowLabel\(m\)\}/.test(monthBars)
    && /monthRowLabel\(m\)/.test(charts) && !/const monthHead/.test(charts))
ok('…and "so far" is the server\'s word for a month still counted up to today, not for any row of this month',
  /running: month === today\.slice\(0, 7\) && to >= today/.test(src('server/stats.js')))
ok('the report names its months from the board\'s book, never the browser\'s Uzbek "M09"',
  /export const monthLabel = \(ym\) =>\s*`\$\{monthName\(/.test(monthLib) && /monthRowLabel[\s\S]*monthLabel\(m\.month\)/.test(monthLib)
    && /label: monthLabel\(month\)/.test(report) && /\$\{monthLabel\(start\)\} – \$\{monthLabel\(month\)\}/.test(report)
    && !/monthWords/.test(report) && !/monthWords\(m\.month\)/.test(monthBars))
ok('the types are named in the reader\'s language, and "Other" is looked up where it is read',
  /typeMix\(data\?\.by_type, typeLabel\)/.test(report) && /get label\(\) \{ return tx\('Other'\) \}/.test(constants)
    && /export const typeLabel/.test(constants))
const byTypeLoop = /const by_type = \{\}([\s\S]*?)revisions_open/.exec(reportsRoute)?.[1] || ''
ok('the server dates the type mix by the Tashkent day and folds unknown types into other',
  /CONTENT_TYPES\.includes\(row\.type\)/.test(byTypeLoop) && /dayOf\(row\.created_at\)/.test(byTypeLoop) && !/slice\(0, 10\)/.test(byTypeLoop))

// Recharts is on one page. It is loaded with that page's charts and not
// before: a chunk of its own, reached only through a lazy import.
const vite = src('vite.config.js')
ok('Recharts has a chunk of its own', /charts:\s*\['recharts'\]/.test(vite))
ok('…and the charts are loaded lazily, the tiles first',
  /lazy\(\(\) => import\('\.\/StatsCharts\.jsx'\)\)/.test(report) && /<Suspense /.test(report) && !/^import StatsCharts/m.test(report))
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const importers = walk(join(ROOT, 'client/src')).filter((f) => /\.jsx?$/.test(f) && !/StatsCharts\.jsx$/.test(f))
  .filter((f) => /from 'recharts'|^import .*StatsCharts/m.test(readFileSync(f, 'utf8')))
ok('…and nothing else imports it', importers.length === 0, importers.join(' '))
const dist = join(ROOT, 'dist')
if (existsSync(join(dist, 'index.html'))) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const entry = /src="\/?assets\/(index-[^"]+\.js)"/.exec(html)?.[1]
  const assets = readdirSync(join(dist, 'assets'))
  const entryJs = entry ? readFileSync(join(dist, 'assets', entry), 'utf8') : ''
  ok('in the build, the charts chunk exists and the first page load does not ask for it',
    assets.some((f) => /^charts-.*\.js$/.test(f)) && !!entry && !/charts-/.test(html) && !/charts-[\w-]+\.js/.test(entryJs),
    `${entry} · ${assets.filter((f) => /^charts-/.test(f)).join(' ')}`)
} else console.log('· no build in dist/ — the chunk check is skipped (CI builds before it runs)')

const css = src('client/src/styles.css')
const vizTypes = ['reel', 'post', 'story', 'video', 'target', 'other']
ok('colours are theme tokens, every one with a dark step of its own',
  [...vizTypes, 'late', 'ontime', 'grid'].every((k) => (css.match(new RegExp(`--viz-${k}:`, 'g')) || []).length === 2))
ok('the types are the chips\' own colours, one palette for a type wherever it is drawn',
  ['reel', 'story', 'video', 'target', 'other'].every((k) => new RegExp(`--viz-${k}: var\\(--type-${k}\\)`).test(css)
    && new RegExp(`\\.chip\\.ct-${k}\\s+\\{ background: var\\(--type-${k}\\)`).test(css)))
ok('…and the post is not ruby: red means late and nothing else',
  [...css.matchAll(/--viz-post:\s*([^;]+);/g)].every((m) => !/ruby|bright-red|brand|critical/.test(m[1])))
ok('a tooltip floats on the theme\'s own shadow', /\.viz-tip \{[^}]*box-shadow: var\(--shadow\)/.test(css) && !/\.viz-tip \{[^}]*rgba/.test(css))
ok('…read off the page so they follow the theme', /MutationObserver/.test(charts) && /data-theme/.test(charts))
ok('on a phone the two pictures stack', /@media \(max-width: 760px\) \{\s*\.viz-row \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css))
ok('…and a pie that wraps above its legend sits in the middle of its card', /\.viz-pie \{[^}]*justify-content: center/.test(css))
// Recharts right-aligns a left axis's numbers at margin.left + width - 8; a
// three-digit count at 11px needs about 20px of that.
const marginLeft = Number(/<BarChart[^>]*margin=\{\{[^}]*left: (-?\d+)/.exec(charts)?.[1])
const yWidth = Number(/<YAxis[^>]*width=\{(\d+)\}/.exec(charts)?.[1])
ok('the numbers down the left have room for three digits', marginLeft + yWidth - 8 >= 22, `${marginLeft} + ${yWidth} - 8`)
ok('the month axis names fewer months on a narrow chart, counted back from the latest, with the year where it turns',
  /new ResizeObserver/.test(charts) && /TICK_ROOM/.test(charts) && /\(n - 1 - i\) % step === 0/.test(charts) && /yearAt/.test(charts))
const i18n = src('client/src/lib/i18n.jsx')
ok('the spec\'s words in all three languages', i18n.includes('"Lateness Rate": "Доля опозданий"') && i18n.includes('"Lateness Rate": "Kechikish darajasi"')
  && i18n.includes('"Download Report": "Скачать отчет"') && i18n.includes('"Download Report": "Hisobotni yuklash"'))
ok('Recharts is a real dependency', /"recharts":/.test(src('package.json')))

for (const id of made) await req(`/content/${id}`, 'DELETE')
if (member?.id) await req(`/users/${member.id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

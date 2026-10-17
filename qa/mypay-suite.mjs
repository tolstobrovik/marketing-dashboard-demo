// What a person is told about their own pay, and whether it is the money.
//
// The payslip learnt to explain itself. Every line on it opens into how it was
// worked out: which field of the card priced it, what the person's own
// arrangement counts and what it leaves out, how much of the pillow the work
// has filled, when the board last measured the KPI card. Every one of those is
// a sentence somebody will hold up against a bank transfer — so the rule this
// suite exists to keep is the dull one:
//
//   the explanation is the payroll's own figures, never a second calculator —
//     the person's own card (/pay/mine), the job-by-job report an admin opens
//     and the payroll itself come to the same total, to the unit, on every
//     arrangement
//
// and around it, the things the explanation may not get wrong:
//
//   every job and every line says which field of the card priced it, and a
//     line priced by a rate multiplies out: count × that field is the amount
//   the arrangement is described to its own person the way the run pays it —
//     where the month's money comes from, whether a floor stands under it,
//     whether the KPI card counts — and the list of every arrangement stays
//     the admin's
//   an arrangement with no pillow presents none, whatever the card still holds
//   a pillow carries the month's earnings whole, so the bar is drawn at the
//     exact ratio and not at a rounded, capped percent
//   a line on the month without a reason is refused, naming the field, and one
//     with a reason is listed with it, to the person it is on
//   a channel admin runs content, not the payroll: somebody else's month is 403
//   the nightly tick stamps the KPI cards that read the board, and a card typed
//     in by hand is never given a time
//
// …and, read from the source, the pages that draw it: the tooltip is a portal
// that stays on the screen, closes on a press anywhere else, keeps its
// Escape from the window under it and, closing with the focus in it, hands the
// focus back to its line; a KPI line with no card says "as recorded" only on a
// month that was closed; the KPI suite saves its card for Tashkent's month,
// the one the page asks for; the pillow bar is a progressbar that grows
// in once, and not at all for somebody who asked for less motion; and "Last
// synced" is never printed over a card somebody typed in by hand.
//
// Nothing here changes what anybody is paid. Every amount below is one the pay
// run already produced, compared with itself or with the card that priced it.
//
//   node qa/mypay-suite.mjs     (expects a server on :4090; CRON_SECRET set to
//                                whatever that server was started with)
import { readFileSync } from 'fs'
import { join } from 'path'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// The nightly route answers only its secret once the server has one — Vercel
// and the deploy both send it as a Bearer token. The suite is handed the same
// one the server under test was started with; left unset, the server is
// expected to have none either.
const CRON = process.env.CRON_SECRET || ''
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const src = (p) => readFileSync(join(ROOT, p), 'utf8')

const login = async (u, p) => (await (await fetch(`${BASE}/api/auth/login`, {
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
// Tashkent's day, the one every month on this board is counted in.
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const noon = (iso) => `${iso}T07:00:00.000Z`
const today = day(0)
const month = today.slice(0, 7)
const first = `${month}-01`
// Every piece sits inside this month whichever day the suite is run on, and
// never in the future: a suite that passes for twenty-eight days and fails on
// the 1st is a suite nobody trusts.
const inMonth = (n) => {
  const d = Math.min(28, Math.max(1, Number(today.slice(8, 10)) - n))
  return `${month}-${String(d).padStart(2, '0')}`
}

const stamp = Date.now().toString(36)
const ch = (await req('/channels')).data[0].key
const published = (await req('/statuses')).data.find((s) => /published/i.test(s.label)).id
const SCHEMES = (await req('/reports/pay/schemes')).data.schemes || {}

const PW = 'probe123'
const mkUser = async (name, extra = {}) => {
  const u = (await req('/users', 'POST', {
    name: `${name} ${stamp}`, username: `${name.toLowerCase()}_${stamp}`, password: PW,
    role: 'member', departments: [ch], ...extra,
  })).data
  return { ...u, token: await login(`${name.toLowerCase()}_${stamp}`, PW) }
}
const made = []
const mk = async (title, over) => {
  const { views, ...rest } = over
  const r = await req('/content', 'POST', {
    title: `MP ${stamp} ${title}`, channels: [ch], status_id: published,
    post_link: `https://example.com/mp-${Math.random().toString(36).slice(2)}`,
    recording_date: inMonth(6), edit_ready_date: inMonth(4), release_date: inMonth(3),
    done_at: noon(inMonth(3)), ...rest,
  })
  if (r.data?.id) made.push(r.data.id)
  if (r.data?.id && views !== undefined) await req(`/content/${r.data.id}`, 'PATCH', { views })
  return r
}

// ===================== six people, five arrangements =====================
// Piecework on a card that still holds a pillow from some earlier month, and
// prices its jobs four different ways: a kind's own rule, the hat's flat rate,
// a per-kind rate, and the flat rate a kind falls back to when its own was
// never set.
const maker = await mkUser('MPmaker')
const MAKER_CARD = {
  currency: 'UZS', scheme: 'piece', pillow: 700000,
  per_publish: 20000, per_edit: 12000, per_edit_reel: 30000,
  kind_rules: { post: { flat: 5000, gate: 10000, per_1k: 1000 } },
}
await req(`/reports/pay/rules/${maker.id}`, 'PUT', MAKER_CARD)
const flew = await mk('post that flew', { type: 'post', assignee_id: maker.id, views: 15700 })
await mk('post that sank', { type: 'post', assignee_id: maker.id, views: 9900 })
await mk('something else', { type: 'other', assignee_id: maker.id })
const cutReel = await mk('a reel, cut', { type: 'reel', editor_id: maker.id })
const cutTarget = await mk('a target, cut', { type: 'target', editor_id: maker.id })
ok('(a maker with five jobs on the board)',
  [flew, cutReel, cutTarget].every((r) => r.status === 201), [flew, cutReel, cutTarget].map((r) => r.status).join(' '))

// A safety pillow the work has not filled, and one it ran past.
const cushion = await mkUser('MPcushion')
await req(`/reports/pay/rules/${cushion.id}`, 'PUT', { currency: 'UZS', scheme: 'pillow', pillow: 1000000, per_publish: 125000 })
for (const n of [1, 2, 3]) await mk(`cushion piece ${n}`, { type: 'other', assignee_id: cushion.id })
const over = await mkUser('MPover')
await req(`/reports/pay/rules/${over.id}`, 'PUT', { currency: 'UZS', scheme: 'pillow', pillow: 200000, per_publish: 125000 })
for (const n of [1, 2]) await mk(`over piece ${n}`, { type: 'other', assignee_id: over.id })

// A fixed salary on a card that also holds a pillow and a piece rate — both
// left over, neither paid.
const salaried = await mkUser('MPsalary')
await req(`/reports/pay/rules/${salaried.id}`, 'PUT', { currency: 'UZS', scheme: 'fixed', base: 3000000, pillow: 5000000, per_publish: 125000 })
await mk('salaried piece', { type: 'other', assignee_id: salaried.id })

// Full KPI on a card the board measures, and a salary plus a KPI card that
// only a person could fill in.
const graded = await mkUser('MPgraded')
await req(`/reports/pay/rules/${graded.id}`, 'PUT', { currency: 'UZS', scheme: 'kpi', per_publish: 50000 })
for (const n of [1, 2]) await mk(`graded piece ${n}`, { type: 'other', assignee_id: graded.id })
const byHand = await mkUser('MPhand')
await req(`/reports/pay/rules/${byHand.id}`, 'PUT', { currency: 'UZS', scheme: 'fixed_kpi', base: 1000000 })
const boardCard = await req(`/reports/kpi/${graded.id}/${month}`, 'PUT', {
  currency: 'UZS', fixed: 100000, readings: {}, note: '',
  ladders: [{
    key: 'k1', label: 'Pieces delivered', metric: 'delivered', unit: '',
    bands: [{ grade: 'A', from: 2, to: null, pays: 400000 }, { grade: 'B', from: 1, to: 1, pays: 150000 }],
  }],
})
const handCard = await req(`/reports/kpi/${byHand.id}/${month}`, 'PUT', {
  currency: 'UZS', fixed: 0, readings: { k1: 4 }, note: '',
  ladders: [{ key: 'k1', label: 'Leads', metric: 'manual', unit: '', bands: [{ grade: 'A', from: 3, to: null, pays: 100000 }] }],
})
ok('(two KPI cards, one read off the board and one typed in)', boardCard.status === 200 && handCard.status === 200,
  `${boardCard.status} ${handCard.status}`)

const everyone = [maker, cushion, over, salaried, graded, byHand]
const mine = async (u) => (await req(`/reports/pay/mine?from=${first}&to=${today}`, 'GET', null, u.token)).data
const report = async (u) => (await req(`/reports/pay/person/${u.id}?month=${month}`)).data
const payroll = async () => (await req(`/reports/pay?from=${first}&to=${today}`)).data.people || []

// ===================== the same money, wherever it is read =====================
// The figures a payslip is explained with, read three ways: by the person on
// their own card, by an admin job by job, and off the payroll the money is
// actually sent from. One calculator answers all three; the day they disagree
// is the day somebody's explanation is of a different number from their pay.
const FIGURES = ['total', 'earned', 'pillow', 'pillowTopUp', 'fixedPart', 'earnedPart', 'kpiPart',
  'adjustmentTotal', 'piecework', 'viewsPay', 'scheme']
const differ = (a, b) => FIGURES.filter((k) => a?.[k] !== b?.[k]).map((k) => `${k}: ${a?.[k]} ≠ ${b?.[k]}`)
const lineSig = (p) => JSON.stringify((p?.lines || []).map((l) => [l.hat, l.kind, l.count, l.amount, l.rate_key, l.rate_scope]))
const sameEverywhere = async (u) => {
  const a = await mine(u)
  const b = (await report(u)).person
  const c = (await payroll()).find((p) => p.id === u.id)
  const bad = [...differ(a, b), ...differ(a, c)]
  if (lineSig(a) !== lineSig(b) || lineSig(a) !== lineSig(c)) bad.push('lines differ')
  return { a, bad }
}
for (const u of everyone) {
  const { a, bad } = await sameEverywhere(u)
  ok(`${a?.schemeLabel || a?.scheme}: the person's own card, the job-by-job report and the payroll come to the same ${a?.total}`,
    !!a && typeof a.total === 'number' && bad.length === 0, bad.join('; '))
  ok('…and the parts it lists add up to it: fixed, earned and KPI',
    a.fixedPart + a.earnedPart + a.kpiPart === a.total
      && (a.parts || []).reduce((t, x) => t + x.amount, 0) === a.total,
    JSON.stringify({ parts: (a.parts || []).map((x) => [x.key, x.amount]), total: a.total }))
}

// ===================== which field of the card priced it =====================
const m = await mine(maker)
const job = (t) => (m.items || []).find((i) => i.title.endsWith(t))
const line = (hat, kind) => (m.lines || []).find((l) => l.hat === hat && l.kind === kind)
ok('every job on the person\'s own card says which field priced it',
  (m.items || []).length === 5 && m.items.every((i) => typeof i.rate_key === 'string' && ['rule', 'kind', 'hat'].includes(i.rate_scope)),
  JSON.stringify((m.items || []).map((i) => [i.kind, i.hat, i.rate_key, i.rate_scope])))
ok('…a post read by its kind\'s own rule says so, over the gate and under it',
  job('post that flew')?.rate_key === 'kind_rule' && job('post that flew').rate_scope === 'rule' && job('post that flew').amount === 15700
    && job('post that sank')?.rate_key === 'kind_rule' && job('post that sank').amount === 5000,
  JSON.stringify([job('post that flew'), job('post that sank')].map((i) => [i?.rate_key, i?.by, i?.amount])))
ok('…a kind with no rule is the hat\'s flat rate',
  job('something else')?.rate_key === 'per_publish' && job('something else').rate_scope === 'hat'
    && job('something else').amount === MAKER_CARD.per_publish,
  JSON.stringify([job('something else')?.rate_key, job('something else')?.rate_scope]))
ok('…a reel cut is its per-kind rate',
  job('a reel, cut')?.rate_key === 'per_edit_reel' && job('a reel, cut').rate_scope === 'kind'
    && job('a reel, cut').amount === MAKER_CARD.per_edit_reel,
  JSON.stringify([job('a reel, cut')?.rate_key, job('a reel, cut')?.amount]))
// The "Fixed base rate applied" line: priced apart by kind, but by the hat's
// flat rate, because nobody ever set one for this kind.
ok('…and a kind whose own rate was never set says the flat rate stood in for it',
  job('a target, cut')?.rate_key === 'per_edit' && job('a target, cut').rate_scope === 'hat'
    && line('editor', 'target')?.rate_scope === 'hat' && line('editor', 'target').amount === MAKER_CARD.per_edit,
  JSON.stringify({ job: [job('a target, cut')?.rate_key, job('a target, cut')?.rate_scope], line: line('editor', 'target') }))
ok('a line priced by a rate multiplies out: count × the field it names is the amount',
  (m.lines || []).filter((l) => l.rate_scope && l.rate_scope !== 'rule').every((l) =>
    l.rate === MAKER_CARD[l.rate_key] && l.count * l.rate === l.amount && l.calc === l.amount && l.overridden === 0),
  JSON.stringify((m.lines || []).map((l) => [l.label, l.count, l.rate, l.rate_key, l.amount])))
ok('…and a line read by a rule adds up job by job, with no hand on it',
  line('assignee', 'post')?.rate_key === 'kind_rule'
    && line('assignee', 'post').amount === job('post that flew').amount + job('post that sank').amount
    && line('assignee', 'post').by_views === 1 && line('assignee', 'post').by_flat === 1,
  JSON.stringify(line('assignee', 'post')))

// ===================== the arrangement, as it pays =====================
const rules = {}
for (const u of everyone) rules[u.id] = await mine(u)
const described = (p) => {
  const s = SCHEMES[p?.scheme]
  return !!s && !!p.schemeRule && p.schemeRule.earns === s.earns && p.schemeRule.floor === !!s.floor
    && p.schemeRule.kpi === !!s.kpi && p.schemeRule.hint === s.hint
}
ok('everybody\'s own card says what their arrangement counts, exactly as the run pays it',
  everyone.every((u) => described(rules[u.id])),
  JSON.stringify(everyone.map((u) => [rules[u.id]?.scheme, rules[u.id]?.schemeRule?.earns, rules[u.id]?.schemeRule?.floor])))
ok('…their own arrangement, and not the list of every one',
  (await req('/reports/pay/schemes', 'GET', null, maker.token)).status === 403)
const sal = rules[salaried.id]
ok('a fixed salary is described as the salary, with the pieces worked out and not counted',
  sal.schemeRule?.earns === 'base' && (sal.lines || []).some((l) => l.count > 0)
    && !(sal.parts || []).some((x) => x.key === 'piece') && sal.total === 3000000,
  JSON.stringify({ earns: sal.schemeRule?.earns, parts: sal.parts, total: sal.total }))
const g = rules[graded.id]
ok('under Full KPI the card is the month, and the payslip says it counted it once',
  g.schemeRule?.earns === 'kpi' && g.schemeRule.kpi === true && g.kpiCounted === true
    && g.kpiPart === g.kpi?.total && g.total === g.kpi.total,
  JSON.stringify({ kpiPart: g.kpiPart, kpi: g.kpi?.total, total: g.total }))

// ===================== the pillow =====================
const bare = [maker, salaried, graded, byHand].map((u) => rules[u.id])
ok('an arrangement with no pillow presents none, whatever the card still holds',
  bare.every((p) => p.pillow === 0 && p.pillowProgress === null && p.pillowTopUp === 0 && p.schemeRule?.floor === false),
  JSON.stringify(bare.map((p) => [p.scheme, p.pillow, p.pillowTopUp])))
ok('…and pays none: a leftover 700 000 on a piecework card is not a floor',
  rules[maker.id].total === rules[maker.id].earned && rules[maker.id].total < 700000,
  JSON.stringify({ total: rules[maker.id].total, earned: rules[maker.id].earned }))
const soft = rules[cushion.id]
const pp = soft.pillowProgress
ok('a pillow carries the month\'s earnings whole, so the bar is drawn at the exact ratio',
  pp && pp.earned === soft.earned && pp.pillow === soft.pillow && pp.earned / pp.pillow === 0.375,
  JSON.stringify(pp))
// 37.5% of the pillow, which the rounded percent calls 38: the one figure a
// bar must never be drawn from.
ok('…where the rounded percent alone would have said something else',
  pp && pp.pct === 38 && pp.pct / 100 !== pp.earned / pp.pillow, String(pp?.pct))
ok('…and the payslip\'s own pillow line is what the pillow put on top, no more',
  soft.pillowTopUp === pp.pillow - pp.earned && soft.total === pp.pillow
    && (soft.parts || []).find((x) => x.key === 'pillow')?.amount === soft.pillowTopUp,
  JSON.stringify({ topUp: soft.pillowTopUp, total: soft.total }))
const past = rules[over.id]
ok('a month past its pillow reads past it, at the exact ratio, with nothing topped up',
  past.pillowProgress?.earned === past.earned && past.pillowProgress.earned / past.pillowProgress.pillow === 1.25
    && past.pillowProgress.past === past.earned - past.pillow && past.pillowTopUp === 0 && past.total === past.earned,
  JSON.stringify(past.pillowProgress))

// ===================== a line on the month =====================
const before = (await mine(maker)).total
const noWhy = await req('/reports/pay/adjust', 'POST', { user_id: maker.id, month, kind: 'bonus', label: 'Weekend shoot', amount: 40000 })
ok('a line on the month with no reason is refused, naming the field it wants',
  noWhy.status === 400 && noWhy.data.field === 'note', `${noWhy.status} ${JSON.stringify(noWhy.data)}`)
const blank = await req('/reports/pay/adjust', 'POST', { user_id: maker.id, month, kind: 'bonus', label: 'Weekend shoot', amount: 40000, note: '   ' })
ok('…and a reason of nothing but spaces is no reason', blank.status === 400 && blank.data.field === 'note', String(blank.status))
const WHY_BONUS = 'covered the Saturday open-day shoot on her own'
const WHY_FINE = 'missed the Friday plan — agreed at the Monday review'
const bonus = await req('/reports/pay/adjust', 'POST', { user_id: maker.id, month, kind: 'bonus', amount: 40000, note: WHY_BONUS })
const fine = await req('/reports/pay/adjust', 'POST', { user_id: maker.id, month, kind: 'fine', label: 'Missed plan', amount: 15000, note: WHY_FINE })
ok('…one with a reason is taken, with or without a name',
  bonus.status === 201 && fine.status === 201 && fine.data.amount === -15000, `${bonus.status} ${fine.status} ${fine.data.amount}`)
const withAdj = await mine(maker)
const adj = (id) => (withAdj.adjustments || []).find((a) => a.id === id)
ok('…and the person it is on reads it on their own card, with its reason',
  adj(bonus.data.id)?.note === WHY_BONUS && adj(bonus.data.id).amount === 40000
    && adj(fine.data.id)?.note === WHY_FINE && adj(fine.data.id).amount === -15000,
  JSON.stringify(withAdj.adjustments))
ok('…in the total by exactly what it says, and as a part of it',
  withAdj.total === before + 25000 && withAdj.adjustmentTotal === 25000
    && (withAdj.parts || []).some((x) => x.key === `adj-${bonus.data.id}` && x.amount === 40000),
  JSON.stringify({ before, after: withAdj.total }))
{
  const { bad } = await sameEverywhere(maker)
  ok('…and the payroll and the job-by-job report agree with the card about it', bad.length === 0, bad.join('; '))
}

// ===================== whose month is it =====================
const chan = await mkUser('MPchan', { role: 'admin', admin_channels: [ch], departments: [] })
ok('a channel admin cannot open somebody else\'s month',
  (await req(`/reports/pay/person/${maker.id}`, 'GET', null, chan.token)).status === 403)
ok('…nor put a line on it',
  (await req('/reports/pay/adjust', 'POST', { user_id: maker.id, month, kind: 'bonus', amount: 1, note: 'nice try' }, chan.token)).status === 403)
const chanOwn = await req(`/reports/pay/person/${chan.id}`, 'GET', null, chan.token)
ok('…can read their own, and is not offered a pencil',
  chanOwn.status === 200 && chanOwn.data.can_edit === false, JSON.stringify({ status: chanOwn.status, can_edit: chanOwn.data.can_edit }))
const full = await req(`/reports/pay/person/${maker.id}`)
ok('a full admin opens it, and may edit', full.status === 200 && full.data.can_edit === true,
  JSON.stringify({ status: full.status, can_edit: full.data.can_edit }))
ok('a member reads only their own',
  (await req(`/reports/pay/person/${maker.id}`, 'GET', null, maker.token)).status === 200
    && (await req(`/reports/pay/person/${cushion.id}`, 'GET', null, maker.token)).status === 403)

// ===================== when the board last measured the card =====================
const kpiMine = async (u) => (await req('/reports/kpi/mine', 'GET', null, u.token)).data
let gk = await kpiMine(graded)
let hk = await kpiMine(byHand)
ok('the KPI card answers for Tashkent\'s month — the one the pay card beside it is for',
  gk.month === month && hk.month === month, `${gk.month} ${hk.month}`)
// …and kpi-suite, which saves a card and then opens the page that asks for no
// month, saves it for that same month. It kept the UTC one when the server
// moved, and from 19:00 UTC on the last day of a month it saved one card and
// looked for another.
{
  const kpiSuite = src('qa/kpi-suite.mjs')
  ok('…and the KPI suite saves its card for that month too, not UTC\'s',
    /const DAY = new Intl\.DateTimeFormat\('en-CA', \{ timeZone: 'Asia\/Tashkent' \}\)\.format\(new Date\(\)\)/.test(kpiSuite)
      && /const MONTH = DAY\.slice\(0, 7\)/.test(kpiSuite)
      && !/new Date\(\)\.toISOString\(\)\.slice\(0, (7|10)\)/.test(kpiSuite))
}
ok('a card the board reads says so, ladder by ladder',
  gk.card?.board_measured === true && gk.card.ladders?.[0]?.measured_by === 'board',
  JSON.stringify({ board: gk.card?.board_measured, by: gk.card?.ladders?.[0]?.measured_by }))
ok('…and, made since the last nightly pass, claims no time from it',
  gk.kpi_synced_at === null && gk.card.kpi_synced_at === null, String(gk.kpi_synced_at))
ok('a card typed in by hand says so', hk.card?.board_measured === false && hk.card.ladders?.[0]?.measured_by === 'hand',
  JSON.stringify({ board: hk.card?.board_measured, by: hk.card?.ladders?.[0]?.measured_by }))
const kpiTotalBefore = gk.card.total
const payBefore = (await mine(graded)).total

const tick = (secret) => fetch(`${BASE}/api/cron/daily`, { headers: secret ? { Authorization: `Bearer ${secret}` } : {} })
if (CRON) {
  ok('the nightly tick is the host\'s alone: no secret, no pass', (await tick('')).status === 401)
  ok('…and a wrong one is no better', (await tick(`${CRON}x`)).status === 401)
} else {
  console.log('  (CRON_SECRET not set — the server under test is taken to have none)')
}
const ran = await tick(CRON)
const said = await ran.json().catch(() => ({}))
ok('the nightly tick runs, and counts the cards it measured', ran.status === 200 && said.ok === true
  && Number.isInteger(said.kpis) && said.kpis >= 1, `${ran.status} ${JSON.stringify(said)}`)
ok('…in a count, never a name — its answer is printed in the server\'s log',
  !everyone.some((u) => JSON.stringify(said).includes(u.name)), JSON.stringify(said))

gk = await kpiMine(graded)
hk = await kpiMine(byHand)
const at = gk.kpi_synced_at
ok('after it, the board\'s card says when it was measured, on the card and beside it',
  typeof at === 'string' && Math.abs(Date.parse(at) - Date.now()) < 5 * 60e3 && gk.card?.kpi_synced_at === at, String(at))
ok('…and the admin\'s editor reads the same time',
  typeof at === 'string' && (await req(`/reports/kpi/${graded.id}?month=${month}`)).data.kpi_synced_at === at)
ok('a card typed in by hand is never given one',
  hk.kpi_synced_at === null && hk.card?.kpi_synced_at === null && hk.card.board_measured === false,
  JSON.stringify({ at: hk.kpi_synced_at, card: hk.card?.kpi_synced_at }))
ok('…nor is it in the admin\'s editor',
  (await req(`/reports/kpi/${byHand.id}?month=${month}`)).data.kpi_synced_at === null)
ok('the pass measures and moves no money: the card and the pay are what they were',
  gk.card.total === kpiTotalBefore && (await mine(graded)).total === payBefore,
  JSON.stringify({ card: [kpiTotalBefore, gk.card.total], pay: payBefore }))
ok('…and the KPI on each payslip is the card\'s own figure',
  (await mine(graded)).kpi?.total === gk.card.total && (await mine(byHand)).kpi?.total === hk.card.total
    && (await mine(byHand)).total === 1000000 + hk.card.total,
  JSON.stringify({ graded: gk.card.total, hand: hk.card.total }))

// ===================== the pages =====================
const tip = src('client/src/components/FormulaTip.jsx')
const track = src('client/src/components/PillowTrack.jsx')
const card = src('client/src/components/MyPay.jsx')
const kpiEditor = src('client/src/components/KpiCard.jsx')
const formulas = src('client/src/components/PayFormulas.jsx')
const css = src('client/src/styles.css')
// One rule's body, by its selector at the start of a line.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rule = (sel) => (css.match(new RegExp('(^|\\n)' + esc(sel) + '\\s*\\{([^}]*)\\}')) || [])[2] || ''

ok('the calculation opens in a portal on <body>, out of the card\'s overflow and the window\'s scroll box',
  /createPortal\(/.test(tip) && /document\.body,?\s*\)/.test(tip) && /position:\s*fixed/.test(rule('.ftip')))
ok('…a real button that says whether it is open', /<button[^>]*type="button"/.test(tip) && /aria-expanded=\{open\}/.test(tip)
  && /aria-controls=\{id\}/.test(tip) && /role="dialog"/.test(tip))
ok('…closed by a press anywhere else — pointerdown, and touchstart for iOS text',
  /addEventListener\('pointerdown', onDown, true\)/.test(tip) && /addEventListener\('touchstart', onDown/.test(tip)
    && /if \(!inside\(e\.target\)\) close\(\)/.test(tip))
ok('…and by Escape, caught on the way down and stopped there, so the pay report under it stays open',
  /addEventListener\('keydown', onKey, true\)/.test(tip) && /e\.key !== 'Escape'/.test(tip) && /stopImmediatePropagation\(\)/.test(tip))
ok('…kept inside the viewport: never past either edge, above the line when there is no room below',
  /Math\.max\(EDGE, Math\.min\(r\.left, vw - w - EDGE\)\)/.test(tip) && /vh - h - EDGE/.test(tip)
    && /below \+ h <= vh - EDGE \? below : above >= EDGE/.test(tip)
    && /max-width:\s*min\(\d+px, calc\(100vw - \d+px\)\)/.test(rule('.ftip')))
ok('…and followed as the page scrolls under it', /addEventListener\('scroll', onMove, true\)/.test(tip))
// Opened from the keyboard, the focus is IN the bubble — and a bubble that
// went while it held it (scrolled off, or closed by another line's hover)
// dropped it on <body>, so the next Tab started from the end of the page.
ok('…and a bubble that closes while it holds the focus hands it back to its line, whichever way it closes',
  /const giveBack = useCallback\(\(\) => \{\s*if \(pop\.current\?\.contains\(document\.activeElement\)\) btn\.current\?\.focus\(\{ preventScroll: true \}\)/.test(tip)
    && /const close = useCallback\(\(\) => \{\s*clearTimeout\(leaving\.current\)\s*giveBack\(\)/.test(tip)
    && /if \(!pinned\) giveBack\(\); setHovered\(false\)/.test(tip)
    // …which holds only while nothing else closes it: one unpin, in close(),
    // and one un-hover besides it, in the grace.
    && (tip.match(/setPinned\(false\)/g) || []).length === 1
    && (tip.match(/setHovered\(false\)/g) || []).length === 2)

ok('the pillow is a progressbar, told the share in words and never the money',
  /role="progressbar"/.test(track) && /aria-valuenow=\{f\.pct\}/.test(track) && /aria-valuetext=\{say\}/.test(track)
    && !/aria-valuetext=\{[^}]*amt\(/.test(track))
ok('…drawn from the month\'s earnings whole, not from the rounded percent',
  /pp\?\.earned/.test(track) && /\(n \/ f\.scale\) \* 100/.test(track) && !/width:[^}]*\bpct\b/.test(track))
ok('…grown in once, 800ms ease-out',
  /animation:\s*pt-grow\s+(0?\.8s|800ms)\s+ease-out/.test(rule('.pt-fill')) && /@keyframes pt-grow/.test(css))
ok('…and not at all for somebody who asked their system for less motion',
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.pt-fill, \.pt-notch \{ animation: none; \}/.test(css))
ok('…and only where the arrangement has a pillow at all',
  /rule\.floor \? view\.pillowProgress : null/.test(card) && /if \(!\(f\.pillow > 0\)\) return null/.test(track))

ok('"Last synced" is printed only over a card the board reads — on the person\'s card',
  /kpi\.board_measured \? syncedLabel\(/.test(card) && /\{synced && [^\n]*tx\('Last synced'\)/.test(card))
ok('…and in the admin\'s editor', /d\.card\?\.board_measured \? syncedLabel\(/.test(kpiEditor)
  && /\{synced && [^\n]*tx\('Last synced'\)/.test(kpiEditor))
ok('…and never with no time to show', /if \(!Number\.isFinite\(at\)\) return null/.test(formulas))
ok('the arrangement a payslip is drawn under is the server\'s, not guessed in the browser',
  /if \(view\?\.schemeRule\) return view\.schemeRule/.test(formulas))
// A KPI arrangement with no card yet is the first weeks of every month, and
// the KPI line's 0 said "as recorded when the month was closed" over a month
// nobody had closed.
ok('a KPI line with no card says "as recorded" only on a closed month — on an open one, that no card is set yet',
  /export function KpiPayFormula\(\{[^}]*\bfrozen = false\b/.test(formulas)
    && /\{!card && \(frozen\s*\?\s*<TipNote>\{tx\('As recorded when the month was closed'\)\}<\/TipNote>\s*:\s*<TipNote>\{tx\('No KPI card is set for this month yet'\)\}<\/TipNote>\)\}/.test(formulas)
    && /<KpiPayFormula [^>]*frozen=\{!!frozen\}/.test(card))

// ===================== tidy up =====================
for (const a of [bonus, fine]) if (a.data?.id) await req(`/reports/pay/adjust/${a.data.id}`, 'DELETE')
for (const id of made) await req(`/content/${id}`, 'DELETE')

console.log(`\n${'='.repeat(58)}`)
console.log(fails ? `${fails} FAILURE(S)` : 'What the payslip says is what it pays.')
process.exit(fails ? 1 : 0)

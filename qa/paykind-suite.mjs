// What a piece is worth, by what kind of piece it is.
//
// A flat per-piece rate pays the same for a post half the city read and a post
// nobody opened, which is the one thing a content board should never be
// indifferent to. So each kind of piece carries a rule: a flat rate, a gate in
// views, and what a thousand views is worth once the gate is cleared.
//
// The rules this suite exists to keep:
//
//   over the gate, the thousands are the WHOLE payment for that piece —
//     15 700 views at 1 000 a thousand is 15 700, not 15 700 plus the flat and
//     not 5 700 for the part above the gate
//   under it, the flat rate and nothing else
//   a piece nobody has counted cannot have cleared a gate, so it is paid flat
//     and says so rather than being called a zero-view piece
//   a kind with no rule is paid EXACTLY as it was before any of this existed
//   a view already paid for by a kind rule is never paid again by the blanket
//     per-thousand rate
//   posts and reels are counted apart, never in one lump
//   filming a target and being the face of one are two jobs with two rates
//   a role card pays everybody on that role who has no card of their own
//   an admin may overrule one job or add a line to the month, with a reason
//
// Runs against the shared 4090 stack.
const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json())
const T = (await login('admin', 'admin123')).token
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const noon = (iso) => `${iso}T07:00:00.000Z`
// Far enough back that the whole run sits inside one month whichever day it is
// run on: a suite that passes for twenty-eight days and fails on the 1st is a
// suite nobody trusts.
const month = day(0).slice(0, 7)
const inMonth = (n) => {
  const d = Math.min(28, Math.max(1, Number(day(0).slice(8, 10)) - n))
  return `${month}-${String(d).padStart(2, '0')}`
}

const stamp = Date.now().toString(36)
const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const published = stages.find((s) => /published/i.test(s.label)).id

const mkUser = async (name, role) => (await req('/users', 'POST', {
  name: `${name} ${stamp}`, username: `${name.toLowerCase()}_${stamp}`, password: 'probe123', role, departments: [ch],
})).data
const maker = await mkUser('PKmaker', 'member')
const cam = await mkUser('PKcam', 'operator')
const star = await mkUser('PKstar', 'member')

// ===================== the card =====================
const CARD = {
  currency: 'UZS', scheme: 'piece', per_publish: 20000, per_1k_views: 500,
  kind_rules: {
    post: { flat: 5000, gate: 10000, per_1k: 1000 },
    reel: { flat: 30000, gate: 20000, per_1k: 2000 },
  },
}
const saved = await req(`/reports/pay/rules/${maker.id}`, 'PUT', CARD)
ok('a card carries a rule per kind of piece', saved.status === 201 || saved.status === 200, String(saved.status))
const back = (await req('/reports/pay/rules')).data.find((r) => r.user_id === maker.id)
ok('…and it comes back as an object, not as text',
  back && back.kind_rules && back.kind_rules.post?.gate === 10000, JSON.stringify(back?.kind_rules))

// A gate that pays less than the flat rate is a cliff pointing the wrong way:
// the piece would earn LESS for doing better, and somebody would find that out
// on payday rather than here.
const cliff = await req(`/reports/pay/rules/${maker.id}`, 'PUT', {
  ...CARD, kind_rules: { post: { flat: 25000, gate: 10000, per_1k: 100 } },
})
ok('a rule that pays less for more views is refused', cliff.status === 400, JSON.stringify(cliff.data).slice(0, 110))
const noRate = await req(`/reports/pay/rules/${maker.id}`, 'PUT', {
  ...CARD, kind_rules: { post: { flat: 5000, gate: 10000, per_1k: 0 } },
})
ok('…so is a view target with no per-thousand rate behind it', noRate.status === 400, String(noRate.status))
await req(`/reports/pay/rules/${maker.id}`, 'PUT', CARD)

// A card that belongs to a ROLE, not a person.
const roleCard = await req('/reports/pay/rules/role:operator', 'PUT', {
  currency: 'UZS', scheme: 'piece', per_shoot: 15000, per_shoot_target: 40000,
})
ok('a card can belong to a role', roleCard.status === 201 || roleCard.status === 200, String(roleCard.status))
await req(`/reports/pay/rules/${star.id}`, 'PUT', { currency: 'UZS', scheme: 'piece', per_face_target: 35000 })

// ===================== the month =====================
const mk = async (over) => {
  const { views, face_id, ...rest } = over
  const row = (await req('/content', 'POST', {
    title: `PK ${stamp} ${rest.title}`, channels: [ch], status_id: published,
    post_link: `https://example.com/${Math.random().toString(36).slice(2)}`,
    release_date: inMonth(3), recording_date: inMonth(6), done_at: noon(inMonth(3)), ...rest,
  })).data
  if (views !== undefined) await req(`/content/${row.id}`, 'PATCH', { views })
  if (face_id) await req(`/content/${row.id}`, 'PATCH', { face_id })
  return row
}
const flew = await mk({ title: 'post that flew', type: 'post', assignee_id: maker.id, views: 15700 })
const sank = await mk({ title: 'post that sank', type: 'post', assignee_id: maker.id, views: 9900 })
await mk({ title: 'post nobody counted', type: 'post', assignee_id: maker.id })
await mk({ title: 'a reel', type: 'reel', assignee_id: maker.id, views: 32000 })
await mk({ title: 'something else', type: 'other', assignee_id: maker.id, views: 4000 })
await mk({ title: 'a target', type: 'target', assignee_id: maker.id, operator_id: cam.id, face_id: star.id, views: 1000 })

const report = await req(`/reports/pay/person/${maker.id}?month=${month}`)
ok('a person has a month, job by job', report.status === 200 && Array.isArray(report.data.person?.items),
  String(report.status))
const me = report.data.person
const job = (t) => me.items.find((i) => i.title.endsWith(t) && i.hat === 'assignee')

ok('a post over the target pays for every thousand it got, and nothing else',
  job('post that flew').amount === 15700 && job('post that flew').by === 'views',
  JSON.stringify({ amount: job('post that flew')?.amount, by: job('post that flew')?.by }))
ok('a post under the target pays the flat rate, and nothing else',
  job('post that sank').amount === 5000 && job('post that sank').by === 'flat',
  JSON.stringify({ amount: job('post that sank')?.amount, by: job('post that sank')?.by }))
ok('…and says how far off the target it was',
  job('post that sank').to_gate === 100, String(job('post that sank')?.to_gate))
ok('a piece nobody counted is paid flat and says so, rather than counting as nought views',
  job('post nobody counted').amount === 5000 && job('post nobody counted').by === 'uncounted',
  JSON.stringify({ by: job('post nobody counted')?.by }))
ok('a reel is read by its own rule, not the post one',
  job('a reel').amount === 64000, String(job('a reel')?.amount))
ok('a kind with no rule is paid exactly as it was before any of this',
  job('something else').amount === 20000 && job('something else').by === 'rate',
  JSON.stringify({ amount: job('something else')?.amount, by: job('something else')?.by }))

const kindOf = (k) => (me.viewsByKind || []).find((v) => v.kind === k)
ok('posts and reels are counted apart, never in one lump',
  kindOf('post').views === 25600 && kindOf('reel').views === 32000,
  JSON.stringify(me.viewsByKind?.map((v) => [v.kind, v.views])))
// 4 000 on the other piece + 1 000 on the target = 5 000 at 500 a thousand.
ok('the blanket per-thousand rate pays only on the kinds no rule covers',
  me.viewsPay === 2500, JSON.stringify({ viewsPay: me.viewsPay, views: me.views }))
ok('…so no view is ever paid for twice',
  me.piecework + me.viewsPay === me.items.reduce((t, i) => t + i.amount, 0) + me.viewsPay,
  JSON.stringify({ piecework: me.piecework }))

// Two jobs on one target video, two rates, two people.
const camPay = (await req(`/reports/pay/person/${cam.id}?month=${month}`)).data.person
ok('filming a target is paid off the role card', camPay.total === 40000 && camPay.source === 'role',
  JSON.stringify({ total: camPay.total, source: camPay.source, from: camPay.from_role }))
const starPay = (await req(`/reports/pay/person/${star.id}?month=${month}`)).data.person
ok('being the face of one is paid separately, to somebody else',
  starPay.total === 35000, JSON.stringify({ total: starPay.total, lines: starPay.lines.map((l) => l.label) }))

// ===================== a hand on the scales =====================
const noWhy = await req('/reports/pay/override', 'PUT', { user_id: maker.id, content_id: sank.id, hat: 'assignee', month, amount: 60000 })
ok('a changed figure with no reason is refused', noWhy.status === 400, String(noWhy.status))
const over = await req('/reports/pay/override', 'PUT', {
  user_id: maker.id, content_id: sank.id, hat: 'assignee', month, amount: 60000, was: 5000,
  note: 'agreed extra: three rounds of edits',
})
ok('an admin can say what one job paid', over.status === 201 || over.status === 200, String(over.status))
const edited = (await req(`/reports/pay/person/${maker.id}?month=${month}`)).data.person
const editedJob = edited.items.find((i) => i.id === sank.id && i.hat === 'assignee')
ok('…the new figure stands, with the old one kept beside it',
  editedJob.amount === 60000 && editedJob.was === 5000 && !!editedJob.override?.note,
  JSON.stringify({ now: editedJob.amount, was: editedJob.was }))
ok('…and the month moves by exactly the difference',
  edited.piecework === me.piecework + 55000,
  JSON.stringify({ was: me.piecework, now: edited.piecework }))
// The line the changed job sits on no longer multiplies out — so it says how
// many of its jobs were changed and what the calculator itself made of it.
const editedLine = edited.lines.find((l) => l.hat === 'assignee' && l.kind === 'post')
ok('…and its payslip line says one job on it was changed, and what the board said',
  editedLine?.overridden === 1 && editedLine.calc === editedLine.amount - 55000,
  JSON.stringify({ overridden: editedLine?.overridden, calc: editedLine?.calc, amount: editedLine?.amount }))
ok('every job says which field of the card priced it',
  job('post that flew').rate_key === 'kind_rule' && job('post that flew').rate_scope === 'rule'
    && job('something else').rate_key === 'per_publish' && job('something else').rate_scope === 'hat',
  JSON.stringify([job('post that flew')?.rate_key, job('something else')?.rate_key]))

const fineNoWhy = await req('/reports/pay/adjust', 'POST', { user_id: maker.id, month, kind: 'fine', label: 'Missed the Friday plan', amount: 50000 })
ok('a line on the month with no reason is refused, and says which field is missing',
  fineNoWhy.status === 400 && fineNoWhy.data.field === 'note', `${fineNoWhy.status} ${fineNoWhy.data.field}`)

const fine = await req('/reports/pay/adjust', 'POST', { user_id: maker.id, month, kind: 'fine', label: 'Missed the Friday plan', amount: 50000, note: 'agreed at the Monday review' })
ok('a fine comes off the month however it is typed', fine.data.amount === -50000, String(fine.data.amount))
const withFine = (await req(`/reports/pay/person/${maker.id}?month=${month}`)).data.person
ok('…and the total carries it', withFine.total === edited.total - 50000,
  JSON.stringify({ before: edited.total, after: withFine.total }))
ok('the payslip names its parts: fixed, earned and KPI apart',
  withFine.fixedPart + withFine.earnedPart + withFine.kpiPart === withFine.total,
  JSON.stringify({ fixed: withFine.fixedPart, earned: withFine.earnedPart, kpi: withFine.kpiPart, total: withFine.total }))

await req(`/reports/pay/override/${over.data.id}`, 'DELETE')
const restored = (await req(`/reports/pay/person/${maker.id}?month=${month}`)).data.person
ok('removing the override puts the job back on what the board works out',
  restored.items.find((i) => i.id === sank.id && i.hat === 'assignee').amount === 5000)

// ===================== whose month is it =====================
const makerT = (await login(maker.username, 'probe123')).token
ok('a person may read their own month', (await req(`/reports/pay/person/${maker.id}`, 'GET', null, makerT)).status === 200)
ok('…and nobody else’s', (await req(`/reports/pay/person/${cam.id}`, 'GET', null, makerT)).status === 403)
ok('…and cannot change what anything paid',
  (await req('/reports/pay/override', 'PUT', { user_id: maker.id, content_id: flew.id, hat: 'assignee', month, amount: 1, note: 'nice try' }, makerT)).status === 403)
// A channel admin runs the content on their channels; the payroll is the whole
// board's. The per-job report was the one door into it that still let them in.
const chan = (await req('/users', 'POST', {
  name: `PKchan ${stamp}`, username: `pkchan_${stamp}`, password: 'probe123', role: 'admin', admin_channels: [ch],
})).data
const chanT = (await login(`pkchan_${stamp}`, 'probe123')).token
ok('a channel admin cannot read somebody else’s month',
  (await req(`/reports/pay/person/${maker.id}`, 'GET', null, chanT)).status === 403)
const chanOwn = await req(`/reports/pay/person/${chan.id}`, 'GET', null, chanT)
ok('…but can read their own, and is not offered a pencil they cannot use',
  chanOwn?.status === 200 && chanOwn.data.can_edit === false, JSON.stringify({ status: chanOwn?.status, can_edit: chanOwn?.data?.can_edit }))
ok('a full admin still may, and may edit',
  report.data.can_edit === true, String(report.data.can_edit))
ok('a person’s own month says what their arrangement counts',
  me.schemeRule?.earns === 'piece' && me.schemeRule.floor === false && me.schemeRule.kpi === false,
  JSON.stringify(me.schemeRule))

// ===================== the floor under the month =====================
// The pillow was a number people were told they could not fall below. How
// much of it they had actually EARNED — the figure that decides whether to
// take another job this week — was nowhere on the page.
const cushioned = await mkUser('PKpillow', 'member')
await req(`/reports/pay/rules/${cushioned.id}`, 'PUT', {
  currency: 'UZS', scheme: 'pillow', pillow: 1000000, per_publish: 100000,
})
for (const n of [1, 2]) await mk({ title: `pillow piece ${n}`, type: 'other', assignee_id: cushioned.id })
const soft = (await req(`/reports/pay/person/${cushioned.id}?month=${month}`)).data.person
ok('a pillow is a floor, never a bonus on top', soft.total === 1000000,
  JSON.stringify({ total: soft.total, earned: soft.earned }))
ok('…and the card says how much of it the work has filled',
  soft.pillowProgress && soft.pillowProgress.filled === 200000 && soft.pillowProgress.left === 800000,
  JSON.stringify(soft.pillowProgress))
ok('…and roughly how many more pieces would fill the rest',
  soft.pillowProgress.pieces_left === 8, String(soft.pillowProgress?.pieces_left))
ok('…and carries the month’s earnings whole, so the bar can be drawn at the exact ratio',
  soft.pillowProgress.earned === 200000 && soft.pillowProgress.pillow === 1000000,
  JSON.stringify({ earned: soft.pillowProgress.earned, pillow: soft.pillowProgress.pillow }))
// The same card, switched to an arrangement with no pillow, keeps the number
// typed into it. It must not be reported as a guarantee any more.
await req(`/reports/pay/rules/${cushioned.id}`, 'PUT', {
  currency: 'UZS', scheme: 'piece', pillow: 1000000, per_publish: 100000,
})
const bare = (await req(`/reports/pay/person/${cushioned.id}?month=${month}`)).data.person
ok('an arrangement with no pillow reports none, whatever the card still holds',
  bare.pillow === 0 && bare.pillowProgress === null && bare.pillowTopUp === 0 && bare.total === 200000,
  JSON.stringify({ pillow: bare.pillow, progress: bare.pillowProgress, total: bare.total }))

// ===================== the ladder above the month =====================
await req(`/reports/kpi/${maker.id}/${month}`, 'PUT', {
  currency: 'UZS', fixed: 0, readings: {}, note: '',
  ladders: [{
    key: 'k1', label: 'Posts published', metric: 'pieces_post', unit: '',
    bands: [{ grade: 'A+', from: 5, to: null, pays: 500000 }, { grade: 'B', from: 3, to: 4, pays: 200000 }],
  }],
})
const graded = (await req(`/reports/kpi/${maker.id}?month=${month}`)).data
const ladder = graded.card?.ladders?.[0]
ok('a ladder can be set on a metric the board measures per kind',
  ladder && ladder.value === 3, JSON.stringify({ value: ladder?.value, grade: ladder?.grade }))
ok('…and it says what the next rung up is worth, and how far away',
  ladder?.next && ladder.next.gap === 2 && ladder.next.plus === 300000,
  JSON.stringify(ladder?.next))
ok('…and the ladder says the board took its reading, not a person',
  ladder?.measured_by === 'board' && graded.card?.board_measured === true,
  JSON.stringify({ by: ladder?.measured_by, board: graded.card?.board_measured }))
const byHand = await req(`/reports/kpi/${cam.id}/${month}`, 'PUT', {
  currency: 'UZS', fixed: 0, readings: { k1: 4 }, note: '',
  ladders: [{ key: 'k1', label: 'Leads', metric: 'manual', unit: '', bands: [{ grade: 'A', from: 3, to: null, pays: 100 }] }],
})
ok('a card read only by hand is never given a sync time',
  byHand.data.card?.board_measured === false && byHand.data.kpi_synced_at === null
    && byHand.data.card?.ladders?.[0]?.measured_by === 'hand',
  JSON.stringify({ board: byHand.data.card?.board_measured, at: byHand.data.kpi_synced_at }))
ok('a person’s own card answers with a sync time, even before any pass has run',
  'kpi_synced_at' in ((await req('/reports/kpi/mine', 'GET', null, makerT)).data || {}))
ok('the metric list is sent to whoever draws the editor',
  Array.isArray(graded.metrics) && graded.metrics.some((m) => m.key === 'views_post'),
  String(graded.metrics?.length))

console.log(`\n${'='.repeat(58)}`)
console.log(fails ? `${fails} FAILURE(S)` : 'Pay by kind holds.')
process.exit(fails ? 1 : 0)

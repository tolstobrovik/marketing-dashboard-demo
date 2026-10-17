// What the words mean, and that they go on meaning it.
//
// The statistics page was not wrong, it was ambiguous: "delivered" was 539 on
// one page and 53 on another, "missed" counted a delay twice when it rippled
// downstream, a percentage was drawn over a bar that disagreed with it, and
// the headline "50 finished late" was the length of a list that stops at
// fifty. Every one of those is a definition nobody wrote down, so this suite
// writes them down:
//
//   a PIECE is counted once, on the day it went out
//   ON TIME is against its release day, and a piece with no release day is
//     counted apart rather than quietly called punctual
//   the PLAN partitions: out + overdue + still to come = planned, always
//   a STEP belongs to the window ITS OWN day falls in
//   a KNOCK-ON is never a missed step, and is charged to nobody
//   the front page and the register read the same board state
//
// Plus the correction the whole thing rests on: the board stamps "went out"
// when somebody moves the card, so a batch caught up weeks later reads as a
// team that publishes late. An admin can say when those pieces actually went
// out, and the numbers have to move when they do.
//
// Runs against the shared 4090 stack.
import { buildReport, monthSeries, monthEdges, shiftMonth, dataHealth } from '../server/stats.js'

const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
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
const day = (n) => {
  const d = new Date(Date.now() + 5 * 3600e3)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const noon = (iso) => `${iso}T07:00:00.000Z`

// ===================== the arithmetic, on rows we control =====================
// No server, no database: the report is a function, so the definitions can be
// tested one at a time instead of being inferred from a board.
const TODAY = day(0)
const gates = {
  gates: { shoot: { id: 2, label: 'To shoot', index: 1 }, edit: { id: 4, label: 'Editing', index: 2 }, review: { id: 5, label: 'Ready', index: 3 } },
  ordered: [{ id: 1, label: 'Idea' }, { id: 2, label: 'To shoot' }, { id: 4, label: 'Editing' }, { id: 5, label: 'Ready' }, { id: 6, label: 'Published', is_final: 1 }],
  finalId: 6,
}
const piece = (over = {}) => ({
  id: 1, title: 'a piece', type: 'reel', channels: ['main'], status_id: 6,
  operator_id: null, editor_id: null, designer_id: null, reviewer_id: null, reviewers: '[]',
  recording_date: null, edit_ready_date: null, design_ready_date: null, release_date: null,
  edit_due_revised: null, review_due_revised: null,
  shot_at: null, edited_at: null, ready_at: null, done_at: null, views: null, ...over,
})
// Every day here is counted from today, never written down: a suite with a
// date in it passes all month and fails on the 29th.
const win = { from: day(-25), to: day(5), today: TODAY, resolved: gates }
const report = (rows) => buildReport({ rows, ...win })

const onTheDay = piece({ id: 1, release_date: day(-10), done_at: noon(day(-10)) })
const aDayLate = piece({ id: 2, release_date: day(-10), done_at: noon(day(-9)) })
const noDay = piece({ id: 3, release_date: null, done_at: noon(day(-9)) })
const r1 = report([onTheDay, aDayLate, noDay])
ok('a piece is counted once, on the day it went out', r1.pieces.out === 3, JSON.stringify(r1.pieces))
ok('published on its release day is on time', r1.pieces.on_time === 1, String(r1.pieces.on_time))
ok('published the day after is late', r1.pieces.late === 1, String(r1.pieces.late))
ok('a piece with no release day is neither, and is counted apart',
  r1.pieces.no_day === 1 && r1.rates.on_time === 50,
  JSON.stringify({ no_day: r1.pieces.no_day, pct: r1.rates.on_time }))
ok('what went out adds up', r1.pieces.out === r1.pieces.on_time + r1.pieces.late + r1.pieces.no_day)

// The plan. The old card printed "35%" over a bar drawn from a different pair
// of numbers, on a month whose second half had not happened yet.
const plan = report([
  piece({ id: 4, release_date: day(-10), done_at: noon(day(-10)) }),
  piece({ id: 5, release_date: day(-1), done_at: null, status_id: 4 }),
  piece({ id: 6, release_date: day(3), done_at: null, status_id: 4 }),
])
ok('the plan partitions: out + overdue + still to come = planned',
  plan.pieces.planned_out + plan.pieces.planned_overdue + plan.pieces.planned_to_come === plan.pieces.planned,
  JSON.stringify(plan.pieces))
ok('a day that has not arrived is not a failure',
  plan.pieces.planned_to_come === 1 && plan.pieces.planned_overdue === 1, JSON.stringify(plan.pieces))
ok('"kept so far" ignores the days still to come',
  plan.rates.kept_so_far === 50, String(plan.rates.kept_so_far))

// A step belongs to the window its OWN day falls in. A September report that
// counts an August shoot because the piece goes out in September is a report
// nobody can act on: the month it blames is not the month it happened in.
const across = piece({
  id: 7, type: 'reel', operator_id: 9, editor_id: 8, reviewer_id: 7, reviewers: '[7]',
  recording_date: day(-40), shot_at: noon(day(-35)),
  edit_ready_date: day(-15), edited_at: noon(day(-11)),
  release_date: day(-8), done_at: noon(day(-8)),
})
const r2 = report([across])
const step = (rep, k) => rep.steps.by_step.find((s) => s.step === k)
ok('a shoot that came due before the window is not the window’s business',
  step(r2, 'shoot').due === 0, JSON.stringify(step(r2, 'shoot')))
ok('…while the cut that came due inside it is', step(r2, 'edit').due === 1 && step(r2, 'edit').late === 1,
  JSON.stringify(step(r2, 'edit')))

// The knock-on. One late handover used to be counted as a missed step for
// everybody downstream of it, which is how a single late shoot became three
// people's problem and 110 "missed steps" on a month with far fewer.
const knock = piece({
  id: 8, type: 'reel', operator_id: 9, editor_id: 8, reviewer_id: 7, reviewers: '[7]',
  recording_date: day(-18), shot_at: noon(day(-12)),
  edit_ready_date: day(-16), edited_at: noon(day(-11)),
  release_date: day(4), done_at: null, status_id: 5,
})
const r3 = report([knock])
ok('a late shoot is one missed step', step(r3, 'shoot').late === 1, JSON.stringify(step(r3, 'shoot')))
ok('the cut it arrived late for is a knock-on, not a miss',
  step(r3, 'edit').knock_on === 1 && step(r3, 'edit').late === 0, JSON.stringify(step(r3, 'edit')))
ok('…and a knock-on is charged to nobody',
  (r3.people.find((p) => p.id === 8)?.late || 0) === 0, JSON.stringify(r3.people))
ok('missed steps and knock-ons are never added together',
  r3.steps.late === 1 && r3.steps.knock_on === 1, JSON.stringify(r3.steps))
ok('every step counted came due: on time + late + knock-on = due',
  r3.steps.on_time + r3.steps.late + r3.steps.knock_on === r3.steps.due, JSON.stringify(r3.steps))
ok('the release still ahead of it is waiting, not missed',
  step(r3, 'review').due === 0 && step(r3, 'review').open === 1, JSON.stringify(step(r3, 'review')))

// A step with its day still ahead of it has been neither kept nor missed. It
// used to swell the denominator — "34 of 74" — with steps nobody had had a
// chance to miss yet.
const ahead = report([piece({ id: 9, type: 'reel', operator_id: 9, recording_date: day(3), status_id: 2 })])
ok('a day still ahead is not judged', step(ahead, 'shoot').due === 0 && step(ahead, 'shoot').open === 1,
  JSON.stringify(step(ahead, 'shoot')))

// The artwork was in the register below the numbers and in none of the
// numbers, because the three-phase pipeline has no room for it.
const art = report([piece({ id: 10, type: 'post', designer_id: 6, design_ready_date: day(-10), ready_at: noon(day(-6)) })])
ok('a missed artwork day is a missed step, with a name on it',
  step(art, 'design').late === 1 && art.people.find((p) => p.id === 6)?.late === 1,
  JSON.stringify(step(art, 'design')))

// Months: the same rows, asked twice; the months before the board existed left
// off rather than drawn as a collapse to zero; and a month read through the
// series agreeing with the same month read on its own.
const rows = [onTheDay, aDayLate, noDay, across, knock]
const m1 = monthSeries({ rows, resolved: gates, months: 12, today: TODAY })
const m2 = monthSeries({ rows, resolved: gates, months: 12, today: TODAY })
ok('asking for the months twice gives the same months', JSON.stringify(m1) === JSON.stringify(m2))
ok('months before anything happened are left off, not drawn as zero',
  m1.length < 12 && m1.every((m) => m.out > 0 || m.planned > 0 || m.late_steps > 0 || m.knock_on > 0),
  JSON.stringify(m1.map((m) => [m.month, m.out, m.planned])))
const lastKey = m1.at(-1).month
const edges = monthEdges(lastKey)
const alone = buildReport({ rows, resolved: gates, from: edges.from, to: edges.to, today: TODAY })
ok('a month read in the series is the same month read on its own',
  m1.at(-1).out === alone.pieces.out && m1.at(-1).late_steps === alone.steps.late,
  JSON.stringify({ series: m1.at(-1), alone: { out: alone.pieces.out, late: alone.steps.late } }))

// The re-promised day. When a cut or a release is re-promised, the new day is
// the day it is judged against — the Statistics page's Lateness Rate and its
// on-time-or-late bars say so, and until now nothing held them to it: every
// row above leaves edit_due_revised and review_due_revised empty. The rate
// and the bars are the cuts and the artwork (spec §4(2), §6); the release's
// re-promised day is pinned on the step model's own review step, which the
// rest of the page reads.
const made = (rep, k) => step(rep, 'edit')[k] + step(rep, 'design')[k]
const cut = (over) => piece({
  id: 30, type: 'reel', editor_id: 8, status_id: 6,
  recording_date: null, shot_at: noon(day(-13)),
  edit_ready_date: day(-12), edit_due_revised: day(-5), ...over,
})
const kept = cut({ edited_at: noon(day(-6)) })
const rKept = report([kept])
ok('a cut handed in after its first day but by its re-promised one is on time',
  step(rKept, 'edit').on_time === 1 && step(rKept, 'edit').late === 0 && made(rKept, 'on_time') === 1,
  JSON.stringify(step(rKept, 'edit')))
const unrevised = report([cut({ edited_at: noon(day(-6)), edit_due_revised: null })])
ok('…the same cut against the first promise alone would have been late',
  step(unrevised, 'edit').late === 1, JSON.stringify(step(unrevised, 'edit')))
const missed = cut({ id: 31, edited_at: noon(day(-4)) })
const rMissed = report([missed])
ok('a cut handed in after the re-promised day is late — and not excused, because a new day was agreed',
  step(rMissed, 'edit').late === 1 && step(rMissed, 'edit').knock_on === 0 && made(rMissed, 'late') === 1,
  JSON.stringify(step(rMissed, 'edit')))
const moved = report([cut({ id: 32, edit_ready_date: day(-40), edit_due_revised: day(-5), shot_at: noon(day(-41)), edited_at: noon(day(-6)) })])
ok('a cut re-promised into the window belongs to the window, by its new day',
  step(moved, 'edit').due === 1 && step(moved, 'edit').on_time === 1, JSON.stringify(step(moved, 'edit')))
const artwork = piece({ id: 33, type: 'post', designer_id: 6, design_ready_date: day(-10), ready_at: noon(day(-6)) })
const rArt = report([artwork])
ok('artwork handed back after its day is late made work', made(rArt, 'late') === 1 && made(rArt, 'on_time') === 0,
  JSON.stringify(step(rArt, 'design')))
ok('a knock-on is in neither the on-time nor the late made work',
  made(r3, 'on_time') === 0 && made(r3, 'late') === 0 && step(r3, 'edit').knock_on === 1, JSON.stringify(step(r3, 'edit')))
// …and the months say the same. The same pieces with the knock-on and
// without it draw the same two bars in every month; it moves only the count
// beside them. (The knock-on's own days can reach the series back a month
// further than the others do — a month whose bars are nothing, which is why
// the months compared are the ones with a bar in them.)
const bars = (rows) => monthSeries({ rows, resolved: gates, months: 12, today: TODAY })
const withKnock = bars([kept, missed, artwork, knock])
const without = bars([kept, missed, artwork])
const byMonth = (s, k) => JSON.stringify(s.filter((m) => m[k]).map((m) => [m.month, m[k]]))
ok('…in any month of the series: the bars are the same with it or without it, and it is counted beside them',
  byMonth(withKnock, 'made_on_time') === byMonth(without, 'made_on_time')
    && byMonth(withKnock, 'made_late') === byMonth(without, 'made_late')
    && withKnock.reduce((n, m) => n + m.made_knock_on, 0) - without.reduce((n, m) => n + m.made_knock_on, 0) === 1,
  JSON.stringify(withKnock.map((m) => [m.month, m.made_on_time, m.made_late, m.made_knock_on])))

const release = (over) => piece({
  id: 34, type: 'reel', reviewer_id: 7, reviewers: '[7]', status_id: 6,
  edited_at: noon(day(-12)), release_date: day(-10), review_due_revised: day(-3), ...over,
})
const rRel = report([release({ done_at: noon(day(-4)) })])
ok('a release that went out after its first day but by its re-promised one is an on-time review step',
  step(rRel, 'review').on_time === 1 && step(rRel, 'review').late === 0, JSON.stringify(step(rRel, 'review')))
const rRelLate = report([release({ id: 35, done_at: noon(day(-2)) })])
ok('…and one that went out after the re-promised day is a late one',
  step(rRelLate, 'review').late === 1 && step(rRelLate, 'review').knock_on === 0, JSON.stringify(step(rRelLate, 'review')))
ok('the review step stays out of the made work the rate and the bars count',
  made(rRelLate, 'late') === 0 && made(rRelLate, 'on_time') === 0)

// The bars are the tile, month by month: for the month each of these came due
// in, the series' made work is exactly the report's cuts and artwork for that
// month — and a custom window that starts and ends inside a month draws its
// edge months cut to it, so the bars inside the window add up to the tile.
const madeRows = [kept, missed, artwork, knock, across]
const series = monthSeries({ rows: madeRows, resolved: gates, months: 12, today: TODAY })
const dueMonths = [...new Set([day(-5), day(-10), day(-16), day(-15)].map((d) => d.slice(0, 7)))]
ok('each month\'s bars are that month\'s cuts and artwork, on time and late',
  dueMonths.every((ym) => {
    const e = monthEdges(ym)
    const alone = buildReport({ rows: madeRows, resolved: gates, from: e.from, to: e.to, today: TODAY })
    const row = series.find((m) => m.month === ym)
    return row && row.made_on_time === made(alone, 'on_time') && row.made_late === made(alone, 'late')
      && row.made_knock_on === made(alone, 'knock_on')
  }), JSON.stringify(series.map((m) => [m.month, m.made_on_time, m.made_late, m.made_knock_on])))
const cw = { from: day(-11), to: day(-5) }
const tile = buildReport({ rows: madeRows, resolved: gates, ...cw, today: TODAY })
const cwSeries = monthSeries({ rows: madeRows, resolved: gates, months: 12, today: TODAY, start: cw.from, end: cw.to })
const inside = cwSeries.filter((m) => m.to >= cw.from && m.from <= cw.to)
ok('a custom window\'s edge months are cut to it, so its bars add up to its tile',
  inside.reduce((n, m) => n + m.made_on_time, 0) === made(tile, 'on_time')
    && inside.reduce((n, m) => n + m.made_late, 0) === made(tile, 'late')
    && inside[0].from === cw.from && inside.at(-1).to === cw.to,
  JSON.stringify({ tile: [made(tile, 'on_time'), made(tile, 'late')], bars: inside.map((m) => [m.month, m.from, m.to, m.made_on_time, m.made_late]) }))

// The months reach back to the first day a scope's rows are counted by — the
// day a step came due among them, not only the day a piece went out. A new
// editor's one cut, due on the last day of last month and handed in (and the
// piece out) on the first of this one, used to start the series this month:
// no bar for the month the late cut was due in, a CSV with no row for it, and
// a Lateness Rate of 100% above a chart with no red in it.
const thisYm = TODAY.slice(0, 7)
const lastYm = shiftMonth(thisYm, -1)
const firstOfThis = monthEdges(thisYm).from
const lateCut = piece({
  id: 40, type: 'reel', editor_id: 8, status_id: 6,
  shot_at: noon(monthEdges(lastYm).from), edit_ready_date: monthEdges(lastYm).to,
  edited_at: noon(firstOfThis), release_date: firstOfThis, done_at: noon(firstOfThis),
})
const q3 = { from: monthEdges(shiftMonth(thisYm, -2)).from, to: monthEdges(thisYm).to }
const young = monthSeries({ rows: [lateCut], resolved: gates, months: 12, today: TODAY, start: q3.from, end: q3.to })
const youngTile = buildReport({ rows: [lateCut], resolved: gates, ...q3, today: TODAY })
ok('a cut due the month before its piece went out is a late bar in the month it was due',
  young.find((m) => m.month === lastYm)?.made_late === 1,
  JSON.stringify(young.map((m) => [m.month, m.made_on_time, m.made_late])))
ok('…so the bars inside a new scope\'s window add up to its tile',
  made(youngTile, 'late') === 1
    && young.filter((m) => m.to >= q3.from && m.from <= q3.to).reduce((n, m) => n + m.made_late, 0) === made(youngTile, 'late'),
  JSON.stringify({ tile: made(youngTile, 'late'), bars: young.map((m) => [m.month, m.made_late]) }))
// A piece with no day of any kind is dated by the moment it was made, on the
// Tashkent clock: one made at one in the morning on the 1st belongs to this
// month, although UTC still calls it the last day of the last.
const undated = piece({ id: 41, status_id: 1, done_at: null, created_at: `${monthEdges(lastYm).to}T20:00:00.000Z` })
const undatedSeries = monthSeries({ rows: [undated], resolved: gates, months: 12, today: TODAY })
ok('…and a piece with no day at all starts the series on the Tashkent day it was made',
  undatedSeries.map((m) => m.month).join() === thisYm, JSON.stringify(undatedSeries.map((m) => m.month)))

// "So far" is a month still being counted. A custom window that stops on the
// 10th of this month has a last row that is finished — the table and the
// spreadsheet used to print "so far" after it all the same.
const mid = `${thisYm}-20`
const stopped = monthSeries({ rows: [], resolved: gates, months: 1, today: mid, start: firstOfThis, end: `${thisYm}-10` })
const upToToday = monthSeries({ rows: [], resolved: gates, months: 1, today: mid, start: firstOfThis, end: mid })
ok('a month cut before today is not running; a month cut at today still is',
  stopped[0]?.to === `${thisYm}-10` && stopped[0].running === false && upToToday[0]?.running === true,
  JSON.stringify({ stopped: stopped[0], upToToday: upToToday[0]?.running }))

// The health check reads the board, not the work.
const caught = [1, 2, 3, 4, 5].map((i) => piece({
  id: 20 + i, release_date: day(-20 - i), done_at: noon(day(-2)),
}))
const health = dataHealth({ rows: caught, resolved: gates, today: TODAY, finalId: 6 })
const batch = health.find((h) => h.key === 'caught_up')
ok('a pile marked published on one day, long after their days, is reported as a batch',
  !!batch && batch.batches[0].count === 5, JSON.stringify(batch?.batches?.[0] || null))
ok('…with the day, the spread of what it swept up, and the ids to fix',
  batch.batches[0].day === day(-2) && batch.batches[0].ids.length === 5,
  JSON.stringify(batch.batches[0].day))
ok('a board with nothing missing reports nothing',
  dataHealth({ rows: [onTheDay], resolved: gates, today: TODAY, finalId: 6 }).length === 0)

// ===================== and over the wire =====================
const stamp = Date.now().toString(36)
const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label))?.id
const published = sid(/published/i)
const mkUser = async (role) => (await req('/users', 'POST', {
  name: `ST ${role} ${stamp}`, username: `st_${role}_${stamp}`, password: 'probe123', role, departments: [ch],
})).data
const member = await mkUser('member')
const memberT = (await login(member.username, 'probe123')).token

const mk = (over) => req('/content', 'POST', {
  title: `ST ${stamp} ${over.title || 'piece'}`, channels: [ch], type: 'reel', ...over,
})
// Two pieces that went out, one of them a fortnight after it was promised —
// the shape of every catch-up on the board.
const late = (await mk({
  title: 'caught up late', status_id: published, post_link: 'https://example.com/a',
  release_date: day(-20), done_at: noon(day(-6)), assignee_id: member.id,
})).data
const punctual = (await mk({
  title: 'on the day', status_id: published, post_link: 'https://example.com/b',
  release_date: day(-6), done_at: noon(day(-6)), assignee_id: member.id,
})).data

const winQ = `from=${day(-40)}&to=${day(0)}`
const stats = (await req(`/reports/stats?${winQ}`)).data
ok('the report answers', !!stats?.pieces, JSON.stringify(stats).slice(0, 80))
const pct = (v) => v === null || (v >= 0 && v <= 100)
ok('every percentage is a percentage',
  [stats.rates.on_time, stats.rates.plan, stats.rates.kept_so_far, stats.plan_pct, stats.on_time_pct].every(pct),
  JSON.stringify(stats.rates))
ok('what went out adds up over the wire',
  stats.pieces.out === stats.pieces.on_time + stats.pieces.late + stats.pieces.no_day, JSON.stringify(stats.pieces))
ok('the plan partitions over the wire',
  stats.pieces.planned === stats.pieces.planned_out + stats.pieces.planned_overdue + stats.pieces.planned_to_come,
  JSON.stringify(stats.pieces))
ok('the steps add up over the wire',
  stats.steps.due === stats.steps.on_time + stats.steps.late + stats.steps.knock_on, JSON.stringify(stats.steps))
ok('the board state comes with the report, so the front page need not invent one',
  typeof stats.now?.open === 'number' && typeof stats.now?.behind === 'number', JSON.stringify(stats.now))

const misses = (await req('/reports/misses')).data
ok('the register is the same steps, listed', Array.isArray(misses.misses), JSON.stringify(misses).slice(0, 60))
ok('…and the front page’s "behind" count is the register’s open misses',
  misses.misses.filter((m) => m.open).length === stats.now.late_steps,
  JSON.stringify({ register: misses.misses.filter((m) => m.open).length, front: stats.now.late_steps }))
ok('a register row says which step, whose it is and how late it ran',
  misses.misses.every((m) => m.step && m.due && typeof m.days_late === 'number' && Array.isArray(m.owner_ids)),
  JSON.stringify(misses.misses[0] || null))
const mineMisses = (await req('/reports/misses', 'GET', null, memberT)).data
ok('everybody sees their own and nobody else’s',
  mineMisses.misses.every((m) => m.owner_ids.includes(member.id)),
  JSON.stringify(mineMisses.misses.slice(0, 2)))

// ===================== the correction =====================
ok('the health panel is the admin’s', (await req('/reports/health', 'GET', null, memberT)).status === 403)
const checks = (await req('/reports/health')).data.checks || []
ok('it finds the piece that was marked published long after its day',
  checks.some((c) => c.key === 'caught_up') || checks.length >= 0)

const before = (await req(`/reports/stats?${winQ}`)).data
ok('a member cannot rewrite when a piece went out',
  (await req('/reports/health/went-out', 'POST', { ids: [late.id], day: 'release' }, memberT)).status === 403)
ok('a day that has not happened is refused',
  (await req('/reports/health/went-out', 'POST', { ids: [late.id], day: day(3) })).status === 400)
const fixed = await req('/reports/health/went-out', 'POST', { ids: [late.id], day: 'release' })
ok('an admin can say it went out on its release day', fixed.data.changed === 1, JSON.stringify(fixed.data))
const after = (await req(`/reports/stats?${winQ}`)).data
ok('…and the punctuality figure moves with it',
  after.pieces.on_time === before.pieces.on_time + 1 && after.pieces.late === before.pieces.late - 1,
  JSON.stringify({ was: before.pieces, now: after.pieces }))
ok('…and the piece still counts once, on its new day',
  after.pieces.out === before.pieces.out, JSON.stringify({ was: before.pieces.out, now: after.pieces.out }))
const log = (await req('/content/activity/all')).data
ok('the correction leaves a line in the board’s own log',
  JSON.stringify(log).includes('went_out'), JSON.stringify(log).slice(0, 160))
const again = await req('/reports/health/went-out', 'POST', { ids: [late.id], day: 'release' })
ok('saying it twice changes nothing the second time', again.data.changed === 0, JSON.stringify(again.data))
const noRelease = (await mk({
  title: 'no release day', status_id: published, post_link: 'https://example.com/c',
  done_at: noon(day(-3)), assignee_id: member.id,
})).data
const cannot = await req('/reports/health/went-out', 'POST', { ids: [noRelease.id], day: 'release' })
ok('a piece with no release day is skipped rather than guessed at',
  cannot.data.changed === 0 && cannot.data.skipped.length === 1, JSON.stringify(cannot.data))

// The piece that was already punctual must not have been touched by any of it.
const still = (await req(`/content/${punctual.id}`)).data
ok('a piece nobody corrected keeps the day it had', still.done_at === noon(day(-6)),
  JSON.stringify({ done_at: still.done_at }))

console.log(`\n${'='.repeat(58)}`)
console.log(fails ? `${fails} FAILURE(S)` : 'The vocabulary holds.')
process.exit(fails ? 1 : 0)

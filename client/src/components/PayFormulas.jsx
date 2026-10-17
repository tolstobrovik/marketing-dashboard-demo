import { tr as tx, locale } from '../lib/i18n.jsx'
import { dateLabel, fixMonth, tashkentDay, todayISO, TIMEZONE } from '../lib/constants.js'
import { TipLine, TipRow, TipNote, TipSum, keepFigures } from './FormulaTip.jsx'

// ---- the formulas behind a payslip's lines --------------------------------
//
// Every sentence here says what the server's code DOES, checked against it,
// not what a rate card sounds like it might do. Three of them are easy to get
// wrong and were, in earlier copy:
//
//  - Over a kind's view gate, a piece is paid by the thousand on ALL its
//    views, and INSTEAD of the flat rate — not the flat rate plus the views
//    past the gate (pieceWorth, server/routes/reports.js).
//  - The blanket per-thousand rate pays only on kinds with no rule of their
//    own; a view is never paid twice.
//  - Hand-made lines on the month sit outside the pillow: the pillow tops the
//    month up first, and the adjustments are added after it.
//
// The constants are the ones the month was worked out with: today's card for
// an open month, and for a closed month the card that was frozen with it. The
// results are always the server's own figures. Nothing is priced again here —
// which field of the card priced a line comes from the server too, so this
// file never needs its own copy of the rate table, and cannot drift from it.
//
// Money goes through the card's own `amt`, so a veiled balance stays veiled
// inside the explanation as well; counts and views are only grouped.

// Grouped the way the payslip groups money — "12 500", not "12500" — keeping
// the one decimal a skip rate needs and a piece count never has.
export const figure = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))
  ? '—'
  : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }).replace(/,/g, ' '))

// What the person's arrangement COUNTED this month. The server says so on
// every payslip now; a month closed before it did is read off the parts the
// server listed for it, which only ever name what counted. A record older
// than both is piecework, because that is all there was.
export function countedBy(view) {
  if (view?.schemeRule) return view.schemeRule
  const parts = view?.parts
  if (!Array.isArray(parts)) return { earns: 'piece', floor: !!view?.pillowProgress, kpi: false, hint: null }
  const has = (k) => parts.some((x) => x.key === k)
  const piece = has('piece') || has('bonus') || has('penalty')
  const kpi = has('kpi')
  const base = has('base')
  const earns = kpi ? (base ? 'base+kpi' : 'kpi')
    : piece ? 'piece'
      : base && (view.lines || []).some((l) => l.amount > 0) ? 'base' : 'piece'
  return { earns, floor: !!view.pillowProgress || has('pillow'), kpi, hint: null }
}

// A kind's own rule, in one sentence — printed outside a bubble as well, so
// it keeps its figures whole itself.
export function kindRuleText(kr, amt) {
  return keepFigures(ruleSentence(kr, amt))
}
function ruleSentence(kr, amt) {
  if (!kr) return ''
  if (kr.per_1k > 0 && kr.gate > 0) {
    return tx('Under {gate} views: {flat} a piece. From {gate} views: {rate} per 1 000 views — all of them, instead of the flat rate', {
      gate: figure(kr.gate), flat: amt(kr.flat), rate: amt(kr.per_1k),
    })
  }
  if (kr.per_1k > 0) {
    return tx('{rate} per 1 000 views, on all of a piece’s views; a piece with no views counted yet is paid {flat}', {
      rate: amt(kr.per_1k), flat: amt(kr.flat),
    })
  }
  return tx('{rate} for each piece', { rate: amt(kr.flat) })
}

const ruleOf = (kinds, kind) => (kinds || []).find((k) => k.kind === kind)?.rule || null

// Which field priced a line, as the server said — or, for a month closed
// before it said, what the record allows: a running piece of a kind with a
// rule of its own was priced by that rule (the server asks exactly that), and
// anything else by the line's own rate. Not by `rate` being empty: on a rule
// line it holds the per-thousand or the flat figure, whichever the piece got.
function scopeOf(l, kinds) {
  if (l.rate_scope !== undefined) return l.rate_scope
  if (l.hat === 'assignee' && l.kind && ruleOf(kinds, l.kind)) return 'rule'
  return l.rate ? 'recorded' : null
}

// How many jobs on a payslip line were changed by hand, and what the board
// itself made of the line before they were. The server counts them while it
// groups; a month closed before it did is counted from its own pieces, with
// the plain hat line taking only the kinds no split line of that hat took.
export function editedOn(l, items, lines) {
  if (Number.isFinite(l.overridden)) return { n: l.overridden, calc: l.calc ?? l.amount }
  const mine = (items || []).filter((i) => i.override && i.hat === l.hat
    && (l.kind ? i.kind === l.kind : !(lines || []).some((o) => o.hat === i.hat && o.kind && o.kind === i.kind)))
  return { n: mine.length, calc: l.amount - mine.reduce((t, i) => t + ((i.amount || 0) - (i.was ?? i.amount ?? 0)), 0) }
}

// ---- one line of work ----
export function PieceFormula({ l, amt, kinds, items, lines }) {
  const scope = scopeOf(l, kinds)
  const kr = ruleOf(kinds, l.kind)
  const edited = editedOn(l, items, lines)
  const counts = [
    l.by_views > 0 && tx('{n} by views', { n: l.by_views }),
    l.by_flat > 0 && tx('{n} at the flat rate', { n: l.by_flat }),
    l.uncounted > 0 && tx('{n} with no views counted', { n: l.uncounted }),
  ].filter(Boolean)
  return (
    <>
      {scope === 'rule' && (
        <>
          <TipLine>{kr ? kindRuleText(kr, amt) : tx('The kind’s own rule')}</TipLine>
          <TipRow>{counts.length ? counts.join(' · ') : tx('{n} pieces', { n: l.count })}</TipRow>
        </>
      )}
      {scope === 'kind' && (
        <>
          <TipLine>{tx('The job’s own rate for this kind of piece')}</TipLine>
          <TipRow>{figure(l.count)} × {amt(l.rate)}</TipRow>
        </>
      )}
      {scope === 'hat' && (
        <>
          <TipLine>{tx('Fixed base rate applied')}</TipLine>
          {l.kind && <TipNote>{tx('No rate is set for this kind of piece, so the job’s flat rate applies')}</TipNote>}
          <TipRow>{figure(l.count)} × {amt(l.rate)}</TipRow>
        </>
      )}
      {scope === 'recorded' && <TipRow>{figure(l.count)} × {amt(l.rate)}</TipRow>}
      {!scope && <TipRow>{tx('{n} pieces', { n: l.count })}</TipRow>}
      {edited.n > 0 && (
        <TipNote>{tx('{n} of them changed by hand; the board’s own figure for the line was {was}', { n: edited.n, was: amt(edited.calc) })}</TipNote>
      )}
      <TipSum>{amt(l.amount)}</TipSum>
    </>
  )
}

// ---- one job, on the per-job report ----
// `fellBack` is whether this job's hat prices this kind apart and nobody set
// that rate, so the hat's flat rate stood in — read off the line the job was
// grouped into, which the server built.
export function JobFormula({ job, amt, kinds, fellBack, notCounted }) {
  const scope = job.rate_scope !== undefined ? job.rate_scope
    : job.hat === 'assignee' && ruleOf(kinds, job.kind) && job.by !== 'rate' ? 'rule' : (job.rate ? 'recorded' : null)
  const kr = ruleOf(kinds, job.kind)
  const board = job.was ?? job.amount
  return (
    <>
      {scope === 'rule' && (
        <>
          <TipLine>{kr ? kindRuleText(kr, amt) : tx('The kind’s own rule')}</TipLine>
          {job.by === 'views' && kr && <TipRow>{figure(job.views)} ÷ 1 000 × {amt(kr.per_1k)}</TipRow>}
          {job.by === 'flat' && kr?.per_1k > 0 && (
            <TipRow>{tx('{views} views — under {gate}, so the flat rate', { views: figure(job.views), gate: figure(job.gate ?? kr.gate) })}</TipRow>
          )}
          {job.by === 'uncounted' && <TipRow>{tx('flat rate — no views counted yet')}</TipRow>}
        </>
      )}
      {scope === 'kind' && <TipLine>{tx('The job’s own rate for this kind of piece')}</TipLine>}
      {scope === 'hat' && (
        <>
          <TipLine>{tx('Fixed base rate applied')}</TipLine>
          {fellBack && <TipNote>{tx('No rate is set for this kind of piece, so the job’s flat rate applies')}</TipNote>}
        </>
      )}
      {job.override && (
        <TipNote>{tx('changed by hand')} · {tx('the board says')} {amt(board)}</TipNote>
      )}
      {notCounted && <TipNote>{notCounted}</TipNote>}
      <TipSum>{amt(job.amount)}</TipSum>
    </>
  )
}

// ---- a salary, or the fixed part of a KPI card ----
export function FixedFormula({ amount, amt }) {
  return (
    <>
      <TipLine>{tx('Fixed base rate applied')}</TipLine>
      <TipNote>{tx('Paid every month, whatever the work')}</TipNote>
      <TipSum>{amt(amount)}</TipSum>
    </>
  )
}

// ---- the blanket per-thousand rate ----
export function ViewsPayFormula({ view, rates, amt }) {
  return (
    <>
      {rates && <TipLine>{tx('{rate} per 1 000 views, on kinds with no rule of their own', { rate: amt(rates.per_1k_views) })}</TipLine>}
      {rates && <TipRow>{figure(view.viewsPayOn ?? view.views ?? 0)} ÷ 1 000 × {amt(rates.per_1k_views)}</TipRow>}
      {!rates && <TipNote>{tx('As recorded when the month was closed')}</TipNote>}
      <TipSum>{amt(view.viewsPay)}</TipSum>
    </>
  )
}

// ---- the three bonuses and the one penalty ----
export function BonusFormula({ kind, view, rates, amt }) {
  const paid = kind === 'views' ? view.viewsBonus : kind === 'quota' ? view.quotaBonus : view.onTimeBonus
  return (
    <>
      {rates && kind === 'views' && (
        <>
          <TipLine>{tx('{bonus} once the month reaches {target} views', { bonus: amt(rates.views_bonus), target: figure(rates.views_target) })}</TipLine>
          <TipRow>{tx('This month: {n} views', { n: figure(view.views) })}</TipRow>
        </>
      )}
      {rates && kind === 'quota' && (
        <>
          <TipLine>{tx('{bonus} once the month reaches {quota} delivered', { bonus: amt(rates.quota_bonus), quota: figure(rates.quota) })}</TipLine>
          <TipRow>{tx('This month: {n} delivered', { n: figure(view.delivered) })}</TipRow>
        </>
      )}
      {rates && kind === 'ontime' && (
        <>
          <TipLine>{tx('{bonus} when {target}% or more is delivered on time', { bonus: amt(rates.ontime_bonus), target: rates.ontime_target })}</TipLine>
          <TipRow>{tx('This month: {pct}% on time', { pct: view.onTimePct })}</TipRow>
        </>
      )}
      {!rates && <TipNote>{tx('As recorded when the month was closed')}</TipNote>}
      <TipSum tone="pay-good">+{amt(paid)}</TipSum>
    </>
  )
}

export function LateFormula({ view, rates, amt }) {
  return (
    <>
      {rates && <TipLine>{tx('{penalty} off for every piece delivered late', { penalty: amt(rates.late_penalty) })}</TipLine>}
      {rates && <TipRow>{figure(view.late)} × {amt(rates.late_penalty)}</TipRow>}
      {!rates && <TipNote>{tx('As recorded when the month was closed')}</TipNote>}
      <TipSum tone="pay-bad">−{amt(view.penalty)}</TipSum>
    </>
  )
}

// ---- the pillow's top-up ----
// `floor` false is the one other way a top-up happens: a month whose late
// penalties ran past its earnings is paid nothing, never less than nothing.
export function PillowFormula({ floor, pillow, earned, topUp, amt }) {
  const known = earned !== null && earned !== undefined
  return (
    <>
      {floor && pillow > 0 && <TipLine>{tx('A month that earns less than {pillow} is topped up to it', { pillow: amt(pillow) })}</TipLine>}
      {!floor && <TipLine>{tx('A month is never paid less than nothing')}</TipLine>}
      {known && <TipRow>{tx('The month earned {earned}', { earned: amt(earned) })}</TipRow>}
      {known && floor && earned >= 0 && <TipRow>{amt(pillow)} − {amt(earned)}</TipRow>}
      {!known && <TipNote>{tx('As recorded when the month was closed')}</TipNote>}
      <TipSum tone="pay-good">+{amt(topUp)}</TipSum>
    </>
  )
}

// ---- a KPI card, as one line of the payslip ----
// No card is two different things. On a closed month it is the record, which
// kept none. On a month still running it is a card nobody has set yet — the
// normal state of the first weeks, since cards are set late in the month — and
// "as recorded when the month was closed" over an open month gave the 0 a
// reason that was not true.
export function KpiPayFormula({ card, total, amt, frozen = false }) {
  return (
    <>
      <TipLine>{tx('The KPI card: its fixed part and what each ladder graded')}</TipLine>
      {card && card.fixed > 0 && <TipRow>{tx('Fixed pay')}: {amt(card.fixed)}</TipRow>}
      {(card?.ladders || []).map((r) => (
        <TipRow key={r.key}>{tx(r.label)}{r.grade ? ` (${r.grade})` : ''}: {amt(r.pays)}</TipRow>
      ))}
      {!card && (frozen
        ? <TipNote>{tx('As recorded when the month was closed')}</TipNote>
        : <TipNote>{tx('No KPI card is set for this month yet')}</TipNote>)}
      <TipSum>{amt(total)}</TipSum>
    </>
  )
}

// ---- one hand-made line on the month ----
export function AdjustFormula({ a, amt }) {
  return (
    <>
      <TipLine>{a.amount < 0 ? tx('Taken off the month by hand') : tx('Added to the month by hand')}</TipLine>
      <TipNote>{tx('Added after everything else — the pillow does not swallow it')}</TipNote>
      <TipSum tone={a.amount < 0 ? 'pay-bad' : 'pay-good'}>{a.amount < 0 ? '−' : '+'}{amt(Math.abs(a.amount))}</TipSum>
    </>
  )
}

// ---- one ladder of a KPI card ----
// The band is written with symbols rather than words — "55–70", "≥ 55",
// "≤ 30" — which read the same in all three languages. Both edges are
// inclusive, as bandFor() in server/kpi.js reads them.
const bandRange = (b, unit) => {
  const lo = b.from === null || b.from === undefined || b.from === '' ? null : `${figure(b.from)}${unit}`
  const hi = b.to === null || b.to === undefined || b.to === '' ? null : `${figure(b.to)}${unit}`
  if (lo !== null && hi !== null) return `${lo}–${hi}`
  if (lo !== null) return `≥ ${lo}`
  if (hi !== null) return `≤ ${hi}`
  return tx('any reading')
}
export function LadderFormula({ l, amt }) {
  const unit = l.unit || ''
  return (
    <>
      {l.value === null || l.value === undefined
        ? <TipLine>{tx('No reading yet, so nothing is paid')}</TipLine>
        : <TipRow>{tx('This month: {value}', { value: `${figure(l.value)}${unit}` })}</TipRow>}
      {l.band && <TipRow>{l.band.grade ? `${l.band.grade}: ` : ''}{bandRange(l.band, unit)} → {amt(l.band.pays)}</TipRow>}
      {l.value !== null && l.value !== undefined && !l.band && <TipLine>{tx('Outside every band, so nothing is paid')}</TipLine>}
      {l.gated && (
        <TipNote>{tx('Pays nothing under {need} — this month it was {got}', {
          need: figure(l.gated.need), got: l.gated.got === null || l.gated.got === undefined ? tx('no reading yet') : figure(l.gated.got),
        })}</TipNote>
      )}
      {l.measured_by === 'board' && <TipNote>{tx('Measured by the board')}</TipNote>}
      {l.measured_by === 'hand' && <TipNote>{tx('Entered by hand')}</TipNote>}
      <TipSum tone={l.pays > 0 ? 'pay-good' : ''}>{l.pays > 0 ? '+' : ''}{amt(l.pays)}</TipSum>
    </>
  )
}

// ---- when the board last measured a KPI card ----
// The nightly pass writes the minute it re-measured the cards that read the
// board. Shown in Tashkent's time, in the reader's language — and not at all
// once it is more than a day and a half old in the month still running: the
// card is graded live on every load, so a stamp that old means the nightly
// pass has stopped, and a week-old time printed beside today's numbers would
// be the one thing on the card that is wrong.
const STALE_MS = 36 * 60 * 60 * 1000
export function syncedLabel(iso, month = null) {
  const at = Date.parse(iso || '')
  if (!Number.isFinite(at)) return null
  const current = !month || month === todayISO().slice(0, 7)
  if (current && Date.now() - at > STALE_MS) return null
  const day = tashkentDay(iso)
  const time = new Date(at).toLocaleTimeString(locale(), {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  return `${fixMonth(dateLabel(day), Number(day.slice(5, 7)) - 1)} ${time}`
}

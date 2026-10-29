import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Wallet, CheckCircle2, Banknote, Undo2, RotateCcw, Pencil, Gauge, Check } from 'lucide-react'
import { api } from '../../lib/api.js'
import { toast } from '../../lib/toast.js'
import { todayISO, addDaysISO, dateLabel } from '../../lib/constants.js'
import { tr as tx, locale } from '../../lib/i18n.jsx'
import Avatar from '../Avatar.jsx'
import Modal from '../Modal.jsx'
import KpiCard from '../KpiCard.jsx'
import { PayReportButton } from '../PayReport.jsx'

// Numbers → Pay (N-02): the payroll, lifted whole out of the Admin panel's
// Payroll tab. The month comes from the page's one picker (`range`), the
// person from its one person menu; everything else is as it was.
/* ==================== PAY ==================== */
/* What people are paid, worked out from what the board already knows.
 *
 * Payroll was being rebuilt by hand every month from numbers this system had
 * to the day: who shot what, who cut what, and how much of it landed on the
 * day they promised. The rates are the part no code can know — they differ per
 * person and they change — so they are edited here and stored as data. One
 * default card everybody starts from, and a card per person that overrides it.
 *
 * Nothing here invents a KPI. It multiplies counts by rates an admin typed. */
const RATE_ROWS = [
  // `roles` is who this line is about. A card opened for an editor shows the
  // editing rates and hides the nine that decide nothing for them — the sheet
  // had fourteen boxes on every card, which is how half of them stayed at
  // whatever the default was. Nothing is deleted: "Show every line" brings
  // them all back, and a rate already set is always shown.
  { key: 'base', label: 'Base', hint: 'Paid for the period whatever the count', roles: null },
  { key: 'per_shoot', label: 'Per shoot', hint: 'Each shoot handed to the editor', roles: ['operator'] },
  { key: 'per_shoot_reel', label: 'Per shoot · reel', hint: 'An afternoon', roles: ['operator'] },
  { key: 'per_shoot_youtube', label: 'Per shoot · YouTube', hint: 'A day', roles: ['operator'] },
  { key: 'per_shoot_target', label: 'Per shoot · target', hint: 'A paid creative', roles: ['operator'] },
  { key: 'per_edit', label: 'Per edit', hint: 'Each edit handed to review', roles: ['editor'] },
  { key: 'per_edit_reel', label: 'Per edit · reel', hint: 'An afternoon', roles: ['editor'] },
  { key: 'per_edit_youtube', label: 'Per edit · YouTube', hint: 'A week', roles: ['editor'] },
  { key: 'per_edit_target', label: 'Per edit · target', hint: 'A paid creative', roles: ['editor'] },
  { key: 'per_design', label: 'Per design', hint: 'Each piece they designed', roles: ['designer'] },
  { key: 'per_publish', label: 'Per piece run', hint: 'Each piece of theirs that reached Editing — a written post once it is published — where its kind has no rule of its own below', roles: ['member', 'admin', 'reviewer'] },
  { key: 'per_review', label: 'Per sign-off', hint: 'Each piece they signed off', roles: ['reviewer', 'admin'] },
  // Being in the piece. A target video is shot by one person and carried by
  // another standing in front of the camera; only one of them was ever paid.
  { key: 'per_face', label: 'Per appearance', hint: 'Each piece they are the face of', roles: ['ambassador', 'member'] },
  { key: 'per_face_reel', label: 'Per appearance · reel', hint: '', roles: ['ambassador', 'member'] },
  { key: 'per_face_youtube', label: 'Per appearance · YouTube', hint: '', roles: ['ambassador', 'member'] },
  { key: 'per_face_target', label: 'Per appearance · target', hint: 'Fronting a paid creative', roles: ['ambassador', 'member'] },
  { key: 'quota', label: 'Pieces a month', hint: 'What a full month of this job looks like. 0 means no quota', plain: true, roles: null },
  { key: 'quota_bonus', label: 'Quota bonus', hint: 'Paid whole when they reach it', roles: null },
  { key: 'ontime_bonus', label: 'On-time bonus', hint: 'Paid whole, or not at all', roles: null },
  { key: 'ontime_target', label: 'On-time target %', hint: 'The share of deliveries that earns the bonus', pct: true, roles: null },
  { key: 'late_penalty', label: 'Per late piece', hint: 'Taken off for each delivery after its promised day', roles: null },
  // What the work was WORTH. Both are 0 on a card nobody has set, so a board
  // that does not pay on views never has to think about them.
  { key: 'per_1k_views', label: 'Per 1,000 views', hint: 'On kinds with no rule of their own below — the rest are paid by their own rule', roles: ['member', 'admin'] },
  { key: 'views_target', label: 'Views a month', hint: 'What a full month of watching looks like. 0 means no target', plain: true, roles: ['member', 'admin'] },
  { key: 'views_bonus', label: 'Views bonus', hint: 'Paid whole when their month reaches that many views', roles: ['member', 'admin'] },
]
// The kinds of piece that can be priced apart, and what each rule is made of.
// The roles a card can belong to, in the words the team uses for them.
const ROLE_WORD = {
  operator: 'Operator', editor: 'Editor', designer: 'Designer', reviewer: 'Reviewer',
  ambassador: 'Ambassador', member: 'Team member', admin: 'Admin', crew: 'Crew',
}
const KIND_ROWS = [
  { key: 'post', label: 'Posts' },
  { key: 'reel', label: 'Reels' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'target', label: 'Targets' },
]
const BLANK_CARD = {
  currency: 'UZS', base: 0, per_shoot: 0, per_edit: 0, per_design: 0, per_publish: 0, per_review: 0,
  quota: 0, quota_bonus: 0, ontime_bonus: 0, ontime_target: 90, late_penalty: 0,
  per_1k_views: 0, views_target: 0, views_bonus: 0, pillow: 0, scheme: 'piece',
  per_shoot_reel: 0, per_edit_reel: 0, per_shoot_youtube: 0, per_edit_youtube: 0,
  per_shoot_target: 0, per_edit_target: 0,
  per_face: 0, per_face_reel: 0, per_face_youtube: 0, per_face_target: 0,
  kind_rules: {},
}

// Which of the rate rows an arrangement actually pays on. A card set to a
// fixed salary has eleven piece rates on it that decide nothing, and leaving
// them on screen is the form inviting somebody to set a number that will never
// be paid. They are not deleted — switching back brings them straight back.
const SCHEME_SHOWS = {
  piece: { rates: true, pillow: false },
  fixed: { rates: false, pillow: false },
  kpi: { rates: false, pillow: false },
  fixed_kpi: { rates: false, pillow: false },
  pillow: { rates: true, pillow: true },
  pillow_kpi: { rates: false, pillow: true },
}

/* ---- working a card out from one number ----
 *
 * Typing eleven rates from scratch, per person, is how a pay scheme never
 * gets set up at all. Almost nobody thinks in rates; everybody thinks in "an
 * editor's month is worth about four million". So that is the question asked,
 * plus roughly how many pieces a full month is, and the shape is applied:
 *
 *   60%  base            paid for turning up and being available
 *   25%  piecework       spread over the quota, so a full month lands on the
 *                        full package and every piece past it pays on top
 *   10%  quota bonus     for doing the whole job
 *    5%  on-time bonus   for doing it when promised
 *   late costs half a piece, so slipping is felt but does not wipe out the day
 *
 * These are a starting shape, not a rule. Every line stays editable, and
 * nothing is saved until Save is pressed — the numbers just appear in the
 * boxes where they can be argued with.
 */
const SHAPE = { base: 0.60, piece: 0.25, quota: 0.10, ontime: 0.05 }
const JOBS = [
  { key: 'editor', label: tx('Editor'), rate: 'per_edit', monthly: 4000000, quota: 20 },
  { key: 'operator', label: tx('Operator'), rate: 'per_shoot', monthly: 4000000, quota: 20 },
  { key: 'designer', label: tx('Designer'), rate: 'per_design', monthly: 3500000, quota: 25 },
  { key: 'planner', label: 'Runs the channel', rate: 'per_publish', monthly: 5000000, quota: 30 },
]
// Round to something a person would actually write down.
const tidy = (n, step = 10000) => Math.max(0, Math.round(n / step) * step)
function workOutCard(job, monthly, quota, currency) {
  const q = Math.max(1, Math.round(Number(quota) || 1))
  const m = Math.max(0, Number(monthly) || 0)
  const perPiece = tidy((m * SHAPE.piece) / q, 5000)
  return {
    ...BLANK_CARD,
    currency,
    base: tidy(m * SHAPE.base),
    [job.rate]: perPiece,
    quota: q,
    quota_bonus: tidy(m * SHAPE.quota),
    ontime_bonus: tidy(m * SHAPE.ontime),
    ontime_target: 90,
    late_penalty: tidy(perPiece / 2, 5000),
  }
}

// Money reads as money: grouped thousands, no decimals for whole sums. UZS
// runs to millions, so an ungrouped 2200000 is unreadable at a glance.
export const money = (n, cur) => `${Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')} ${cur || ''}`.trim()

export default function Pay({ range, person = '' }) {
  const [data, setData] = useState(null)
  const [rules, setRules] = useState([])
  const [card, setCard] = useState(null) // { userId | 'default', name, form }
  const [kpiFor, setKpiFor] = useState(null) // { id, name } — whose month is open
  const [plan, setPlan] = useState(null) // null | { job, monthly, quota } — the calculator
  // The arrangements there are, served rather than copied: the card that
  // OFFERS one and the run that PAYS on it have to agree about what it does.
  const [schemes, setSchemes] = useState({})
  const [closing, setClosing] = useState(null) // { month, paid_at, note } — the month being recorded as paid
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Every line, including the ones this role is never paid on.
  const [showAll, setShowAll] = useState(false)
  // The roles this team actually has, so the sheet offers a card per role.
  const [payRoles, setPayRoles] = useState([])


  const load = () => {
    api.get(`/reports/pay?from=${range.from}&to=${range.to}`).then(setData).catch(() => setData(null))
    api.get('/reports/pay/rules').then(setRules).catch(() => setRules([]))
  }
  useEffect(() => { api.get('/reports/pay/schemes').then((d) => { setSchemes(d?.schemes || {}); setPayRoles(d?.roles || []) }).catch(() => {}) }, [])
  // Which parts of the card the chosen arrangement actually pays on.
  const shows = SCHEME_SHOWS[card?.form?.scheme || 'piece'] || SCHEME_SHOWS.piece
  useEffect(() => { load() }, [range.from, range.to]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a card starts from whatever this person is being paid on now:
  // their own card, else their role's, else the board default. Copying the
  // role card into the form is deliberate — the admin sees the numbers that
  // are actually in force rather than a blank sheet that would quietly
  // overwrite them with zeroes on Save.
  const openCard = (userId, name, payRole = null) => {
    const isDefault = userId === 'default'
    const isRole = String(userId).startsWith('role:')
    const roleKey = isRole ? String(userId).slice(5) : payRole
    const row = rules.find((r) => (isDefault ? (!r.user_id && !r.role)
      : isRole ? (!r.user_id && r.role === roleKey)
        : r.user_id === userId))
    const roleRow = !isDefault && !isRole && roleKey ? rules.find((r) => !r.user_id && r.role === roleKey) : null
    const fallback = isDefault ? BLANK_CARD : (roleRow || rules.find((r) => !r.user_id && !r.role) || BLANK_CARD)
    setErr('')
    setPlan(null)
    setShowAll(false)
    setCard({
      userId, name, own: !!row, role: roleKey || null,
      from: row ? 'own' : roleRow ? 'role' : 'default',
      form: { ...BLANK_CARD, ...(row || fallback), kind_rules: { ...((row || fallback).kind_rules || {}) } },
    })
  }
  const saveCard = async () => {
    if (!card) return
    setBusy(true); setErr('')
    try {
      await api.put(`/reports/pay/rules/${card.userId}`, card.form)
      setCard(null)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const dropCard = async () => {
    if (!card || card.userId === 'default') return
    if (!confirm(tx('Put {name} back on the card their role is paid on?', { name: card.name }))) return
    setBusy(true)
    try { await api.del(`/reports/pay/rules/${card.userId}`); setCard(null); load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const total = (data?.people || []).reduce((a, p) => a + p.total, 0)
  const cur = data?.currency || 'UZS'
  // The month the range sits in, and whether it has already been closed.
  // Everything above this line is a CALCULATOR; closing a month is the only
  // thing on the page that writes down what actually went out.
  const month = data?.month || range.to.slice(0, 7)
  const settled = (data?.people || []).filter((p) => p.payout)
  // Who "Record as paid" will actually write down, by the server's own rule: somebody
  // with no record yet who is a payment at all. A person already recorded keeps
  // the payslip they were paid against.
  const toRecord = (data?.people || []).filter((p) => !p.payout && p.source !== 'none' && (p.total !== 0 || p.delivered > 0))
  // The month is closed when nobody is LEFT to record — not when every row has
  // a record. The list also holds people who are never a payment (on a card,
  // nothing delivered, nothing owed); counting them kept the head at "4 of 9"
  // and the button on offer for a month that was finished.
  const allSettled = settled.length > 0 && toRecord.length === 0
  const monthOver = month < todayISO().slice(0, 7)
  // A payment is recorded against a MONTH — that is what the row is keyed on,
  // and what somebody is asked "was I paid for August?" about. Both presets
  // are whole months, so the button is there where it belongs; a hand-typed
  // range that is not one would put the range's total in front of somebody
  // and write the month's down, which is two different numbers and only one
  // of them on screen.
  const monthEnd = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10)
  const wholeMonth = range.from === `${month}-01`
    && (range.to === monthEnd || range.to === todayISO())

  // "2026-09" is a filename, not a month. Anything a person reads says
  // September.
  const monthWords = (m) => new Date(`${m}-01T00:00:00Z`)
    .toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const closeMonth = async () => {
    if (!closing) return
    setBusy(true); setErr('')
    try {
      const out = await api.post('/reports/pay/payouts', {
        month: closing.month, paid_at: closing.paid_at, note: closing.note,
      })
      setClosing(null)
      toast(tx('{n} people recorded as paid for {month}', { n: out.recorded, month: closing.month }))
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const reopenMonth = async () => {
    if (!confirm(tx('Re-open {month}? The recorded figures are deleted and the month goes back to being worked out live.', { month: monthWords(month) }))) return
    setBusy(true)
    try { await api.del(`/reports/pay/payouts/${month}/all`); toast(tx('{month} re-opened', { month: monthWords(month) })); load() }
    // Said where it can be read: `err` is drawn only inside the two dialogs,
    // and neither is open here, so a refused re-open used to say nothing.
    catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="section-head">
        <h2>{tx('Pay')}</h2>
        <span className="count">{tx('· worked out from what was delivered')}</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => openCard('default', 'everybody')}>
          <Wallet size={14} /> {tx('Default rates')}
        </button>
      </div>

      {/* ---- a card per role ----
          The sheet was thirty-five copies of the same numbers, which is how
          half of them ended up out of date. Set the editor card once and every
          editor is paid on it; anybody who negotiated their own terms gets a
          card of their own, and their row says so. */}
      {payRoles.length > 0 && (
        <div className="pay-roles">
          <span className="stat-sub">{tx('Cards by role — everybody on that role is paid this unless they have one of their own')}</span>
          <div className="pill-group">
            {payRoles.map((r) => {
              const set = rules.some((x) => !x.user_id && x.role === r)
              return (
                <button key={r} className={'pill' + (set ? ' active' : '')}
                  onClick={() => openCard(`role:${r}`, tx(ROLE_WORD[r] || r))}>
                  {tx(ROLE_WORD[r] || r)}{set ? '' : ` · ${tx('not set')}`}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!data ? <div className="app-loading"><span className="spinner" /></div> : (
        <>
          {!data.hasDefault && (
            <div className="card card-pad pay-empty">
              <b>{tx('No rates set yet.')}</b>
              <span className="stat-sub">
                {tx('Nothing here is guessed. Set the default card — a base, and what a shoot, an edit and a design are each worth — and every person is worked out from it. Anybody paid differently gets a card of their own on their row.')}
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => openCard('default', 'everybody')}>{tx('Set the default rates')}</button>
            </div>
          )}

          {/* "0 UZS" in 40px type is a statement about the team. On a board
              where nobody has set a rate it is a statement about the setup,
              and the card above already makes it — so the total waits until
              there is one. */}
          {data.hasDefault && (
            <div className={'card card-pad rp-head' + (allSettled ? ' rp-head-settled' : '')}>
              <div className="rp-big">
                <b>{money(allSettled ? data.settledTotal : total, cur)}</b>
                <span className="rp-big-label">
                  {allSettled ? tx('paid for {month}', { month: monthWords(month) }) : tx('the whole payroll for the period')}
                  <br /><span className="stat-sub">{range.from} → {range.to}</span>
                </span>
              </div>
              {/* Closing a month is the one thing on this page that writes
                  down what actually went out. Everything else re-derives
                  itself for ever, which is why editing an old task used to
                  quietly rewrite a payslip somebody had already been paid
                  against. */}
              <div className="rp-close">
                {settled.length > 0 && (
                  <span className="rp-closed-note">
                    <CheckCircle2 size={14} />
                    {allSettled
                      ? tx('Recorded as paid')
                      : tx('{n} of {total} recorded as paid', { n: settled.length, total: data.people.length })}
                  </span>
                )}
                {!allSettled && wholeMonth && (
                  <button className="btn btn-sm btn-primary" disabled={busy || data.people.length === 0}
                    onClick={() => setClosing({ month, paid_at: todayISO(), note: '' })}>
                    <Banknote size={14} /> {tx('Record as paid')}
                  </button>
                )}
                {!allSettled && !wholeMonth && (
                  <span className="stat-sub rp-closed-note rp-note-plain">
                    {tx('Pick a whole month to record a payment — a payment is recorded against a month.')}
                  </span>
                )}
                {settled.length > 0 && (
                  <button className="btn btn-sm" onClick={reopenMonth} disabled={busy}>
                    <Undo2 size={14} /> {tx('Re-open')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* One row per person, not ten columns.
              It WAS a table: Member, Delivered, On time, Views, Base,
              Piecework, Bonus, Late, Pay, and two buttons — every cell with
              two or three sub-lines under it. Ten columns is past what
              anybody reads across, which is why it needed a legend card above
              it explaining that the last column was the other four added up.
              A table that needs a key is a table nobody can read.

              So the sum is drawn instead of explained: the bar under each
              name IS base + piecework + bonus, in proportion, and the terms
              are written under it in the same colours. Nothing to cross-
              reference, and the legend card is gone with the columns. */}
          <div className="pay-rows">
            {data.people.filter((p) => !person || String(p.id) === String(person)).map((p) => {
              const noRates = p.source === 'none'
              // What the total is made of, as worked out by whatever decided
              // it. The old list was base + piecework + bonus, which is one
              // arrangement out of six: on a pillow card it drew a bar that
              // did not add up to the number beside it, and on a KPI card it
              // drew nothing at all.
              const parts = (p.parts || []).filter((x) => x.amount > 0)
              return (
                <div className={'pay-row' + (noRates ? ' pay-row-unset' : '') + (p.payout ? ' pay-row-paid' : '')} key={p.id}>
                  <div className="pay-row-who">
                    <Avatar name={p.name} color={p.color} src={p.avatar} size="sm" />
                    <div>
                      <b>{p.name}</b>
                      <span className="stat-sub">
                        {p.source === 'own' ? tx('own rates')
                          : p.source === 'role' ? tx('on the {role} card', { role: tx(ROLE_WORD[p.from_role] || p.from_role || '') })
                            : p.source === 'default' ? tx('default rates') : tx('no rates set')}
                        {/* Which arrangement they are on. Two people with the
                            same figure beside their name can have got there
                            two completely different ways, and the payroll was
                            not saying which. */}
                        {!noRates && p.schemeLabel && p.scheme !== 'piece' && <> · {tx(p.schemeLabel)}</>}
                      </span>
                    </div>
                  </div>

                  <div className="pay-row-sum">
                    {/* A person nobody has set up shows what is true — that
                        nobody has set them up. "0 UZS" in the same type as
                        everybody else's pay reads as a statement about them. */}
                    {noRates
                      ? <button className="btn btn-sm" onClick={() => openCard(p.id, p.name)}>{tx('Set their rates')}</button>
                      : <>
                          <b>{money(p.payout ? p.payout.total : p.total, p.currency)}</b>
                          {wholeMonth && !p.payout && (p.goals || []).some((g) => g.state === 'behind') && (
                            <span className="pay-slip-tag"
                              data-tip={tx('At this pace the month ends short of a bonus they could still reach')}>
                              <AlertCircle size={12} /> {tx('slipping')}
                            </span>
                          )}
                          {p.payout && (
                            <span className="pay-paid-tag" data-tip={p.payout.paid_at ? tx('Paid {day}', { day: dateLabel(p.payout.paid_at) }) : undefined}>
                              <CheckCircle2 size={12} /> {tx('paid')}
                            </span>
                          )}
                          {parts.length > 0 && (
                            <>
                              <span className="pay-bar">
                                {parts.map((x) => <span key={x.key} className={`pay-bar-${x.key}`} style={{ flexGrow: x.amount }} />)}
                              </span>
                              <span className="pay-parts">
                                {parts.map((x) => (
                                  <span key={x.key} className={`pay-part pay-part-${x.key}`}>
                                    <i />{tx(x.label)} {money(x.amount, '')}
                                  </span>
                                ))}
                                {p.penalty > 0 && (
                                  <span className="pay-part pay-part-late">
                                    <i />{tx('Late')} −{money(p.penalty, '')}
                                  </span>
                                )}
                              </span>
                            </>
                          )}
                        </>}
                  </div>

                  {/* The counts that earned it. Nothing that is zero and
                      nothing nobody set a target for is printed: a board that
                      pays nothing on views should never mention views. */}
                  <div className="pay-row-facts">
                    <span>
                      <b>{p.delivered}</b>{p.quota > 0 ? ` / ${p.quota}` : ''} {tx('delivered')}
                      {p.quota > 0 && !p.quotaMet && <em> · {tx('{n} to go', { n: p.quotaLeft })}</em>}
                    </span>
                    {p.onTimePct !== null && (
                      <span className={p.onTimePct >= (p.rates?.ontime_target || 0) ? 'pay-good' : 'pay-bad'}>
                        <b>{p.onTimePct}%</b> {tx('on time')}
                      </span>
                    )}
                    {(p.views > 0 || p.viewsTarget > 0) && (
                      <span className={p.viewsTarget > 0 && p.viewsMet ? 'pay-good' : undefined}>
                        <b>{money(p.views || 0, '')}</b>
                        {p.viewsTarget > 0 ? ` / ${money(p.viewsTarget, '')}` : ''} {tx('views')}
                        {p.viewsCounted > 0 && p.viewsCounted < p.delivered && (
                          <em> · {tx('{counted} of {delivered} counted', { counted: p.viewsCounted, delivered: p.delivered })}</em>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Two different things get paid here and they are set
                      apart: the RATES are what a piece is worth and change
                      rarely; the KPI card is this month's grades and is
                      rewritten in the last five days of every month.
                      Named in words rather than left to two tooltips that
                      opened on top of each other. */}
                  <div className="pay-row-do">
                    <PayReportButton userId={p.id} name={p.name} label={tx('Every job')} />
                    <button className="btn btn-sm" onClick={() => setKpiFor({ id: p.id, name: p.name })}>
                      <Gauge size={14} /> {tx('KPI')}
                    </button>
                    <button className="btn btn-sm" onClick={() => openCard(p.id, p.name, p.pay_role)}
                      data-tip={p.source === 'own' ? tx('A card of their own')
                        : p.source === 'role' ? tx('Paid on the {role} card', { role: tx(ROLE_WORD[p.from_role] || p.from_role || '') })
                          : tx('Paid on the default card')}>
                      <Pencil size={14} /> {tx('Rates')}
                      {p.source !== 'own' && <span className="pay-from">{p.source === 'role' ? tx(ROLE_WORD[p.from_role] || p.from_role || '') : tx('default')}</span>}
                    </button>
                  </div>
                </div>
              )
            })}
            {data.people.length === 0 && <div className="card card-pad empty">{tx('No deliveries')}</div>}
          </div>
          {kpiFor && (
            <KpiCard userId={kpiFor.id} name={kpiFor.name} month={range.to.slice(0, 7)}
              onClose={(saved) => { setKpiFor(null); if (saved) load() }} />
          )}
        </>
      )}

      {/* Recording a month as paid. Deliberately a confirmation rather than a
          single press: it freezes figures somebody is going to be paid
          against, and the day it says the money went out is the day that will
          be on the record for ever. */}
      {closing && (
        <Modal
          title={tx('Record {month} as paid', { month: monthWords(closing.month) })}
          onClose={() => setClosing(null)}
          footer={<>
            <span className="foot-gap" />
            <button className="btn" onClick={() => setClosing(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={closeMonth} disabled={busy}>
              <Banknote size={14} /> {tx('Record as paid')}
            </button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="cm-hint" style={{ marginBottom: 12 }}>
            {tx('{n} people, {amount} in total. The figures are written down as they stand now and stop being re-worked-out — so editing an old task later cannot change a payslip somebody has already been paid against. Re-opening the month undoes it.', {
              n: toRecord.length, amount: money(toRecord.reduce((a, p) => a + p.total, 0), cur),
            })}
          </div>
          <label className="field">
            <span className="label">{tx('The day the money went out')}</span>
            <input className="input" type="date" style={{ maxWidth: 200 }} value={closing.paid_at}
              onChange={(e) => setClosing({ ...closing, paid_at: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">{tx('Note')} <span className="stat-sub">{tx('optional')}</span></span>
            <input className="input" value={closing.note} placeholder={tx('e.g. paid by transfer, 2 people in cash')}
              onChange={(e) => setClosing({ ...closing, note: e.target.value })} />
          </label>
          {!monthOver && (
            <div className="cm-hint">
              <AlertCircle size={13} style={{ verticalAlign: -2 }} />{' '}
              {tx('{month} has not finished yet — anything delivered after today will not be in these figures.', { month: monthWords(closing.month) })}
            </div>
          )}
        </Modal>
      )}

      {card && (
        <Modal
          title={card.userId === 'default' ? 'Default rates' : `${card.name}'s rates`}
          onClose={() => setCard(null)}
          footer={<>
            {card.userId !== 'default' && card.own && (
              <button className="btn" onClick={dropCard} disabled={busy}><RotateCcw size={14} /> {tx('Use the default')}</button>
            )}
            <span className="foot-gap" />
            <button className="btn" onClick={() => setCard(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={saveCard} disabled={busy}>{tx('Save rates')}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          {/* Three layers, and the card says which one it is looking at: a
              personal card beats a role card, and a role card beats the
              default. Somebody editing a card that is not the person's own is
              about to create one, and should know it before they save. */}
          <div className="cm-hint" style={{ marginBottom: 12 }}>
            {card.userId === 'default'
              ? tx('What everybody is paid on unless their role has a card, or they have one of their own. Leave a line at zero and it simply does not count.')
              : String(card.userId).startsWith('role:')
                ? tx('Every {role} is paid on this unless they have a card of their own.', { role: card.name })
                : card.own
                  ? tx('{name} is paid on these rates rather than on their role’s card.', { name: card.name })
                  : card.from === 'role'
                    ? tx('{name} is paid on the {role} card. Change anything here and they get a card of their own, which stops following it.', { name: card.name, role: tx(ROLE_WORD[card.role] || card.role || '') })
                    : tx('{name} is on the default rates. Change anything here and they get a card of their own.', { name: card.name })}
          </div>
          <div className="field"><label>{tx('Currency')}</label>
            <input className="input" style={{ maxWidth: 120 }} value={card.form.currency || ''}
              onChange={(e) => setCard({ ...card, form: { ...card.form, currency: e.target.value } })} />
          </div>

          {/* HOW this person is paid, before a single rate. It decides which
              of the rows below are paid on at all, so asking it after them
              would be eleven questions in front of the one that says whether
              they matter. */}
          <div className="field"><label>{tx('How they are paid')}</label>
            <select className="select" value={card.form.scheme || 'piece'}
              onChange={(e) => setCard({ ...card, form: { ...card.form, scheme: e.target.value } })}>
              {Object.entries(schemes).map(([k, v]) => (
                <option key={k} value={k}>{tx(v.label)}</option>
              ))}
            </select>
            <div className="cm-hint">{tx(schemes[card.form.scheme || 'piece']?.hint || '')}</div>
          </div>

          {/* The safety pillow. Drawn only where one stands, and it says what
              it does in the two directions people actually ask about. */}
          {shows.pillow && (
            <div className="field"><label>{tx('Safety pillow')}</label>
              <input className="input" type="number" min="0" step="100000" style={{ maxWidth: 220 }}
                value={card.form.pillow ?? 0}
                onChange={(e) => setCard({ ...card, form: { ...card.form, pillow: e.target.value } })} />
              <div className="cm-hint">
                {Number(card.form.pillow) > 0
                  ? tx('A month that comes to less than {amount} is topped up to it — a month the company could not fill is still paid in full. A month that runs past it is paid for what was actually done; the pillow is a floor, never a bonus on top.', { amount: money(Number(card.form.pillow), card.form.currency || 'UZS') })
                  : tx('Nothing guaranteed. Set an amount and the month can never come to less than it.')}
              </div>
            </div>
          )}

          {/* Eleven rates typed from scratch, per person, is how a pay scheme
              never gets set up at all. Nobody thinks in rates; everybody
              thinks in "an editor's month is worth about four million". */}
          {!shows.rates ? null : !plan ? (
            <button type="button" className="btn btn-sm" style={{ marginBottom: 14 }}
              onClick={() => setPlan({ job: JOBS[0].key, monthly: JOBS[0].monthly, quota: JOBS[0].quota })}>
              <Wallet size={14} /> Work it out from a monthly figure
            </button>
          ) : (
            <div className="card card-pad pay-plan">
              <div className="cm-hint">
                Say what a full month of this job is worth and roughly how many pieces that is.
                It splits into {Math.round(SHAPE.base * 100)}% base, {Math.round(SHAPE.piece * 100)}% paid per piece,
                {' '}{Math.round(SHAPE.quota * 100)}% for reaching the quota and {Math.round(SHAPE.ontime * 100)}% for
                being on time — a starting shape, not a rule. Nothing is saved until you press Save, and every
                line below stays yours to argue with.
              </div>
              <div className="pay-plan-row">
                <label>
                  <span>{tx('Job')}</span>
                  <select className="select" value={plan.job}
                    onChange={(e) => {
                      const j = JOBS.find((x) => x.key === e.target.value)
                      setPlan({ job: j.key, monthly: j.monthly, quota: j.quota })
                    }}>
                    {JOBS.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>{tx('A full month is worth')}</span>
                  <input className="input" type="number" min="0" step="100000" value={plan.monthly}
                    onChange={(e) => setPlan({ ...plan, monthly: e.target.value })} />
                </label>
                <label>
                  <span>{tx('…and is about')}</span>
                  <input className="input" type="number" min="1" step="1" value={plan.quota}
                    onChange={(e) => setPlan({ ...plan, quota: e.target.value })} />
                </label>
              </div>
              <div className="pay-plan-do">
                <button type="button" className="btn btn-sm" onClick={() => setPlan(null)}>{tx('Never mind')}</button>
                <button type="button" className="btn btn-sm btn-primary"
                  onClick={() => {
                    const j = JOBS.find((x) => x.key === plan.job)
                    setCard({ ...card, form: workOutCard(j, plan.monthly, plan.quota, card.form.currency || 'UZS') })
                    setPlan(null)
                  }}>
                  <Check size={14} /> Fill the rates in
                </button>
              </div>
            </div>
          )}
          {/* ---- what a piece is worth, by what kind of piece it is ----
              The maker's side of the card. Over the view target the thousands
              are the WHOLE payment for that piece; under it, the flat rate and
              nothing else. A kind left blank is paid exactly as it was before
              any of this existed. */}
          {shows.rates && (
            <div className="pay-kinds">
              <div className="pay-kinds-head">
                <b>{tx('What a piece is worth, by what it is')}</b>
                <span className="stat-sub">
                  {tx('Past the view target a piece is paid by the thousand instead of the flat rate — not as well as it. Leave a kind empty and it is paid by the rates above.')}
                </span>
              </div>
              <table className="tbl pay-kinds-tbl">
                <thead><tr>
                  <th>{tx('Kind')}</th><th>{tx('Flat')}</th><th>{tx('View target')}</th><th>{tx('Per 1,000 past it')}</th>
                </tr></thead>
                <tbody>
                  {KIND_ROWS.map((k) => {
                    const rule = card.form.kind_rules?.[k.key] || {}
                    const setRule = (field, value) => setCard({
                      ...card,
                      form: {
                        ...card.form,
                        kind_rules: { ...(card.form.kind_rules || {}), [k.key]: { ...rule, [field]: value } },
                      },
                    })
                    return (
                      <tr key={k.key}>
                        <td><b>{tx(k.label)}</b></td>
                        {['flat', 'gate', 'per_1k'].map((f) => (
                          <td key={f}>
                            <input className="input" type="number" min="0" step={f === 'gate' ? 1000 : 1000}
                              value={rule[f] ?? ''} placeholder="0"
                              onChange={(e) => setRule(f, e.target.value)} />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* The rates, with the lines this role is never paid on folded out of
              the way — and a switch that brings every one of them back. */}
          {shows.rates && (
            <>
              <div className="pay-rows-head">
                <b>{tx('The rates')}</b>
                <label className="pay-showall">
                  <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                  {tx('Show every line')}
                </label>
              </div>
              {RATE_ROWS
                .filter((r) => showAll || !r.roles || !card.role || r.roles.includes(card.role)
                  || Number(card.form[r.key]) > 0)
                .map((r) => (
                  <div className="field" key={r.key}>
                    <label>{tx(r.label)} {r.hint ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— {tx(r.hint)}</span> : null}</label>
                    <input className="input" type="number" min="0" style={{ maxWidth: 220 }}
                      step={r.pct || r.plain ? 1 : 1000} max={r.pct ? 100 : undefined}
                      value={card.form[r.key] ?? 0}
                      onChange={(e) => setCard({ ...card, form: { ...card.form, [r.key]: e.target.value } })} />
                  </div>
                ))}
            </>
          )}
        </Modal>
      )}
    </>
  )
}

import { useEffect, useState } from 'react'
import { Wallet, ChevronDown, Eye, EyeOff, CheckCircle2, Shield } from 'lucide-react'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/constants.js'
import { useAuth } from '../lib/auth.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import SalaryPlanner, { money } from './SalaryPlanner.jsx'
import PayGoals, { PayGoalLine } from './PayGoals.jsx'
import PayHistory from './PayHistory.jsx'
import { PayReportButton, ADJ_LABEL, lineLabel } from './PayReport.jsx'
import { Dot } from './Dot.jsx'
import FormulaTip, { keepFigures } from './FormulaTip.jsx'
import PillowTrack from './PillowTrack.jsx'
import {
  figure, countedBy, editedOn, kindRuleText, syncedLabel,
  PieceFormula, FixedFormula, ViewsPayFormula, BonusFormula, LateFormula,
  PillowFormula, KpiPayFormula, AdjustFormula, LadderFormula,
} from './PayFormulas.jsx'

// What this month is worth to the person looking at it — and, under it, what
// the month they WANT would take.
//
// The amount is hidden until they ask for it, the way a banking app hides a
// balance: My Day is open on desks and phones in a shared office, and pay is
// the one number on it that is nobody else's business. The choice is
// remembered per person; the counts beside it (delivered, on time, views)
// are not money and stay in view.
//
// It shows nothing at all until an admin has set rates. A card reading
// "0 UZS" is worse than no card: it looks like a statement about the person
// rather than about the setup.
//
// Every line on it opens into how it was worked out (FormulaTip), and the
// lines add up to the total under them: the hand-made lines on the month are
// listed, a job somebody changed by hand says so, and what the person's
// arrangement did not count is not printed as money it paid.

const SHOWN_KEY = (uid) => `satashkent_pay_shown_${uid}`

// What a closed month's record has only carried since the freeze learnt to
// keep it. A month closed before then has none of these, and must not borrow
// today's: today's arrangement, pillow and KPI card explaining a figure that
// was settled without them is the very mix of live and frozen the freeze
// exists to prevent. The server blanks the same fields on the per-job report.
const KEPT_SINCE = {
  pillowProgress: null, scheme: null, schemeRule: null, schemeLabel: null,
  earned: null, pillow: null, pillowTopUp: null, kpi: null, kpiPart: null,
  parts: null, adjustments: [], viewsByKind: [], viewsPayOn: undefined,
}

// `startOpen` is for the Payment page, where the breakdown IS the page and
// folding it away would leave a card with one number on it.
export default function MyPay({ startOpen = false }) {
  const { user } = useAuth()
  const [pay, setPay] = useState(null)
  const [open, setOpen] = useState(startOpen)
  const [shown, setShown] = useState(() => { try { return localStorage.getItem(SHOWN_KEY(user?.id)) === '1' } catch { return false } })
  const toggle = (e) => {
    e.stopPropagation()
    setShown((v) => { try { localStorage.setItem(SHOWN_KEY(user?.id), v ? '' : '1') } catch { /* ok */ } return !v })
  }

  const [kpi, setKpi] = useState(null)
  useEffect(() => {
    const t = todayISO()
    const from = t.slice(0, 8) + '01'
    api.get(`/reports/pay/mine?from=${from}&to=${t}`).then(setPay).catch(() => setPay(null))
    // The month's KPI card, if an admin has set one. Nothing is shown when
    // there is none: an empty ladder is a statement about the setup rather
    // than about the person.
    api.get('/reports/kpi/mine').then((d) => setKpi(d?.card || null)).catch(() => setKpi(null))
  }, [])

  // A KPI card stands on its own. Somebody paid a fixed salary against a set
  // of grades has no piece rates at all, and bailing out on the rate card left
  // them looking at a page with nothing on it about their own month.
  const hasRates = !!pay && pay.source !== 'none'
  // Under some arrangements the KPI card IS the month and the server has
  // already put it in the total; adding it again here would pay it twice on
  // screen. `kpiCounted` says which.
  const kpiInTotal = !!pay?.kpiCounted
  const hasKpi = !!kpi && (kpi.ladders.length > 0 || kpi.fixed > 0)
  if (!hasRates && !hasKpi) return null
  const cur = (hasRates ? pay.currency : kpi?.currency) || 'UZS'
  // One figure, never broken across two lines of a narrow card.
  const amt = (n) => (shown ? keepFigures(money(n, cur)) : '••••••')

  // A month somebody has been paid for is not an estimate any more, and the
  // card should stop calling it one. "Expected" over a figure that has already
  // reached a bank account is the kind of small wrongness that makes people
  // stop believing the rest of the page.
  const settled = hasRates ? pay.payout : null
  // …and neither is anything under it. The first cut put the frozen total
  // above a breakdown the calculator re-derived on every load: a number that
  // cannot move, itemised by numbers that can. They agree the day the month
  // closes, and stop agreeing the first time somebody edits an old task. So a
  // settled month is READ from the record, whole — lines, rates, counts and
  // the pieces it was paid for.
  const frozen = settled?.breakdown && Object.keys(settled.breakdown).length ? settled.breakdown : null
  const view = frozen
    ? { ...pay, ...KEPT_SINCE, ...frozen, total: settled.total, rates: frozen.rates || pay.rates,
        lines: frozen.lines || [], items: frozen.items || [],
        quotaLeft: null, viewsLeft: null,
        quotaMet: (frozen.quotaBonus || 0) > 0, viewsMet: (frozen.viewsBonus || 0) > 0 }
    : pay
  // The constants a formula quotes: today's card for a month still running,
  // the card frozen with it for a closed one — and none at all for a closed
  // month whose record kept no card, rather than today's standing in for it.
  const R = hasRates ? (frozen ? frozen.rates || null : pay.rates) : null
  const earning = hasRates ? (view.lines || []).filter((l) => l.count > 0) : []
  // Views are counted on the pieces this person RAN, so that is what "counted
  // so far" is out of — not every job on the month (a cut has no views box).
  const ran = hasRates ? (view.items || []).filter((i) => i.hat === 'assignee').length : 0

  // WHAT THE ARRANGEMENT COUNTED. Under a fixed salary or a KPI card the
  // pieces, their bonuses and their penalty are worked out all the same — the
  // payroll shows them — but none of it is in the total, and this card used
  // to list them as though they had been paid. Now it lists what was paid,
  // and says in one line that the rest was not.
  const rule = hasRates ? countedBy(view) : null
  const piecePaid = !!rule && rule.earns === 'piece'
  const basePaid = !!rule && rule.earns !== 'kpi' && view.base > 0
  const kpiPaid = !!rule && !!rule.kpi
  const kpiMoney = view?.kpiPart ?? view?.kpi?.total ?? 0
  const topUp = !hasRates ? 0 : Number.isFinite(view.pillowTopUp) ? view.pillowTopUp
    : ((view.parts || []).find((x) => x.key === 'pillow')?.amount || 0)
  const pp = hasRates && rule.floor ? view.pillowProgress : null
  const adjustments = hasRates ? view.adjustments || [] : []
  const synced = hasKpi && kpi.board_measured ? syncedLabel(kpi.kpi_synced_at, kpi.month) : null

  return (
    <div className={'card card-pad my-pay' + (shown ? '' : ' my-pay-hidden') + (settled ? ' my-pay-settled' : '')}>
      <button type="button" className="my-pay-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Wallet size={17} />
        <span className="my-pay-sum">
          <b>{amt(settled ? view.total : (hasRates ? pay.total : 0) + (hasKpi && !kpiInTotal ? kpi.total : 0))}</b>
          <span className="stat-sub">
            {settled
              ? <><CheckCircle2 size={12} /> {tx('paid this month')}</>
              : tx('expected this month')}
          </span>
        </span>
        <span role="button" tabIndex={0} className="icon-btn my-pay-eye" onClick={toggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e) }}
          aria-label={shown ? tx('Hide the amount') : tx('Show the amount')} data-tip={shown ? tx('Hide the amount') : tx('Show the amount')}>
          {shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </span>
        <span className="my-pay-facts">
          {hasRates && <>
          <span><b>{view.delivered}</b>{view.quota > 0 ? ` / ${view.quota}` : ''} {tx('delivered')}</span>
          {view.onTimePct !== null && (
            <span className={view.onTimePct >= (view.rates.ontime_target || 0) ? 'pay-good' : 'pay-bad'}>
              <b>{view.onTimePct}%</b> {tx('on time')}
            </span>
          )}
          {(view.views > 0 || view.viewsTarget > 0 || view.rates.per_1k_views > 0) && (
            <span className={view.viewsTarget > 0 && view.viewsMet ? 'pay-good' : undefined}>
              <b>{money(view.views || 0, '')}</b>
              {view.viewsTarget > 0 ? ` / ${money(view.viewsTarget, '')}` : ''} {tx('views')}
            </span>
          )}
          </>}
        </span>
        <ChevronDown size={16} className={'my-pay-caret' + (open ? ' open' : '')} />
        {/* Folded, this card is a number and a caret — and on My Day, where it
            is always folded, that meant the whole of what is still winnable
            was behind a press nobody makes on a Tuesday. One line comes out
            to meet them: the goal that most wants attention today. Only where
            the goals are money the arrangement pays: a bonus a fixed salary
            never counts is not something to chase. */}
        {!open && !settled && hasRates && piecePaid && (
          <PayGoalLine goals={pay.goals} period={pay.period} currency={cur} shown={shown} />
        )}
      </button>

      {open && (
        <div className="my-pay-lines">
          {!shown && <div className="stat-sub my-pay-veil">{tx('Amounts are hidden — press the eye to show them')}</div>}
          {/* What is still winnable, before the accounting of what already is.
              The lines below answer "what did I earn"; this answers "what can
              I still do about it", which is the question with a week left in
              the month. A month that has been closed and paid has nothing
              left on the table, so it says nothing. */}
          {hasRates && !settled && piecePaid && (
            <PayGoals goals={pay.goals} period={pay.period} currency={cur}
              userId={user?.id} month={(pay.period?.to || '').slice(0, 7)} shown={shown} />
          )}
          {hasRates && <>
          {basePaid && (
            <div className="my-pay-line">
              <FormulaTip label={tx('Base')}><FixedFormula amount={view.base} amt={amt} /></FormulaTip>
              <span /><b>{amt(view.base)}</b>
            </div>
          )}
          {/* One line per job per KIND of piece — posts and reels are paid by
              different rules now, and adding them together is the thing this
              round exists to stop. The key carries the kind for the same
              reason: two lines of the same hat used to collide into one.
              A line with a job somebody changed by hand stops claiming
              "count × rate": that product is no longer what it paid — and
              neither is it for a piece paid by its views, whose `rate` is the
              per-thousand figure, not what the piece came to. */}
          {piecePaid && earning.map((l) => {
            const edited = editedOn(l, view.items, view.lines)
            return (
              <div className="my-pay-line" key={`${l.hat}:${l.kind || 'flat'}`}>
                <FormulaTip label={lineLabel(l.label)}>
                  <PieceFormula l={l} amt={amt} kinds={view.viewsByKind} items={view.items} lines={view.lines} />
                </FormulaTip>
                <span className="stat-sub">
                  {edited.n > 0
                    ? `${tx('{n} pieces', { n: l.count })} · ${tx('{n} changed by hand', { n: edited.n })}`
                    : l.rate && !(l.by_views > 0) ? `${l.count} × ${amt(l.rate)}` : tx('{n} pieces', { n: l.count })}
                  {l.by_views > 0 ? ` · ${tx('{n} by views', { n: l.by_views })}` : ''}
                  {l.by_flat > 0 ? ` · ${tx('{n} at the flat rate', { n: l.by_flat })}` : ''}
                  {l.uncounted > 0 ? ` · ${tx('{n} with no views counted', { n: l.uncounted })}` : ''}
                </span>
                <b>{amt(l.amount)}</b>
              </div>
            )
          })}

          {/* Views, split by what the piece was. The old card added a post's
              views to a reel's and paid one rate over the lot. */}
          {piecePaid && (view.viewsByKind || []).filter((k) => k.views > 0 || k.rule).map((k) => (
            <div className="my-pay-line my-pay-kind" key={`v-${k.kind}`}>
              <span className="stat-sub">
                {k.rule
                  ? <FormulaTip label={tx('Views on {kind}', { kind: tx(k.label) })}>
                      <div className="ftip-line">{kindRuleText(k.rule, amt)}</div>
                    </FormulaTip>
                  : tx('Views on {kind}', { kind: tx(k.label) })}
              </span>
              <span className="stat-sub">
                {money(k.views || 0, '')}
                {k.rule?.gate > 0 ? ` · ${tx('{n} is the target per piece', { n: money(k.rule.gate, '') })}` : ''}
              </span>
              <span />
            </div>
          ))}

          {/* Under an arrangement that does not pay per piece, the pieces are
              one line of fact rather than a column of money it never paid. */}
          {!piecePaid && view.delivered > 0 && (
            <div className="my-pay-line">
              <span className="stat-sub">
                <FormulaTip label={tx('{n} delivered', { n: view.delivered })}>
                  <div className="ftip-line">{rule.hint ? tx(rule.hint) : tx('Not counted under {scheme}', { scheme: tx(view.schemeLabel || '') })}</div>
                </FormulaTip>
              </span>
              <span className="stat-sub">{tx('Not counted under {scheme}', { scheme: tx(view.schemeLabel || '') })}</span>
              <span />
            </div>
          )}

          {/* The one prompt worth making: a piece a few hundred views short of
              being paid by the thousand instead of flat. */}
          {!settled && piecePaid && (view.nearGate || []).length > 0 && (
            <div className="my-pay-near">
              <b>{tx('Close to paying by views')}</b>
              {view.nearGate.map((n) => (
                <div key={n.id} className="stat-sub">
                  {n.title} — {tx('{n} views short of {gate}', { n: money(n.to_gate, ''), gate: money(n.gate, '') })}
                </div>
              ))}
            </div>
          )}
          {/* The blanket per-thousand rate, and the views it is actually paid
              on — which is not the month's total any more: a post or a reel
              with a rule of its own is paid by that rule and its views are
              already in the line above. Printing the whole month's views
              beside this figure made it look like the rate had been applied
              to all of them and then quietly rounded down. */}
          {piecePaid && view.viewsPay > 0 && (
            <div className="my-pay-line">
              <FormulaTip label={tx('On views')}><ViewsPayFormula view={view} rates={R} amt={amt} /></FormulaTip>
              <span className="stat-sub">
                {money(view.viewsPayOn ?? view.views ?? 0, '')} × {amt(view.rates.per_1k_views)} / 1 000
                {view.viewsPayOn !== undefined && view.viewsPayOn < (view.views || 0)
                  ? ` · ${tx('the rest is paid by its own kind’s rule')}` : ''}
              </span>
              <b>{amt(view.viewsPay)}</b>
            </div>
          )}
          {piecePaid && view.viewsBonus > 0 && (
            <div className="my-pay-line">
              <FormulaTip label={tx('Views bonus')}><BonusFormula kind="views" view={view} rates={R} amt={amt} /></FormulaTip>
              <span className="stat-sub">{money(view.viewsTarget, '')} {tx('in the month')}</span>
              <b className="pay-good">+{amt(view.viewsBonus)}</b>
            </div>
          )}
          {piecePaid && view.viewsCounted > 0 && view.viewsCounted < ran && (
            <div className="my-pay-line">
              <span className="stat-sub">{tx('Counted so far')}</span>
              <span className="stat-sub">{tx('{counted} of {delivered} pieces have a number on them', { counted: view.viewsCounted, delivered: ran })}</span>
              <span />
            </div>
          )}
          {piecePaid && view.quotaBonus > 0 && (
            <div className="my-pay-line">
              <FormulaTip label={tx('Quota bonus')}><BonusFormula kind="quota" view={view} rates={R} amt={amt} /></FormulaTip>
              <span className="stat-sub">{view.quota} {tx('in the month')}</span>
              <b className="pay-good">+{amt(view.quotaBonus)}</b>
            </div>
          )}
          {piecePaid && view.onTimeBonus > 0 && (
            <div className="my-pay-line">
              <FormulaTip label={tx('On-time bonus')}><BonusFormula kind="ontime" view={view} rates={R} amt={amt} /></FormulaTip>
              <span className="stat-sub">{tx('{target}% or better', { target: view.rates.ontime_target })}</span>
              <b className="pay-good">+{amt(view.onTimeBonus)}</b>
            </div>
          )}
          {piecePaid && view.penalty > 0 && (
            <div className="my-pay-line">
              <FormulaTip label={tx('Late')}><LateFormula view={view} rates={R} amt={amt} /></FormulaTip>
              <span className="stat-sub">{view.late} × {amt(view.rates.late_penalty)}</span>
              <b className="pay-bad">−{amt(view.penalty)}</b>
            </div>
          )}
          {/* The KPI card, where the arrangement is paid on it: it is inside
              the total below, so it is a line above it — the card itself is
              further down, ladder by ladder. */}
          {kpiPaid && (
            <div className="my-pay-line">
              <FormulaTip label={tx('KPI')}><KpiPayFormula card={view.kpi} total={kpiMoney} amt={amt} frozen={!!frozen} /></FormulaTip>
              <span /><b className={kpiMoney > 0 ? 'pay-good' : undefined}>{amt(kpiMoney)}</b>
            </div>
          )}
          {/* The safety pillow, as what it put on top of the month — on a
              closed month too, read from the record, because it is part of
              what was paid. The rare other top-up is a month whose late
              penalties ran past its earnings: it is paid nothing, not less. */}
          {topUp > 0 && (
            <div className="my-pay-line my-pay-pillow">
              <FormulaTip label={<><Shield size={13} /> {rule.floor ? tx('Safety pillow') : tx('Raised to zero')}</>}>
                <PillowFormula floor={!!rule.floor} pillow={view.pillow} earned={view.earned} topUp={topUp} amt={amt} />
              </FormulaTip>
              <span className="stat-sub">
                {rule.floor && view.earned !== null && view.earned !== undefined
                  ? tx('the month came to {earned} — topped up to the guarantee', { earned: amt(view.earned) }) : ''}
              </span>
              <b className="pay-good">+{amt(topUp)}</b>
            </div>
          )}
          {/* HOW MUCH OF THE PILLOW IS FILLED. "Guaranteed 4 000 000" says you
              cannot lose; it does not say you are 1 200 000 short of earning
              it, which is the number that decides whether you take another job
              this week. The hint about pieces is for piecework only: on a KPI
              card the next piece is not what fills the pillow. */}
          {pp && (
            <div className="my-pay-pillow-bar">
              <PillowTrack pp={pp} amt={amt}
                hint={!settled && piecePaid && pp.pieces_left ? tx('about {n} more pieces at your average', { n: pp.pieces_left }) : ''} />
            </div>
          )}
          {/* Hand-made lines on the month — a bonus somebody agreed, a fine,
              an advance already handed over. They are in the total, so they
              are on the card: a fine nobody is shown is a fine nobody can
              ask about. The reason sits under the figure it explains, behind
              the same eye as the figure. */}
          {adjustments.map((a) => (
            <div className="my-pay-line my-pay-adj" key={`adj-${a.id}`}>
              <FormulaTip label={a.label || (ADJ_LABEL[a.kind] ? tx(ADJ_LABEL[a.kind]) : tx('Adjustment'))}>
                <AdjustFormula a={a} amt={amt} />
              </FormulaTip>
              <span />
              <span className="pay-amt">
                <b className={a.amount < 0 ? 'pay-bad' : 'pay-good'}>{a.amount < 0 ? '−' : '+'}{amt(Math.abs(a.amount))}</b>
                {shown && <span className="stat-sub pr-why">{a.note ? a.note : tx('No reason given')}</span>}
              </span>
            </div>
          ))}
          {/* When a KPI card is paid ON TOP of the work — the arrangement most
              of this team is on — the figure at the head of the card is the
              two added together, and this one is only the work half. Calling
              both of them "expected this month" put two different numbers
              under one sentence on the same card. */}
          <div className="my-pay-line my-pay-total">
            <span>
              {settled ? tx('Paid this month')
                : (hasKpi && !kpiInTotal) ? tx('From the work') : tx('Expected this month')}
            </span><span /><b>{amt(view.total)}</b>
          </div>

          {(view.items || []).length > 0 && (
            <details className="my-pay-items">
              <summary className="stat-sub">
                {tx('{n} delivered', { n: view.items.length })}{view.late > 0 ? ` · ${tx('{n} late', { n: view.late })}` : ''}
              </summary>
              <div>
                {view.items.map((it) => (
                  <div key={`${it.hat}${it.id}`} className={'my-pay-item' + (it.override ? ' my-pay-item-edited' : '')}>
                    <span>{it.title}</span>
                    <span className="stat-sub">{it.day}</span>
                    {shown && piecePaid && it.amount !== undefined && (
                      <span className="pay-amt">
                        <b className="my-pay-item-amt">{amt(it.amount)}</b>
                        {it.override && (
                          <>
                            <span className="stat-sub">{tx('changed by hand')} · {tx('was')} {amt(it.was)}</span>
                            <span className="stat-sub pr-why">{it.override.note ? `“${it.override.note}”` : tx('No reason given')}</span>
                          </>
                        )}
                      </span>
                    )}
                    {it.late ? <Dot tone="late" label={tx('late')} /> : <Dot tone="ok" label={tx('on time')} />}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* …and the whole of it, job by job, on its own page. */}
          <div className="my-pay-more">
            <PayReportButton userId={user.id} name={user.name} />
          </div>

          </>}

          {/* The KPI card for the month: every ladder the admin set, the reading
              it was graded on, the grade it reached and what that band pays.
              A ladder nobody took a reading for says so instead of grading a D
              against a number that was never taken, and a bonus held behind a
              floor says which floor rather than showing a bare nought.
              A card that reads the board says when the board last measured
              it; one made only of numbers somebody typed in says nothing,
              because there is nothing for a nightly pass to have synced. */}
          {kpi && (kpi.ladders.length > 0 || kpi.fixed > 0) && (
            <div className="kpi-card">
              <div className="section-head">
                <h3>{tx('This month’s KPI')}</h3>
                {synced && <><span className="spacer" /><span className="stat-sub kpi-synced">{tx('Last synced')}: {synced}</span></>}
              </div>
              {kpi.fixed > 0 && (
                <div className="my-pay-line">
                  <FormulaTip label={tx('Fixed pay')}><FixedFormula amount={kpi.fixed} amt={amt} /></FormulaTip>
                  <span /><b>{amt(kpi.fixed)}</b>
                </div>
              )}
              {kpi.ladders.map((l) => (
                <div key={l.key}>
                  <div className="my-pay-line kpi-line">
                    <span>
                      <FormulaTip label={tx(l.label)}><LadderFormula l={l} amt={amt} /></FormulaTip>
                      {l.grade ? <b className="kpi-grade">{l.grade}</b> : null}
                    </span>
                    <span className="stat-sub">
                      {l.value === null
                        ? tx('no reading yet')
                        : `${figure(l.value)}${l.unit || ''}`}
                      {l.gated ? ` · ${tx('needs {n} to qualify', { n: figure(l.gated.need) })}` : ''}
                    </span>
                    {l.pays > 0 ? <b className="pay-good">+{amt(l.pays)}</b> : <span className="stat-sub">{amt(0)}</span>}
                  </div>
                  {/* THE NEXT RUNG. A grade says where you stand; this says
                      what standing one step higher is worth and how far off it
                      is — the only part of a KPI sheet anybody reads twice. */}
                  {l.next && (
                    <div className="my-pay-next">
                      <span className="kpi-next-goal">{l.next.grade || tx('the next band')}</span>
                      {tx('{gap} {unit} to go', { gap: figure(l.next.gap), unit: l.unit || '' })}
                      {' · '}
                      <b className="pay-good">+{amt(l.next.plus)}</b>
                    </div>
                  )}
                </div>
              ))}
              <div className="my-pay-line my-pay-total">
                <span>{tx('KPI this month')}</span><span /><b>{amt(kpi.total)}</b>
              </div>
            </div>
          )}

          {hasRates && <div className="cm-hint">
            {tx('Counted on the day your part was delivered. Work that reached you after its own day had gone is not counted against you.')}
          </div>}

          <PayHistory shown={shown} />

          {hasRates && <SalaryPlanner pay={pay} />}
        </div>
      )}
    </div>
  )
}

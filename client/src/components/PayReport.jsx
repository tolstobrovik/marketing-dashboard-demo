import { useEffect, useMemo, useState } from 'react'
import {
  Wallet, ChevronLeft, ChevronRight, Pencil, RotateCcw, Plus, Trash2, Shield, Check, X,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { dateLabel, todayISO } from '../lib/constants.js'
import { monthOf, shiftMonth, monthWords } from '../lib/month.js'
import DeliveryReport from './DeliveryReport.jsx'
import Modal from './Modal.jsx'
import { money } from './SalaryPlanner.jsx'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import FormulaTip, { keepFigures } from './FormulaTip.jsx'
import PillowTrack from './PillowTrack.jsx'
import { countedBy, kindRuleText, JobFormula } from './PayFormulas.jsx'

// ---- one person's month, job by job ----------------------------------------
//
// The payroll could always say what a month came to. It could never say what
// it came to FOR THAT PIECE — so "why is this less than last month?" was
// answered by re-counting on a phone, and the first person to lose that
// argument stopped trusting the whole page.
//
// Every job is a row here: the piece, which hat was worn on it, what it paid
// and WHY it paid that — a flat rate, the thousands its views earned, or a
// figure an admin wrote in with a reason attached. The admin can change any
// row and add lines to the month, and every change keeps what the calculator
// had said beside it. A correction nobody can see is how a board becomes
// decoration.

const WHY = {
  views: 'by views',
  flat: 'flat rate — under the view target',
  uncounted: 'flat rate — no views counted yet',
  rate: 'the rate for this job',
}
export const ADJ_LABEL = { bonus: 'Bonus', fine: 'Fine', advance: 'Advance paid', correction: 'Correction' }

// A payslip line's name is put together on the server — "Shot it · reels" —
// and the whole of it is in no phrase book, so it read in English on every
// Russian and Uzbek screen. Each half is in the book; it is translated half
// by half.
export const lineLabel = (label) => String(label || '').split(' · ').map((part) => tx(part)).join(' · ')

export default function PayReport({ userId, name, onClose }) {
  const { user } = useAuth()
  const isAdmin = user.role === 'admin'
  // Tashkent's month, like the pay card that opens this: the browser's UTC
  // one opened last month's report for the first five hours of every month.
  const [month, setMonth] = useState(() => monthOf(todayISO()))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)   // the job being changed
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setData(null); setErr('')
    return api.get(`/reports/pay/person/${userId}?month=${month}`)
      .then(setData).catch((e) => setErr(e.message))
  }
  useEffect(() => { load() }, [userId, month]) // eslint-disable-line react-hooks/exhaustive-deps

  const p = data?.person
  const cur = p?.currency || 'UZS'
  const amt = (n) => keepFigures(money(Math.round(Number(n) || 0), cur))
  const canEdit = !!data?.can_edit && !data?.payout
  // Under an arrangement that does not pay per piece the jobs are still
  // listed — "which work did I do" is half of a payslip — but not as money
  // the month paid.
  const rule = p ? countedBy(p) : null
  const notCounted = rule && rule.earns !== 'piece'
    ? tx('Not counted under {scheme}', { scheme: tx(p.schemeLabel || '') }) : null

  const byDay = useMemo(() => {
    const out = new Map()
    for (const it of p?.items || []) {
      const key = it.day || '—'
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(it)
    }
    return [...out.entries()]
  }, [p])

  const saveOverride = async (job, amount, note) => {
    setBusy(true)
    try {
      await api.put('/reports/pay/override', {
        user_id: userId, content_id: job.id, hat: job.hat, month,
        amount: Number(amount), was: job.was ?? job.amount, note,
      })
      setEditing(null)
      await load()
      toast(tx('Saved — synced'))
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const clearOverride = async (job) => {
    setBusy(true)
    try {
      await api.del(`/reports/pay/override/${job.override.id}`)
      await load()
      toast(tx('Back to what the board worked out'))
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  // A refusal about the reason goes back to the form, beside the box it is
  // about, rather than into a toast that is gone before it is read.
  const addAdjustment = async (form) => {
    setBusy(true)
    try {
      await api.post('/reports/pay/adjust', { user_id: userId, month, ...form })
      setAdding(false)
      await load()
      toast(tx('Saved — synced'))
      return null
    } catch (e) {
      if (e.data?.field === 'note') return 'note'
      toast(e.message, 'err')
      return null
    } finally { setBusy(false) }
  }
  const dropAdjustment = async (id) => {
    setBusy(true)
    try { await api.del(`/reports/pay/adjust/${id}`); await load() }
    catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <Modal title={`${name || tx('Pay')} · ${monthWords(month)}`} wide onClose={onClose}>
      <div className="pr-head">
        <div className="at-month">
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label={tx('Previous month')}><ChevronLeft size={18} /></button>
          <b>{monthWords(month)}</b>
          <button className="icon-btn" disabled={month >= monthOf(todayISO())}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={tx('Next month')}><ChevronRight size={18} /></button>
        </div>
        {data?.payout && (
          <span className="chip chip-ok"><Check size={12} /> {tx('paid')} · {dateLabel(String(data.payout.paid_at || data.payout.closed_at).slice(0, 10))}</span>
        )}
      </div>

      {err && <div className="form-error">{err}</div>}
      {!p ? <div className="app-loading"><span className="spinner" /></div> : (
        <>
          {/* What the month came to, and which of the three kinds of money it
              is made of. "Fixed" and "earned" are different promises and the
              page says which is which before it says anything else. */}
          <div className="pr-sum">
            <div className="pr-total">
              <span className="st-k">{data.payout ? tx('Paid this month') : tx('Expected this month')}</span>
              <b>{amt(p.total)}</b>
              <span className="stat-sub">{tx(p.schemeLabel || '')}</span>
            </div>
            <div className="pr-split">
              <div><span className="stat-sub">{tx('Fixed pay')}</span><b>{amt(p.fixedPart)}</b></div>
              <div><span className="stat-sub">{tx('Earned')}</span><b>{amt(p.earnedPart)}</b></div>
              {p.kpiPart > 0 && <div><span className="stat-sub">{tx('KPI')}</span><b>{amt(p.kpiPart)}</b></div>}
            </div>
          </div>

          {/* The pillow, as the facts it is: what the work earned toward it,
              what it adds, and how far past it the month ran. Only where the
              arrangement has one — the server sends none otherwise. */}
          {p.pillowProgress && rule.floor && (
            <div className="pr-pillow">
              <span className="pr-pillow-t">
                <Shield size={14} /> {tx('Safety pillow')} · {amt(p.pillowProgress.pillow)}
              </span>
              <PillowTrack pp={p.pillowProgress} amt={amt}
                hint={!data.payout && rule.earns === 'piece' && p.pillowProgress.pieces_left
                  ? tx('about {n} more pieces at this month’s average', { n: p.pillowProgress.pieces_left }) : ''} />
            </div>
          )}

          {/* Views, per kind of piece, never added together. */}
          {(p.viewsByKind || []).length > 0 && (
            <div className="pr-kinds">
              {p.viewsByKind.map((k) => (
                <div key={k.kind} className="pr-kind">
                  <b>{tx(k.label)}</b>
                  <span>{k.pieces} {tx('pieces')}</span>
                  <span className="stat-sub">{k.views > 0 ? `${money(k.views, '')} ${tx('views')}` : tx('no views counted')}</span>
                  {k.rule && <span className="stat-sub">{kindRuleText(k.rule, amt)}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Every job, newest day first. */}
          {notCounted && <p className="stat-sub pr-frozen">{notCounted}</p>}
          <div className="pr-jobs">
            {byDay.length === 0 && <div className="empty">{tx('Nothing was delivered in this month.')}</div>}
            {byDay.map(([day, jobs]) => (
              <div key={day} className="pr-day">
                <div className="pr-day-head">{day === '—' ? tx('no day') : dateLabel(day)}</div>
                {jobs.map((job) => (
                  <div key={`${job.id}-${job.hat}`} className={'pr-job' + (job.override ? ' pr-job-edited' : '')}>
                    <span className="pr-job-main">
                      <b>{job.title}</b>
                      <span className="stat-sub">
                        {tx(job.label)}
                        {job.kind ? ` · ${tx(job.kind)}` : ''}
                        {' · '}
                        {/* WHY it paid that, and — opened — the working. */}
                        <FormulaTip label={tx(WHY[job.by] || WHY.rate)}>
                          <JobFormula job={job} amt={amt} kinds={p.viewsByKind} notCounted={notCounted}
                            fellBack={(p.lines || []).some((l) => l.hat === job.hat && l.kind && l.kind === job.kind && l.rate_scope === 'hat')} />
                        </FormulaTip>
                        {job.by === 'views' && job.views !== null ? ` (${money(job.views, '')})` : ''}
                        {job.to_gate ? ` · ${tx('{n} views short of the thousand-rate', { n: money(job.to_gate, '') })}` : ''}
                        {job.late ? ` · ${tx('late')}` : ''}
                      </span>
                      {job.override && (
                        <span className="stat-sub">{tx('changed by hand')} · {tx('was')} {amt(job.was)}</span>
                      )}
                    </span>
                    {/* The reason sits under the figure it explains: the eye that
                        checks the amount should not have to go looking for why.
                        A change saved before a reason was required says so. */}
                    <span className="pay-amt">
                      <b className="pr-job-amt">{amt(job.amount)}</b>
                      {job.override && (
                        <span className="stat-sub pr-why">{job.override.note ? `“${job.override.note}”` : tx('No reason given')}</span>
                      )}
                    </span>
                    {canEdit && (
                      <span className="pr-job-do">
                        <button className="icon-btn" data-tip={tx('Change what this paid')}
                          onClick={() => setEditing({ ...job, draft: String(job.amount), note: job.override?.note || '' })}>
                          <Pencil size={14} />
                        </button>
                        {job.override && (
                          <button className="icon-btn" data-tip={tx('Back to what the board worked out')}
                            disabled={busy} onClick={() => clearOverride(job)}>
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Lines that belong to no piece. */}
          <div className="pr-adj">
            <div className="pr-adj-head">
              <b>{tx('On the month')}</b>
              {canEdit && (
                <button className="btn btn-sm" onClick={() => setAdding(true)}>
                  <Plus size={14} /> {tx('Add a line')}
                </button>
              )}
            </div>
            {(p.adjustments || []).length === 0
              ? <div className="stat-sub">{tx('No bonuses, fines or advances on this month.')}</div>
              : p.adjustments.map((a) => (
                <div key={a.id} className="pr-adj-row">
                  <span>
                    <b>{a.label || (ADJ_LABEL[a.kind] ? tx(ADJ_LABEL[a.kind]) : tx('Adjustment'))}</b>
                  </span>
                  <span className="pay-amt">
                    <b className={a.amount < 0 ? 'pay-bad' : 'pay-good'}>{a.amount < 0 ? '−' : '+'}{amt(Math.abs(a.amount))}</b>
                    <span className="stat-sub pr-why">{a.note ? a.note : tx('No reason given')}</span>
                  </span>
                  {canEdit && (
                    <button className="icon-btn" disabled={busy} data-tip={tx('Remove')}
                      onClick={() => dropAdjustment(a.id)}><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
          </div>

          {data.payout && (
            <p className="stat-sub pr-frozen">
              {tx('This month is closed. What was paid is written down; changes here will not move it until it is reopened.')}
            </p>
          )}
          {/* The same month, counted: this person's deliveries by hat and
              kind, each count opening into the tasks behind it. */}
          <DeliveryReport userId={userId} month={month} />
        </>
      )}

      {editing && (
        <JobEdit job={editing} cur={cur} busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(amount, note) => saveOverride(editing, amount, note)} />
      )}
      {adding && <AdjustForm busy={busy} onCancel={() => setAdding(false)} onSave={addAdjustment} />}
    </Modal>
  )
}

// One job, changed by hand. The reason is not optional: a figure somebody
// typed with no note is the one nobody can defend three months later.
function JobEdit({ job, cur, busy, onCancel, onSave }) {
  const [amount, setAmount] = useState(String(job.amount))
  const [note, setNote] = useState(job.note || '')
  // An emptied "Pays" box is not a nought: Number('') is 0, and a cleared box
  // with a reason typed under it used to save a job as paying nothing.
  const good = String(amount).trim() !== '' && Number(amount) >= 0 && note.trim().length > 0
  return (
    <Modal title={tx('What should this job pay?')} onClose={onCancel}>
      <div className="pr-edit">
        <p className="stat-sub">
          <b>{job.title}</b> · {tx(job.label)} · {tx('the board says')} {money(job.was ?? job.amount, cur)}
        </p>
        <label className="field">
          <span>{tx('Pays')}</span>
          <input className="input" type="number" min="0" value={amount} autoFocus
            onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>{tx('Why')}</span>
          <input className="input" value={note} maxLength={300} placeholder={tx('agreed extra for three rounds of edits')}
            onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="gate-foot">
          <button className="btn btn-ghost" onClick={onCancel}><X size={14} /> {tx('Cancel')}</button>
          <button className="btn btn-primary" disabled={!good || busy} onClick={() => onSave(amount, note.trim())}>
            <Check size={15} /> {tx('Save')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// A line on the month. The name may be left off — it falls back to what kind
// of line it is — but the REASON may not, for the same reason a changed job
// needs one, and the server refuses it without: a fine or a bonus on
// somebody's month with nothing to say why is the line nobody can defend
// later, and the person it is on is the one who reads it.
function AdjustForm({ busy, onCancel, onSave }) {
  const [kind, setKind] = useState('bonus')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [refused, setRefused] = useState(false)
  const hasWhy = note.trim().length > 0
  const good = Number(amount) > 0 && hasWhy
  const save = async () => {
    const bad = await onSave({ kind, label: label.trim(), amount: Number(amount), note: note.trim() })
    if (bad === 'note') setRefused(true)
  }
  return (
    <Modal title={tx('A line on the month')} onClose={onCancel}>
      <div className="pr-edit">
        <label className="field">
          <span>{tx('What kind')}</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(ADJ_LABEL).map(([k, v]) => <option key={k} value={k}>{tx(v)}</option>)}
          </select>
        </label>
        <p className="stat-sub">
          {kind === 'fine' || kind === 'advance'
            ? tx('This comes off the month, however it is typed.')
            : tx('This is added to the month.')}
        </p>
        <label className="field">
          <span>{tx('Name it')}</span>
          <input className="input" value={label} autoFocus placeholder={tx('e.g. covered the weekend shoot')}
            onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span>{tx('Amount')}</span>
          <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>{tx('Why')}</span>
          <input className="input" value={note} maxLength={300} required aria-required="true"
            aria-invalid={refused && !hasWhy ? 'true' : undefined} aria-describedby="adj-why-say"
            placeholder={tx('agreed extra for three rounds of edits')}
            onChange={(e) => { setNote(e.target.value); setRefused(false) }} />
          <span id="adj-why-say" className={'pr-why-say' + (refused ? ' pr-why-need' : '')}>
            {hasWhy ? tx('The person this is on will read it.') : tx('Say why — the person this is on will read it.')}
          </span>
        </label>
        <div className="gate-foot">
          <button className="btn btn-ghost" onClick={onCancel}><X size={14} /> {tx('Cancel')}</button>
          <button className="btn btn-primary" disabled={!good || busy} onClick={save}>
            <Check size={15} /> {tx('Save')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// The button that opens it, so every page that lists people can offer the
// same door without knowing what is behind it.
export function PayReportButton({ userId, name, label, className = 'btn btn-sm' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
        <Wallet size={14} /> {label || tx('Every job, and what it paid')}
      </button>
      {open && <PayReport userId={userId} name={name} onClose={() => setOpen(false)} />}
    </>
  )
}

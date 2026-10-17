import { useState } from 'react'
import { Check, Hand, Link2, CalendarClock, RotateCcw } from 'lucide-react'
import RevisionRounds from './RevisionRounds.jsx'
import PravkaBox from './PravkaBox.jsx'
import ClashDialog, { isClash } from './ClashDialog.jsx'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { activityLine } from '../lib/activity.js'
import { adminOn } from '../lib/auth.jsx'
import { PRAVKA_ROUNDS } from '../lib/constants.js'
import { useChannels } from '../lib/channels.jsx'
import { useT, tr as tx } from '../lib/i18n.jsx'
import { dayShort } from './CoachParts.jsx'

// ---- the record of a task, in its window -----------------------------------------------
//
// What the tabbed task sheet held besides its fields, moved into the task window
// when the sheet became the window's Edit mode (the owner, 13 October 2026: one
// task view for everybody). An ask to move a promised day is said beside the
// days, with an admin's two answers (DayAsks); the rest is under "More details":
// the rounds of changes, a hand raised, the three clocks, the history, the
// task's link, and an admin's override of the pravka lock. Each press is the
// server's own route, and the window reads the task again after it.

const PROMISED = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the edit is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}
const promisedDay = (field) => tx(PROMISED[field] || field)
// How each phase state reads. "Excused" says the delay belongs upstream.
const PHASE_WORDS = {
  ok: 'on time', late: 'late', excused: 'excused — handed over late',
  pending: 'in hand', waiting: 'not started',
}
const when = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))

// An ask to move a promised day that waits on an admin, said where the days are.
export function DayAsks({ t, user, onChanged }) {
  const { byKey } = useChannels()
  const [busy, setBusy] = useState(false)
  const [clash, setClash] = useState(null)   // { reqId, data }: the new shoot day lands on another shoot
  const asks = (t.date_requests || []).filter((r) => r.state === 'open')
  if (!asks.length) return null
  const decide = async (reqId, approve, force = false) => {
    if (busy) return
    setBusy(true)
    try {
      const out = await api.post(`/content/date-requests/${reqId}/decide`, { approve, ...(force ? { force: true } : {}) })
      setClash(null)
      toast(approve ? tx('Moved — everyone on the task hears it') : tx('Kept where it was — they hear why'))
      onChanged(out?.task)
    } catch (e) {
      if (e.status === 409 && isClash(e.data)) setClash({ reqId, data: e.data })
      else { setClash(null); toast(e.message, 'err') }
    } finally { setBusy(false) }
  }
  return (
    <div className="co-asks">
      {asks.map((r) => (
        <div key={r.id} className="co-note co-n-wait">
          <CalendarClock size={20} aria-hidden="true" />
          <div className="co-ask-day">
          <span>
            <b>{tx('Asked to move {day}', { day: promisedDay(r.field) })}:</b>{' '}
            {r.from_date ? dayShort(r.from_date) : '—'} → {r.to_date ? dayShort(r.to_date) : tx('cleared')}{r.to_time ? `, ${r.to_time}${r.to_end ? `–${r.to_end}` : ''}` : ''}. “{r.reason}” — {r.asked_name || '—'}
          </span>
          {user.role === 'admin' && (
            <span className="co-btns">
              <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy} onClick={() => decide(r.id, false)}>{tx('Keep the day')}</button>
              <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy} onClick={() => decide(r.id, true)}><Check size={16} aria-hidden="true" />{tx('Move it')}</button>
            </span>
          )}
          </div>
        </div>
      ))}
      {clash && (
        <ClashDialog clash={clash.data} busy={busy} chanLabel={(ch) => byKey[ch]?.label || ch}
          onBack={() => setClash(null)} onForce={() => decide(clash.reqId, true, true)} />
      )}
    </div>
  )
}

export default function TaskMore({ t, user, team, label = '', canEdit = false, canRaise = false, onChanged }) {
  const { t: tt } = useT()
  const nameOf = (id) => (team.find((u) => u.id === id)?.name || '').split(' ')[0]
  const revisions = t.revisions || []
  const flags = (t.flags || []).filter((f) => !f.cleared_at)
  const phases = (t.phases || []).filter((p) => p.state !== 'none')
  const asks = t.date_requests || []
  const activity = t.activity || []
  const [busy, setBusy] = useState(false)
  const [raising, setRaising] = useState(null)   // null | { kind, reason }
  const [allLog, setAllLog] = useState(false)
  // An admin on the channel may push a pravka past either lock (two rounds, or
  // an approval) on purpose — never from the step, where it would read as the
  // normal next one.
  const cleared = revisions.length >= PRAVKA_ROUNDS || !!t.approved_at
  const mayForce = /^ready$/i.test(label) && cleared && adminOn(user, t.channels)
  const targets = [
    t.editor_id && { key: 'editor', label: tx('Editor') },
    t.operator_id && { key: 'operator', label: tx('Operator · re-shoot') },
    t.designer_id && { key: 'designer', label: tx('Designer') },
  ].filter(Boolean)
  const [force, setForce] = useState(null)   // null | { note, target }
  const [uploading, setUploading] = useState(false)

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try { const r = await fn(); done?.(); onChanged(r?.id ? r : r?.task) } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const copyLink = () => {
    const url = `${window.location.origin}/brief?task=${t.id}`
    navigator.clipboard?.writeText(url)
      .then(() => toast(tx('Link copied — paste it anywhere')))
      .catch(() => toast(url, 'err'))
  }

  return (
    <>
      {revisions.length > 0 && (
        <section className="co-blk co-more-blk">
          <h3>{tt('task.revisions')}</h3>
          <RevisionRounds taskId={t.id} revisions={revisions} onChange={() => onChanged()} />
        </section>
      )}

      {(flags.length > 0 || raising || canRaise) && (
        <section className="co-blk co-more-blk">
          <h3><Hand size={14} aria-hidden="true" /> {tt('task.trouble')}</h3>
          {flags.map((f) => (
            <div key={f.id} className={`flag-item flag-${f.kind}`}>
              <span className="flag-line"><b>{f.raised_name}</b> {f.kind === 'cant_take' ? tx('cannot take this on') : tx('says this will be late')}</span>
              <span className="flag-why">“{f.reason}”</span>
              {(canEdit || f.raised_by === user.id) && (
                <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy}
                  onClick={() => run(() => api.post(`/content/flags/${f.id}/clear`, {}))}>{tx('Sorted — hand down')}</button>
              )}
            </div>
          ))}
          {raising ? (
            <div className="flag-form">
              <div className="pravki-target">
                {[['at_risk', tx('This will be late')], ['cant_take', tx('I can’t take this on')]].map(([k, l]) => (
                  <button key={k} type="button" className={'tchip' + (raising.kind === k ? ' on' : '')} onClick={() => setRaising({ ...raising, kind: k })}>{l}</button>
                ))}
              </div>
              <textarea className="input" rows={2} autoFocus value={raising.reason} onChange={(e) => setRaising({ ...raising, reason: e.target.value })}
                placeholder={tx('What is in the way? The other shoot overran, the location fell through…')} />
              <div className="co-btns">
                <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy || !raising.reason.trim()}
                  onClick={() => run(() => api.post(`/content/${t.id}/flags`, { kind: raising.kind, reason: raising.reason.trim() }), () => { setRaising(null); toast(tx('Said early — the people who plan have it')) })}>
                  <Hand size={16} aria-hidden="true" />{tx('Say it now')}
                </button>
                <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setRaising(null)}>{tx('Cancel')}</button>
              </div>
            </div>
          ) : canRaise && flags.length === 0 && (
            <button type="button" className="co-link" onClick={() => setRaising({ kind: 'at_risk', reason: '' })}><Hand size={14} aria-hidden="true" /> {tx('Raise a hand')}</button>
          )}
        </section>
      )}

      {mayForce && targets.length > 0 && (
        <section className="co-blk co-more-blk">
          {!force ? (
            <button type="button" className="co-link" onClick={() => setForce({ note: '', target: targets[0].key })}><RotateCcw size={14} aria-hidden="true" /> {tx('Force Pravka (Override)')}</button>
          ) : (
            <>
              <h3>{tx('Force Pravka (Override)')}</h3>
              <PravkaBox taskId={t.id} value={force.note} disabled={busy}
                onChange={(v) => setForce((p) => (p ? { ...p, note: typeof v === 'function' ? v(p.note) : v } : p))}
                onError={(m) => toast(m, 'err')} onUploading={setUploading}
                placeholder={tx('Write everything that needs changing, in one go…')} />
              <span className="co-help">{tx('Override: this pravka goes past the lock.')}</span>
              {targets.length > 1 && (
                <div className="pravki-target">
                  <span className="crew-opt">{tt('task.sendbackto')}</span>
                  {targets.map((x) => <button key={x.key} type="button" className={'tchip' + (force.target === x.key ? ' on' : '')} onClick={() => setForce({ ...force, target: x.key })}>{x.label}</button>)}
                </div>
              )}
              <div className="co-btns">
                <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy || uploading || !force.note.trim()}
                  onClick={() => run(() => api.post(`/content/${t.id}/revisions`, { note: force.note.trim(), target: force.target, force: true }), () => { setForce(null); toast(tx('Sent back to the crew — synced')) })}>
                  <RotateCcw size={16} aria-hidden="true" />{tt('task.sendback')}
                </button>
                <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setForce(null)}>{tx('Cancel')}</button>
              </div>
            </>
          )}
        </section>
      )}

      {phases.length > 0 && (
        <section className="co-blk co-more-blk">
          <h3>{tt('task.deadlines')}</h3>
          <div className="phases">
            {phases.map((p) => {
              const who = (p.owner_ids || [p.owner_id]).filter(Boolean).map((id) => team.find((u) => u.id === id)?.name).filter(Boolean)
              return (
                <div className="phase-row" key={p.phase}>
                  <span className="phase-name">{tx(p.label)} <span className="muted">{who.length ? who.join(' · ') : tx('nobody')}</span></span>
                  <span className={`phase-state phase-${p.state}`}>{tx(PHASE_WORDS[p.state] || p.state)}</span>
                  <span className="phase-meta">
                    {tx('due')} {p.revised ? <><s>{p.promised}</s> → <b>{p.revised}</b></> : <b>{p.due}</b>}
                    {p.days_late > 0 && <> · <b>{tx('{n}d late', { n: p.days_late })}</b></>}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {asks.length > 0 && (
        <section className="co-blk co-more-blk">
          <h3><CalendarClock size={14} aria-hidden="true" /> {tt('task.daymoves')}</h3>
          {asks.map((r) => (
            <div key={r.id} className={`ask-item ask-${r.state}`}>
              <span className="ask-line">
                <b>{promisedDay(r.field)}</b>: {r.from_date || '—'} → {r.to_date || tx('cleared')}{' '}
                <span className={`chip ask-state ask-chip-${r.state}`}>
                  {r.state === 'open' ? tx('waiting on an admin') : r.state === 'approved' ? tx('moved') : r.state === 'stale' ? tx('out of date') : tx('kept where it was')}
                </span>
              </span>
              <span className="ask-why">“{r.reason}” — {r.asked_name || '—'}</span>
              {r.decided_at && (
                <span className="ask-meta">
                  {r.state === 'approved' ? tx('Moved by {name}', { name: r.decided_name })
                    : r.state === 'stale' ? tx('Dropped by {name}', { name: r.decided_name })
                      : tx('Kept by {name}', { name: r.decided_name })}
                  {r.decided_note ? ` — ${r.decided_note}` : ''}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {activity.length > 0 && (
        <section className="co-blk co-more-blk">
          <h3>{tt('task.history')}</h3>
          {!allLog ? (
            <button type="button" className="co-link" onClick={() => setAllLog(true)}>{tx('Show the {n} changes', { n: activity.length })}</button>
          ) : (
            <>
              {activity.map((a) => (
                <div key={a.id} className="cmt-row hist-row">
                  <b className="cmt-who">{nameOf(a.user_id) || (a.user_name || '?').split(' ')[0]}</b>
                  <span className="cmt-text">{activityLine(a)}</span>
                  <span className="cmt-when">{when(a.created_at)}</span>
                </div>
              ))}
              <button type="button" className="co-link" onClick={() => setAllLog(false)}>{tx('Hide')}</button>
            </>
          )}
        </section>
      )}

      <button type="button" className="co-link co-copy" onClick={copyLink}><Link2 size={14} aria-hidden="true" /> {tx('Copy link')}</button>
    </>
  )
}

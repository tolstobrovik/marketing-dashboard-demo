import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clapperboard, Scissors, Palette, Send, X } from 'lucide-react'
import PersonPick from './PersonPick.jsx'
import TimeBand from './TimeBand.jsx'
import { Face, Badge, firstName, dayShort, weekdayShort, lateWords } from './CoachParts.jsx'
import { api } from '../lib/api.js'
import { addDaysISO } from '../lib/constants.js'
import { editDue, reviewDue } from '../lib/due.js'
import { makeDone, daysBetween } from '../lib/coach.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the plan of a task: one row per stop, pressed to change it (round 14) ----------------
//
// The owner (16 Oct 2026): "the edit form sucks — it does not match the task
// view". So the task window IS the form for what changes most: the side of the
// window lists the stops of the piece — the shoot, the edit, the artwork, the
// day it goes out — each with who does it and when. Whoever may edit the piece
// presses a name to choose another (PersonPick), a shoot's time to book it
// (the booking panel, TimeBand) and any other day to set it (two weeks of days).
// Each answer is one PATCH of that one field, the same route the Edit form
// saves through, so every rule and every clash is still the server's: a
// refusal is said in its words. Everybody else reads the same rows.

const hh = (t) => String(t || '').slice(0, 5)

// A small window at the button that opened it; a sheet on a phone.
function Pop({ anchor, label, onClose, wide = false, children }) {
  const el = useRef(null)
  // Placed again whenever it changes size: the booking panel grows once the free times arrive.
  useLayoutEffect(() => {
    const p = el.current
    if (!p || !anchor) return undefined
    const place = () => {
      if (window.matchMedia('(max-width: 640px)').matches) return
      const r = anchor.getBoundingClientRect(), h = p.offsetHeight, w = p.offsetWidth
      const below = r.bottom + 6 + h < window.innerHeight - 12, above = r.top - 6 - h > 12
      if (below || above) {
        p.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`
        p.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`
        p.style.transformOrigin = below ? 'top left' : 'bottom left'
      } else {   // no room over or under: beside it, where there is room (the plan sits on the right)
        p.style.left = `${r.left - w - 8 > 12 ? r.left - w - 8 : Math.min(r.right + 8, window.innerWidth - w - 12)}px`
        p.style.top = `${Math.max(12, Math.min(r.top - 40, window.innerHeight - h - 12))}px`
        p.style.transformOrigin = 'top right'
      }
    }
    place()
    const ro = window.ResizeObserver ? new ResizeObserver(place) : null
    ro?.observe(p)
    window.addEventListener('resize', place)
    return () => { ro?.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor])
  useEffect(() => {
    const p = el.current
    ;(p?.querySelector('[aria-pressed="true"]') || p?.querySelector('button:not(.r14-pop-x), input'))?.focus()
    const out = (e) => { if (!el.current?.contains(e.target) && !anchor?.contains(e.target)) onClose(false) }
    // Esc closes this and not the window under it, wherever the focus went (a button asleep while saving drops it).
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true) } }
    document.addEventListener('pointerdown', out, true)
    window.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('pointerdown', out, true); window.removeEventListener('keydown', esc, true) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div ref={el} className={'r14-pop' + (wide ? ' wide' : '')} role="dialog" aria-label={label}>
      <div className="r14-pop-h"><b>{label}</b><button type="button" className="r14-pop-x" onClick={() => onClose(true)} aria-label={tx('Close')}><X size={18} aria-hidden="true" /></button></div>
      {children}
    </div>,
    document.body,
  )
}

// Two weeks of days: today ringed, Sundays quiet, the day it goes out marked; another day from the browser's own box.
function DayGrid({ today, value, out, onPick }) {
  const days = Array.from({ length: 14 }, (_, i) => addDaysISO(today, i))
  return (
    <div className="r14-dg">
      <div className="r14-dg-grid" role="group">
        {days.map((iso, i) => {
          const sun = new Date(`${iso}T12:00:00Z`).getUTCDay() === 0
          return (
            <button key={iso} type="button" className={'r14-dg-d' + (i === 0 ? ' today' : '') + (sun ? ' off' : '') + (iso === out ? ' out' : '')}
              aria-pressed={value === iso} onClick={() => onPick(iso)}
              aria-label={`${i === 0 ? `${tx('Today')}, ` : ''}${dayShort(iso)}${iso === out ? `, ${tx('the day it goes out')}` : ''}`}>
              <b>{weekdayShort(iso)}</b>
              <small>{Number(iso.slice(8))}</small>
            </button>
          )
        })}
      </div>
      {days.includes(out) && <p className="r14-dg-key"><i aria-hidden="true" />{tx('the day it goes out')}</p>}
      <label className="r14-dg-other">{tx('Another day…')}
        <input className="input" type="date" min={today} onChange={(e) => { if (e.target.value) onPick(e.target.value) }} />
      </label>
    </div>
  )
}

// Booking the shoot from the plan: the booking panel, then one button.
function Book({ t, operators, onBook, busy }) {
  const [v, setV] = useState({ day: t.recording_date || '', from: hh(t.recording_time), to: hh(t.recording_end), op: t.operator_id || null })
  const ok = v.day && v.from && v.op
  return (
    <div className="r14-book">
      <TimeBand day={v.day} onDay={(d) => setV((o) => ({ ...o, day: d }))}
        value={{ from: v.from, to: v.to }} onChange={({ from, to }) => setV((o) => ({ ...o, from, to }))}
        operatorId={v.op} onOperator={(id) => setV((o) => ({ ...o, op: id }))} operators={operators} excludeId={t.id} />
      <div className="r14-book-f">
        <button type="button" className="co-btn co-btn-p" disabled={!ok || busy}
          onClick={() => onBook({ operator_id: v.op, recording_date: v.day, recording_time: v.from, recording_end: v.to || null })}>{tx('Book')}</button>
      </div>
    </div>
  )
}

export default function TaskPlan({ t, label = '', making, team = [], today, byKey = {}, edit = false, onSaved, extra = null }) {
  const [open, setOpen] = useState(null)      // { key, el } — the row whose window is open
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')      // the field just changed glows once
  const person = (id) => team.find((u) => u.id === id) || null
  const holds = (role) => team.filter((u) => (u.crew_roles || []).includes(role))
  const others = (role) => team.filter((u) => !(u.crew_roles || []).includes(role) && u.role !== 'ambassador')
  const save = async (body, key) => {
    if (busy) return
    setBusy(true)
    try {
      const u = await api.patch(`/content/${t.id}`, body)
      onSaved?.(u)
      setOpen(null); setFlash(key); setTimeout(() => setFlash(''), 1200)
      toast(tx('Saved — everyone on it sees the change'))
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const out = reviewDue(t) || t.release_date || null
  const chans = (t.channels || []).map((c) => byKey[c]?.label || c).join(', ')
  const rows = []
  if (making?.filmed) {
    rows.push({ k: 'shoot', Icon: Clapperboard, cls: 'co-k-shoot', label: tx('Shoot'), q: tx('Who films it?'), who: t.operator_id, field: 'operator_id', role: 'operator',
      day: t.recording_date, time: t.recording_time ? `${hh(t.recording_time)}${t.recording_end ? `–${hh(t.recording_end)}` : ''}` : '', done: !!t.shot_at })
  }
  if (making && !making.written && !making.repost && (making.filmed || !making.designed || t.editor_id)) {
    rows.push({ k: 'edit', Icon: Scissors, cls: 'co-k-cut', label: tx('Edit due'), q: tx('Who edits it?'), who: t.editor_id, field: 'editor_id', role: 'editor',
      day: editDue(t), dayField: 'edit_ready_date', done: makeDone(t, label, 'editor') })
  }
  if (making && !making.written && !making.repost && (making.designed || t.designer_id || t.design_ready_date)) {
    rows.push({ k: 'design', Icon: Palette, cls: 'co-k-art', label: making.filmed ? tx('Cover') : tx('Artwork due'), q: tx('Who makes the artwork?'), who: t.designer_id, field: 'designer_id', role: 'designer',
      day: t.design_ready_date, dayField: 'design_ready_date', done: makeDone(t, label, 'designer') })
  }
  rows.push({ k: 'out', Icon: Send, cls: 'co-k-good', label: tx('Goes out'), whoText: chans, day: out, dayField: 'release_date', done: !!t.done_at })

  const chip = (r) => (r.done ? <Badge tone="good" icon="check">{tx('Done')}</Badge>
    : r.day && r.day < today ? <Badge tone="late">{lateWords(daysBetween(r.day, today))}</Badge> : null)
  const when = (r) => (r.day ? `${dayShort(r.day)}${r.time ? `, ${r.time}` : ''}` : r.k === 'shoot' ? tx('Book a time') : tx('Set a day'))
  const may = edit && !t.done_at

  return (
    <ol className="r14-pl" aria-label={tx('Plan')}>
      {rows.map((r) => {
        const p = person(r.who)
        const whoCell = r.whoText != null ? <span className="r14-pl-f">{r.whoText || '—'}</span>
          : may ? (
            <span className={'r14-pl-who' + (flash === r.field ? ' r14-flash' : '')}>
              <PersonPick value={r.who} label={r.q} first={holds(r.role)} rest={others(r.role)} disabled={busy} empty={tx('Choose')}
                onChange={(id) => { if (id !== r.who) save({ [r.field]: id }, r.field) }} />
            </span>
          ) : <span className="r14-pl-f">{p ? <><Face person={p} />{firstName(p)}</> : <em>{tx('Nobody yet')}</em>}</span>
        const whenKey = r.k === 'shoot' ? 'recording_date' : r.dayField
        const whenCell = may ? (
          <button type="button" className={'r14-pl-when' + (r.day ? '' : ' empty') + (flash === whenKey ? ' r14-flash' : '')} aria-haspopup="dialog" aria-expanded={open?.key === r.k}
            onClick={(e) => setOpen(open?.key === r.k ? null : { key: r.k, el: e.currentTarget })}
            aria-label={`${r.label}: ${when(r)}. ${tx('Press to change')}`}>{when(r)}</button>
        ) : <span className="r14-pl-when ro">{when(r)}</span>
        return (
          <li key={r.k} className="r14-pl-row">
            <span className={`r14-pl-kt co-kic ${r.cls}`} aria-hidden="true"><r.Icon size={15} /></span>
            <span className="r14-pl-lb">{r.label}{chip(r)}</span>
            {whoCell}
            {whenCell}
            {extra?.[r.k]}
            {open?.key === r.k && (
              <Pop anchor={open.el} label={r.k === 'shoot' ? tx('Book the shoot') : r.label} wide={r.k === 'shoot'}
                onClose={(back) => { const el = open.el; setOpen(null); if (back) el?.focus() }}>
                {r.k === 'shoot'
                  ? <Book t={t} busy={busy} operators={holds('operator').length ? holds('operator') : others('operator')}
                    onBook={(body) => save(body, 'recording_date')} />
                  : <DayGrid today={today} value={r.day} out={r.k === 'out' ? null : out} onPick={(iso) => save({ [r.dayField]: iso }, r.dayField)} />}
              </Pop>
            )}
          </li>
        )
      })}
    </ol>
  )
}

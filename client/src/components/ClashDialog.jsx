import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// ---- "they are already booked then" -----------------------------------------
//
// The server answers a shoot that lands on another one, or outside the
// operator's working day, with a 409 naming what is in the way (guardShoot in
// server/routes/content.js). It used to be answered two ways. The builder drew
// a box under its steps; the task sheet drew one at the TOP of the sheet —
// half a sheet above the timeline the booking is made on, so for the person
// who had just pressed Save it looked as if Save did nothing.
//
// One window now, over whichever sheet asked, in front of whoever pressed the
// button. A warning, not a wall: "Pick another time" goes back with nothing
// lost, and a channel admin can "Book anyway". Escape is "Pick another time"
// and only that — it must not reach the sheet underneath, whose Escape asks
// whether to throw the whole edit away.
//
// `schedule_why` is the server's reason in parts, so it can be said in the
// reader's language; `schedule_issue` is the same reason as an English
// sentence, kept for a server that predates the parts.

// A 409 that is about the operator's day — another shoot in the way, or
// hours they do not work — as opposed to the other 409s a save can meet (a
// full day's quota, a slot its holder has already accepted).
export const isClash = (c) => !!c && ((c.conflicts?.length || 0) > 0 || !!c.schedule_issue)

// For every other place that moves a shoot — a calendar drag, a card given
// to somebody on the crew board, a stage move through the handover gate. They
// used to answer a double booking with a toast or a browser alert and no way
// through for the admin who meant it. Now:
//
//   const [clashUi, askClash] = useClash()
//   …catch (e) { if (!askClash(e, () => save({ force: true }))) toast(e.message, 'err') }
//   …{clashUi}
//
// askClash() says whether it took the error; `again` is the same call made
// again with force, and reports its own outcome; `back`, if given, runs when
// they choose another time instead.
export function useClash(chanLabel) {
  const [open, setOpen] = useState(null) // { data, again, back }
  const [busy, setBusy] = useState(false)
  const ask = (e, again, back) => {
    if (!(e?.status === 409 && isClash(e.data))) return false
    setOpen({ data: e.data, again, back })
    return true
  }
  const ui = open ? (
    <ClashDialog clash={open.data} busy={busy} chanLabel={chanLabel}
      onBack={() => { const b = open.back; setOpen(null); b?.() }}
      onForce={async () => {
        setBusy(true)
        try { await open.again() } finally { setBusy(false); setOpen(null) }
      }} />
  ) : null
  return [ui, ask]
}

const why = (clash) => {
  const w = clash?.schedule_why
  if (w?.kind === 'day_off') return tx('{name} doesn’t work that day', { name: w.name })
  if (w?.kind === 'hours') return tx('Outside {name}’s working hours ({from}–{to})', { name: w.name, from: w.from, to: w.to })
  return clash?.schedule_issue || ''
}

export default function ClashDialog({ clash, busy = false, onBack, onForce, chanLabel }) {
  const back = useRef(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const was = document.activeElement
    back.current?.focus()
    // Capture, so this runs before the sheet's own Escape listener — and stops
    // there.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      // Not while "Book anyway" is on its way — the answer is already given.
      if (!busyRef.current) onBackRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (was && typeof was.focus === 'function') was.focus()
    }
  }, [])

  if (!clash) return null
  const conflicts = clash.conflicts || []
  const reason = why(clash)
  const title = conflicts.length ? tx('Already booked then') : tx('Outside their working time')

  return createPortal(
    <div className="modal-backdrop clash-backdrop" onMouseDown={(e) => { e.stopPropagation(); if (!busy) onBack?.() }}>
      <div className="modal clash-modal" role="alertdialog" aria-modal="true"
        aria-labelledby="clash-title" aria-describedby="clash-body" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="clash-title"><AlertCircle size={17} /> {title}</h3>
        </div>
        <div className="modal-body" id="clash-body">
          {conflicts.length > 0 && (
            <ul className="clash-list">
              {conflicts.map((c) => (
                <li key={c.id ?? `${c.from}-${c.to}`}>
                  <b>{c.from}{c.to ? `–${c.to}` : ''}</b> · {c.title || tx('taken')}
                  {chanLabel && c.channels?.length > 0 && <span className="stat-sub"> ({c.channels.map(chanLabel).join(', ')})</span>}
                </li>
              ))}
            </ul>
          )}
          {reason && <p className="clash-why">{reason}</p>}
          <p className="stat-sub">
            {clash.can_force ? tx('You’re the admin — you can book it anyway.')
              : conflicts.length ? tx('Only a channel admin can double-book.')
                : tx('Only a channel admin can book outside their working time.')}
          </p>
        </div>
        <div className="modal-foot">
          <button ref={back} type="button" className="btn" disabled={busy} onClick={() => onBack?.()}>{tx('Pick another time')}</button>
          {clash.can_force && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onForce?.()}>{tx('Book anyway')}</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

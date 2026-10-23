import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// While a sheet is up, the page behind it does not move. On a desk that is a
// nicety; on a phone it is the difference between a sheet and a hole in the
// page — a finger that misses the form scrolls the board underneath and you
// come back to somewhere else. Counted, because a modal opens over a modal
// (the handover gate over the task sheet) and the first one to close must not
// give the scroll back while the second is still up.
let held = 0
function holdPage() {
  if (held++ === 0) document.body.classList.add('page-held')
  return () => { if (--held === 0) document.body.classList.remove('page-held') }
}

export default function Modal({ title, onClose, children, footer, wide = false, subhead = null, bodyRef = null, bodyClass = '', tall = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(holdPage, [])
  // The keyboard stays in the window while it is open — Tab past the last box
  // walked into the page behind it (the bug hunt, 14 Oct 2026) — and goes back
  // to whatever opened it when it closes.
  const box = useRef(null)
  const [titleId] = useState(() => `modal-t-${Math.random().toString(36).slice(2, 8)}`)
  const [opener] = useState(() => document.activeElement)   // before the children's autofocus
  // Back to the opener only when the window is really gone and nothing else
  // took the focus — not when another window replaced it (the builder's "All
  // fields"), nor on StrictMode's rehearsal of an unmount.
  useEffect(() => {
    const el = box.current
    // The first control of the body takes the focus (S-07) — a box the person
    // types in, else the first button; the close button is the fallback — unless
    // a child already asked for it (autoFocus).
    requestAnimationFrame(() => {
      if (!el?.isConnected || el.contains(document.activeElement)) return
      const first = el.querySelector('.modal-body :is(input, select, textarea):not([disabled]), .modal-body button:not([disabled]), .modal-body [tabindex="0"]') || el.querySelector('button')
      ;(first || el).focus({ preventScroll: true })
    })
    return () => {
      const a = document.activeElement
      if (opener && document.contains(opener) && !el?.isConnected && (!a || a === document.body)) opener.focus?.({ preventScroll: true })
    }
  }, [])
  const trap = (e) => {
    if (e.key !== 'Tab' || !box.current) return
    const stops = [...box.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, audio[controls], video[controls], [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
      // What is inside a shut <details> still has a box in Chrome (content-visibility),
      // so visibility is asked, not measured — else the last stop is one the
      // keyboard can never reach, and Tab walks out of the window after the summary.
      .filter((el) => (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0) && !el.closest('[hidden], [aria-hidden="true"]'))
    if (!stops.length) return
    const first = stops[0], last = stops[stops.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal${wide ? ' modal-wide' : ''}${tall ? ' modal-tall' : ''}`} onMouseDown={(e) => e.stopPropagation()}
        ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trap}>
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn" onClick={onClose} data-tip={tx('Close')} data-tip-left="" aria-label={tx('Close')}>
            <X size={18} />
          </button>
        </div>
        {/* A strip that belongs to the window rather than to the form: it
            stays put while the form scrolls under it. The task sheet uses it
            on a phone to deal one long form into pages. */}
        {subhead && <div className="modal-sub">{subhead}</div>}
        <div className={'modal-body' + (bodyClass ? ' ' + bodyClass : '')} ref={bodyRef}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

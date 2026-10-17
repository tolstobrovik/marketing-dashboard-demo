import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// How a line on a payslip was worked out, opened from the line itself.
//
// "Why is this 1 240 000?" was answered by re-counting on a phone, and the
// board's one tooltip could not help: [data-tip] is CSS hover, switched off on
// every phone — which is where a payslip is read — one line of nowrap text
// that runs off a 375px screen, and it would have been clipped by the pay card
// anyway. So this is its own small thing, and every rule in it is one a phone
// or a keyboard taught somebody the hard way:
//
//  - It is a real button. It takes focus, Enter and Space open it, and it says
//    whether it is open (aria-expanded) and what it opens (aria-controls).
//  - A mouse opens it by resting on it — only where the device has a mouse at
//    all, and only for a real mouse pointer, because a touch screen fakes a
//    hover just before the tap and the tap would then close what the fake
//    hover opened. A finger opens it with the FIRST tap. A click pins what a
//    hover opened instead of closing it.
//  - A press anywhere else closes it: pointerdown AND touchstart, because iOS
//    Safari sends no mousedown for a tap on plain text, and plain text is most
//    of a payslip. Escape closes it too, caught on the way DOWN and stopped
//    there, so the Modal the pay report lives in stays open.
//  - It is drawn into <body>, outside the card's overflow and the modal's
//    scroll box, and kept inside the viewport: under the line, above it when
//    there is no room below, never past either edge.
//
// One open at a time: opening a second closes the first, the way somebody
// reading down a payslip expects.
let closeOther = null

const EDGE = 8
const GAP = 6
const mouseHovers = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: hover)').matches

export default function FormulaTip({ label, children, className = '' }) {
  const id = useId()
  const btn = useRef(null)
  const pop = useRef(null)
  const leaving = useRef(null)
  const byKeys = useRef(false)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState(null)
  const open = pinned || hovered

  // A bubble that goes while it holds the focus hands it back to its line
  // first. Left to itself the focus falls to <body> with the portal, and the
  // next Tab starts from the far end of the page — which is what scrolling
  // the line off the screen, or resting the mouse on another line's label,
  // used to do to somebody reading with the keyboard. Every way it closes
  // comes through here, or through the hover grace below.
  const giveBack = useCallback(() => {
    if (pop.current?.contains(document.activeElement)) btn.current?.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    clearTimeout(leaving.current)
    giveBack()
    setPinned(false); setHovered(false)
  }, [giveBack])

  // Where it goes: measured, not guessed, once it exists and whenever the page
  // moves under it. A line that has scrolled right off the screen has nothing
  // left to point at, and the bubble goes with it.
  const place = useCallback(() => {
    const b = btn.current
    const p = pop.current
    if (!b || !p) return
    const r = b.getBoundingClientRect()
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = window.innerHeight
    if (r.bottom < 0 || r.top > vh) { close(); return }
    const w = p.offsetWidth
    const h = p.offsetHeight
    const left = Math.max(EDGE, Math.min(r.left, vw - w - EDGE))
    const below = r.bottom + GAP
    const above = r.top - GAP - h
    const top = below + h <= vh - EDGE ? below : above >= EDGE ? above : Math.max(EDGE, vh - h - EDGE)
    setPos((was) => (was && was.left === left && was.top === top ? was : { left, top }))
  }, [close])

  useLayoutEffect(() => {
    if (open) place()
    else setPos(null)
  }, [open, place])

  // Opened from the keyboard, the reader goes with it — once, when it first
  // lands, not again every time a scroll moves it. Opened by a finger or a
  // mouse, focus stays where the person put it.
  useEffect(() => {
    if (!open || !pos || !byKeys.current) return
    byKeys.current = false
    pop.current?.focus({ preventScroll: true })
  }, [open, pos])

  useEffect(() => {
    if (!open) return undefined
    if (closeOther && closeOther !== close) closeOther()
    closeOther = close
    const inside = (t) => !!(btn.current?.contains(t) || pop.current?.contains(t))
    const onDown = (e) => { if (!inside(e.target)) close() }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
    }
    let frame = 0
    const onMove = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('touchstart', onDown, { capture: true, passive: true })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      if (closeOther === close) closeOther = null
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('touchstart', onDown, { capture: true })
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, close, place])

  useEffect(() => () => clearTimeout(leaving.current), [])

  const onEnter = (e) => {
    if (e.pointerType !== 'mouse' || !mouseHovers()) return
    clearTimeout(leaving.current)
    setHovered(true)
  }
  // A short grace on the way out, so the pointer can cross the gap into the
  // bubble — somebody may want to select a figure out of it, and a press
  // inside it to do so puts the focus there, which it then hands back.
  const onLeave = (e) => {
    if (e.pointerType !== 'mouse') return
    clearTimeout(leaving.current)
    leaving.current = setTimeout(() => { if (!pinned) giveBack(); setHovered(false) }, 160)
  }
  const onClick = (e) => {
    // The line may sit inside something that answers a press of its own.
    e.stopPropagation()
    byKeys.current = e.detail === 0
    // Pinning or unpinning cancels a grace still running, so the `pinned`
    // that grace read is never out of date by the time it fires.
    if (pinned) close()
    else { clearTimeout(leaving.current); setPinned(true) }
  }
  // Tab out of the bubble lands back on the line it explains, not at the far
  // end of the page where the portal happens to live.
  const onPopKey = (e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    close()
  }

  return (
    <>
      <button ref={btn} type="button" className={'ftip-btn' + (className ? ` ${className}` : '')}
        aria-expanded={open} aria-controls={id}
        onClick={onClick} onPointerEnter={onEnter} onPointerLeave={onLeave}>
        {label}<Info size={12} className="ftip-i" aria-hidden="true" />
        <span className="sr-only"> — {tx('Calculation details')}</span>
      </button>
      {open && createPortal(
        <div ref={pop} id={id} className="ftip" role="dialog" aria-labelledby={`${id}h`} tabIndex={-1}
          style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
          onPointerEnter={onEnter} onPointerLeave={onLeave} onKeyDown={onPopKey}
          onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <b className="ftip-h" id={`${id}h`}>{tx('Calculation details')}</b>
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

// A figure is one word. "10 000" broken after the 10, or "5 000" left on one
// line and its "UZS" on the next, is how a narrow bubble turns a sum into two
// numbers — so the group spaces, and the space before a currency, do not
// break. Strings only; anything else passes through untouched.
const NBSP = '\u00a0'
export const keepFigures = (node) => {
  if (typeof node === 'string') {
    return node.replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NBSP}`).replace(/(\d) (?=[A-Z]{3}\b)/g, `$1${NBSP}`)
  }
  return Array.isArray(node) ? node.map(keepFigures) : node
}

// The four kinds of line a formula is written in. The RULE, in words; the
// working, in figures; a note about something that bent it (a hand edit, an
// arrangement that did not count it); and the result, which is always the
// server's own figure and never one worked out again in the browser — the
// server rounds per piece, and a product recomputed here can be a few units
// out from the payslip it claims to explain.
export const TipLine = ({ children }) => <div className="ftip-line">{keepFigures(children)}</div>
export const TipRow = ({ children }) => <div className="ftip-row">{keepFigures(children)}</div>
export const TipNote = ({ children }) => <div className="ftip-note">{keepFigures(children)}</div>
export const TipSum = ({ children, tone = '' }) => (
  <div className="ftip-sum"><span>=</span><b className={tone}>{keepFigures(children)}</b></div>
)

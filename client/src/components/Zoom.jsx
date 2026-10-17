import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// A picture to look into (the owner, 14 Oct 2026: "if a photo, with zooming").
// The wheel or a pinch zooms where the pointer is, a drag moves it once it is
// bigger, a double click goes between whole and 2.5×, and the buttons (or + − 0)
// do the same without a mouse.
export function PanZoom({ src, alt = '' }) {
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 })
  const box = useRef(null)
  const pts = useRef(new Map())
  const pinch = useRef(0)
  const zoom = (to, cx, cy) => setZ((o) => {
    const s = Math.min(6, Math.max(1, to(o.s)))
    if (s === 1) return { s: 1, x: 0, y: 0 }
    const r = box.current.getBoundingClientRect()
    const px = (cx ?? r.left + r.width / 2) - r.left - r.width / 2, py = (cy ?? r.top + r.height / 2) - r.top - r.height / 2
    const k = s / o.s
    return { s, x: px - (px - o.x) * k, y: py - (py - o.y) * k }
  })
  useEffect(() => {
    const el = box.current
    // not passive: the page behind must not scroll while the picture zooms
    const wheel = (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; zoom((s) => s * f, e.clientX, e.clientY) }
    const keys = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return
      if (e.key === '+' || e.key === '=') zoom((s) => s * 1.25)
      else if (e.key === '-') zoom((s) => s / 1.25)
      else if (e.key === '0') zoom(() => 1)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', keys)
    return () => { el.removeEventListener('wheel', wheel); window.removeEventListener('keydown', keys) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const down = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); pts.current.set(e.pointerId, [e.clientX, e.clientY]) }
  const move = (e) => {
    const was = pts.current.get(e.pointerId)
    if (!was) return
    pts.current.set(e.pointerId, [e.clientX, e.clientY])
    const all = [...pts.current.values()]
    if (all.length === 2) {
      const d = Math.hypot(all[0][0] - all[1][0], all[0][1] - all[1][1])
      const k = pinch.current ? d / pinch.current : 1
      if (pinch.current) zoom((s) => s * k, (all[0][0] + all[1][0]) / 2, (all[0][1] + all[1][1]) / 2)
      pinch.current = d
    } else if (z.s > 1) setZ((o) => ({ ...o, x: o.x + e.clientX - was[0], y: o.y + e.clientY - was[1] }))
  }
  const up = (e) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = 0 }
  return (
    <div className="pz">
      <div className="pz-box" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onMouseDown={(e) => { if (z.s > 1 || e.target.tagName === 'IMG') e.stopPropagation() }}
        onDoubleClick={(e) => { const x = e.clientX, y = e.clientY; zoom((s) => (s > 1 ? 1 : 2.5), x, y) }} style={{ cursor: z.s > 1 ? 'grab' : 'zoom-in' }}>
        <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }} />
      </div>
      <div className="pz-bar" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoom((s) => s / 1.5)} disabled={z.s <= 1} aria-label={tx('Zoom out')}><ZoomOut size={18} aria-hidden="true" /></button>
        <span aria-live="polite">{Math.round(z.s * 100)}%</span>
        <button type="button" onClick={() => zoom((s) => s * 1.5)} disabled={z.s >= 6} aria-label={tx('Zoom in')}><ZoomIn size={18} aria-hidden="true" /></button>
        <button type="button" onClick={() => zoom(() => 1)} disabled={z.s === 1} aria-label={tx('Whole picture')}><Maximize size={16} aria-hidden="true" /></button>
      </div>
    </div>
  )
}

// A screenshot you can actually look at.
//
// Every photo on the board was a plain <img> with no click handler, so the
// reference somebody pasted in stayed the size of a stamp forever. The one
// place that tried — the review shot — wrapped it in <a target="_blank">,
// which for a data: URI opens a blank tab or is blocked outright.
//
// The viewer is portalled to the body on purpose: half of these photos live
// inside a modal whose body scrolls and clips, and an overlay that renders
// inside that box can only ever be as big as the box.
export default function Zoom({ src, full, alt = '', className = '', tip, onError }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    // Capture, so Escape closes the picture rather than the window behind it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!src) return null
  return (
    <>
      <img
        className={`zoomable${className ? ` ${className}` : ''}`}
        src={src} alt={alt} loading="lazy" onError={onError}
        data-tip={tip || tx('Click to see it full size')}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
      />
      {open && createPortal(
        <div className="zoom-back" onMouseDown={() => setOpen(false)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button className="zoom-close" aria-label={tx('Close')} onMouseDown={() => setOpen(false)}>
            <X size={20} />
          </button>
          <PanZoom src={full || src} alt={alt} />
        </div>,
        document.body,
      )}
    </>
  )
}

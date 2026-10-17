import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the heatmap: where people pressed, drawn on the page itself (round 13) ----
// Opened from Admin → Usage with ?heatmap=day:2026-10-14 (or week:…, or a
// number of days back) on any page: every recorded
// press there in those days is a soft dot where it landed, ruby where it hit
// something pressable, amber where it hit nothing (people thought it was a
// button). The page stays usable under it; the bar on top closes it.
export default function HeatmapOverlay() {
  const { user } = useAuth()
  const loc = useLocation()
  const navigate = useNavigate()
  const days = new URLSearchParams(loc.search).get('heatmap')
  const [pts, setPts] = useState(null)
  const [span, setSpan] = useState('')
  const canvas = useRef(null)
  const show = !!days && user?.role === 'admin'
  useEffect(() => {
    if (!show) { setPts(null); return }
    const [k, v] = String(days).includes(':') ? String(days).split(':') : ['days', days]
    api.get(`/track/heat?path=${encodeURIComponent(loc.pathname)}&${k === 'week' ? 'week' : k === 'day' ? 'day' : 'days'}=${encodeURIComponent(v)}`)
      .then((r) => { setPts(r.points || []); setSpan(r.from === r.to ? r.from : `${r.from} – ${r.to}`) }).catch(() => setPts([]))
  }, [show, days, loc.pathname])
  useEffect(() => {
    const c = canvas.current
    if (!c || !pts) return undefined
    const draw = () => {
      const W = document.documentElement.clientWidth
      const H = Math.max(document.documentElement.scrollHeight, window.innerHeight)
      c.width = W; c.height = H
      const g = c.getContext('2d')
      const css = getComputedStyle(document.documentElement)
      const hit = css.getPropertyValue('--ruby').trim() || 'crimson'
      const miss = css.getPropertyValue('--warn-ink').trim() || 'orange'
      g.clearRect(0, 0, W, H)
      g.globalAlpha = 0.16
      // Only presses made at about this width: a phone's taps are on a phone's layout.
      for (const p of pts.filter((q) => !q.w || Math.abs(q.w - W) / W < 0.3)) {
        g.fillStyle = p.d ? miss : hit
        g.beginPath(); g.arc(p.x * W, p.y, p.r ? 22 : 14, 0, Math.PI * 2); g.fill()
      }
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [pts])
  if (!show) return null
  const off = () => navigate(loc.pathname)
  return createPortal(
    <>
      <canvas ref={canvas} className="hm-layer" aria-hidden="true" />
      <div className="hm-bar" role="status">
        <b>{pts == null ? tx('Loading the presses…') : tx('Presses on this page, {when}: {n}', { n: pts.length, when: span })}</b>
        <span className="hm-key"><i className="hm-hit" /> {tx('on a button')} <i className="hm-miss" /> {tx('on nothing pressable')}</span>
        <button type="button" className="icon-btn" onClick={off} aria-label={tx('Close the heatmap')}><X size={18} aria-hidden="true" /></button>
      </div>
    </>,
    document.body,
  )
}

import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import MiniCalendar from './builder/MiniCalendar.jsx'
import { fmtDay, todayISO } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'

// One way to pick a day in the Coach look (S-06).
//
// The browser's own <input type="date"> drew "mm/dd/yyyy" whatever the
// language, opened a grey system popup in the middle of a ruby-and-white
// sheet, and read the day back in a fourth format. This is a button that says
// the day the way every row says it (fmtDay: "Fri 6 Nov" / "пт, 6 нояб." /
// "jum, 6-noy") and opens the builder's five-week card (MiniCalendar) beside
// it. Escape and a click outside close it; the keyboard comes back to the
// button. The card is fixed to the viewport, so a panel that hides its
// overflow (the board's question panel) cannot cut it.
//
//   value      YYYY-MM-DD or ''
//   min        the first day that may be picked (today by default)
//   film       the shoot day, dotted on the card
//   label      what the day is for — the button's name for a screen reader
//   placeholder the words on an empty button ("Pick a day")
const W = 320
export default function DayPick({ value = '', onChange, min = '', film = '', label = '', placeholder = '', disabled = false, id, className = '' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const wrap = useRef(null)
  const btn = useRef(null)
  const today = todayISO()
  const show = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom
    const top = below < 380 && r.top > 380 ? Math.max(12, r.top - 6 - 372) : r.bottom + 6
    setPos({ top, left: Math.max(12, Math.min(r.left, window.innerWidth - W - 12)) })
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus() } }
    const move = () => setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', move)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', move)
    }
  }, [open])
  const said = value ? fmtDay(value) : (placeholder || tx('Pick a day'))
  return (
    <span className={'co-dp' + (className ? ` ${className}` : '')} ref={wrap}>
      <button ref={btn} id={id} type="button" className={'co-dp-b' + (value ? '' : ' empty')} disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-label={label ? `${label}: ${value ? fmtDay(value) : tx('No day yet')}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}>
        <CalendarDays size={16} aria-hidden="true" /><span>{said}</span>
      </button>
      {open && (
        <div className="co-dp-pop" role="dialog" aria-label={label || tx('Pick a day')} style={{ top: pos.top, left: pos.left, width: W }}>
          <MiniCalendar value={value} today={today} min={min} film={film} label={label || tx('Pick a day')}
            onChange={(d) => { onChange(d); setOpen(false); btn.current?.focus() }} />
        </div>
      )}
    </span>
  )
}

// A time on the half hour (S-06): the grid a shoot is booked on (snapHalfHour
// in lib/constants.js), as one list from `from` to `to` o'clock, in place of
// the browser's own time box, which read "--:-- --" in every language. A
// value off the grid (typed before this existed) stays in the list.
export function TimePick({ value = '', onChange, label, disabled = false, id, from = 6, to = 23.5, className = '' }) {
  const opts = []
  for (let m = from * 60; m <= to * 60; m += 30) opts.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  const v = value ? String(value).slice(0, 5) : ''
  if (v && !opts.includes(v)) { opts.push(v); opts.sort() }
  return (
    <select id={id} className={'select co-tp' + (className ? ` ${className}` : '')} value={v} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {opts.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}

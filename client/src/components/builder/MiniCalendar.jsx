import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDaysISO, monthName } from '../../lib/constants.js'
import { tr as tx, lang } from '../../lib/i18n.jsx'

// Five weeks on one card, starting with this one: press a day and it is the
// day. It replaces four pills and the browser's own date picker, which opened
// as a grey system popup in the middle of a ruby-and-white sheet and looked
// like a different program.
//
// Five weeks rather than a month, because a month card on the 25th is four
// rows of days already gone; this one always opens on days that can be
// picked, and the next month's first day wears its name.
//
//   ruby disc   the day picked
//   ruby ring   today
//   dot         the shoot day, when there is one — so the two days are seen
//               together instead of one of them on another screen
//   faded       gone by; cannot be picked
//
// Weeks start on Monday, the way this team's week does. Arrow keys walk the
// days, Page Up / Page Down five weeks at a time, Enter picks.

const WEEKS = 5
// Shared with the Master Calendar's weekday heads (ContentCalendar), so the
// two grids a planner meets in one sitting name the days the same way.
export const WEEKDAYS = {
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  uz: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
}
const mondayOf = (iso) => addDaysISO(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))
const ymd = (iso) => iso.split('-').map(Number)

// `min`: the first day that may be picked — a release never before its shoot.
export default function MiniCalendar({ value, onChange, today, film = '', label, min = '' }) {
  const first = mondayOf(today)
  const [start, setStart] = useState(() => (value && value > today ? mondayOf(value) : first))
  // The day the keyboard is on; walking off the card turns the page.
  const [focus, setFocus] = useState(value || today)
  const grid = useRef(null)
  const keyed = useRef(false)
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDaysISO(start, i))
  const last = days[days.length - 1]
  useEffect(() => {
    if (value && (value < start || value > last)) setStart(value > today ? mondayOf(value) : first)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!keyed.current) return
    keyed.current = false
    grid.current?.querySelector(`[data-day="${focus}"]`)?.focus()
  }, [focus, start])

  const page = (n) => {
    const next = addDaysISO(start, n * 7)
    setStart(next < first ? first : next)
  }
  const floor = min && min > today ? min : today   // the first day that may be picked
  const move = (iso) => {
    if (iso < floor) return
    keyed.current = true
    setFocus(iso)
    if (iso < start) setStart(mondayOf(iso) < first ? first : mondayOf(iso))
    else if (iso > last) setStart(addDaysISO(mondayOf(iso), -(WEEKS - 1) * 7))
  }
  const onKey = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -7 * WEEKS, PageDown: 7 * WEEKS }[e.key]
    if (step) { e.preventDefault(); move(addDaysISO(focus, step)) }
  }
  // One day is in the tab order: the keyboard's, else the picked one, else today.
  const tabDay = [focus, value, floor].find((d) => d && d >= start && d <= last && d >= floor) || days.find((d) => d >= floor)

  // "September – October 2026": the months the card actually shows.
  const [y1, m1] = ymd(days[0] < today ? today : days[0])
  const [y2, m2] = ymd(last)
  const head = y1 === y2 && m1 === m2
    ? `${monthName(y1, m1)} ${y1}`
    : `${monthName(y1, m1)}${y1 !== y2 ? ` ${y1}` : ''} – ${monthName(y2, m2)} ${y2}`

  return (
    <div className="mc" role="group" aria-label={label}>
      <div className="mc-head">
        <button type="button" className="mc-nav" onClick={() => page(-WEEKS)} disabled={start <= first} aria-label={tx('Previous month')}>
          <ChevronLeft size={16} />
        </button>
        <b className="mc-month" aria-live="polite">{head}</b>
        <button type="button" className="mc-nav" onClick={() => page(WEEKS)} aria-label={tx('Next month')}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="mc-grid" ref={grid} onKeyDown={onKey}>
        {(WEEKDAYS[lang()] || WEEKDAYS.en).map((w) => <span key={w} className="mc-wd" aria-hidden="true">{w}</span>)}
        {days.map((iso) => {
          const gone = iso < floor
          const on = iso === value
          const [y, m, d] = ymd(iso)
          const cls = 'mc-day'
            + (gone ? ' gone' : '')
            + (iso === today ? ' today' : '')
            + (on ? ' on' : '')
            + (iso === film ? ' film' : '')
          return (
            <button key={iso} type="button" className={cls} data-day={iso} disabled={gone}
              tabIndex={iso === tabDay ? 0 : -1} aria-pressed={on}
              aria-label={iso === film ? `${iso} · ${tx('Shoot day')}` : iso}
              onFocus={() => setFocus(iso)}
              onClick={() => onChange(on ? '' : iso)}>
              {d === 1 && <span className="mc-mo">{monthName(y, m, 'short')}</span>}
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

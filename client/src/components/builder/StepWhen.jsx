import { useEffect, useRef } from 'react'
import { CalendarHeart, UserRound } from 'lucide-react'
import { addDaysISO, longDayLabel, dateLabel } from '../../lib/constants.js'
import { tr as tx } from '../../lib/i18n.jsx'
import FacePicker from './FacePicker.jsx'
import MiniCalendar from './MiniCalendar.jsx'

// When does it go out? One month on a card — press a day. Optional: an idea
// with no day is still an idea worth writing down. The shoot day, when there
// is one, is marked on the same card so the two are seen together. Who films,
// edits and designs it are steps of their own, asked only of the kinds that
// are filmed or designed.
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)

export default function StepWhen({ today, release, onRelease, filming, owners, owner, onOwner, quick = [] }) {
  const box = useRef(null)
  useEffect(() => {
    box.current?.querySelector('.mc-day.on, .mc-day.today')?.focus()
  }, [])
  const away = release ? daysBetween(today, release) : null
  const when = away === null ? '' : away === 0 ? tx('Today') : away === 1 ? tx('Tomorrow') : away > 1 ? tx('in {n} days', { n: away }) : ''
  return (
    <div className="tb-q" ref={box}>
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><CalendarHeart size={18} /></span>{tx('When should it go out?')}</h2>
      {/* How far ahead this kind of work is usually given — a Telegram post
          two days, a paid ad three, a reel about a week — as one press each. */}
      {quick.length > 0 && (
        <div className="tb-pills tb-quick" role="group" aria-label={tx('When should it go out?')}>
          {quick.map((n) => {
            const day = addDaysISO(today, n)
            const rel = n === 0 ? tx('Today') : n === 1 ? tx('Tomorrow') : tx('in {n} days', { n })
            return (
              <button key={n} type="button" className={'tb-pill' + (release === day ? ' on' : '')} aria-pressed={release === day} disabled={!!filming && day < filming}
                onClick={() => onRelease(day)}>
                {rel.charAt(0).toUpperCase() + rel.slice(1)}
                {n > 1 && <span className="tb-quick-day">· {dateLabel(day)}</span>}
              </button>
            )
          })}
        </div>
      )}
      <MiniCalendar value={release} onChange={onRelease} today={today} film={filming} min={filming || ''} label={tx('When should it go out?')} />
      <p className="tb-date-say" aria-live="polite">
        {release ? (
          <>
            <b>{longDayLabel(release)}</b>
            {when && <span className="tb-date-away"> · {when}</span>}
            <button type="button" className="tb-link tb-date-clear" onClick={() => onRelease('')}>{tx('Clear')}</button>
          </>
        ) : tx('No day yet — that is fine for an idea.')}
      </p>
      {owners && (
        <FacePicker label={tx('Whose task is it?')} Icon={UserRound} people={owners}
          value={owner} onChange={onOwner} required />
      )}
    </div>
  )
}

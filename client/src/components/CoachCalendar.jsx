import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, Send, Check } from 'lucide-react'
import { Badge, firstName, dayShort, weekdayShort, lateWords } from './CoachParts.jsx'
import { monthName } from '../lib/constants.js'
import { dayEvents, monthCells, weekCells, addDays, daysBetween } from '../lib/coach.js'
import { usePieceColors, colorStyle } from '../lib/pieceColor.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the maker's calendar -----------------------------------------------------------
//
// "For the content makers, make them the calendar": a screen of its own, one
// press from My Day, with the maker's shoots and releases TOGETHER on one
// grid. The board's other calendars each show one kind of day — releases on
// the Master Calendar, shoots on Recordings, and every channel's at once; a
// maker planning their own month had to hold two pages in their head. This is
// only their pieces, both kinds of day, in two colours:
//
//   blue    a shoot, on the day it is filmed
//   green   a release, on the day the piece goes out (struck through once it is out)
//   ruby    a release day that passed without the piece going out
//
// A day is pressed to list it at the side; a piece in that list opens the
// task window. Month and Week are the same days at two sizes — the week has
// room to say who films.
//
// It reads and never writes: a day is moved in the task itself, where the
// server's rules about days are asked. What falls on which day is dayEvents
// in lib/coach.js, the same reading the week strip on My Day uses.

export function Legend({ miss = false }) {
  return (
    <span className="co-legend">
      <span><i className="co-l-shoot" />{tx('Shoot')}</span>
      <span><i className="co-l-rel" />{tx('Release')}</span>
      {miss && <span><i className="co-l-miss" />{tx('Missed its day')}</span>}
    </span>
  )
}

// One day's shoots and releases, as rows that open the piece.
export function EventList({ events, today, byKey, nameOf, onOpen }) {
  const colorOf = usePieceColors()
  return (
    <div className="co-evs">
      {events.map((e) => {
        const { t } = e
        const chans = (t.channels || []).map((c) => byKey[c]?.label || c).join(', ')
        const who = nameOf(t.operator_id)
        const sub = e.k === 'shoot' ? [tx('Shoot'), e.time && `${e.time.slice(0, 5)}${t.recording_end ? `–${t.recording_end.slice(0, 5)}` : ''}`, who && tx('{name} films it', { name: who })].filter(Boolean).join(' · ')
          : e.k === 'out' ? `${tx('Went out')} · ${chans}`
            : e.k === 'miss' ? `${tx('Did not go out')} · ${lateWords(daysBetween(e.day, today))}`
              : `${tx('Goes out')} · ${chans}`
        const Icon = e.k === 'shoot' ? Clapperboard : e.k === 'out' ? Check : Send
        return (
          <button key={`${e.k}${t.id}`} type="button" className="co-ev" onClick={() => onOpen(t)}>
            <span className={`co-kic ${e.k === 'shoot' ? 'co-k-shoot' : e.k === 'miss' ? 'co-k-late' : 'co-k-good'}`} aria-hidden="true"><Icon size={18} /></span>
            <span className="co-row-b"><span className="co-row-t">{colorOf(t) != null && <i className="pc-dot" style={colorStyle(colorOf(t))} aria-hidden="true" />}{t.title}</span><span className="co-row-f">{sub}</span></span>
            {e.k === 'shoot' && e.filmed && <Badge tone="good" icon="check">{tx('It is filmed')}</Badge>}
          </button>
        )
      })}
    </div>
  )
}

// dayEvents for a day, each carrying the day it is on (a missed release says
// how late it is).
export const eventsOn = (pieces, day, today, pipe) => dayEvents(pieces, day, today, pipe).map((e) => ({ ...e, day }))

export default function CoachCalendar({ pieces, user, today, byKey, pipe, team, onOpen }) {
  const [mode, setMode] = useState('month')
  const [sel, setSel] = useState(today)
  const [month, setMonth] = useState(today.slice(0, 7))
  const side = useRef(null)
  const nameOf = (id) => firstName(team.find((u) => u.id === id))
  const colorOf = usePieceColors()
  const week = mode === 'week'
  const days = week ? weekCells(sel) : monthCells(month)

  const move = (n) => {
    if (week) {
      const to = addDays(sel, 7 * n)
      setSel(to); setMonth(to.slice(0, 7))
      return
    }
    const d = new Date(`${month}-01T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + n)
    setMonth(d.toISOString().slice(0, 7))
  }
  // On a narrow page the day's list sits under the grid: a pressed day brings
  // it into view, so the press is seen to have done something.
  const pick = (iso) => {
    setSel(iso)
    if (!week && iso.slice(0, 7) !== month) setMonth(iso.slice(0, 7))
    requestAnimationFrame(() => side.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const toToday = () => { setSel(today); setMonth(today.slice(0, 7)) }
  const title = week ? `${dayShort(days[0])} – ${dayShort(days[6])}`
    : `${monthName(Number(month.slice(0, 4)), Number(month.slice(5, 7)))} ${month.slice(0, 4)}`
  const away = week ? !days.includes(today) : month !== today.slice(0, 7)

  const pill = (e) => (
    <span key={`${e.k}${e.t.id}`} className={`co-pill co-p-${e.k}`}>
      {colorOf(e.t) != null && <i className="pc-dot" style={colorStyle(colorOf(e.t))} aria-hidden="true" />}{e.time ? <b>{e.time.slice(0, 5)} </b> : null}{e.t.title}
      {week && e.k === 'shoot' && nameOf(e.t.operator_id) ? <><br />{tx('{name} films it', { name: nameOf(e.t.operator_id) })}</> : null}
    </span>
  )
  const selEvents = eventsOn(pieces, sel, today, pipe)

  return (
    <>
      <div className="co-cal-box"><div className="co-cal">
        <section className="co-card">
          <div className="co-cal-h">
            <h2>{title}</h2>
            <Legend miss />
            <span className="co-cal-nav">
              <button type="button" className="co-nav" onClick={() => move(-1)} aria-label={week ? tx('The week before') : tx('Previous month')}><ChevronLeft size={18} aria-hidden="true" /></button>
              <button type="button" className="co-nav" onClick={() => move(1)} aria-label={week ? tx('The week after') : tx('Next month')}><ChevronRight size={18} aria-hidden="true" /></button>
              {away && <button type="button" className="co-link" onClick={toToday}>{tx('Today')}</button>}
            </span>
            <span className="co-switch" role="group" aria-label={tx('How much to show')}>
              <button type="button" aria-pressed={!week} onClick={() => setMode('month')}>{tx('Month')}</button>
              <button type="button" aria-pressed={week} onClick={() => setMode('week')}>{tx('Week')}</button>
            </span>
          </div>
          <div className={`co-wk ${mode}`} aria-hidden="true">
            {weekCells('2024-01-01').map((d) => <span key={d}>{weekdayShort(d)}</span>)}
          </div>
          <div className={`co-grid ${mode}`}>
            {days.map((d, i) => {
              const ev = eventsOn(pieces, d, today, pipe)
              const max = week ? 99 : 3
              const other = !week && d.slice(0, 7) !== month
              return (
                <button key={d} type="button" className={'co-cell' + (other ? ' other' : '') + (d === today ? ' today' : '')}
                  aria-pressed={d === sel} onClick={() => pick(d)}
                  aria-label={tx('{day}: {n} planned', { day: dayShort(d), n: ev.length })}>
                  <span className="co-cn">
                    <b>{Number(d.slice(8))}</b>
                    {week ? weekdayShort(d) : (d.slice(8) === '01' || i === 0) ? monthName(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 'short') : ''}
                  </span>
                  {ev.slice(0, max).map(pill)}
                  {ev.length > max && <span className="co-more">{tx('+{n} more', { n: ev.length - max })}</span>}
                </button>
              )
            })}
          </div>
        </section>
        <aside className="co-card co-side" ref={side} aria-label={tx('The chosen day')}>
          <h2>{sel === today ? `${tx('Today')} · ` : ''}{dayShort(sel)}</h2>
          <p>{tx('Press a piece to open it.')}</p>
          {selEvents.length > 0
            ? <EventList events={selEvents} today={today} byKey={byKey} nameOf={nameOf} onOpen={onOpen} />
            : <p className="co-quiet">{tx('Nothing is planned for this day. When you plan a shoot or a release, it shows up here.')}</p>}
        </aside>
      </div></div>
    </>
  )
}

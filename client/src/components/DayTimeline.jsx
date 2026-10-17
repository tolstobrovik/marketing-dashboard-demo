import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Check, AlertCircle } from 'lucide-react'
import { api } from '../lib/api.js'
import { addDaysISO, longDayLabel, noteServerClock, serverNow } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- one person's day, as a strip -------------------------------------------
//
// The week grid (Timetable) answers "when this week?". Assigning somebody
// asks a smaller question — "is this person free that day, and when?" — so
// this is one day, drawn left to right in half-hour cells, and it reads at a
// glance:
//
//   clear     free — press it to book from there (snaps to the half hour)
//   grey      taken — a shoot already booked
//   striped   studying — their repeating week
//   faint     outside their hours, or already past (Tashkent time)
//   ruby      the time being booked right now
//
// Overlapping a booking is allowed and said out loud, not blocked: the
// server answers with a double-booking warning an admin can override. So a
// taken half-hour can still be pressed while booking — the block over it lets
// the press through to its cell — and so can a day they do not work.
// It reads the same /users/:id/slots the week grid reads, so the two cannot
// disagree about who is busy.
//
// "Past" is the SERVER's past. The answer carries the team's clock and the
// page keeps the difference (noteServerClock in lib/constants.js), so a phone
// set a few minutes out, or to another zone, greys the same half-hours the
// server stops offering. A half-hour is past once it has ENDED — the one under
// way can still be booked, on both sides. The strip re-reads the clock twice a
// minute, so one left open on the crew's page greys the morning as it goes.

const STEP = 30
const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5))
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hhmmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
const TICK = 30 * 1000
const LENGTHS = [30, 60, 120, 180]
// The latest a shoot can end: a time box cannot hold "24:00".
const END_CAP = 23 * 60 + 59
// The lengths are words too: "1h" is English, and the strip is read in three
// languages.
const lenLabel = (m) => (m < 60 ? tx('{n}m', { n: m }) : tx('{n}h', { n: m / 60 }))

export default function DayTimeline({
  userId, day, onDay, excludeId, value, onPick, onClear, readOnly = false, done = [], title, showDue = false, showUntimed = false, stamp = '',
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setTick((n) => n + 1) }, TICK)
    // A phone that was asleep comes back to the time it is now, at once.
    const wake = () => setTick((n) => n + 1)
    document.addEventListener('visibilitychange', wake)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', wake) }
  }, [])
  const now = serverNow()
  const today = dayFmt.format(now)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  // The length of a booking already made, if it is one the strip offers. A
  // 45-minute shoot typed in by hand used to become the length of the next
  // pick as well, so the half-hour strip wrote 14:00–14:45 itself.
  const [mins, setMins] = useState(() => {
    const had = value?.from && value?.to ? toMin(value.to) - toMin(value.from) : 0
    return LENGTHS.includes(had) ? had : 120
  })
  useEffect(() => {
    if (!userId || !day) { setData(null); return }
    let alive = true
    setErr('')
    api.get(`/users/${userId}/slots?from=${day}&days=1&mins=${STEP}${excludeId ? `&exclude=${excludeId}` : ''}`)
      .then((d) => {
        if (d?.now?.at) noteServerClock(d.now.at)
        if (alive) setData(d)
      })
      .catch((e) => { if (alive) setErr(e.message) })
    return () => { alive = false }
    // `stamp` is the caller's word that the bookings changed under it — the
    // crew's page re-reads the board every few seconds, and a shoot moved or
    // killed must not stay drawn where it was until somebody reloads.
  }, [userId, day, excludeId, stamp])

  const cal = data?.calendar?.[0]
  const hours = data?.hours
  const openAt = hours ? toMin(hours.from) : 9 * 60
  const shutAt = hours ? toMin(hours.to) : 18 * 60
  const busy = cal?.busy || []
  const study = cal?.study || []
  const due = cal?.due || []
  const untimed = cal?.untimed || []
  // The strip runs from an hour before their day to an hour after it, and
  // always far enough to show every block that is actually in it.
  const { lo, hi } = useMemo(() => {
    let a = Math.min(8 * 60, openAt - 60)
    let b = Math.max(20 * 60, shutAt + 60)
    for (const x of [...busy, ...study, ...(value?.from ? [value] : [])]) { a = Math.min(a, toMin(x.from)); b = Math.max(b, toMin(x.to || x.from) + STEP) }
    return { lo: Math.max(0, Math.floor(a / 60) * 60), hi: Math.min(24 * 60, Math.ceil(b / 60) * 60) }
  }, [openAt, shutAt, busy, study, value])
  const cells = []
  for (let t = lo; t < hi; t += STEP) cells.push(t)
  const pct = (m) => `${((m - lo) / (hi - lo)) * 100}%`
  const nowMin = day === today ? toMin(hhmmFmt.format(now)) : day < today ? 24 * 60 : -1
  const working = cal ? cal.working : true
  const busyAt = (t) => busy.find((b) => t < toMin(b.to) && toMin(b.from) < t + STEP)
  // Bookings in the same hours — an admin can book over one on purpose — are
  // drawn one above the other rather than one ON the other, where the second
  // simply vanished and the operator saw one shoot instead of two. Each takes
  // the first row nothing it overlaps is already in, and the rows share the
  // block's height between them.
  const overlaps = (a, b) => toMin(a.from) < toMin(b.to) && toMin(b.from) < toMin(a.to)
  const lanes = []
  busy.forEach((b, i) => {
    let l = 0
    while (busy.some((o, j) => j < i && lanes[j] === l && overlaps(b, o))) l++
    lanes[i] = l
  })
  const rows = busy.length ? Math.max(...lanes) + 1 : 1
  const offAt = (t) => !working || t < openAt || t >= shutAt
  const pick = (t) => {
    if (readOnly || !onPick) return
    if (t >= END_CAP) return
    onPick({ from: toHHMM(t), to: toHHMM(Math.min(END_CAP, t + mins)) })
  }
  const clash = value?.from && busy.find((b) => toMin(value.from) < toMin(b.to) && toMin(b.from) < toMin(value.to || value.from))

  // On a phone the strip is wider than the screen and scrolls sideways — so
  // it opens on the part that matters: the time being booked, else now, else
  // the start of their day. Nobody should have to swipe to find the evening.
  const scroller = useRef(null)
  const focusMin = value?.from ? toMin(value.from) : nowMin > lo && nowMin < hi ? nowMin : openAt
  useEffect(() => {
    const el = scroller.current
    if (!el || !data || el.scrollWidth <= el.clientWidth) return
    const x = ((focusMin - lo) / (hi - lo)) * el.scrollWidth
    el.scrollLeft = Math.max(0, x - el.clientWidth / 3)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps -- once per day loaded; a tap must not move the strip under the finger

  return (
    <div className={'dt' + (readOnly ? ' dt-ro' : '')}>
      <div className="dt-head">
        {onDay && title && <b className="dt-title">{title}</b>}
        {onDay ? (
          <span className="dt-day">
            <button type="button" className="icon-btn" aria-label={tx('Previous day')} onClick={() => onDay(addDaysISO(day, -1))}
              disabled={day <= today}><ChevronLeft size={15} /></button>
            <b>{longDayLabel(day)}</b>
            <button type="button" className="icon-btn" aria-label={tx('Next day')} onClick={() => onDay(addDaysISO(day, 1))}><ChevronRight size={15} /></button>
          </span>
        ) : <b className="dt-title">{title || longDayLabel(day)}</b>}
        {!readOnly && (
          <span className="dt-len" role="group" aria-label={tx('How long')}>
            {LENGTHS.map((m) => (
              <button key={m} type="button" className={'dt-len-btn' + (m === mins ? ' on' : '')} aria-pressed={m === mins}
                onClick={() => {
                  setMins(m)
                  if (!value?.from) return
                  // From the half-hour the booking starts in, so a length
                  // pressed on an older 10:15 lands on the grid too.
                  const f = Math.floor(toMin(value.from) / STEP) * STEP
                  onPick({ from: toHHMM(f), to: toHHMM(Math.min(END_CAP, f + m)) })
                }}>
                {lenLabel(m)}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="dt-scroll" ref={scroller}>
        <div className="dt-track" style={{ '--dt-cells': cells.length }}>
          <div className="dt-hours" aria-hidden="true">
            {cells.filter((t) => t % 120 === 0).map((t) => (
              <span key={t} style={{ left: pct(t) }}>{toHHMM(t).slice(0, 2)}</span>
            ))}
          </div>
          <div className="dt-cells">
            {cells.map((t) => {
              const past = t + STEP <= nowMin
              const off = offAt(t)
              // The block over a taken cell lets presses through (see the
              // stylesheet), so the cell says what is booked in it.
              const over = busyAt(t)
              const said = over ? `${toHHMM(t)} · ${over.title || tx('taken')}` : toHHMM(t)
              return (
                <button key={t} type="button" className={'dt-cell' + (off ? ' off' : '') + (past ? ' past' : '')}
                  disabled={readOnly || past} aria-label={said} title={said}
                  onClick={() => pick(t)} />
              )
            })}
          </div>
          {study.map((b, i) => (
            <span key={`s${i}`} className="dt-block dt-study" style={{ left: pct(toMin(b.from)), width: `calc(${pct(toMin(b.to))} - ${pct(toMin(b.from))})` }}
              title={`${b.label || tx('studying')} · ${b.from}–${b.to}`} />
          ))}
          {busy.map((b, i) => {
            const isDone = !!b.done || (!!b.id && done.includes(b.id))
            const said = `${b.title || tx('taken')} · ${b.from}–${b.to}${isDone ? ` · ${tx('Completed')}` : ''}`
            return (
              <span key={`b${i}`} className={'dt-block dt-busy' + (isDone ? ' done' : '') + (toMin(b.to) <= nowMin ? ' past' : '')
                + (rows > 1 ? ' split' : '')}
                style={{
                  left: pct(toMin(b.from)), width: `calc(${pct(toMin(b.to))} - ${pct(toMin(b.from))})`,
                  ...(rows > 1 ? { top: `calc(20px + ${lanes[i]} * 32px / ${rows})`, height: `calc(32px / ${rows} - 1px)` } : {}),
                }}
                title={said}>
                {isDone && <Check size={11} strokeWidth={3} />}<em>{b.title || tx('taken')}</em>
                {isDone && <span className="dt-sr"> · {tx('Completed')}</span>}
              </span>
            )
          })}
          {value?.from && (
            <span className="dt-block dt-pick" style={{ left: pct(toMin(value.from)), width: `calc(${pct(toMin(value.to || toHHMM(toMin(value.from) + mins)))} - ${pct(toMin(value.from))})` }}>
              <em>{value.from}–{value.to}</em>
            </span>
          )}
          {nowMin > lo && nowMin < hi && <span className="dt-now" style={{ left: pct(nowMin) }} aria-hidden="true" />}
        </div>
      </div>

      {err && <div className="form-error">{err}</div>}
      {cal && !working && <p className="dt-say">{tx('{name} does not work this day.', { name: data.user.name.split(' ')[0] })}</p>}
      {/* Their shoots that day with no hour yet — not a time to plan around,
          but not a clear day either. (The crew's own page has its own pool.) */}
      {showUntimed && untimed.length > 0 && (
        <div className="dt-due">
          <span className="cd-unscheduled-label">{day === today ? tx('Unscheduled today') : tx('No time set that day')}</span>
          {untimed.map((b, i) => <span key={b.id ?? `u${i}`} className="dt-due-item"><span className="cd-unscheduled-title">{b.title || tx('taken')}</span></span>)}
        </div>
      )}
      {/* What they owe that day with no hour on it — an editor's cuts. */}
      {showDue && due.length > 0 && (
        <div className="dt-due">
          <span className="cd-unscheduled-label">{tx('Edits due this day')}</span>
          {due.map((c, i) => <span key={c.id ?? `d${i}`} className="dt-due-item"><span className="cd-unscheduled-title">{c.title || tx('taken')}</span></span>)}
        </div>
      )}
      {value?.from && (
        <p className={'dt-say' + (clash ? ' warn' : '')}>
          {clash
            ? <><AlertCircle size={13} /> {tx('Overlaps «{title}» {from}–{to}', { title: clash.title || tx('taken'), from: clash.from, to: clash.to })}</>
            : <>{value.from}–{value.to}</>}
          {onClear && <button type="button" className="tb-link" onClick={onClear}>{tx('Clear')}</button>}
        </p>
      )}
    </div>
  )
}

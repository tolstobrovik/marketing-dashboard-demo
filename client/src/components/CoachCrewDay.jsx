import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Upload } from 'lucide-react'
import {
  KIND, CrewBadge, Empty, WhatsNew, KindMark, ownOf,
  firstName, dayInLine, dayShort, hoursOf,
} from './CoachParts.jsx'
import { Capsule, tracks, Frame, DayChip } from './CoachBits.jsx'
import HandIn from './HandIn.jsx'
import { api } from '../lib/api.js'
import { longDayLabel, typeLabel, serverNow } from '../lib/constants.js'
import { ownersOf } from '../lib/coach.js'
import { toast } from '../lib/toast.js'
import { usePieceColors, colorStyle } from '../lib/pieceColor.js'
import { tr as tx } from '../lib/i18n.jsx'
import { isCarried, carriedFrom, monthLongOf } from '../lib/planMonth.js'

// ---- the crew's day, the Coach way -------------------------------------------------
//
// From the top:
//
//   the headline      "{name}, start here."
//   Now               (round 14, the owner's pick: Jobber) the first task that
//                     can be done, lifted out of the list: what it is, why it is
//                     first, and — when it can be handed in now — the Drive drop
//                     box and Send, on the card itself. A shoot in its hours is
//                     Now. Beside it, one height, the square: today's shoots for
//                     whoever films, today's edits for an editor; a row of it
//                     pressed is brought into Now
//   the bands         (round 14, the owner's pick: Microsoft Planner) Overdue,
//                     Today and Coming up side by side, three rows each and
//                     "N more"; a row is the mark of its work, the title and
//                     one badge. A booking question is answered on its row
//   Waiting for others  below the bands, open, with its count: what is theirs
//                     but cannot be started — no footage yet, not sent on by
//                     its maker, a booking they said no to — each row naming
//                     whom it waits for. It folds; it does not start folded
//                     (13 Oct: an editor with only such work saw one shut line).
//                     Done today is a fold under it, shut
//
// Round 9 (the owner, on the live page: "too complex — simplify everything"):
// nothing is said twice. A long band showed five rows and the rest on request;
// round 14 (the Planner pick) makes it three in every band, with its count
// (CUT). What waits for somebody else is always all on screen.
//
// Round 11 ("the hard parts that will be misunderstood by the team"): an
// editor's "Overdue 41" was mostly work nobody could start, so the bands hold
// only what the person can do and the rest is "Waiting for others" — still
// counted, still saying how late, because a piece parked out of sight is
// worse than a false alarm. The strip of hours (round 8's "day as a line")
// is the square beside Now since round 14: today's shoots in order, by the hour.
//
// Which task is first and which band a row is in are not decided here: that
// is crewDay in lib/coach.js, pinned by qa/coach-suite.mjs. This draws it.
//
// A row has no button. Pressing it opens the task (components/CoachTask.jsx),
// and the task's last step is the one button — so there is one place where
// work is handed in, and it is the place that says what happens next. The big
// card's own button does the real thing only where nothing can be missing: a
// yes to "can you make it?". Everything else it opens.
//
// Nothing is taken away: the month calendar is a page in the menu on the left.

const BANDS = [
  { key: 'late', label: () => tx('Overdue'), none: () => tx('Nothing is late.') },
  { key: 'today', label: () => tx('Today'), none: () => tx('Nothing for today.') },
  { key: 'soon', label: () => tx('Coming up'), none: () => tx('Nothing planned yet.') },
  { key: 'done', label: () => tx('Done today'), none: () => '' },
]
// Three rows a band and the rest one press away (the owner's Planner pick, 15 Oct 2026).
const CUT = 3

const hh = (t) => String(t || '').slice(0, 5)
const minutesOf = (t) => (t ? Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5)) : null)
// The team's clock, like every "today" on the board.
const clockHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(serverNow())
const inWords = (m) => (m < 60 ? tx('{n} min', { n: m }) : m % 60 ? tx('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 }) : tx('{h} h', { h: m / 60 }))

export default function CoachCrewDay({
  model, entries, user, today, byKey, pipe, team, making = null, onOpen, onChanged, calendar = null, more = null, onClassic = null,
}) {
  const [busy, setBusy] = useState(false)
  const colorOf = usePieceColors()
  const [pick, setPick] = useState(null)     // a row of the square brought into Now
  const [openAll, setOpenAll] = useState({})   // a band opened past its three rows
  // Now and "in 40 min" follow the clock.
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(id) }, [])
  const name = user.name.split(' ')[0]
  const person = (id) => team.find((u) => u.id === id) || null
  // Who the work is for: whoever runs the piece.
  const forWhom = (t) => person(ownersOf(t)[0])
  const waiting = (t) => firstName(forWhom(t)) || tx('The team')

  const { rows, first, held } = model
  const open = (r, focus = null) => onOpen(r.t, { prefer: r.kind, focus })

  // The one line of facts under a title: what kind of work, for whom, when.
  const whenOf = (r) => {
    const hours = r.kind === 'shoot' ? hoursOf(r.t) : ''
    if (!r.due) return ''
    // A change sent back: its day is the next one the piece is promised for.
    if (r.state === 'fix') return tx('due {day}', { day: dayInLine(r.due, today) })
    if (r.late) return tx('was due {day}', { day: dayShort(r.due) })
    if (r.kind === 'shoot') return `${dayInLine(r.due, today)}${hours ? `, ${hours}` : ''}`
    return tx('due {day}', { day: dayInLine(r.due, today) })
  }
  // Round 9: nothing is said twice. The tile is the kind of work and the badge
  // is the day, how late, or what it waits on — so the line is for whom, plus
  // the day only where the badge is busy saying something else.
  // A booking question says what Yes and No answer: "Can you? today, 15:30".
  const factOf = (r) => [
    r.state === 'ask' && [tx('Can you?'), whenOf(r)].filter(Boolean).join(' '),
    firstName(forWhom(r.t)) && tx('for {name}', { name: firstName(forWhom(r.t)) }),
    r.state === 'fix' && whenOf(r),
  ].filter(Boolean).join(' · ')
  // Round 11: what a person cannot start is not theirs to be late on. Whom it
  // waits for comes after a colon — a name inside a clause would need a case
  // in Russian and in Uzbek.
  const waits = (r) => ['blocked', 'early', 'declined'].includes(r.state)
  const waitsFor = (r) => (r.state === 'blocked' ? tx('Waits for the footage: {name}', { name: firstName(person(r.t.operator_id)) || tx('nobody yet') })
    : r.state === 'early' ? tx('Not sent to you yet: {name}', { name: waiting(r.t) })
      : tx('Has to answer: {name}', { name: waiting(r.t) }))

  const row = (r) => (
    <div key={r.key} className={`co-row nonum ${KIND[r.kind].cls}${r.state === 'done' ? ' is-done' : ''}${r.state === 'ask' ? ' ask' : ''}`}>
      {/* r11: no icon square on a row — the mark (camera, film, or both cut on
          the diagonal: what of the piece is yours) and the colour dot carry it. */}
      <button type="button" className="co-row-b" onClick={() => open(r)}>
        <span className="co-row-t"><KindMark {...ownOf(r.t, user.id)} size={18} />{colorOf(r.t) != null && <i className="pc-dot" style={colorStyle(colorOf(r.t))} aria-hidden="true" />}{r.t.title}</span>
        <span className="co-row-f">{waits(r) ? waitsFor(r) : factOf(r)}</span>
      </button>
      <span className="co-row-r">
        {r.state === 'ask' ? (
          // "Can you film it?" is answered here, in one press; a no opens the
          // task, where it is said why.
          <>
            <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy} onClick={() => sayYes(r)}><Check size={16} aria-hidden="true" />{tx('Yes')}</button>
            <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy} onClick={() => open(r, 'no')}>{tx('No')}</button>
          </>
        ) : waits(r) ? (r.late > 0 && <CrewBadge row={{ ...r, state: 'go' }} today={today} />) : <CrewBadge row={r} today={today} />}
      </span>
    </div>
  )

  // A yes needs nothing else, so the big card takes it on the spot — the same
  // route the booking box in the window uses.
  const sayYes = async (r = first) => {
    if (busy || !r) return
    setBusy(true)
    try {
      const u = await api.post(`/content/${r.t.id}/confirm`, { which: r.ask.which, ok: true })
      toast(tx('Confirmed — it is in your day now'))
      onChanged?.(u)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  // ---- Now (round 14, the owner's pick: Jobber) --------------------------------------
  // The card is what to do now, and beside it the whole of today: the shoots
  // for whoever films, today's edits for an editor. A shoot in its hours is Now
  // (the clock is the team's); a row of the square pressed is brought into Now,
  // and "Not now" puts back what the day would start with.
  const films = (user.crew_roles || []).includes('operator') || entries.some((e) => e.kind === 'shoot')
  const nowMin = minutesOf(clockHM())
  const sq = (films
    ? rows.filter((r) => r.kind === 'shoot' && r.due === today).sort((a, b) => String(a.t.recording_time || '99').localeCompare(String(b.t.recording_time || '99')))
    : rows.filter((r) => r.kind !== 'shoot' && r.band === 'today' && !waits(r)))
  const span = (r) => {
    const a = minutesOf(r.t.recording_time)
    return a == null ? null : { a, b: minutesOf(r.t.recording_end) ?? a + 60 }
  }
  const running = films ? sq.find((r) => r.state === 'go' && span(r) && span(r).a <= nowMin && nowMin < span(r).b) || null : null
  const ended = (r) => films && r.state === 'go' && span(r) && span(r).b <= nowMin
  const base = running || first || null
  const picked = pick ? sq.find((r) => r.key === pick && r !== base) || null : null
  const now = picked || base
  const later = picked ? base : running && first !== running ? first : null
  const upNext = films ? sq.find((r) => r.state === 'go' && span(r) && span(r).a > nowMin) : null
  const nextShoot = films ? rows.filter((r) => r.kind === 'shoot' && r.due > today && r.state !== 'done')
    .sort((a, b) => `${a.due} ${a.t.recording_time || ''}`.localeCompare(`${b.due} ${b.t.recording_time || ''}`))[0] : null

  // Why this one is first: a row brought in by hand, or the shoot under way, says only what it is.
  const pickedWhy = (r) => (r.kind === 'shoot'
    ? (r === running ? tx('Shoot for {name}. When it is done, upload the videos and press the button.', { name: waiting(r.t) }) : tx('Shoot for {name}.', { name: waiting(r.t) }))
    : r.state === 'fix' ? tx('{name} asked you to change something, and is waiting for it.', { name: (r.fix?.requested_name || waiting(r.t)).split(' ')[0] })
      : r.late ? tx('{name} is waiting for it.', { name: waiting(r.t) }) : '')

  const hero = (r) => {
    const who = waiting(r.t)
    // The one sentence this look adds, so it has to be true in every state.
    // Somebody waiting on an answer or a change is said first, whatever day
    // the work is due. "The oldest late task" is said of the oldest one that
    // CAN be started. And "nothing is late" is never said while the bar above
    // counts an overdue row: when what is late cannot be started (no footage,
    // or its maker has not sent it on — crewDay's `held`), the card says so,
    // and says that this is the first one that can be done.
    const HELD = {
      blocked: () => tx('What is late can’t be started yet: the footage is not in.'),
      early: () => tx('What is late can’t be started yet: it is not sent to you.'),
      mixed: () => tx('What is late can’t be started yet: it waits for somebody else.'),
    }
    const why = r !== first ? pickedWhy(r)
      : r.state === 'fix' ? tx('{name} asked you to change something, and is waiting for it.', { name: (r.fix.requested_name || who).split(' ')[0] })
        : r.state === 'ask' ? tx('{name} is waiting for your answer. It takes one tap.', { name: who })
          : r.late ? tx('{name} is waiting for it.', { name: who })
            : held ? `${(HELD[held.why] || HELD.mixed)()} ${tx('So this is the first one you can do: {when}.', { when: whenOf(r) || tx('No date') })}`
              : r.band === 'today' ? tx('Nothing is late. This is the next thing in your day: {when}.', { when: whenOf(r) || tx('today') })
                : tx('Nothing is late and today is clear. This is the next one: {when}.', { when: whenOf(r) || tx('No date') })
    // r11 (the owner's drawing): the card is the name, the upload and "Send".
    // A shoot goes to whoever edits it; anything else back to whose it is.
    const editor = firstName(person(r.t.editor_id))
    const to = r.state === 'fix' ? String(r.fix?.requested_name || '').split(' ')[0] : r.kind === 'shoot' ? editor : firstName(forWhom(r.t))
    const button = to ? tx('Send to {name}', { name: to }) : r.state === 'fix' ? tx('Hand in the fix') : tx('Send')
    const after = r.kind === 'shoot'
      ? (editor ? tx('{name} gets the videos and starts the edit.', { name: editor }) : tx('The piece moves on to editing.'))
      : to ? tx('{name} gets it to check.', { name: to }) : ''
    const label = picked ? (r.kind === 'shoot' ? (r.state === 'ask' ? tx('Asked of you') : tx('Shoot')) : tx('Picked'))
      : r === running ? tx('Filming now') : tx('Now')
    const sub = r.kind === 'shoot' && r.due === today && hoursOf(r.t) ? (r === running ? tx('until {time}', { time: hh(r.t.recording_end) || '' }) : hoursOf(r.t)) : ''
    return (
      <section className={`co-now ${KIND[r.kind].cls}`} aria-labelledby="co-now-t">
        <p className="co-now-l">
          {label}{sub && <span>{sub}</span>}{twoJobs && <span className="co-kind">{KIND[r.kind].word()}</span>}<CrewBadge row={r} today={today} />
          {picked && <button type="button" className="co-link co-now-x" onClick={() => setPick(null)}>{tx('Not now')}</button>}
        </p>
        <div className="co-now-t">
          <KindMark {...ownOf(r.t, user.id)} size={22} />
          <div>
            <h2 id="co-now-t"><button type="button" onClick={() => open(r)}>{r.t.title}</button></h2>
            {why && <p className="co-why">{why}</p>}
          </div>
        </div>
        {making && tracks(user, r.t) && <Capsule t={r.t} pipe={pipe} making={making(r.t)} userId={user.id} person={person} />}
        {r.state === 'ask' ? (
          <div className="co-btns">
            <button type="button" className="co-btn co-btn-p" disabled={busy} onClick={() => sayYes(r)}><Check size={18} aria-hidden="true" />{tx('I can make it')}</button>
            <button type="button" className="co-btn co-btn-s" disabled={busy} onClick={() => open(r, 'no')}>{tx('I can’t')}</button>
          </div>
        ) : r.state === 'go' ? (
          // It can be handed in now: the place to drop the file is the card.
          <HandIn inline key={r.key} item={r.t} kind={r.kind} label={button} steps={after} sendIcon onDone={(u) => { setPick(null); onChanged?.(u) }} />
        ) : (
          <div className="co-btns"><button type="button" className="co-btn co-btn-p" onClick={() => open(r)}>{button} <ArrowRight size={18} aria-hidden="true" /></button></div>
        )}
        <p className="co-now-ln">
          <button type="button" className="co-link" onClick={() => open(r)}>{tx('Open the task')}</button>
          {later && <span>{picked ? tx('After this') : tx('After the shoot')}: <button type="button" className="co-link" onClick={() => open(later)}>{later.t.title}</button></span>}
        </p>
      </section>
    )
  }

  // The square: every one of today's, in order, one height with Now; it scrolls inside rather than leave room empty.
  const sqName = films ? tx('Today’s shoots') : (user.crew_roles || []).includes('editor') ? tx('Today’s edits') : tx('Due today')
  const square = () => (
    <section className={'co-sq' + (films ? '' : ' edits')} aria-label={sqName}>
      <div className="co-sq-in">
        <h2 className="co-sq-h">{sqName}{sq.length > 0 && <span>{sq.length}</span>}</h2>
        {sq.length ? (
          <ol>
            {sq.map((r) => {
              const state = r === now ? (r === running ? tx('Filming now') : tx('Now'))
                : r.state === 'done' ? tx('Done')
                  : r.state === 'ask' ? tx('Can you?')
                    : r.state === 'fix' ? tx('Changes asked')
                      : waits(r) ? tx('Not sent to you yet')
                        : ended(r) ? <span className="co-sq-up"><Upload size={12} aria-hidden="true" />{tx('Hand in')}</span>
                          : r === running ? tx('Filming now')
                            : r === upNext ? tx('in {time}', { time: inWords(span(r).a - nowMin) }) : ''
              // A row that can be done now is brought into Now; the rest open their task.
              const take = ['go', 'ask', 'fix'].includes(r.state)
              return (
                <li key={r.key} className={(r === now ? 'now' : '') + (r.state === 'done' || ended(r) ? ' gone' : '') + (r.state === 'ask' ? ' ask' : '')}>
                  <button type="button" className="co-sq-b" aria-current={r === now || undefined}
                    onClick={() => (!take ? open(r) : r === base ? setPick(null) : setPick(r.key))}>
                    {films && <span className="co-sq-tm">{hh(r.t.recording_time) || '—'}{r.t.recording_end && <small>–{hh(r.t.recording_end)}</small>}</span>}
                    <span className="co-sq-t"><b>{r.t.title}</b><small>{firstName(forWhom(r.t)) ? tx('for {name}', { name: firstName(forWhom(r.t)) }) : typeLabel(r.t.type)}</small></span>
                    <span className="co-sq-s">{state}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : <p className="co-sq-none">{films ? tx('No shoots today.') : tx('Nothing for today.')}</p>}
        {nextShoot && <p className="co-sq-next">{tx('Next:')} <b>{dayShort(nextShoot.due)}{nextShoot.t.recording_time ? `, ${hh(nextShoot.t.recording_time)}` : ''}</b> · {nextShoot.t.title}</p>}
      </div>
    </section>
  )

  const twoJobs = new Set(entries.map((e) => e.kind)).size > 1
  // ---- the lists (round 14, the owner's pick: Microsoft Planner) ---------------------
  // Overdue, Today and Coming up side by side, three rows each and "N more"
  // for the rest in the same short form (the owner, 15 Oct: "3 rows per band").
  // That overrides the 13 Oct rule that what is late or for today is never cut:
  // the count is on every band and the rest is one press away. What is in Now
  // or in the square is not listed again. What waits for somebody else, and
  // what is done today, are folds below; done starts folded.
  const shown = new Set([now, ...sq].filter(Boolean).map((r) => r.key))
  const carriedRows = rows.filter((r) => r.band !== 'done' && !waits(r) && isCarried(r.t, today) && !shown.has(r.key))
  const carriedKeys = new Set(carriedRows.map((r) => r.key))
  const from = carriedFrom(carriedRows, today, (r) => r.t)
  const bands = BANDS.map((b) => ({ ...b, rows: rows.filter((r) => r.band === b.key && !waits(r) && !carriedKeys.has(r.key) && !shown.has(r.key)) }))
  const cols = bands.filter((b) => b.key !== 'done')
  const doneRows = bands.find((b) => b.key === 'done').rows
  const parked = rows.filter((r) => waits(r) && !shown.has(r.key))
  const listed = cols.some((b) => b.rows.length) || carriedRows.length > 0
  const band = (b) => {
    const cut = openAll[b.key] ? b.rows.length : CUT
    return (
      <section key={b.key} className={`co-band co-band-${b.key}`} aria-label={`${b.label()}, ${b.rows.length}`}>
        <div className="co-band-h"><b>{b.label()}</b><span>{b.rows.length}</span></div>
        {b.rows.length ? b.rows.slice(0, cut).map(row) : <p className="co-band-none">{b.none()}</p>}
        {b.rows.length > CUT && (
          <button type="button" className="co-more-rows" aria-expanded={!!openAll[b.key]} onClick={() => setOpenAll((old) => ({ ...old, [b.key]: !old[b.key] }))}>
            <ChevronDown size={16} aria-hidden="true" />{openAll[b.key] ? tx('Show fewer') : tx('{n} more', { n: b.rows.length - CUT })}
          </button>
        )}
      </section>
    )
  }

  // A person whose one job is to draw gets "the wall" (the owner's pick for the
  // designer): every piece as a frame at its true shape, in the order to do
  // them, showing what it should look like — the picture when there is one,
  // else the words of its ТЗ. No stages line, no percentage.
  const wall = !films && entries.length > 0 && entries.every((e) => e.kind === 'design')
  const shapeOf = (t) => (t.type === 'story' || t.type === 'reel' ? 'tall' : t.type === 'video' ? 'wide' : 'square')
  const words = (t) => { const w = String(t.tz || t.description || '').trim(); return w.length > 110 ? `${w.slice(0, 110).trim()}…` : w }
  const wallRows = cols.flatMap((b) => b.rows)

  return (
    <div className="co">
      <header className="co-head">
        <p className="co-date">{longDayLabel(today)}</p>
        <h1 className="co-title">{now ? tx('{name}, start here.', { name }) : tx('{name}, nothing to start right now.', { name })}</h1>
      </header>

      <WhatsNew />

      {(now || films || sq.length > 0) && (
        <div className={'co-nn' + (now ? '' : ' solo')}>
          {now ? hero(now) : (
            <section className="co-now" aria-label={tx('Now')}>
              <p className="co-now-l">{tx('Now')}<span>{tx('nothing you can start')}</span></p>
              <p className="co-now-empty">{parked.length ? tx('Everything of yours waits for somebody else.') : tx('Nothing is waiting for you. New work shows up here the moment someone gives it to you.')}</p>
            </section>
          )}
          {square()}
        </div>
      )}

      {wall && wallRows.length > 0 && (
        <section className="co-wall" aria-label={tx('Your tasks, in the order to do them')}>
          {wallRows.map((r) => (
            <button key={r.key} type="button" className="co-wall-it" onClick={() => open(r)}>
              <span className="co-wall-top"><DayChip day={r.due} today={today} />{r.state !== 'go' && <CrewBadge row={r} today={today} />}</span>
              <Frame shape={shapeOf(r.t)} src={r.t.photo_thumb || null}>
                {!r.t.photo_thumb && <span className="co-wall-words">{words(r.t) || tx('Nothing is written here yet — ask whoever gave you the task.')}</span>}
              </Frame>
              <b>{r.t.title}</b>
              <small>{[typeLabel(r.t.type), firstName(forWhom(r.t)) && tx('for {name}', { name: firstName(forWhom(r.t)) })].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
        </section>
      )}

      <section className="co-list co-cols" aria-label={tx('Your tasks, in the order to do them')} hidden={(wall && wallRows.length > 0) || !listed}>
        {cols.map(band)}
      </section>
      {carriedRows.length > 0 && !wall && band({ key: 'carried', label: () => tx('Carried over from {month}', { month: monthLongOf(from) }), none: () => '', rows: carriedRows })}
      {!now && !listed && parked.length === 0 && doneRows.length === 0 && (
        <Empty good title={tx('All done, {name}', { name })}
          why={tx('Nothing is waiting for you. New work shows up here the moment someone gives it to you.')} />
      )}

      {parked.length > 0 && (
        <details open className="co-card sd-fold co-parked">
          <summary>{tx('Waiting for others')}<span className="count"> · {parked.length}</span> <ChevronDown size={14} className="cd-done-caret" aria-hidden="true" /></summary>
          <p className="co-quiet">{tx('Yours, but not yet in your hands. Each wakes up by itself when its turn comes.')}</p>
          {parked.map(row)}
        </details>
      )}
      {doneRows.length > 0 && (
        <details className="co-card sd-fold co-parked co-done-fold">
          <summary>{tx('Done today')}<span className="count"> · {doneRows.length}</span> <ChevronDown size={14} className="cd-done-caret" aria-hidden="true" /></summary>
          {doneRows.map(row)}
        </details>
      )}
    </div>
  )
}

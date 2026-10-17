import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Check, Info } from 'lucide-react'
import { api } from '../lib/api.js'
import { addDaysISO, noteServerClock, serverNow, todayISO, TIMEZONE } from '../lib/constants.js'
import { Q, toMin, hm, snap, typed, taken, clash, whoFilms, verdict } from '../lib/timeband.js'
import { Face, firstName, dayShort, weekdayShort } from './CoachParts.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- choosing the recording time: buttons, top to bottom -----------------------------
//
// Round 8 drew this as one band of quarter hours to drag across, with the
// operators as thin rows under it. Round 11 (October 2026): the owner asked
// for the parts the team would not understand to be rebuilt, and a timeline
// to drag on was the hardest thing on the site — more so under a finger, where
// a drag is also a scroll. So it is the form everybody has booked a doctor
// with: the day, the start, how long, who films. Each is a row of buttons and
// one press. It answers one question for every form that books a shoot — the
// board's questions, the new idea, the task window: "When do you film, and
// who films?"
//
//   <TimeBand day onDay value={{ from, to }} onChange operatorId onOperator operators excludeId compact />
//     day         ISO day ('2026-10-09') or ''          onDay(iso, auto)
//                 With no day yet it shows tomorrow, and says so to the form
//                 (onDay(iso, true)) the moment a time is chosen.
//     value       { from: '11:00', to: '12:00' } (either may be '')
//                                                       onChange({ from, to }) — both '' when cleared
//     operatorId  the chosen operator's id, or null     onOperator(id | null)
//                 Until somebody presses an operator the first one who is free
//                 at the chosen time films, and the form is told who that is.
//     operators   [{ id, name, color?, avatar? }] — who may film
//     excludeId   the task being booked: its own hours are not "busy"
//     compact     a narrow place: the cards lose their second line.
//   A handler left out takes its control away: no onDay — no day chips; no
//   onOperator — no cards, and the operator is the one given; no onChange — a
//   time already asked for, only written out.
//   One press can answer two of them (an offered time on another day, with
//   its operator); each is told in turn and the form is redrawn in between, so
//   handlers that write one object do not overwrite each other.
//
// A start button is every half hour, a length button is one of four. Any other
// time — the owner's "each element 15 minutes" still holds on the server — is
// typed under "Another time": "14", "930", "14.15", rounded to the quarter.
//
// A start somebody is busy at is struck through, not switched off: pressing it
// says who is busy until when and offers the nearest free time and the other
// operator. That is read in lib/timeband.js from /users/:id/slots, the answer
// the week grid reads. It is advice: the server still decides a clash when the
// booking is saved.
//
// The styles are the "r8: time band" section of styles.css (.co-tb-*); the
// name stayed so that nothing that imports it had to change.

const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const TICK = 30 * 1000
const WEEK = 7                   // the days offered as chips, and read in one go
const STEP = 30                  // a start button every half hour
const LENS = [30, 60, 90, 120]   // the lengths offered as buttons
const END_CAP = 23 * 60 + 59     // a time box cannot hold "24:00"
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lenWords = (m) => (m < 60 ? tx('{n} min', { n: m }) : m % 60 ? tx('{h} h {n} min', { h: Math.floor(m / 60), n: m % 60 }) : tx('{n} h', { n: m / 60 }))
// No `ack` on a busy item is an answer from before the server sent one: read as "said yes".
const asked = (r) => r.ack != null && r.ack !== 'yes'

export default function TimeBand({ day = '', onDay, value = {}, onChange, operatorId = null, onOperator, operators = [], excludeId = null, compact = false }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setTick((n) => n + 1) }, TICK)
    // A phone that was asleep comes back to the time it is now, at once.
    const wake = () => setTick((n) => n + 1)
    document.addEventListener('visibilitychange', wake)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', wake) }
  }, [])
  const today = todayISO()
  const now = toMin(hhmm.format(serverNow()))
  const d = day || addDaysISO(today, 1)
  const sent = !onChange
  const days = Array.from({ length: WEEK }, (_, i) => addDaysISO(today, i))

  // ---- the operators' days: the week on the chips in one answer each, so a
  // press on another day draws at once and "the nearest free time" can look ahead
  const ids = operators.map((o) => o.id).join(',')
  const base = days.includes(d) ? today : d
  const [answers, setAnswers] = useState({})
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    setErr('')
    // Asked in quarter hours; a server that refuses that is asked the old way.
    const ask = (id, mins) => api.get(`/users/${id}/slots?from=${base}&days=${WEEK}&mins=${mins}${excludeId ? `&exclude=${excludeId}` : ''}`)
    for (const id of ids ? ids.split(',') : []) {
      ask(id, Q).catch(() => ask(id, 30)).then((ans) => {
        if (ans?.now?.at) noteServerClock(ans.now.at)
        if (alive) setAnswers((was) => ({ ...was, [id]: ans }))
      }).catch((e) => { if (alive) setErr(e.message) })
    }
    return () => { alive = false }
  }, [ids, base, excludeId])
  const ready = operators.every((o) => answers[o.id])

  // 08:00 to 20:00 — stretched to whole hours when an operator's own hours, or
  // a time already booked, lie outside it: nothing chosen may be off the row.
  const { lo, hi } = useMemo(() => {
    let a = 8 * 60, b = 20 * 60
    for (const id of ids ? ids.split(',') : []) {
      const h = answers[id]?.hours
      if (h) { a = Math.min(a, toMin(h.from)); b = Math.max(b, toMin(h.to)) }
    }
    if (value.from) { a = Math.min(a, toMin(value.from)); b = Math.max(b, value.to ? toMin(value.to) : toMin(value.from) + 60) }
    return { lo: Math.max(0, Math.floor(a / 60) * 60), hi: Math.min(24 * 60, Math.ceil(b / 60) * 60) }
  }, [answers, ids, value.from, value.to])
  const ctx = { lo, hi, today, now }
  const week = useMemo(() => Object.fromEntries((ids ? ids.split(',') : []).map((id) => [id,
    Object.fromEntries((answers[id]?.calendar || []).map((c) => [c.day, taken(answers[id], c.day, { lo, hi, today, now })]))])),
  [answers, ids, lo, hi, today, now])

  // ---- the time the form holds, and the length the next start will take ----
  const a = value.from ? clamp(snap(toMin(value.from)), lo, hi - Q) : null
  const b = a == null ? null : value.to ? clamp(snap(toMin(value.to)), a + Q, hi) : Math.min(hi, a + 60)
  const [wantLen, setWantLen] = useState(60)
  const len = a == null ? wantLen : b - a
  // Who films: the one pressed, or — until somebody presses — the first who is free then.
  // An operator the form names by itself (a task that arrived late) is a press too.
  const [auto, setAuto] = useState(operatorId == null)
  const told = useRef(null)   // whom this picker itself last named to the form
  if (auto && operatorId != null && operatorId !== told.current) setAuto(false)
  const pool = onOperator ? operators : operators.filter((o) => o.id === operatorId)
  const who = onOperator && auto ? whoFilms(pool, week, d, a, b) : operatorId
  const v = sent ? { ok: who } : verdict(pool, week, d, a, b, who, ctx)
  const person = (id) => operators.find((o) => o.id === id)
  const name = (id) => firstName(person(id))

  // The form always hears from its own latest handlers: a press that answers
  // two questions tells them one after the other, redrawn in between.
  const P = useRef({})
  P.current = { onDay, onChange, onOperator }
  const tell = (...steps) => {
    const todo = steps.filter(Boolean)
    todo.forEach((step) => (todo.length > 1 ? flushSync(step) : step()))
  }
  const commit = (na, nb) => {
    if (na === a && nb === b) return
    if (na == null) return onChange({ from: '', to: '' })
    tell(!day && onDay && (() => P.current.onDay(d, true)), () => P.current.onChange({ from: hm(na), to: hm(Math.min(nb, END_CAP)) }))
  }
  const press = (id) => { setAuto(false); onOperator?.(id) }
  const take = (o) => {
    setAuto(false)
    tell(o.day !== day && onDay && (() => P.current.onDay(o.day)),
      () => P.current.onChange({ from: hm(o.a), to: hm(o.a + o.len) }),
      o.op !== operatorId && onOperator && (() => P.current.onOperator(o.op)))
  }
  useEffect(() => {
    if (!onOperator || !auto || !ready || (who ?? null) === (operatorId ?? null)) return
    told.current = who ?? null
    onOperator(told.current)
  }, [auto, ready, who, operatorId]) // eslint-disable-line react-hooks/exhaustive-deps -- the form's handler is new on every draw

  // ---- the starts: every half hour still ahead, each knowing what is in its way ----
  // Nobody pressed yet: a start is free when anybody can film then. Somebody
  // chosen (or given): it is that person's day.
  const inWay = (t) => {
    const end = Math.min(hi, t + len)
    if (onOperator && auto) {
      const all = pool.map((o) => clash(week[o.id]?.[d], t, end))
      return all.length && all.every(Boolean) ? all[0] : null
    }
    return who == null ? null : clash(week[who]?.[d], t, end)
  }
  const starts = []
  for (let t = lo; t + STEP <= hi; t += STEP) {
    if (d < today || (d === today && t <= now)) continue   // gone by on the team's clock
    starts.push({ t, c: inWay(t) })
  }
  // A time no button holds (10:15, or 45 minutes) shows its own boxes.
  const offGrid = a != null && (a % STEP !== 0 || !LENS.includes(b - a))

  // ---- typed hours: rounded to the quarter; a whole hour typed, or picked from the list, is taken at once
  const [draft, setDraft] = useState(null)   // { which: 'a' | 'b', text } while a field is being typed in
  const typedIn = (which, text) => {
    setDraft(null)
    const m = typed(text)
    if (m == null) return   // not an hour: the field shows the chosen time again
    if (which === 'a') { const na = clamp(m, lo, hi - Q); commit(na, Math.min(hi, na + len)) }
    else { const nb = clamp(m, lo + Q, hi); commit(a == null ? Math.max(lo, nb - 60) : a >= nb ? nb - Q : a, nb) }
  }
  const listId = useId()
  const field = (which, label, m) => (
    <label className="co-tb-tf">{label}
      <input className="input" inputMode="numeric" autoComplete="off" list={listId} maxLength={5} placeholder="--:--"
        value={draft?.which === which ? draft.text : m == null ? '' : hm(m)}
        onChange={(e) => (/^\d\d:\d\d$/.test(e.target.value) ? typedIn(which, e.target.value) : setDraft({ which, text: e.target.value }))}
        onBlur={(e) => { if (draft?.which === which) typedIn(which, e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); typedIn(which, e.target.value) } }} />
    </label>
  )

  // ---- the words ----
  const whyShort = (c) => (c.kind === 'past' ? tx('Passed') : c.kind === 'off'
    ? (c.all ? tx('Day off') : c.a === lo ? tx('Starts at {time}', { time: hm(c.b) }) : tx('Finishes at {time}', { time: hm(c.a) }))
    : tx('Busy until {time}', { time: hm(c.b) }))
  const whyLong = (c, id) => {
    const n = name(id)
    if (c.kind === 'past') return tx('That hour has passed.')
    if (c.kind === 'off') {
      return c.all ? tx('{name} does not work this day.', { name: n })
        : c.a === lo ? tx('{name} starts at {time}.', { name: n, time: hm(c.b) }) : tx('{name} finishes at {time}.', { name: n, time: hm(c.a) })
    }
    if (c.kind !== 'rec' || !c.r.title) return tx('{name} is busy until {time}.', { name: n, time: hm(c.b) })
    return asked(c.r) ? tx('{name} is already asked for “{title}” until {time}.', { name: n, title: c.r.title, time: hm(c.b) })
      : tx('{name} films “{title}” until {time}.', { name: n, title: c.r.title, time: hm(c.b) })
  }
  // An offered time on another day needs a way to say the day.
  const offers = (v.offers || []).filter((o) => o.day === d || onDay)
  const why = who != null ? v.why?.filter((x) => x.c).map(({ op, c }) => whyLong(c, op)).join(' ')
    : [v.off ? tx('Nobody films that day.') : tx('Nobody is free then.'),
      ...(v.off ? [] : (v.why || []).filter((x) => x.c).map(({ op, c }) => whyLong(c, op))),
      ...(offers.length ? [] : [tx('Nothing that long is free this week: make it shorter.')])].join(' ')
  const rdId = useId()
  const fromId = useId()
  const lenId = useId()
  const dateBox = useRef(null)
  const other = !!day && !days.includes(day)

  // ---- round 14: "Find a time", made small (the owner's pick, 15 Oct; "too big and непонятный", 16 Oct) ----
  // The day, how long, and then each operator with the starts they are free for:
  // one press is the person AND the time. Without operators to choose from it is
  // the starts alone, as before.
  const freeFor = (id, iso) => {
    const out = []
    for (let t = lo; t + len <= hi; t += STEP) {
      if (iso < today || (iso === today && t <= now)) continue
      if (!clash(week[id]?.[iso], t, Math.min(hi, t + len))) out.push(t)
    }
    return out
  }
  const rows = onOperator ? operators : operators.filter((o) => o.id === operatorId)
  // Eight starts a person, the rest one press away: a free day is twenty buttons otherwise.
  const [allOf, setAllOf] = useState(() => new Set())
  if (!sent && rows.length > 0) {
    const nFree = (iso) => rows.filter((o) => freeFor(o.id, iso).length > 0).length
    return (
      <div className={'co-tb r14-bk' + (compact ? ' compact' : '')}>
        {onDay && (
          <div className="r14-bk-days" role="group" aria-label={tx('Day')}>
            {days.map((iso, i) => {
              const off = rows.every((o) => week[o.id]?.[iso]?.[0]?.all)
              const n = ready ? nFree(iso) : null
              return (
                <button key={iso} type="button" className="r14-bk-day" aria-pressed={iso === d} onClick={() => onDay(iso)}
                  title={dayShort(iso)}>
                  <b>{i === 0 ? tx('Today') : i === 1 ? tx('Tomorrow') : `${weekdayShort(iso)} ${Number(iso.slice(8))}`}</b>
                  <small>{off ? tx('Day off') : n == null ? '…' : n ? tx('{n} free', { n }) : tx('Nobody free')}</small>
                </button>
              )
            })}
            <span className="co-tb-other">
              <button type="button" className="r14-bk-day" aria-pressed={other}
                onClick={() => { try { dateBox.current.showPicker() } catch { dateBox.current.focus() } }}>
                <b>{other ? dayShort(day) : tx('Another day…')}</b><small>&nbsp;</small>
              </button>
              <input ref={dateBox} type="date" tabIndex={-1} aria-hidden="true" min={today} value={other ? day : ''}
                onChange={(e) => { if (e.target.value) onDay(e.target.value) }} />
            </span>
          </div>
        )}
        <div className="r14-bk-len" role="group" aria-labelledby={lenId}>
          <span id={lenId}>{tx('How long')}</span>
          {LENS.map((L) => (
            <button key={L} type="button" aria-pressed={len === L}
              onClick={() => (a == null ? setWantLen(L) : commit(a, Math.min(hi, a + L)))}>{lenWords(L)}</button>
          ))}
        </div>
        <ul className="r14-bk-ops" aria-label={tx('Free times')}>
          {rows.map((o) => {
            const free = ready ? freeFor(o.id, d) : null
            const tk = week[o.id]?.[d] || []
            return (
              <li key={o.id}>
                <Face person={o} />
                <b>{firstName(o)}</b>
                {free == null ? <p className="r14-bk-none">…</p>
                  : free.length ? (
                    <div className="r14-bk-tms">
                      {(allOf.has(o.id) || free.length <= 9 ? free : free.slice(0, 8)).map((t) => (
                        <button key={t} type="button" className="r14-bk-tm" aria-pressed={who === o.id && a === t}
                          aria-label={tx('{name}, {from} to {to}', { name: firstName(o), from: hm(t), to: hm(Math.min(hi, t + len)) })}
                          onClick={() => take({ op: o.id, day: d, a: t, len })}>{hm(t)}</button>
                      ))}
                      {!allOf.has(o.id) && free.length > 9 && (
                        <button type="button" className="r14-bk-more" onClick={() => setAllOf((was) => new Set([...was, o.id]))}>{tx('+{n} more', { n: free.length - 8 })}</button>
                      )}
                    </div>
                  ) : <p className="r14-bk-none">{tk[0]?.all ? tx('Does not film that day') : tx('Busy that day')}</p>}
              </li>
            )
          })}
        </ul>
        <details className="co-tb-exact" open={offGrid}>
          <summary>{tx('Another time')}</summary>
          <div className="co-tb-typed">
            {field('a', tx('From'), a)}
            {field('b', tx('To'), b)}
            <datalist id={listId}>{Array.from({ length: (hi - lo) / Q + 1 }, (_, i) => <option key={i} value={hm(lo + i * Q)} />)}</datalist>
          </div>
        </details>
        <div className="co-tb-say">
          <p className="co-tb-rd" id={rdId} aria-live="polite">
            {a != null ? (
              <><b>{person(who) ? `${name(who)} · ` : ''}{dayShort(d)} · {hm(a)}–{hm(b)}</b> · {lenWords(b - a)}</>
            ) : tx('Press a time.')}
          </p>
          {a != null && !v.empty && !('ok' in v) && <p className="co-tb-why no" role="status"><Info size={18} aria-hidden="true" /><span>{why}</span></p>}
          {err && <p className="co-tb-why no" role="alert"><Info size={18} aria-hidden="true" /><span>{err}</span></p>}
        </div>
      </div>
    )
  }

  return (
    <div className={'co-tb' + (compact ? ' compact' : '') + (sent ? ' sent' : '')}>
      {onDay && (
        <div className="co-tb-days" role="group" aria-label={tx('Day')}>
          {days.map((iso, i) => {
            const none = operators.length > 0 && operators.every((o) => week[o.id]?.[iso]?.[0]?.all)
            const short = `${weekdayShort(iso)} ${Number(iso.slice(8))}`
            return (
              <button key={iso} type="button" className={'co-chip' + (iso === d ? ' sel' : '') + (none ? ' none' : '')} aria-pressed={iso === d}
                title={none ? `${dayShort(iso)} — ${tx('Nobody films that day.')}` : dayShort(iso)} onClick={() => onDay(iso)}>
                {i === 0 ? `${tx('Today')} · ${short}` : i === 1 ? `${tx('Tomorrow')} · ${short}` : short}
              </button>
            )
          })}
          <span className="co-tb-other">
            <button type="button" className={'co-chip' + (other ? ' sel' : '')} aria-pressed={other}
              onClick={() => { try { dateBox.current.showPicker() } catch { dateBox.current.focus() } }}>
              {other ? dayShort(day) : tx('Another day…')}
            </button>
            <input ref={dateBox} type="date" tabIndex={-1} aria-hidden="true" min={today} value={other ? day : ''}
              onChange={(e) => { if (e.target.value) onDay(e.target.value) }} />
          </span>
        </div>
      )}

      {!sent && (
        <div className="co-tb-pick">
          <span className="co-tb-l" id={fromId}>{tx('From')}</span>
          {starts.length > 0 ? (
            <div className="co-tb-slots" role="group" aria-labelledby={fromId}>
              {starts.map(({ t, c }) => (
                <button key={t} type="button" className={'co-chip co-tb-slot' + (a === t ? ' sel' : '') + (c ? ' busy' : '')} aria-pressed={a === t}
                  title={c ? whyShort(c) : undefined}
                  onClick={() => (a === t ? commit(null, null) : commit(t, Math.min(hi, t + len)))}>{hm(t)}</button>
              ))}
            </div>
          ) : <p className="co-tb-soft">{tx('No time is left on this day.')}</p>}
          <span className="co-tb-l" id={lenId}>{tx('How long')}</span>
          <div className="co-tb-slots" role="group" aria-labelledby={lenId}>
            {LENS.map((L) => (
              <button key={L} type="button" className={'co-chip' + (len === L ? ' sel' : '')} aria-pressed={len === L}
                onClick={() => (a == null ? setWantLen(L) : commit(a, Math.min(hi, a + L)))}>{lenWords(L)}</button>
            ))}
          </div>
        </div>
      )}

      {onOperator && operators.length > 0 && (
        <div className="co-tb-cards" role="radiogroup" aria-label={tx('Who films it')}>
          {operators.map((o) => {
            const tk = week[o.id]?.[d] || []
            const c = a != null && clash(tk, a, b)
            const off = !!tk[0]?.all
            const hours = answers[o.id]?.hours
            const recs = tk.filter((z) => z.kind === 'rec' && !z.r.done)
            const small = off ? tx('Day off') : a == null ? (hours ? `${hours.from}–${hours.to}` : '') : c ? whyShort(c) : tx('Free then')
            return (
              <button key={o.id} type="button" role="radio" aria-checked={who === o.id} className={'co-tb-wc' + (c ? ' busy' : '')} onClick={() => press(o.id)}>
                <Face person={o} />
                <span className="co-tb-wc-t"><b>{firstName(o)}</b>{small && <small>{small}</small>}</span>
                <span className="co-tb-wc-r" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
                {!compact && (
                  <span className="co-tb-wc-l">
                    {off ? tx('Does not film that day') : recs.length ? recs.map((z) => `${z.r.from} ${z.r.title || tx('taken')}`).join(' · ') : tx('Nothing else that day')}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {!sent && (
        <details className="co-tb-exact" open={offGrid}>
          <summary>{tx('Another time')}</summary>
          <div className="co-tb-typed">
            {field('a', tx('From'), a)}
            {field('b', tx('To'), b)}
            <datalist id={listId}>{Array.from({ length: (hi - lo) / Q + 1 }, (_, i) => <option key={i} value={hm(lo + i * Q)} />)}</datalist>
          </div>
        </details>
      )}

      <div className="co-tb-say">
        <p className="co-tb-rd" id={rdId} aria-live="polite">
          {a != null && (
            <>
              <b>{dayShort(d)} · {hm(a)}–{hm(b)}</b> · {lenWords(b - a)}
              {person(who) && <> · {sent ? tx('{name} is asked', { name: name(who) }) : tx('{name} films', { name: name(who) })}</>}
            </>
          )}
        </p>
        {!v.empty && !('ok' in v) && <p className="co-tb-why no" role="status"><Info size={18} aria-hidden="true" /><span>{why}</span></p>}
        {offers.length > 0 && (
          <div className="co-tb-offers">
            {offers.map((o) => (
              <button key={`${o.op} ${o.day} ${o.a}`} type="button" className="co-btn co-btn-t co-btn-sm" onClick={() => take(o)}>
                {o.same ? tx('Ask {name} — free then', { name: name(o.op) })
                  : `${o.day === d ? '' : `${dayShort(o.day)} · `}${hm(o.a)}–${hm(o.a + o.len)} · ${name(o.op)}`}
              </button>
            ))}
          </div>
        )}
        {err && <p className="co-tb-why no" role="alert"><Info size={18} aria-hidden="true" /><span>{err}</span></p>}
      </div>
    </div>
  )
}

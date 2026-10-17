import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Clapperboard, Scissors, Send, Palette, AlertCircle, Check } from 'lucide-react'
import { api } from '../lib/api.js'
import { addDaysISO, longDayLabel, serverNow } from '../lib/constants.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import { KIND, Badge, Face, WhatsNew, firstName, dayInLine, dayShort, lateWords } from './CoachParts.jsx'
import Housekeeping from './Housekeeping.jsx'

// ---- an admin's My Day: who does what today, who is stuck first -----------------
//
// "I am an admin and I need to see the deadlines first of all in my day, and
// the schedule of the team — Jasmina has two shoots, at 14:00 and 15:00."
//
// Round 14 (the owner's pick: Float) makes the schedule the page: everyone
// down, the hours across. A shoot is a bar at its hours on the row of everyone
// in it, a post going out is a pin at its hour, lessons and the hours outside
// a person's working day are hatched, and a red line is now — so "who can film
// at 15:00?" is the white space under 15:00. Beside each row: what is due today
// (edits and covers have a day, not an hour) and what the person holds up — a
// count per kind of step, red once something is over three days late, pressed
// for the list. Above it, in one ruby line, the day moves waiting on an
// admin's answer. A shoot nobody films has a row of its own, first. A bar opens
// the task window, where who films it is changed.
//
// The three deadline lists of before (Overdue now, Due today, Needs editing
// ASAP) are under it, folded: nothing is taken away.
//
// What is late and what is done is the server's reading (GET /content/day/team,
// routes/content.js — lateDue and phasePassed); this page only draws it.
const WHAT = { shoot: () => tx('Shoot'), design: () => tx('Artwork'), release: () => tx('Goes out'), edit: () => tx('Editing') }
const KIND_OF = { shoot: 'shoot', design: 'design', release: 'send', edit: 'edit' }
const HOLD = { shoot: Clapperboard, edit: Scissors, design: Palette, release: Send }
const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5))
const hhmm = (t) => String(t || '').slice(0, 5)
const ofMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const clockMin = () => toMin(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(serverNow()))

export default function CoachAdminDay({ user, team, byKey, today, onOpen }) {
  const [day, setDay] = useState(today)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [chan, setChan] = useState('all')
  const [show, setShow] = useState('all')      // everyone, the crew, the makers, who is free now
  const [held, setHeld] = useState(null)       // whose "holds up" list is open
  const [asks, setAsks] = useState([])
  const [asksOpen, setAsksOpen] = useState(false)
  const [busyAsk, setBusyAsk] = useState(null)
  // A long backlog is a group's first few and one press for the rest.
  const [all, setAll] = useState({})
  const FIRST = 3   // r11: three rows, then "Show all"
  const [, tick] = useState(0)
  useEffect(() => {
    let alive = true
    const load = () => api.get(`/content/day/team?date=${day}&everyone=1`)
      .then((d) => { if (alive) { setData(d); setErr('') } })
      .catch((e) => { if (alive) setErr(e.message) })
    load()
    const id = setInterval(() => { if (!document.hidden) { load(); tick((n) => n + 1) } }, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [day])
  useEffect(() => {
    const load = () => api.get('/content/date-requests/open').then((d) => { if (Array.isArray(d)) setAsks(d) }).catch(() => {})
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 30000)
    return () => clearInterval(id)
  }, [])

  const person = (id) => team.find((u) => u.id === id)
  const names = (ids) => (ids || []).map((id) => firstName(person(id))).filter(Boolean).join(', ')
  const on = (x) => chan === 'all' || (x.channels || []).includes(chan)

  // The channels that have something today or on the timeline — the menu.
  const chans = useMemo(() => {
    if (!data) return []
    const seen = new Set()
    for (const x of [...data.overdue, ...data.dueToday, ...data.editAsap, ...data.timeline.flatMap((p) => p.items)])
      for (const c of x.channels || []) seen.add(c)
    return [...seen].filter((c) => byKey[c]).sort((a, b) => (byKey[a].label || a).localeCompare(byKey[b].label || b))
  }, [data, byKey])

  if (!data) return <div className="co">{err ? <p className="co-none">{err}</p> : <div className="app-loading"><span className="spinner" /></div>}</div>

  const overdue = data.overdue.filter(on)
  const dueToday = data.dueToday.filter(on)
  const editAsap = data.editAsap.filter(on)

  // ---- the day moves waiting on an admin's yes ----
  const answer = async (a, approve) => {
    setBusyAsk(a.id)
    try {
      await api.post(`/content/date-requests/${a.id}/decide`, { approve })
      setAsks((prev) => prev.filter((x) => x.id !== a.id))
      toast(approve ? tx('Moved — they hear it right away') : tx('Kept where it was — they hear why'))
    } catch (e) { toast(e.message, 'err') } finally { setBusyAsk(null) }
  }
  const askers = [...new Set(asks.map((a) => String(a.asked_name || '').split(' ')[0]).filter(Boolean))]

  // ---- the people: a row each, the crew first ----
  const now = day === today ? clockMin() : null
  const statusOf = (p) => {
    if (!p.working) return { k: 'off', t: tx('Not a working day') }
    if (now == null) return { k: '', t: '' }
    const end = (i) => (i.to ? toMin(i.to) : toMin(i.from) + 60)
    const filming = p.items.find((i) => i.kind === 'shoot' && i.from && toMin(i.from) <= now && now < end(i))
    if (filming) return { k: 'film', t: tx('Filming until {time}', { time: ofMin(end(filming)) }) }
    const busy = p.busy.find((b) => toMin(b.from) <= now && now < toMin(b.to))
    if (busy) return { k: 'busy', t: tx('At lessons until {time}', { time: hhmm(busy.to) }) }
    if (p.work_start && now < toMin(p.work_start)) return { k: 'later', t: tx('Starts at {time}', { time: hhmm(p.work_start) }) }
    if (p.work_end && now >= toMin(p.work_end)) return { k: 'gone', t: tx('Day is over') }
    const next = [...p.items.filter((i) => i.kind === 'shoot' && i.from).map((i) => toMin(i.from)), ...p.busy.map((b) => toMin(b.from))]
      .filter((m) => m > now).sort((a, b) => a - b)[0]
    return { k: 'free', t: next != null ? tx('Free until {time}', { time: ofMin(next) }) : tx('Free') }
  }
  const crew = (p) => (p.crew_roles || []).length > 0
  const everyone = data.timeline
    .map((p) => ({ ...p, items: p.items.filter(on), st: statusOf(p) }))
    .filter((p) => chan === 'all' || p.items.length)
  const freeN = everyone.filter((p) => p.st.k === 'free').length
  const rows = everyone
    .filter((p) => show === 'all' || (show === 'crew' ? crew(p) : show === 'makers' ? !crew(p) : p.st.k === 'free'))
    .sort((a, b) => (crew(b) - crew(a)) || String(a.items.find((i) => i.from)?.from || '99').localeCompare(String(b.items.find((i) => i.from)?.from || '99')) || a.name.localeCompare(b.name))
  // A shoot on the day that nobody films yet: a row of its own, first.
  const nobody = [...new Map(everyone.flatMap((p) => p.items).filter((i) => i.kind === 'shoot' && !i.operator_id && i.from).map((i) => [i.content_id, i])).values()]

  // What a person holds up: their steps past their day, the most late first.
  const holdsOf = (id) => [
    ...overdue.filter((x) => (x.owners || []).includes(id)),
    ...editAsap.filter((x) => x.days_late > 0 && (x.owners || []).includes(id)).map((x) => ({ ...x, phase: 'edit' })),
  ].sort((a, b) => b.days_late - a.days_late)

  // ---- the hours: the working day, stretched to whatever is on it ----
  const shown = [...rows, ...(nobody.length ? [{ items: nobody, busy: [] }] : [])]
  const times = shown.flatMap((p) => [...p.items.flatMap((i) => [i.from, i.to]), ...p.busy.flatMap((b) => [b.from, b.to])]).filter(Boolean).map(toMin)
  const start = Math.min(9 * 60, ...times.map((m) => Math.floor(m / 60) * 60), ...(now != null ? [Math.floor(now / 60) * 60] : []))
  const end = Math.max(20 * 60, ...times.map((m) => Math.ceil(m / 60) * 60), ...(now != null ? [Math.ceil((now + 1) / 60) * 60] : []))
  const pct = (m) => `${((Math.max(start, Math.min(end, m)) - start) / (end - start)) * 100}%`
  const span = (a, b) => ({ left: pct(a), width: `${Math.max(1.5, ((Math.min(end, b) - Math.max(start, a)) / (end - start)) * 100)}%` })
  const hours = []
  for (let m = start; m <= end; m += 60) hours.push(m)

  const track = (p, items) => {
    const ws = p.work_start ? toMin(p.work_start) : null, we = p.work_end ? toMin(p.work_end) : null
    return (
      <div className="co-ad-trk">
        {p.working === false ? <i className="co-ad-off" style={{ left: 0, width: '100%' }}><span>{tx('Not a working day')}</span></i> : (
          <>
            {ws != null && ws > start && <i className="co-ad-off" style={span(start, ws)} />}
            {we != null && we < end && <i className="co-ad-off" style={span(we, end)} />}
          </>
        )}
        {p.busy.map((b, k) => <span key={`b${k}`} className="co-ad-busy" style={span(toMin(b.from), toMin(b.to))}>{b.label || tx('Lessons')}</span>)}
        {items.filter((i) => i.kind === 'shoot' && i.from).map((i) => {
          const a = toMin(i.from), b = i.to ? toMin(i.to) : a + 60
          return (
            <button key={`s${i.content_id}`} type="button" style={span(a, b)} onClick={() => onOpen(i.content_id)}
              className={'co-ad-bar' + (i.done || (now != null && b <= now) ? ' done' : '') + (now != null && a <= now && now < b ? ' now' : '') + (i.operator_id ? '' : ' nobody')}
              title={`${i.title}, ${hhmm(i.from)}–${ofMin(b)}${i.operator_id ? ` · ${tx('films')} ${firstName(person(i.operator_id))}` : ''}`}>
              <b>{i.title}</b>
            </button>
          )
        })}
        {items.filter((i) => i.kind === 'post' && i.from).map((i) => (
          <button key={`p${i.content_id}`} type="button" className={'co-ad-pin' + (i.done ? ' done' : '')} style={{ left: pct(toMin(i.from)) }}
            onClick={() => onOpen(i.content_id)} aria-label={`${tx('Goes out')} ${hhmm(i.from)}: ${i.title}`} title={`${tx('Goes out')} ${hhmm(i.from)} · ${i.title}`}>
            <Send size={13} aria-hidden="true" />
          </button>
        ))}
        {now != null && now >= start && now <= end && <i className="co-ad-nl" style={{ left: pct(now) }} aria-hidden="true" />}
      </div>
    )
  }
  // Due that day, said in words: "1 edit", "2 covers"; a shoot or a post with no hour is named here too.
  const dueCell = (p) => {
    const cuts = p.items.filter((i) => i.kind === 'cut' && !i.done), arts = p.items.filter((i) => i.kind === 'art' && !i.done)
    const loose = p.items.filter((i) => (i.kind === 'shoot' || i.kind === 'post') && !i.from && !i.done)
    return (
      <>
        {cuts.length > 0 && <button type="button" className="co-ad-du co-k-cut" onClick={() => onOpen(cuts[0].content_id)} title={cuts.map((i) => i.title).join(', ')}><Scissors size={13} aria-hidden="true" />{cuts.length > 1 ? tx('{n} edits', { n: cuts.length }) : tx('1 edit')}</button>}
        {arts.length > 0 && <button type="button" className="co-ad-du co-k-art" onClick={() => onOpen(arts[0].content_id)} title={arts.map((i) => i.title).join(', ')}><Palette size={13} aria-hidden="true" />{arts.length > 1 ? tx('{n} covers', { n: arts.length }) : tx('1 cover')}</button>}
        {loose.map((i) => <button key={`l${i.kind}${i.content_id}`} type="button" className="co-ad-du" onClick={() => onOpen(i.content_id)} title={i.title}>{i.kind === 'post' ? <Send size={13} aria-hidden="true" /> : <Clapperboard size={13} aria-hidden="true" />}{i.kind === 'post' ? tx('Goes out') : tx('Shoot, no hour')}</button>)}
      </>
    )
  }
  const holdBtn = (p) => {
    const h = holdsOf(p.id)
    if (!h.length) return null
    const cnt = {}
    h.forEach((x) => { cnt[x.phase] = (cnt[x.phase] || 0) + 1 })
    return (
      <button type="button" className={'co-ad-hold' + (h[0].days_late > 3 ? ' late' : '')} aria-expanded={held === p.id} onClick={() => setHeld(held === p.id ? null : p.id)}
        aria-label={tx('{name} holds up {n}', { name: firstName(p), n: h.length })}>
        {Object.entries(cnt).map(([ph, n]) => { const I = HOLD[ph] || Clapperboard; return <span key={ph}><I size={13} aria-hidden="true" />{n}</span> })}
      </button>
    )
  }

  const row = (x, kind, fact, badge) => (
    <div key={`${x.content_id}:${x.phase || kind}`} className={`co-row nonum ${KIND[kind].cls}`}>
      <button type="button" className="co-row-b" onClick={() => onOpen(x.content_id)}>
        <span className="co-row-t">{x.title}</span>
        <span className="co-row-f">{fact}</span>
      </button>
      {/* r10: last month's plan in its own colour — the day it was due says which month. */}
      <span className="co-row-r">{badge}</span>
    </div>
  )
  const whose = (x) => names(x.owners) || tx('nobody yet')
  const GROUPS = [
    {
      key: 'late', label: () => tx('Overdue now'), list: overdue,
      why: () => tx('Past its day and not done. The most late first.'), none: () => tx('Nothing is late. Every step is on its day.'),
      draw: (x) => row(x, KIND_OF[x.phase], `${WHAT[x.phase]()} · ${whose(x)}`,
        <Badge tone="late">{lateWords(x.days_late)}</Badge>),
    },
    {
      key: 'today', label: () => tx('Due today'), list: dueToday,
      why: () => tx('Its day is today: shoots and posts with their hour.'), none: () => tx('Nothing is due today.'),
      draw: (x) => row(x, KIND_OF[x.phase], `${WHAT[x.phase]()} · ${whose(x)}`,
        <Badge>{x.time ? hhmm(x.time) : tx('Today')}</Badge>),
    },
    {
      key: 'edit', label: () => tx('Needs editing ASAP'), list: editAsap,
      why: () => tx('The footage is in, and the edit is late or due within a day.'), none: () => tx('No edit is close to its day.'),
      draw: (x) => row(x, 'edit', whose(x),
        x.days_late > 0 ? <Badge tone="late">{lateWords(x.days_late)}</Badge>
          : <Badge tone="wait">{x.days_late === 0 ? tx('due today') : tx('due tomorrow')}</Badge>),
    },
  ]
  const SHOW = [['all', tx('Everyone')], ['crew', tx('Crew')], ['makers', tx('Makers')], ...(now != null ? [['free', `${tx('Free')} (${freeN})`]] : [])]

  return (
    <div className="co co-admin">
      <section className="co-sum co-ad-head">
        <div className="co-hello">
          <div className="co-date">{longDayLabel(day)}</div>
          <h2>{tx('Who does what today')}</h2>
        </div>
        <div className="co-ad-ctl">
          <span className="co-tl-nav">
            <button type="button" className="icon-btn" onClick={() => setDay(addDaysISO(day, -1))} aria-label={tx('A day earlier')}><ChevronLeft size={18} /></button>
            {day !== today && <button type="button" className="co-link" onClick={() => setDay(today)}>{tx('Today')}</button>}
            <button type="button" className="icon-btn" onClick={() => setDay(addDaysISO(day, 1))} aria-label={tx('A day later')}><ChevronRight size={18} /></button>
          </span>
          <div className="co-ad-seg" role="group" aria-label={tx('Show')}>
            {SHOW.map(([k, label]) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{label}</button>)}
          </div>
          {/* One menu, not a row of nine buttons (round 9: "too complex"). */}
          <select className="select co-chan-pick" aria-label={tx('Channels')} value={chan} onChange={(e) => setChan(e.target.value)}>
            <option value="all">{tx('All channels')}</option>
            {chans.map((c) => <option key={c} value={c}>{byKey[c].label}</option>)}
          </select>
        </div>
      </section>

      <WhatsNew />

      {asks.length > 0 && (
        <section className="co-ad-ask" aria-label={tx('Waiting on your answer')}>
          <p><AlertCircle size={16} aria-hidden="true" /><span><b>{tx('{n} wait on your answer:', { n: asks.length })}</b> {askers.join(', ')}</span></p>
          <button type="button" className="co-btn co-btn-p co-btn-sm" aria-expanded={asksOpen} onClick={() => setAsksOpen(!asksOpen)}>{asksOpen ? tx('Hide') : tx('Answer')}</button>
          {asksOpen && (
            <ul className="co-ad-asks">
              {asks.map((a) => (
                <li key={a.id}>
                  <button type="button" className="co-ad-ask-t" onClick={() => onOpen(a.content_id)}>
                    <b>{a.title}</b>
                    <small>{String(a.asked_name || '').split(' ')[0]}: {dayShort(a.from_date)} → {dayShort(a.to_date)}{a.to_time ? `, ${hhmm(a.to_time)}` : ''}{a.reason ? ` · ${a.reason}` : ''}</small>
                  </button>
                  <span className="co-btns">
                    <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busyAsk === a.id} onClick={() => answer(a, true)}><Check size={15} aria-hidden="true" />{tx('Move it')}</button>
                    <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busyAsk === a.id} onClick={() => answer(a, false)}>{tx('Keep it')}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="co-ad-key">
        <span><i className="s" />{tx('Shoot')}</span>
        <span><Send size={13} aria-hidden="true" />{tx('Goes out')}</span>
        <span><i className="e" />{tx('Edit due')}</span>
        <span><i className="a" />{tx('Cover due')}</span>
        <span><i className="h" />{tx('Lessons or not working')}</span>
        {now != null && <span><i className="n" />{tx('Now')}</span>}
      </p>

      <div className="co-ad-wrap">
        <div className="co-ad" role="table" aria-label={tx('Who does what today')}>
          <div className="co-ad-r co-ad-hd" role="row">
            <span className="co-ad-who" role="columnheader" />
            <div className="co-ad-trk" role="columnheader" aria-label={tx('Hours')}>
              {hours.map((m) => m < end && (now == null || Math.abs(now - m) > 25) && <span key={m} style={{ left: pct(m) }}>{ofMin(m)}</span>)}
              {now != null && <b className="co-ad-nowl" style={{ left: pct(now) }}>{ofMin(now)}</b>}
            </div>
            <span className="co-ad-dk" role="columnheader">{tx('Due today')}</span>
            <span className="co-ad-dk" role="columnheader">{tx('Holds up')}</span>
          </div>
          {nobody.length > 0 && show !== 'makers' && (
            <div className="co-ad-r nobody" role="row">
              <span className="co-ad-who"><span className="co-ad-q" aria-hidden="true">?</span><span><b>{tx('Nobody yet')}</b><small>{tx('Press it to choose who films it')}</small></span></span>
              {track({ working: true, busy: [] }, nobody)}
              <span className="co-ad-dk" />
              <span className="co-ad-dk" />
            </div>
          )}
          {rows.map((p) => (
            <div key={p.id} className="co-ad-r" role="row">
              <span className="co-ad-who"><Face person={person(p.id) || { name: p.name }} /><span><b>{firstName(person(p.id) || p)}</b><small className={p.st.k}>{p.st.t}</small></span></span>
              {track(p, p.items)}
              <span className="co-ad-dk">{dueCell(p)}</span>
              <span className="co-ad-dk">{holdBtn(p)}</span>
              {held === p.id && (
                <div className="co-ad-drw">
                  {(all[`h${p.id}`] ? holdsOf(p.id) : holdsOf(p.id).slice(0, 5)).map((x) => row(x, KIND_OF[x.phase], WHAT[x.phase](), <Badge tone="late">{lateWords(x.days_late)}</Badge>))}
                  {holdsOf(p.id).length > 5 && (
                    <button type="button" className="co-link co-more-rows" onClick={() => setAll((a) => ({ ...a, [`h${p.id}`]: !a[`h${p.id}`] }))}>
                      {all[`h${p.id}`] ? tx('Show fewer') : tx('Show all {n}', { n: holdsOf(p.id).length })}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="co-quiet">{show === 'free' ? tx('Nobody is free right now.') : tx('Nobody has a shoot, an edit or a post on {day}.', { day: dayInLine(day, today) })}</p>}
        </div>
      </div>

      {/* r11: how much is overdue, and what leaves the board next. */}
      <Housekeeping />

      {/* Round 14: the deadline lists of before, under the schedule and folded — nothing is taken away. */}
      <details className="co-card sd-fold co-ad-dl" aria-label={tx('Deadlines')}>
        <summary>{tx('All deadlines')}<span className="count"> · {overdue.length + dueToday.length + editAsap.length}</span> <ChevronDown size={14} className="cd-done-caret" aria-hidden="true" /></summary>
        {GROUPS.map((g) => (
          <div key={g.key} className={'co-grp' + (g.list.length ? '' : ' none')}>
            <div className="co-grp-h">
              <h3>{g.label()}{g.list.length > 0 && <span>{g.list.length}</span>}</h3>
              {g.list.length === 0 && <p>{g.none()}</p>}
            </div>
            {(all[g.key] ? g.list : g.list.slice(0, FIRST)).map(g.draw)}
            {g.list.length > FIRST && (
              <button type="button" className="co-link co-more-rows" onClick={() => setAll((a) => ({ ...a, [g.key]: !a[g.key] }))}>
                {all[g.key] ? tx('Show fewer') : tx('Show all {n}', { n: g.list.length })}
              </button>
            )}
          </div>
        ))}
      </details>
    </div>
  )
}

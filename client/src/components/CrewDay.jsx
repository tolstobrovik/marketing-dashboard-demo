import { useEffect, useMemo, useState } from 'react'
import {
  Sun, Scissors, Palette, Clapperboard, Check, CheckCircle2, CalendarClock, Hand,
  RotateCcw, ExternalLink, Rows3, CalendarDays, ChevronDown,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { dateLabel, addDaysISO, longDayLabel, PRAVKA_ROUNDS } from '../lib/constants.js'
import { editDue, reviewDue } from '../lib/due.js'
import { crewEntries } from '../lib/coach.js'
import { deliveryHref, URL_RE, isSentence } from '../lib/text.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import HandIn from './HandIn.jsx'
import DayTimeline from './DayTimeline.jsx'
import PravkaNote from './PravkaNote.jsx'

// ---- the crew's day ----------------------------------------------------------
//
// THE PREVIOUS LOOK. Since October 2026 this page is what "Bring back the
// previous look" brings back; the page a crew member lands on is
// components/CoachCrewDay.jsx. What work a person holds — one entry per job —
// is read in one place for both (crewEntries in lib/coach.js), so the two
// looks can never disagree about whose a cut is or whether it is handed in.
//
// What an editor saw on opening the board, in order: a red card listing four
// late cuts with three buttons each; a headline saying six were overdue; and a
// board whose first section, "Missed — still haunting", listed the same six
// again. Three counts of one thing, twelve buttons before the day had started,
// and on a phone the whole first screen spent on it. People did not find their
// work on this page; they scrolled past a wall of alarms to reach it.
//
// So the page now answers one question — what do I hand in next — the way the
// tools people already trust answer it (Things, Linear's My Issues, an inbox):
//
//   one headline, one count, and it is the same count as the list
//   one list, oldest first, split by when it is due — not five folds to open
//   one action per row, the one that row actually needs, and only when it can
//     be done; everything else is the row itself, which opens the task
//   the late escape hatches (a new day, or saying what is in the way) folded
//     under the late row they belong to, one quiet link rather than two
//     buttons on every line
//
// Nothing here decides anything the server does not already decide. "Late",
// "due" and "handed in" are read exactly as the board reads them everywhere
// else; this only changes how much of it is shouted at once.

const KIND = {
  shoot: { Icon: Clapperboard, word: 'Shoot', go: 'Mark as filmed' },
  edit: { Icon: Scissors, word: 'Editing', go: 'Hand in' },
  design: { Icon: Palette, word: 'Artwork', go: 'Hand in' },
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5)

// A Drive address is a file, not a note. Descriptions here are often nothing
// but a link, and printing ninety characters of one under a title told the
// editor nothing and pushed the row off the edge of a phone.
const readable = (s) => String(s || '').replace(URL_RE, '').replace(/\s+/g, ' ').trim()

export default function CrewDay({
  content, statusesById, user, today, byKey, pravki = [], view, onView, onOpen, onOpenId, onUpdated, onFixed, calendar = null, children = null,
}) {
  const firstName = user.name.split(' ')[0]
  const tomorrow = addDaysISO(today, 1)
  const caps = user.crew_roles || []

  // What the server says about each late job: whether a new day has been
  // asked for, or a reason given. Keyed by task and job, because a person who
  // shoots and edits the same piece can be late on one and not the other.
  const [lateInfo, setLateInfo] = useState({})
  const loadLate = () => api.get('/content/late/mine')
    .then((rows) => {
      const m = {}
      for (const r of Array.isArray(rows) ? rows : []) m[`${r.content_id}:${r.phase}`] = r
      setLateInfo(m)
    })
    .catch(() => {})
  useEffect(() => { loadLate() }, [])

  const all = useMemo(() => crewEntries(content, user.id, statusesById), [content, user.id, statusesById])
  // A piece with changes asked of you lives in "Changes requested", with the
  // reviewer's note beside its box — listing it again below as ordinary work
  // was the same job twice, with two different buttons.
  const fixing = new Set(pravki.map((r) => `${r.content_id}:${{ operator: 'shoot', editor: 'edit', designer: 'design' }[r.target]}`))
  const open = all.filter((e) => !e.done && !fixing.has(`${e.t.id}:${e.kind}`))
  const doneRecent = all.filter((e) => e.done)
    .sort((a, b) => String(b.t.ready_at || b.t.done_at || '').localeCompare(String(a.t.ready_at || a.t.done_at || '')))
    .slice(0, 10)

  const groupOf = (e) => (!e.due ? 'none' : e.due < today ? 'late' : e.due === today ? 'today' : e.due === tomorrow ? 'tomorrow' : 'later')
  const GROUPS = [
    // 'Overdue', not 'Late': as a heading the Russian for 'Late' read «Опоздал»,
    // 'he was late' — a verdict on a person rather than the name of a pile.
    { key: 'late', label: 'Overdue' },
    { key: 'today', label: 'Today' },
    { key: 'tomorrow', label: 'Tomorrow' },
    { key: 'later', label: 'Coming up' },
    { key: 'none', label: 'No date yet' },
  ]
  const sorted = [...open].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')
    || (a.t.recording_time || '99').localeCompare(b.t.recording_time || '99'))
  const grouped = GROUPS.map((g) => ({ ...g, rows: sorted.filter((e) => groupOf(e) === g.key) })).filter((g) => g.rows.length)
  const lateN = sorted.filter((e) => groupOf(e) === 'late').length
  const todayN = sorted.filter((e) => groupOf(e) === 'today').length

  // Channels and kinds are said on a row only when they tell rows apart. An
  // editor on one channel does not need "Instagram Main" printed eleven times,
  // and somebody who only cuts does not need "Editing" beside every cut.
  const manyChannels = new Set(open.flatMap((e) => e.t.channels || [])).size > 1
  const manyKinds = new Set(open.map((e) => e.kind)).size > 1

  // One action per row, and only where it can be taken: a cut whose footage
  // has not come in cannot be handed in, and a shoot a week away cannot be
  // filmed yet. And ONE filled button on the page — on the first job that can
  // be done, which is the one the headline tells them to start with. Five red
  // buttons in a column are five shouts; the eye needs one place to land.
  const canActOn = (e) => (e.kind === 'shoot' ? (!!e.due && e.due <= today) : e.filmed)
  const firstUp = sorted.find((e) => canActOn(e) && groupOf(e) !== 'none')

  const [handing, setHanding] = useState(null)   // { t, kind }
  const [cant, setCant] = useState(null)          // key of the row whose options are open
  const [asking, setAsking] = useState(null)      // { key, e, to, reason }
  const [saying, setSaying] = useState(null)      // { key, e, reason }
  const [busy, setBusy] = useState(false)

  // Both answers go to the server exactly as the old late banner sent them,
  // filed against the deadline the SERVER says is late — which is why the
  // "Can't make it?" link is only drawn on rows the server agrees are late.
  const askNewDay = async () => {
    if (!asking || busy || !isSentence(asking.reason)) return
    setBusy(true)
    try {
      await api.post(`/content/${asking.e.t.id}/date-requests`, {
        field: asking.field, to_date: asking.to || null, reason: asking.reason.trim(),
      })
      toast(tx('Asked — an admin will answer, and you will hear it'))
      setAsking(null); setCant(null)
      loadLate()
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }
  const sayWhy = async () => {
    if (!saying || busy || !isSentence(saying.reason)) return
    setBusy(true)
    try {
      await api.post(`/content/${saying.e.t.id}/flags`, { kind: 'at_risk', reason: saying.reason.trim() })
      toast(tx('Sent — they know what is in the way'))
      setSaying(null); setCant(null)
      loadLate()
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }

  // ---- the headline: one count, the same one the list shows ----
  const niceDate = longDayLabel(today)
  const next = sorted[0]
  const headline = lateN > 0
    ? (todayN > 0
      ? tx('{name}, {late} late and {today} due today', { name: firstName, late: lateN, today: todayN })
      : tx('{name}, {n} late', { name: firstName, n: lateN }))
    : todayN > 0
      ? tx('{name}, {n} due today', { name: firstName, n: todayN })
      : next
        ? tx('{name}, you are on top of it', { name: firstName })
        : tx('{name}, all caught up', { name: firstName })
  // Changes sent back come first: the reviewer is waiting on them, and they sit
  // above the list, so the line that says where to start has to say so.
  const subline = pravki.length > 0
    ? (pravki.length === 1 ? tx('Start with the change sent back — it is just below.') : tx('Start with the changes sent back — they are just below.'))
    : lateN > 0
    ? tx('Start with the oldest — it is at the top of the list.')
    : todayN > 0
      ? tx('Everything due today is below, in order.')
      : next
        ? tx('Next: {title}, {when}.', { title: next.t.title, when: next.due ? dateLabel(next.due) : tx('no date yet') })
        : tx('Nothing is waiting on you right now.')

  const whenOf = (e) => {
    const g = groupOf(e)
    if (g === 'late') {
      const n = daysBetween(e.due, today)
      return n === 1 ? tx('1 day late') : tx('{n} days late', { n })
    }
    if (g === 'today') return e.kind === 'shoot' && e.t.recording_time ? e.t.recording_time.slice(0, 5) : tx('Today')
    if (g === 'tomorrow') return e.kind === 'shoot' && e.t.recording_time ? `${tx('Tomorrow')} ${e.t.recording_time.slice(0, 5)}` : tx('Tomorrow')
    if (g === 'none') return tx('No date')
    return dateLabel(e.due)
  }

  // What a late job can say for itself — drawn under the row in both looks.
  const lateExtras = (key, e, info) => (
    <>
      {/* The two answers a late job has, folded under the job itself —
          and only where the server has it as late, so what is asked is
          filed against the deadline that actually slipped. */}
      {info && (info.asked || info.flagged) && (
        <span className="cd-said">
          {info.asked ? <><CalendarClock size={12} /> {tx('New day asked for — waiting on an admin')}</>
            : <><Hand size={12} /> {tx('The planners know this one is late')}</>}
        </span>
      )}
      {info && !info.asked && !info.flagged && cant !== key && (
        <button type="button" className="cd-cant" onClick={() => { setCant(key); setAsking(null); setSaying(null) }}>
          {tx('Can’t make it?')}
        </button>
      )}
      {info && cant === key && !asking && !saying && (
        <span className="cd-cant-opts">
          <button type="button" className="btn btn-sm" onClick={() => setAsking({ key, e, field: info.field, to: '', reason: '' })}>
            <CalendarClock size={13} /> {tx('Ask for a new day')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setSaying({ key, e, reason: '' })}>
            <Hand size={13} /> {tx('Say what is in the way')}
          </button>
          <button type="button" className="cd-cant" onClick={() => setCant(null)}>{tx('Never mind')}</button>
        </span>
      )}
      {asking?.key === key && (
        <div className="cd-form">
          <label className="cd-form-row">
            <span>{tx('New day')}</span>
            <input className="input" type="date" min={today} value={asking.to}
              onChange={(ev) => setAsking({ ...asking, to: ev.target.value })} />
          </label>
          <textarea className="input" rows={2} autoFocus value={asking.reason}
            placeholder={tx('What happened — e.g. “the footage came in late”')}
            onChange={(ev) => setAsking({ ...asking, reason: ev.target.value })} />
          <span className="cd-form-do">
            <span className="stat-sub">{tx('An admin says yes or no; you will hear either way.')}</span>
            <button type="button" className="btn btn-sm" onClick={() => { setAsking(null); setCant(null) }}>{tx('Cancel')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !isSentence(asking.reason)} onClick={askNewDay}>
              {tx('Ask')}
            </button>
          </span>
        </div>
      )}
      {saying?.key === key && (
        <div className="cd-form">
          <textarea className="input" rows={2} autoFocus value={saying.reason}
            placeholder={tx('What is in the way — e.g. “waiting for the music”')}
            onChange={(ev) => setSaying({ ...saying, reason: ev.target.value })} />
          <span className="cd-form-do">
            <span className="stat-sub">{tx('The planners hear it straight away.')}</span>
            <button type="button" className="btn btn-sm" onClick={() => { setSaying(null); setCant(null) }}>{tx('Cancel')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !isSentence(saying.reason)} onClick={sayWhy}>
              {tx('Send')}
            </button>
          </span>
        </div>
      )}
    </>
  )

  // A render function, not a component: a component declared in here is a new
  // type on every render, and the reason box under a late row lost its focus
  // after every letter typed into it.
  const row = (e) => {
    const key = `${e.t.id}:${e.kind}`
    const g = groupOf(e)
    const K = KIND[e.kind]
    const late = g === 'late'
    const info = lateInfo[key]
    const note = readable(e.t.description)
    const canAct = canActOn(e)
    const urgent = e === firstUp
    return (
      <div key={key} className={'cd-row' + (late ? ' cd-late' : '')}>
        <button type="button" className="cd-main" onClick={() => onOpen(e.t)}>
          <span className={'cd-when' + (late ? ' late' : g === 'today' ? ' today' : '')}>{whenOf(e)}</span>
          <span className="cd-body">
            <b className="cd-title">{e.t.title}</b>
            <span className="cd-meta">
              {manyKinds && <span className="cd-kind"><K.Icon size={11} /> {tx(K.word)}</span>}
              {manyChannels && <span>{(e.t.channels || []).map((c) => byKey[c]?.label || c).join(' · ')}</span>}
              {/* Only the exception is said. Footage being in is the normal
                  state, and a line saying so on every row is a line people
                  learn not to read — including on the row where it matters. */}
              {e.kind === 'edit' && !e.t.shot_link && (
                e.filmed
                  ? <span className="cd-in">{tx('Filmed — no link yet')}</span>
                  : <span className="cd-in wait">{tx('Waiting for footage')}</span>
              )}
              {note && <span className="cd-note">{note}</span>}
            </span>
          </span>
        </button>
        <span className="cd-do">
          {canAct && (
            <button type="button" className={'btn btn-sm cd-go' + (urgent ? ' btn-primary' : '')}
              onClick={() => setHanding({ t: e.t, kind: e.kind })}>
              {e.kind === 'shoot' ? <Clapperboard size={13} /> : <Check size={13} />} {tx(K.go)}
            </button>
          )}
        </span>

        {lateExtras(key, e, info)}
      </div>
    )
  }

  // ---- today, by the clock ----
  // The shoots this person holds today, in time order on a strip (the same
  // strip a planner sees when booking them), and underneath, everything else
  // due from them today that has no hour: a shoot booked for the day but not
  // the time, a cut, a piece of artwork. Each is ticked off there the moment it
  // is handed in — the hand-in window stays the only button.
  // Shown to all of the crew. It used to be only whoever films, so an editor
  // opened their page to no day at all: their work has no hours, but it is
  // still today's, and seeing today is the first thing this page is for.
  const todaysShoots = all.filter((e) => e.kind === 'shoot' && e.t.recording_date === today)
  const todaysOther = all.filter((e) => e.kind !== 'shoot' && e.due === today)
  const unscheduled = [...todaysShoots.filter((e) => !e.t.recording_time), ...todaysOther]
  const filmedIds = todaysShoots.filter((e) => e.done).map((e) => e.t.id)
  const showTimeline = caps.length > 0 || todaysShoots.length > 0 || todaysOther.length > 0

  return (
    <div className="cd">
      <div className="card card-pad cd-hero">
        <div className="brief-hello"><Sun size={18} /> {niceDate}</div>
        <h2 className="brief-title">{headline}</h2>
        <p className="cd-subline">{subline}</p>
      </div>

      {showTimeline && (
        <section className="card card-pad cd-timeline" aria-label={tx('Your timeline today')}>
          <DayTimeline readOnly userId={user.id} day={today} done={filmedIds} title={tx('Your timeline today')}
            stamp={todaysShoots.map((e) => `${e.t.id}:${e.t.recording_time || ''}-${e.t.recording_end || ''}:${e.t.status_id}`).join('|')} />
          {unscheduled.length > 0 && (
            <div className="cd-unscheduled">
              <span className="cd-unscheduled-label">{tx('Unscheduled today')}</span>
              {unscheduled.map((e) => {
                const { Icon } = KIND[e.kind]
                return (
                  <button key={`${e.kind}${e.t.id}`} type="button" className={'cd-unscheduled-item' + (e.done ? ' done' : '')} onClick={() => onOpen(e.t)}
                    title={e.done ? `${e.t.title} · ${tx('Completed')}` : e.t.title}>
                    {e.done ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <Icon size={12} aria-hidden="true" />}
                    <span className="cd-unscheduled-title">{e.t.title}</span>
                    {e.done && <span className="dt-sr"> · {tx('Completed')}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Whatever the page wants said right under the headline — the bookings
          waiting on an answer. */}
      {children}

      {pravki.length > 0 && (
        <section className="cd-changes">
          <div className="cd-sec-head">
            <RotateCcw size={16} />
            <b>{tx('Changes requested')}</b>
            <span className="count">· {pravki.length}</span>
          </div>
          {pravki.map((r) => <ChangeCard key={r.id} rev={r} byKey={byKey} today={today} onOpen={onOpenId} onFixed={onFixed} />)}
        </section>
      )}

      <section className="card cd-list">
        <div className="cd-list-head">
          <b>{caps.includes('operator') && !caps.includes('editor') ? tx('Your shoots') : tx('Your work')}</b>
          <span className="count">· {open.length}</span>
          <span className="spacer" />
          <span className="seg cd-view" role="tablist" aria-label={tx('How to show it')}>
            <button type="button" role="tab" aria-selected={view !== 'calendar'} className={'seg-btn' + (view !== 'calendar' ? ' on' : '')}
              onClick={() => onView('list')} data-tip={tx('List')} aria-label={tx('List')}><Rows3 size={14} /></button>
            <button type="button" role="tab" aria-selected={view === 'calendar'} className={'seg-btn' + (view === 'calendar' ? ' on' : '')}
              onClick={() => onView('calendar')} data-tip={tx('Calendar')} aria-label={tx('Calendar')}><CalendarDays size={14} /></button>
          </span>
        </div>
        {view === 'calendar' && calendar}
        {view !== 'calendar' && (grouped.length === 0 ? (
          <div className="cd-empty">
            <CheckCircle2 size={22} />
            <b>{tx('Nothing to hand in')}</b>
            <span className="stat-sub">{tx('New work shows up here the moment it is given to you.')}</span>
          </div>
        ) : grouped.map((g) => (
          <div key={g.key} className={'cd-group cd-group-' + g.key}>
            <div className="cd-group-head">{tx(g.label)} <span>{g.rows.length}</span></div>
            {g.rows.map(row)}
          </div>
        )))}
      </section>

      {view !== 'calendar' && doneRecent.length > 0 && (
        <details className="card cd-done">
          <summary><CheckCircle2 size={15} /> {tx('Handed in recently')} <span className="count">· {doneRecent.length}</span><ChevronDown size={14} className="cd-done-caret" /></summary>
          {doneRecent.map((e) => (
            <button key={`${e.t.id}:${e.kind}`} type="button" className="cd-done-row" onClick={() => onOpen(e.t)}>
              <Check size={13} /> <span>{e.t.title}</span>
            </button>
          ))}
        </details>
      )}

      {handing && (
        <HandIn item={handing.t} kind={handing.kind}
          onDone={(u) => { onUpdated?.(u); loadLate() }}
          onClose={() => setHanding(null)}
          onOpenFull={onOpen} />
      )}
    </div>
  )
}

// ---- changes somebody sent back -----------------------------------------------
// The reviewer's note, the file that was sent back, and one box for the new
// one. Deliberately EMPTY, not pre-filled with the old file: pre-filling made
// "fixed" one press away from re-delivering the same cut, which is how a whole
// round of changes used to evaporate.
function ChangeCard({ rev, byKey, today, onOpen, onFixed }) {
  const col = rev.target === 'operator' ? 'shot_link' : rev.target === 'designer' ? 'design_link' : 'ready_link'
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const due = rev.target === 'operator' ? rev.recording_date
    : rev.target === 'designer' ? (rev.design_ready_date || reviewDue(rev))
      : (editDue(rev) || reviewDue(rev))
  // The round's own record of what it sent back (the box may already hold
  // the new version); a round older than that record falls back to the task.
  const was = rev.sent_link != null ? rev.sent_link : (rev[col] || '')
  const same = link.trim() && link.trim() === was
  const sentBack = deliveryHref(was)
  const refs = (rev.reference_links || []).filter((u) => /^https?:\/\//i.test(u))
  const prior = (rev.history || []).filter((h) => h.round !== rev.round)
  const fix = async () => { setBusy(true); try { await onFixed(rev, link.trim()) } finally { setBusy(false) } }
  return (
    <div className="card cd-change">
      <button type="button" className="cd-change-top" onClick={() => onOpen(rev.content_id)}>
        <b>{rev.title}</b>
        <span className="stat-sub">
          {tx('from {name}', { name: rev.requested_name || 'SMM' })}
          {rev.round > 1 ? ` · ${tx('round {n}', { n: rev.round })}` : ''}
          {due ? <> · <span className={due < today ? 'cd-due-late' : ''}>{tx('due {day}', { day: dateLabel(due) })}</span></> : null}
          {(rev.channels || []).length > 0 ? ` · ${rev.channels.map((c) => byKey[c]?.label || c).join(' · ')}` : ''}
        </span>
      </button>
      <p className="cd-change-note"><PravkaNote text={rev.note} /></p>
      {/* The last round says so where the fix is made: the next hand-in is
          the one that goes out, whatever anybody thinks of it then. */}
      {rev.round >= PRAVKA_ROUNDS && (
        <span className="cd-change-last">{tx('This is the last pravka — the next delivery is approved as it stands.')}</span>
      )}
      {/* What the reviewer pointed at, and what they asked for before. Both
          matter when fixing and neither needs to be read first, so the links
          are one line and the earlier rounds stay folded. */}
      {(rev.reference_text || refs.length > 0) && (
        <div className="cd-change-refs">
          {rev.reference_text && <span>{rev.reference_text}</span>}
          {refs.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer"><ExternalLink size={11} /> {tx('Example {n}', { n: i + 1 })}</a>
          ))}
        </div>
      )}
      {prior.length > 0 && (
        <details className="cd-change-prior">
          <summary>{tx('Asked before')} · {prior.length}</summary>
          {prior.map((h) => (
            <div key={h.round} className="cd-change-prior-row">
              <b>{h.round}.</b> <PravkaNote text={h.note} />
              <span className="stat-sub"> — {h.requested_name || 'SMM'}{h.resolved_at ? ` · ${tx('fixed')}` : ''}</span>
            </div>
          ))}
        </details>
      )}
      <div className="cd-change-fix">
        <input className="input" value={link} placeholder={tx('Link to the new version')}
          onChange={(e) => setLink(e.target.value)} />
        {sentBack && (
          <a className="btn btn-sm" href={sentBack} target="_blank" rel="noreferrer"
            data-tip={tx('The version that was sent back')} aria-label={tx('The version that was sent back')}>
            <ExternalLink size={13} />
          </a>
        )}
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || !link.trim() || same} onClick={fix}>
          <Check size={13} /> {tx('Hand in the fix')}
        </button>
      </div>
      {same && <div className="cd-change-same">{tx('That is the version that was sent back — paste the new one.')}</div>}
    </div>
  )
}

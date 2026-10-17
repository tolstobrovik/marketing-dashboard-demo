import { useMemo, useState } from 'react'
import { Clapperboard, Scissors, AlertTriangle, ChevronRight, ChevronDown, Check } from 'lucide-react'
import { addDaysISO, dateLabel } from '../lib/constants.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- Post Production, on a phone -------------------------------------------
//
// The desk shows the week as people × days: a 1,300-pixel grid. Squeezed onto
// a phone it lost the one thing it existed to say — WHO — because the column
// of names collapsed to an empty block, and only the first day kept a heading.
// It also asked for the one gesture a phone cannot make: "drag onto a day".
//
// A phone asks a narrower question: what is happening on a given day, and who
// is doing it. So: pick a day, read a list. Every row says when, what, who and
// where, and a press opens the task — which is where anything is changed on a
// phone, dates included. Late work is one line that opens into a list, not a
// tray of chips waiting to be dragged.

// The day a cut is owed: the editor's own deadline — the re-promised one if a
// late handover wrote one — else the release it is holding up. The same order
// deadlines.js reads, so this page and the server agree about the day.
const cutDue = (t) => t.edit_due_revised || t.edit_ready_date || t.review_due_revised || t.release_date || null
// Past the shoot on the pipeline, whatever the timestamps say — the rule My
// Day already uses, so the two never disagree about whether a shoot is over.
const SHOT_STAGE = /shot|edit|ready|publish|post|got/i

const dayWord = (iso, today) => {
  if (iso === today) return tx('Today')
  if (iso === addDaysISO(today, 1)) return tx('Tomorrow')
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function CrewAgenda({ crew, content, statuses, today, byKey, onOpen }) {
  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(today, i)), [today])
  const [day, setDay] = useState(today)
  const [lateOpen, setLateOpen] = useState(false)

  const { byDay, late } = useMemo(() => {
    const ids = new Set(crew.map((u) => u.id))
    const nameOf = Object.fromEntries(crew.map((u) => [u.id, u.name.split(' ')[0]]))
    const shotAlready = (t) => !!t.shot_at || !!t.done_at || SHOT_STAGE.test(statusesById[t.status_id]?.label || '')
    const cutAlready = (t) => !!t.ready_at || !!t.done_at
    const byDay = Object.fromEntries(week.map((d) => [d, []]))
    const late = []
    for (const t of content) {
      if (ids.has(t.operator_id) && t.recording_date) {
        const row = { t, kind: 'shoot', who: nameOf[t.operator_id], time: t.recording_time || '', end: t.recording_end || '', done: shotAlready(t) }
        if (byDay[t.recording_date]) byDay[t.recording_date].push(row)
        else if (t.recording_date < today && !row.done) late.push({ ...row, day: t.recording_date })
      }
      const due = cutDue(t)
      if (ids.has(t.editor_id) && due && !cutAlready(t)) {
        const row = { t, kind: 'cut', who: nameOf[t.editor_id], time: '', end: '', done: false }
        if (byDay[due]) byDay[due].push(row)
        else if (due < today) late.push({ ...row, day: due })
      }
    }
    // Timed shoots first, in time order; then the cuts, which have a day and
    // no hour. Finished work sinks to the bottom of its day.
    for (const d of week) byDay[d].sort((a, b) => (a.done - b.done) || (a.kind === b.kind ? 0 : a.kind === 'shoot' ? -1 : 1) || (a.time || '99').localeCompare(b.time || '99'))
    late.sort((a, b) => a.day.localeCompare(b.day))
    return { byDay, late }
  }, [crew, content, statusesById, week, today])

  const rows = byDay[day] || []
  const open = (row) => onOpen(row.t)

  return (
    <div className="ag">
      {late.length > 0 && (
        <div className={'ag-late' + (lateOpen ? ' open' : '')}>
          <button type="button" className="ag-late-head" onClick={() => setLateOpen(!lateOpen)} aria-expanded={lateOpen}>
            <AlertTriangle size={16} />
            <b>{tx('Late')} · {late.length}</b>
            <ChevronDown size={18} className="ag-caret" />
          </button>
          {lateOpen && late.map((r) => (
            <Row key={`${r.kind}${r.t.id}`} row={r} byKey={byKey} onOpen={open} when={dateLabel(r.day)} />
          ))}
        </div>
      )}

      {/* The week as seven buttons. Each carries its count, so an empty day
          is visible before it is pressed. */}
      <div className="ag-days" role="tablist">
        {week.map((d) => {
          const n = byDay[d].filter((r) => !r.done).length
          return (
            <button key={d} type="button" role="tab" aria-selected={d === day}
              className={'ag-day' + (d === day ? ' on' : '') + (n === 0 ? ' empty' : '')} onClick={() => setDay(d)}>
              <span className="ag-day-name">{dayWord(d, today)}</span>
              <span className="ag-day-n">{n || '·'}</span>
            </button>
          )
        })}
      </div>

      <div className="ag-list">
        {rows.length === 0
          ? <div className="ag-empty">{tx('No bookings')}</div>
          : rows.map((r) => <Row key={`${r.kind}${r.t.id}`} row={r} byKey={byKey} onOpen={open} />)}
      </div>
    </div>
  )
}

function Row({ row, byKey, onOpen, when }) {
  const { t, kind, who, time, end, done } = row
  const chan = (t.channels || []).map((c) => byKey[c]?.label || c)[0]
  return (
    <button type="button" className={`ag-row ag-${kind}` + (done ? ' done' : '')} onClick={() => onOpen(row)}>
      <span className="ag-when">
        {kind === 'shoot'
          ? (time ? <><b>{time}</b>{end && <small>{end}</small>}</> : <Clapperboard size={18} />)
          : <Scissors size={18} />}
      </span>
      <span className="ag-body">
        <span className="ag-title">{done && <Check size={14} />} {t.title}</span>
        <span className="ag-meta">
          {kind === 'shoot' ? tx('Shoot') : tx('Editing')} · <b>{who}</b>{chan ? ` · ${chan}` : ''}{when ? ` · ${when}` : ''}
        </span>
      </span>
      <ChevronRight size={18} className="ag-go" />
    </button>
  )
}

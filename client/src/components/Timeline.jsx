import { Check } from 'lucide-react'
import { KIND, Face, firstName, dayShort, hoursOf } from './CoachParts.jsx'
import { wayOf } from '../lib/coach.js'
import { editDue } from '../lib/due.js'
import { tashkentDay } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the timeline (round 18, 23 Oct 2026): the line is the interface ----------
//
// Every piece is a line of stops — Idea → Shoot → Edit → Out (a written piece
// three, a repost two: wayOf's answer) — and the stop it is on is lit. The
// same line is drawn in three sizes: `row` on My Day (icons only; the stop
// that is yours wears your kind's colour as a ring), `top` over the task
// window (the word, whose and the day under each stop) and `plan` in the new
// task form (the stops are tabs; pressing one opens its day and its person
// under the line). Position replaces words: nobody reads "not your step now"
// when the lit stop is somebody else's face.
//
// The marks are round 17's (KIND in CoachParts.jsx): a clapperboard for the
// shoot, scissors for the edit, a palette for the artwork, a tick for out.

const kindOfStop = (s) => (s.role === 'final' ? 'out' : s.role === 'review' ? 'send' : s.role === 'shoot' ? 'shoot'
  : s.role === 'edit' ? (s.verb === 'draw' ? 'design' : 'edit') : 'idea')

// A task's stops, read off wayOf — never a reading of their own. Each carries
// its kind, where it stands, who has it and its day.
export function timelineOf(t, pipe, making, { person = null, userId = null, today = '' } = {}) {
  const stops = wayOf(t, pipe, making).filter((s) => s.cls !== 'skip')
  const found = stops.findIndex((s) => s.cls === 'on')
  const on = found >= 0 ? found : t.done_at ? stops.length - 1 : -1
  return stops.map((s, i) => {
    const kind = kindOfStop(s)
    const day = kind === 'shoot' ? t.recording_date : kind === 'edit' ? editDue(t) : kind === 'design' ? t.design_ready_date
      : kind === 'out' ? (t.done_at ? tashkentDay(t.done_at) : t.release_date) : ''
    const hours = kind === 'shoot' ? hoursOf(t) : ''
    const state = i === on ? 'on' : (on < 0 ? s.cls === 'done' : i < on) ? 'done' : 'todo'
    return {
      key: s.id, kind, label: tx(s.label || ''), state,
      who: s.who ? person?.(s.who) || null : null,
      mine: !!userId && s.who === userId,
      when: day ? `${dayShort(day)}${hours ? `, ${hours}` : ''}` : '',
      late: state === 'on' && !!day && !!today && day < today && !t.done_at,
    }
  })
}

export default function Timeline({ stops, size = 'row', picked = null, onPick = null, label = '', youId = null }) {
  const name = (s) => (s.who ? (youId && s.who.id === youId ? tx('You') : firstName(s.who)) : '')
  return (
    <ol className={`co-line co-line-${size}`} aria-label={label || tx('Stages')}>
      {stops.map((s) => {
        const K = KIND[s.kind] || KIND.idea
        const Icon = s.state === 'done' ? Check : K.Icon
        const under = s.sub ?? [name(s), s.when].filter(Boolean).join(' · ')
        const inner = (
          <>
            <span className="co-line-ic" aria-hidden="true">
              {size !== 'row' && s.who && s.state !== 'done' ? <Face person={s.who} size="xs" /> : <Icon size={size === 'row' ? 11 : 15} />}
            </span>
            {size !== 'row' && (
              <span className="co-line-txt">
                <b>{s.label}</b>
                {under && <small>{under}</small>}
              </span>
            )}
          </>
        )
        const cls = `co-line-s ${K.cls} is-${s.state}${s.mine ? ' mine' : ''}${s.late ? ' is-late' : ''}${picked === s.key ? ' picked' : ''}`
        const title = `${s.label}${name(s) ? ` — ${name(s)}` : ''}${s.when ? ` · ${s.when}` : ''}`
        return (
          <li key={s.key} className={cls} aria-current={s.state === 'on' ? 'step' : undefined} title={size === 'row' ? title : undefined}>
            {onPick && !s.fixed
              ? <button type="button" role="tab" aria-selected={picked === s.key} onClick={() => onPick(s.key)}>{inner}</button>
              : inner}
          </li>
        )
      })}
    </ol>
  )
}

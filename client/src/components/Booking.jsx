import { useState } from 'react'
import { CalendarCheck, CalendarX, Clock, Check, X, Hourglass, Undo2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx, locale } from '../lib/i18n.jsx'
import DayPick, { TimePick } from './DayPick.jsx'
import { todayISO, fmtDay } from '../lib/constants.js'
import { editDue } from '../lib/due.js'

// ---- the time the crew agreed to ----
// A shoot day used to be a fact the moment somebody typed it. It is not: the
// person holding the camera has an afternoon that is either free or not, and
// the board found out which on the day. Same for an editor handed a deadline.
//
// So a booking is a question, and this is where it is asked and answered.
// The planner books; the person holding it says yes or no. A "no" is strict:
// it carries a reason, and it says what happens next — another time this
// person CAN do, which goes to the planner as a request to move the day, or
// that they cannot take this one at all, in which case the seat is emptied on
// the spot and the task is back in the pool. A "no" that leaves the task
// sitting under a name that already said no is the thing this replaces.

const HOURS = (from, to) => {
  if (!from || !to) return ''
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const mins = m(to) - m(from)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const r = mins % 60
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`
}

const dayWords = (iso) => fmtDay(iso)

// `openNo` opens it with the "no" already being written — for the Coach look's
// big card, whose "I can’t" has to land on the reason box, because a no is
// only taken with a reason.
export default function Booking({ item, which, label, holderName, mine, onAnswered, openNo = false }) {
  const [busy, setBusy] = useState(false)
  const [saying, setSaying] = useState(() => (openNo && item
    ? { note: '', mode: 'later', day: '', from: (which === 'shoot' && item.recording_time) || '', to: (which === 'shoot' && item.recording_end) || '' }
    : null)) // null | { note, mode: 'later'|'release', day, from, to }
  if (!item) return null

  const K = which === 'shoot'
    ? { ack: 'shoot_ack', at: 'shoot_ack_at', note: 'shoot_ack_note', day: 'recording_date', from: 'recording_time', to: 'recording_end', role: tx('operator') }
    : { ack: 'edit_ack', at: 'edit_ack_at', note: 'edit_ack_note', day: 'edit_ready_date', from: null, to: null, role: tx('editor') }
  // The editor is asked about the day they actually owe. A deadline
  // re-promised after a late handover replaces the original, so confirming
  // the original would be answering for a day nobody is working to.
  const day = which === 'shoot' ? item[K.day] : editDue(item)
  // …and so does a re-promise with no booking under it: the server books an
  // edit on edit_ready_date and answers "Nothing is booked yet" without one.
  if (!day || !item[K.day] || !holderName) return null // half a plan owes nobody an answer

  const state = item[K.ack] || ''
  const from = K.from ? item[K.from] : null
  const to = K.to ? item[K.to] : null
  const span = HOURS(from, to)
  // A day that has already gone by is not a question any more.
  const gone = day < todayISO()

  const answer = async (ok, extra = {}) => {
    setBusy(true)
    try {
      const next = await api.post(`/content/${item.id}/confirm`, { which, ok, ...extra })
      toast(ok ? tx('Confirmed — it is in your day now')
        : extra.release ? tx('Handed back — it needs a new {role} now', { role: K.role })
          : tx('Sent — whoever booked it has been asked to move it'))
      setSaying(null)
      onAnswered?.(next)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const canSend = saying && saying.note.trim() && (saying.mode === 'release' || (saying.mode === 'later' && saying.day))
  const send = () => {
    if (!canSend) return
    if (saying.mode === 'release') return answer(false, { note: saying.note.trim(), release: true })
    return answer(false, { note: saying.note.trim(), suggest: { day: saying.day, from: K.from ? saying.from || null : null, to: K.to ? saying.to || null : null } })
  }

  const Icon = state === 'yes' ? CalendarCheck : state === 'no' ? CalendarX : Hourglass
  return (
    <div className={`bk bk-${state || (gone ? 'gone' : 'wait')}`}>
      <div className="bk-slot">
        <Icon size={15} className="bk-ico" />
        <span className="bk-when">
          <b>{dayWords(day)}</b>
          {from && <span className="bk-time"><Clock size={11} /> {from}{to ? `–${to}` : ''}{span ? ` · ${span}` : ''}</span>}
        </span>
        <span className="bk-label">{label}</span>
      </div>

      <div className="bk-line">
        {state === 'yes' && <span className="bk-said bk-yes"><Check size={13} strokeWidth={3} /> {tx('{name} confirmed', { name: holderName })}</span>}
        {state === 'no' && (
          <span className="bk-said bk-no">
            <X size={13} strokeWidth={3} /> {tx('{name} can’t make it', { name: holderName })}
            {item[K.note] ? <i className="bk-why">“{item[K.note]}”</i> : null}
          </span>
        )}
        {!state && !gone && <span className="bk-said bk-wait">{tx('Waiting on {name}', { name: holderName })}</span>}
        {!state && gone && <span className="bk-said bk-gone">{tx('The day passed with no answer from {name}', { name: holderName })}</span>}

        {mine && !gone && !saying && (
          <span className="bk-do">
            {state !== 'yes' && (
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => answer(true)}>
                <Check size={13} /> {tx('I can make it')}
              </button>
            )}
            {state !== 'no' && (
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setSaying({ note: '', mode: 'later', day: '', from: from || '', to: to || '' })}>
                <X size={13} /> {tx('I can’t')}
              </button>
            )}
          </span>
        )}
      </div>

      {mine && !gone && saying && (
        <div className="bk-form">
          <textarea className="input" rows={2} autoFocus value={saying.note}
            onChange={(e) => setSaying({ ...saying, note: e.target.value })}
            placeholder={tx('What is in the way? Another shoot, an exam, out of town…')} />
          <div className="bk-choice" role="radiogroup">
            <label className={'bk-opt' + (saying.mode === 'later' ? ' on' : '')}>
              <input type="radio" name={`bk-${which}-${item.id}`} checked={saying.mode === 'later'} onChange={() => setSaying({ ...saying, mode: 'later' })} />
              <Clock size={13} /> {tx('I can do it another time')}
            </label>
            {saying.mode === 'later' && (
              <div className="bk-when-pick">
                <DayPick value={saying.day} min={todayISO()} label={tx('Suggest a day')} placeholder={tx('Suggest a day')}
                  onChange={(d) => setSaying({ ...saying, day: d })} />
                {K.from && (<>
                  <span className="stat-sub">{tx('from')}</span>
                  <TimePick value={saying.from} label={tx('from')} onChange={(t) => setSaying({ ...saying, from: t })} />
                  <span className="stat-sub">{tx('to')}</span>
                  <TimePick value={saying.to} label={tx('to')} onChange={(t) => setSaying({ ...saying, to: t })} />
                </>)}
              </div>
            )}
            <label className={'bk-opt' + (saying.mode === 'release' ? ' on' : '')}>
              <input type="radio" name={`bk-${which}-${item.id}`} checked={saying.mode === 'release'} onChange={() => setSaying({ ...saying, mode: 'release' })} />
              <Undo2 size={13} /> {tx('I can’t take this one — hand it back')}
            </label>
          </div>
          <div className="bk-actions">
            <span className="stat-sub">{saying.note.trim() ? '' : tx('Say what is in the way first')}</span>
            <button type="button" className="btn btn-sm" onClick={() => setSaying(null)}>{tx('Cancel')}</button>
            <button type="button" className={'btn btn-sm ' + (saying.mode === 'release' ? 'btn-danger' : 'btn-primary')} disabled={busy || !canSend} onClick={send}>
              {tx('Send it')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

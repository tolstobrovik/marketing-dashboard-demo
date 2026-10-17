import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Scissors } from 'lucide-react'
import { addDaysISO, longDayLabel } from '../../lib/constants.js'
import { tr as tx } from '../../lib/i18n.jsx'
import FacePicker from './FacePicker.jsx'
import DayTimeline from '../DayTimeline.jsx'

// A deadline as one line with two arrows: never before `floor`, never after
// `ceil` (the release, once there is one).
export function DueStepper({ Icon, label, day, floor, ceil, onDay }) {
  return (
    <div className="tb-cut">
      <span className="tb-faces-label"><Icon size={14} /> {label}</span>
      <span className="tb-cut-step">
        <button type="button" className="mc-nav" disabled={day <= floor} onClick={() => onDay(addDaysISO(day, -1))} aria-label={tx('A day earlier')}>
          <ChevronLeft size={16} />
        </button>
        <b aria-live="polite">{longDayLabel(day)}</b>
        <button type="button" className="mc-nav" disabled={!!ceil && day >= ceil} onClick={() => onDay(addDaysISO(day, 1))} aria-label={tx('A day later')}>
          <ChevronRight size={16} />
        </button>
      </span>
    </div>
  )
}

// The cut — after the shoot. Who edits it, their day (shown, not picked
// from: an editor is not booked by the hour), and the day the cut is due.
export default function StepEdit({ editors, editorId, onEditor, sameAsShooter, cut, cutFloor, release, onCut }) {
  const [view, setView] = useState(null)
  useEffect(() => { setView(null) }, [cut])
  const first = (editors.find((u) => u.id === editorId)?.name || '').split(' ')[0]
  return (
    <div className="tb-q">
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><Scissors size={18} /></span>{tx('The edit')}</h2>
      <FacePicker label={tx('Who edits it?')} Icon={Scissors} people={editors} value={editorId} onChange={onEditor} />
      {editorId && !sameAsShooter && (
        <DayTimeline readOnly showDue showUntimed userId={editorId} day={view || cut || cutFloor} onDay={setView}
          title={tx('{name}’s day', { name: first })} />
      )}
      {cut && <DueStepper Icon={Scissors} label={tx('Edit due')} day={cut} floor={cutFloor} ceil={release} onDay={onCut} />}
    </div>
  )
}

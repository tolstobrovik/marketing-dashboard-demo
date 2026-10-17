import { useState } from 'react'
import { Clapperboard, Video, Users, X, Plus } from 'lucide-react'
import { longDayLabel } from '../../lib/constants.js'
import { tr as tx } from '../../lib/i18n.jsx'
import FacePicker from './FacePicker.jsx'
import DayTimeline from '../DayTimeline.jsx'

// The shoot — for the kinds that are filmed. Who films it, the half-hour on
// their day (press a free one to book it), and who is in front of the camera.
// All optional: an idea can be written down long before anybody is booked.
export default function StepShoot({ today, operators, operatorId, onOperator, filming, filmFrom, filmTo, onFilm, onClearFilming, people, faces, onFaces, showDue, askFaces, release = '' }) {
  // The day their strip shows: the shoot once one is set, else today.
  const [viewDay, setViewDay] = useState(() => (filming && filming >= today ? filming : today))
  // Who is in it is a paid ad's question; anywhere else it waits behind a link.
  const [facesOpen, setFacesOpen] = useState(() => askFaces || faces.length > 0)
  return (
    <div className="tb-q">
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><Clapperboard size={18} /></span>{tx('Book the shoot')}</h2>
      <FacePicker label={tx('Who films it?')} Icon={Video} people={operators} value={operatorId} onChange={onOperator} />
      {filming && !operatorId && (
        <p className="tb-film-day">
          <Clapperboard size={14} /> {tx('Filming on {day}', { day: longDayLabel(filming) })}
          <button type="button" className="icon-btn tb-x" onClick={onClearFilming} aria-label={tx('Remove the filming day')}>
            <X size={13} />
          </button>
        </p>
      )}
      {/* Their day, the moment they are picked: press a free half-hour to
          book the shoot from there. */}
      {operatorId && (
        <DayTimeline userId={operatorId} day={viewDay} onDay={setViewDay} showUntimed showDue={showDue}
          value={filming === viewDay && filmFrom ? { from: filmFrom, to: filmTo } : null}
          onPick={(slot) => onFilm({ date: viewDay, ...slot })}
          onClear={() => onFilm(null)} />
      )}
      {/* The day it goes out is asked first now (round 13), so a shoot after it is said here. */}
      {filming && release && filming > release && (
        <p className="tb-film-day tb-film-late" role="alert">
          <Clapperboard size={14} aria-hidden="true" /> {tx('It goes out on {day}, before this shoot. Pick an earlier day, or move the release.', { day: longDayLabel(release) })}
        </p>
      )}
      {facesOpen
        ? <FacePicker label={tx('Who is in it?')} Icon={Users} people={people} value={faces} onChange={onFaces} multi />
        : (
          <button type="button" className="tb-link tb-more-q" onClick={() => setFacesOpen(true)}>
            <Plus size={14} /> {tx('Who is in it?')}
          </button>
        )}
    </div>
  )
}

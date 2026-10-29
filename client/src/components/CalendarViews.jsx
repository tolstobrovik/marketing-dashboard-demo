import { useNavigate } from 'react-router-dom'
import { Send, Clapperboard, CalendarDays } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { usePages } from '../lib/pages.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// The buttons at the top of the one calendar frame (round 15): Shooting and
// Releasing are Schedule.jsx's two routes, one press apart with the address
// kept; Mine is the crew's own month (Brief.jsx with `calendar`, at
// /brief/calendar), offered to whoever holds a seat on a piece. One door,
// "Calendar", in every menu; which buttons a person has is the question every
// door already asks (pages.jsx), and a person with one view sees no strip.
//
// `go` is Schedule's own navigation for its two views, which carries the
// channels and the lens along in the address; Mine is a plain address.
const CREW = ['editor', 'operator', 'designer', 'crew']
export const hasSeat = (user) => CREW.includes(user?.role)

export default function CalendarViews({ active, go = null }) {
  const { user } = useAuth()
  const { shows } = usePages()
  const navigate = useNavigate()
  const views = [
    shows('recordings') && { key: 'recording', label: tx('Shooting'), Icon: Clapperboard, to: '/recordings' },
    shows('releases') && { key: 'release', label: tx('Releasing'), Icon: Send, to: '/calendar' },
    hasSeat(user) && { key: 'mine', label: tx('Mine'), Icon: CalendarDays, to: '/brief/calendar' },
  ].filter(Boolean)
  if (views.length < 2) return null
  const press = (v) => {
    if (v.key === active) return
    if (v.key !== 'mine' && go) go(v.key); else navigate(v.to)
  }
  return (
    <div className="sch-view" role="tablist" aria-label={tx('Calendar')}>
      {views.map((v) => (
        <button key={v.key} type="button" role="tab" aria-selected={v.key === active} className={'sch-view-btn' + (v.key === active ? ' active' : '')}
          onClick={() => press(v)}>
          <v.Icon size={14} aria-hidden="true" /> {v.label}
        </button>
      ))}
    </div>
  )
}

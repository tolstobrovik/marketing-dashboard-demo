import { useMemo } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import People from '../components/team/People.jsx'
import Workload from '../components/team/Workload.jsx'
import Access from '../components/team/Access.jsx'

// Team (N-03, TZ of 19 October 2026, section 4.0). Three pages listed the
// same twelve people: Team & hiring (cards with phone and hours, plus Hiring
// and Candidates folded), Post Production (the same people as capacity rows)
// and Admin → Team (the same people as a table with roles, channels and
// permissions). One page now, three tabs under one headline:
//
//   People     the cards — who we have, how to reach them, when they work
//   Workload   the crew's and the designers' desks: deck, timetable, list
//   Access     every account, its role, channels and permissions
//
// Admins only, as every one of the three was. Hiring and Candidates are gone
// (decided); /crew and /admin?tab=team land on their tabs (App.jsx).
export default function Team() {
  const { user } = useAuth()
  const runsEverything = user.role === 'admin' && !(user.admin_channels || []).length
  const tabs = useMemo(() => [
    { key: 'people', label: tx('People') },
    { key: 'workload', label: tx('Workload') },
    runsEverything && { key: 'access', label: tx('Access') },
  ].filter(Boolean), [runsEverything])
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const tab = tabs.some((t) => t.key === asked) ? asked : 'people'
  const pick = (key) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return (
    <div className="co tm">
      <header className="co-head co-cal-head">
        <h1 className="co-title">{tx('Team')}</h1>
        <span className="co-switch" role="group" aria-label={tx('Which part of the team')}>
          {tabs.map((t) => (
            <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => pick(t.key)}>{t.label}</button>
          ))}
        </span>
      </header>
      {tab === 'people' && <People />}
      {tab === 'workload' && <Workload />}
      {tab === 'access' && <Access />}
    </div>
  )
}

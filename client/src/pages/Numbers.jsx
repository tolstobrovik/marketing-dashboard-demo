import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { usePages } from '../lib/pages.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO } from '../lib/constants.js'
import { monthLabel, shiftMonth, monthEdges } from '../lib/month.js'
import { tr as tx } from '../lib/i18n.jsx'
import Month from '../components/numbers/Month.jsx'
import People from '../components/numbers/People.jsx'
import { Reports } from '../components/numbers/Reports.jsx'
import Pay from '../components/numbers/Pay.jsx'

// Numbers (N-02, TZ of 19 October 2026, section 4.0). Five pages answered
// "what happened this month and what does it cost" — Statistics (/missed),
// Payment (/docs), Admin → Reports, Admin → Pay and the Overview — with five
// layouts and five month pickers. One page now, three tabs under one headline:
//
//   Month    where the board and the month stand, and what got watched
//   People   who is late and how late; who did what; what everyone made
//   Pay      the payroll (admins who run the whole board)
//
// One month picker, one channel menu and one person menu, shared by the tabs
// and kept in the address, so a link says what it shows. A member's own pay
// is not a board page: it is "My pay" under their profile. The old addresses
// land here (App.jsx).
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()).slice(0, 7)

export default function Numbers() {
  const { user } = useAuth()
  const { shows } = usePages()
  const { channels, byKey } = useChannels()
  const isAdmin = user.role === 'admin'
  const runsEverything = isAdmin && !(user.admin_channels || []).length
  const tabs = useMemo(() => [
    isAdmin && { key: 'month', label: tx('Month') },
    (isAdmin || shows('missed')) && { key: 'people', label: tx('People') },
    runsEverything && { key: 'pay', label: tx('Pay') },
  ].filter(Boolean), [isAdmin, runsEverything, shows])

  const [params, setParams] = useSearchParams()
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  const asked = params.get('tab')
  const tab = tabs.some((t) => t.key === asked) ? asked : tabs[0]?.key
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : thisMonth()
  const channel = byKey[params.get('channel')] ? params.get('channel') : 'all'
  const person = /^\d+$/.test(params.get('person') || '') ? params.get('person') : ''

  const [team, setTeam] = useState([])
  useEffect(() => { api.cached('/users').then((u) => setTeam(Array.isArray(u) ? u : [])).catch(() => {}) }, [])

  // The month as a window: whole, or up to today while it is still running.
  const range = useMemo(() => {
    const e = monthEdges(month)
    const today = todayISO()
    return { from: e.from, to: e.to > today ? today : e.to }
  }, [month])

  if (!tab) return <Navigate to="/" replace />
  return (
    <div className="co nb">
      <header className="co-head co-cal-head">
        <h1 className="co-title">{tx('Numbers')}</h1>
        {tabs.length > 1 && (
          <span className="co-switch" role="group" aria-label={tx('Which numbers')}>
            {tabs.map((t) => (
              <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => set({ tab: t.key })}>{t.label}</button>
            ))}
          </span>
        )}
      </header>
      {/* One month, one channel, one person — for every tab, in the address. */}
      <div className="nb-controls">
        <span className="nb-month">
          <button type="button" className="icon-btn" onClick={() => set({ month: shiftMonth(month, -1) })} aria-label={tx('Previous month')}><ChevronLeft size={20} /></button>
          <b>{monthLabel(month)}</b>
          <button type="button" className="icon-btn" onClick={() => set({ month: shiftMonth(month, 1) })} aria-label={tx('Next month')} disabled={month >= thisMonth()}><ChevronRight size={20} /></button>
        </span>
        <select className="select co-chan-pick" aria-label={tx('Channels')} value={channel} onChange={(e) => set({ channel: e.target.value === 'all' ? '' : e.target.value })}>
          <option value="all">{tx('All channels')}</option>
          {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {tab !== 'month' && isAdmin && (
          <select className="select" aria-label={tx('Person')} value={person} onChange={(e) => set({ person: e.target.value })}>
            <option value="">{tx('Everyone')}</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      {tab === 'month' && <Month month={month} channel={channel} onMonth={(m) => set({ month: m })} />}
      {tab === 'people' && (
        <>
          <People month={month} channel={channel} person={person} />
          {isAdmin && <Reports range={range} channel={channel} person={person} onChannel={(k) => set({ channel: k })} />}
        </>
      )}
      {tab === 'pay' && <Pay range={range} person={person} />}
    </div>
  )
}

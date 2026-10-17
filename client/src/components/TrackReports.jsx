import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Flame } from 'lucide-react'
import { api, getToken } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- "How the board is used": the daily and weekly reports (round 13) --------
// The owner, 14 Oct 2026: a daily and a weekly .md file, on an admin page only,
// to download and read when planning the next round; and a heatmap. The report
// is written by the server (server/routes/track.js); this lists the days and
// weeks, shows one, hands it over as a file, and opens a page with its presses
// drawn on it.
const asText = async (path) => {
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!r.ok) throw new Error(tx('The report could not be read'))
  return r
}

export default function TrackReports() {
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [pick, setPick] = useState(null)      // { day } or { week }
  const [text, setText] = useState('')
  useEffect(() => {
    api.get('/track/days').then((r) => {
      setList(r)
      if (r.days?.[0]) setPick({ day: r.days[0].day })
    }).catch(() => setList({ days: [], weeks: [] }))
  }, [])
  const query = pick ? (pick.week ? `week=${pick.week}` : `day=${pick.day}`) : ''
  useEffect(() => {
    if (!query) return undefined
    let on = true
    setText('')
    asText(`/track/report?${query}`).then((r) => r.text()).then((s) => { if (on) setText(s) }).catch((e) => { if (on) setText(e.message) })
    return () => { on = false }
  }, [query])
  const download = async () => {
    try {
      const blob = await (await asText(`/track/report?${query}&download=1`)).blob()
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `board-usage-${pick.week ? `week-${pick.week}` : pick.day}.md` })
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) { toast(e.message, 'err') }
  }
  // The pages in the report's own table, each with a way to see its presses.
  const pages = useMemo(() => {
    const part = text.split('## Pages')[1]?.split('\n## ')[0] || ''
    // Only the board's own pages: never "//other.site", which navigate() would leave the board for.
    return part.split('\n').map((l) => /^\| (\/[^|]*?) \|/.exec(l)?.[1]).filter((p) => p && /^\/(?![/\\])/.test(p) && !p.includes(':id')).slice(0, 8)
  }, [text])

  if (!list) return <div className="card"><span className="spinner" /></div>
  if (!list.days.length) {
    return (
      <div className="card tr-card">
        <h3>{tx('How the board is used')}</h3>
        <p className="stat-sub">{tx('Nothing recorded yet. The first report appears after people have used the board for a while.')}</p>
      </div>
    )
  }
  return (
    <div className="card tr-card">
      <div className="tr-head">
        <h3>{tx('How the board is used')}</h3>
        <select className="select tr-pick" value={pick?.week ? `w:${pick.week}` : `d:${pick?.day || ''}`} aria-label={tx('Which report')}
          onChange={(e) => { const [k, v] = e.target.value.split(':'); setPick(k === 'w' ? { week: v } : { day: v }) }}>
          <optgroup label={tx('Days')}>{list.days.map((d) => <option key={d.day} value={`d:${d.day}`}>{d.day}</option>)}</optgroup>
          <optgroup label={tx('Weeks')}>{list.weeks.map((w) => <option key={w} value={`w:${w}`}>{tx('Week of {day}', { day: w })}</option>)}</optgroup>
        </select>
        <button type="button" className="btn btn-sm" onClick={download} disabled={!text}><Download size={15} aria-hidden="true" /> {tx('Download .md')}</button>
      </div>
      <p className="stat-sub">{tx('Pages opened, where people pressed and what the board said no with, by name — never what anybody typed. Read "What to improve first" at the top.')}</p>
      {pages.length > 0 && (
        <div className="tr-heat">
          <span>{tx('See where people pressed:')}</span>
          {pages.map((p) => (
            <button key={p} type="button" className="btn btn-sm" onClick={() => navigate(`${p}?heatmap=${pick?.week ? `week:${pick.week}` : `day:${pick.day}`}`)}><Flame size={14} aria-hidden="true" /> {p}</button>
          ))}
        </div>
      )}
      <pre className="tr-text">{text || '…'}</pre>
    </div>
  )
}

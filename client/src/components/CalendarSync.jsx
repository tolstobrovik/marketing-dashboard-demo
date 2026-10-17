import { useEffect, useState } from 'react'
import { CalendarDays, Check, Copy } from 'lucide-react'
import { api } from '../lib/api.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the board in the phone's calendar (server/routes/calendar.js) -----------
//
// One private link per person. Apple Calendar subscribes to it (the webcal://
// address makes an iPhone or a Mac offer "Subscribe") and fetches it again by
// itself, so shoots, deadlines and release days follow the board with nobody
// copying them. Google Calendar takes the same link under "From URL".

const fullUrl = (path) => `${window.location.origin}${path}`
const webcalOf = (path) => fullUrl(path).replace(/^https?:/, 'webcal:')

export default function CalendarSync() {
  const [path, setPath] = useState(undefined) // undefined: loading · null: off
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.get('/calendar/link').then((r) => setPath(r.path || null)).catch(() => setPath(null))
  }, [])

  const make = async () => {
    setBusy(true); setErr('')
    try { const r = await api.post('/calendar/link', {}); setPath(r.path); return r.path }
    catch (e) { setErr(e.message || tx('Something went wrong')); return null }
    finally { setBusy(false) }
  }
  const subscribe = async () => {
    const p = path || await make()
    if (p) window.location.href = webcalOf(p)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(fullUrl(path)); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { window.prompt(tx('Copy link'), fullUrl(path)) }
  }
  const renew = async () => {
    if (!window.confirm(tx('Make a new link? The old one stops working, and calendars that use it stop updating.'))) return
    await make()
  }
  const off = async () => {
    if (!window.confirm(tx('Turn the calendar link off? Calendars that use it stop updating.'))) return
    setBusy(true)
    try { await api.del('/calendar/link'); setPath(null) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="section-head" style={{ marginTop: 22 }}><h2><CalendarDays size={16} style={{ verticalAlign: -2 }} /> {tx('Calendar on your phone')}</h2></div>
      <div className="card card-pad">
        <div className="stat-sub" style={{ marginBottom: 10 }}>
          {tx('Your shoots, edit and design deadlines and release days appear in Apple Calendar by themselves, and stay up to date when something moves on the board.')}
        </div>
        {path === undefined ? (
          <div className="stat-sub">{tx('Checking…')}</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={subscribe} disabled={busy}><CalendarDays size={14} /> {tx('Add to Apple Calendar')}</button>
              {path && <button className="btn btn-sm" onClick={copy}>{copied ? <><Check size={14} /> {tx('Copied')}</> : <><Copy size={14} /> {tx('Copy link')}</>}</button>}
            </div>
            <div className="stat-sub" style={{ marginTop: 8 }}>
              {tx('On an iPhone or a Mac the button opens Calendar and asks to subscribe. For Google Calendar: Other calendars → From URL, and paste the link.')}
            </div>
            {path && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="stat-sub">{tx('Anyone with this link can see your task titles and days — keep it to yourself.')}</span>
                <button className="btn btn-sm" onClick={renew} disabled={busy}>{tx('Make a new link')}</button>
                <button className="btn btn-sm" onClick={off} disabled={busy}>{tx('Turn off')}</button>
              </div>
            )}
          </>
        )}
        {err && <div className="stat-sub" style={{ marginTop: 8 }}>{err}</div>}
      </div>
    </>
  )
}

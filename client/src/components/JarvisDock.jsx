import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Send, Sparkles, X } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { tr as tx, lang } from '../lib/i18n.jsx'
import { api } from '../lib/api.js'

// Jarvis on every page, for the admins who run the whole team
// (server/jarvis.js): one round button in the corner; pressed, a card with
// what it spotted lately and a box to ask it anything — about the board, the
// team, or the task open on the page. The same Jarvis answers in Telegram.
//
// An answer names pieces as [title](task:ID); they are drawn as links into
// the task, and "- " lines as a list.
function Said({ text, onGo }) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const draw = (line) => line.split(/(\[[^\]]+\]\(task:\d+\))/g).map((part, i) => {
    const m = /^\[([^\]]+)\]\(task:(\d+)\)$/.exec(part)
    return m ? <Link key={i} to={`/brief?task=${m[2]}`} onClick={onGo}>{m[1]}</Link> : part
  })
  const items = lines.filter((l) => l.startsWith('- '))
  return (
    <div className="co-jv-said">
      {lines.filter((l) => !l.startsWith('- ')).map((l, i) => <p key={i}>{draw(l)}</p>)}
      {items.length > 0 && <ul>{items.map((l, i) => <li key={i}>{draw(l.slice(2))}</li>)}</ul>}
    </div>
  )
}

export default function JarvisDock() {
  const { user } = useAuth()
  const loc = useLocation()
  const full = user?.role === 'admin' && !(user.admin_channels || []).length
  const [st, setSt] = useState(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [talk, setTalk] = useState([])
  const [alerts, setAlerts] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef(null)

  useEffect(() => {
    if (!full) return
    api.get('/jarvis/status').then(setSt).catch(() => setSt(null))
  }, [full])
  useEffect(() => {
    if (!open || !st?.can || !st.ready || alerts !== null) return
    api.get(`/jarvis/alerts?lang=${lang()}`).then(setAlerts).catch(() => setAlerts([]))
  }, [open, st, alerts])
  useEffect(() => { if (open) box.current?.focus() }, [open])

  if (!full || !st?.can) return null
  const task = loc.pathname.startsWith('/brief') ? new URLSearchParams(loc.search).get('task') : null

  const ask = async (text = q) => {
    const asked = String(text || '').trim()
    if (!asked || busy) return
    setBusy(true); setErr('')
    try {
      const out = await api.post('/jarvis/ask', { q: asked, lang: lang(), task })
      setTalk((t) => [...t, { q: asked, a: out.answer }].slice(-6))
      setQ('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button type="button" className="co-jv-fab" onClick={() => setOpen(true)} aria-label={tx('Ask Jarvis')} title={tx('Ask Jarvis')}>
        <Sparkles size={20} aria-hidden="true" />
      </button>
    )
  }
  return (
    <section className="co-jv" aria-label={tx('Jarvis')}>
      <div className="co-jv-head">
        <Sparkles size={16} aria-hidden="true" /><b>{tx('Jarvis')}</b>
        <button type="button" className="ud-icon" onClick={() => setOpen(false)} aria-label={tx('Close')}><X size={16} /></button>
      </div>
      <div className="co-jv-body">
        {!st.ready && <p className="co-jv-quiet">{tx('Jarvis wakes up when the Gemini key is set.')}</p>}
        {st.ready && talk.length === 0 && (
          <>
            <b className="co-jv-label">{tx('What Jarvis spotted')}</b>
            {alerts === null ? <p className="co-jv-quiet">{tx('Thinking…')}</p>
              : alerts.length === 0 ? <p className="co-jv-quiet">{tx('Nothing spotted yet.')}</p>
                : (
                  <ul className="co-jv-alerts">
                    {alerts.slice(0, 5).map((a) => (
                      <li key={a.id}>{a.task ? <Link to={`/brief?task=${a.task}`} onClick={() => setOpen(false)}>{a.text}</Link> : a.text}</li>
                    ))}
                  </ul>
                )}
          </>
        )}
        {talk.map((t, i) => (
          <div key={i} className="co-jv-turn">
            <p className="co-jv-q">{t.q}</p>
            <Said text={t.a} onGo={() => setOpen(false)} />
          </div>
        ))}
        {busy && <p className="co-jv-quiet">{tx('Thinking…')}</p>}
        {err && <div className="rround-err">{err}</div>}
      </div>
      {st.ready && (
        <div className="co-jv-ask">
          {task && talk.length === 0 && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => ask(tx('What is happening with this task, and what should I do about it?'))}>
              {tx('Ask about this task')}
            </button>
          )}
          <div className="co-jv-row">
            <input ref={box} className="input" value={q} maxLength={2000} disabled={busy}
              placeholder={tx('Ask about the board, the team, or this task…')} aria-label={tx('Ask Jarvis')}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }} />
            <button type="button" className="co-btn co-btn-p" disabled={busy || !q.trim()} onClick={() => ask()} aria-label={tx('Ask Jarvis')}>
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

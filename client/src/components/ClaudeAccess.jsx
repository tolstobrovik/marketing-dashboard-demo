import { useEffect, useState } from 'react'
import { Bot, Check, Copy, Trash2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { tr as tx } from '../lib/i18n.jsx'

// Claude access (routes/keys.js): a key that lets Claude act as this person on
// the board — make, change and delete tasks with their own reach — through the
// board's connector (mcp/satashkent.mjs). The key is shown once, when it is
// made; afterwards only its last four characters, and one press revokes it.
export default function ClaudeAccess() {
  const [keys, setKeys] = useState(null)
  const [fresh, setFresh] = useState(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = () => api.get('/keys').then(setKeys).catch(() => setKeys([]))
  useEffect(() => { load() }, [])

  const make = async () => {
    setBusy(true); setErr(''); setCopied(false)
    try { setFresh(await api.post('/keys', { name: 'Claude' })); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const revoke = async (id) => {
    setBusy(true); setErr('')
    try { await api.del(`/keys/${id}`); if (fresh?.id === id) setFresh(null); await load() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh.key); setCopied(true) } catch { setErr(tx('Select the key and copy it by hand.')) }
  }

  return (
    <>
      <div className="section-head" style={{ marginTop: 22 }}><h2><Bot size={16} style={{ verticalAlign: -2 }} /> {tx('Claude access')}</h2></div>
      <div className="card card-pad">
        <div className="stat-sub" style={{ marginBottom: 10 }}>
          {tx('Let Claude make and change tasks for you. It acts as you, with exactly your access, until you revoke its key.')}
        </div>
        {fresh && (
          <div style={{ marginBottom: 12 }}>
            <div className="stat-sub" style={{ marginBottom: 6 }}><b>{tx('Copy it now — it is shown only this once.')}</b></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" readOnly value={fresh.key} onFocus={(e) => e.target.select()} aria-label={tx('Claude access key')} style={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }} />
              <button type="button" className="btn btn-sm" onClick={copy}>{copied ? <><Check size={14} /> {tx('Copied')}</> : <><Copy size={14} /> {tx('Copy')}</>}</button>
            </div>
          </div>
        )}
        {keys === null ? <div className="stat-sub">{tx('Checking…')}</div> : keys.length === 0 ? (
          <div className="stat-sub" style={{ marginBottom: 10 }}>{tx('No keys yet.')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {keys.map((k) => (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="stat-sub" style={{ flex: 1 }}>{tx('{name} · ends in {tail} · {day}', { name: k.name, tail: k.tail, day: String(k.created_at).slice(0, 10) })}</span>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => revoke(k.id)}><Trash2 size={14} /> {tx('Revoke')}</button>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={make}><Bot size={14} /> {tx('Make a key for Claude')}</button>
        {err && <div className="stat-sub" style={{ marginTop: 8 }}>{err}</div>}
      </div>
    </>
  )
}

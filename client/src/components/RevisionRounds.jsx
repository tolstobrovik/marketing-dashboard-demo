import { useState } from 'react'
import { Check, ExternalLink, RotateCcw, Send } from 'lucide-react'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { deliveryHref } from '../lib/text.js'
import { api } from '../lib/api.js'
import { fmtDay, tashkentDay } from '../lib/constants.js'
import { toast } from '../lib/toast.js'
import { VoicePlayer } from './VoiceNote.jsx'
import Zoom from './Zoom.jsx'
import PravkaNote from './PravkaNote.jsx'

// The revision rounds of one task, under its delivery links: "Round 1",
// "Round 2", … each with what was asked, the talk under it, and — once a new
// file answered it — who fixed it and when. An open round is the one still
// owed and reads like it; a resolved one steps back.
//
// The notes go to /content/revisions/:rid/notes, never under /content/:id/…:
// the client reads an answer from there as the task itself.
const day = (iso) => (iso ? fmtDay(tashkentDay(iso)) : '')
const SEAT = { operator: 'to the operator', editor: 'to the editor', designer: 'to the designer' }

export default function RevisionRounds({ taskId, revisions, onChange }) {
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(0)
  const [err, setErr] = useState('')
  if (!revisions?.length) return null
  // Open rounds first — the one being worked on is the one people came for.
  const open = revisions.filter((r) => !r.resolved_at).sort((a, b) => b.round - a.round)
  const done = revisions.filter((r) => r.resolved_at).sort((a, b) => b.round - a.round)

  const post = async (r) => {
    const text = String(drafts[r.id] || '').trim()
    if (!text || busy) return
    setBusy(r.id); setErr('')
    try {
      await api.post(`/content/revisions/${r.id}/notes`, { text })
      setDrafts((d) => ({ ...d, [r.id]: '' }))
      onChange?.(await api.get(`/content/${taskId}/revisions`))
      toast(tx('Note added — synced'))
    } catch (e) { setErr(e.message) } finally { setBusy(0) }
  }

  const card = (r) => {
    const sent = deliveryHref(r.sent_link || '')
    const fixed = deliveryHref(r.fixed_link || '')
    return (
      <div key={r.id} className={'rround' + (r.resolved_at ? ' rround-done' : ' rround-open')}>
        <div className="rround-head">
          <b className="rround-n">{tx('Round {n}', { n: r.round })}</b>
          {r.resolved_at
            ? <span className="rround-pill rround-pill-done"><Check size={12} strokeWidth={3} /> {tx('Fixed')}</span>
            : <span className="rround-pill rround-pill-open"><RotateCcw size={12} /> {tx('To fix')}</span>}
          <span className="rround-seat">{tx(SEAT[r.target] || SEAT.editor)}</span>
        </div>
        <div className="rround-ask">
          {/* A pravka carries its pasted screenshots and dropped files as
              Markdown (Pravka 2.0); PravkaNote draws them. */}
          <PravkaNote text={r.note} className="rround-note" />
          {r.voice_id ? <VoicePlayer id={r.voice_id} secs={r.voice_secs} /> : null}
          {r.photo && <span className="rev-shot"><Zoom src={r.photo_thumb || r.photo} full={r.photo} alt={tx('What needs changing')} /></span>}
          <span className="rround-meta">{tx('Asked by {name} · {day}', { name: r.requested_name || '—', day: day(r.created_at) })}</span>
        </div>
        {(r.notes || []).length > 0 && (
          <div className="rround-thread">
            {r.notes.map((n) => (
              <div key={n.id} className="rround-line">
                <b>{n.author || '—'}</b> <span className="rround-meta">{day(n.created_at)}</span>
                <div className="rround-text">{n.text}</div>
              </div>
            ))}
          </div>
        )}
        {r.resolved_at ? (
          <div className="rround-foot">
            <span className="rround-meta">{tx('Fixed · {day} · {name}', { day: day(r.resolved_at), name: r.resolved_name || '—' })}</span>
            {sent && <a className="rround-link" href={sent} target="_blank" rel="noreferrer">{tx('Sent back')} <ExternalLink size={11} /></a>}
            {fixed && <a className="rround-link" href={fixed} target="_blank" rel="noreferrer">{tx('The fix')} <ExternalLink size={11} /></a>}
          </div>
        ) : (
          <div className="rround-compose">
            <input className="input" value={drafts[r.id] || ''} maxLength={2000}
              placeholder={tx('What is still wrong, or a question about this round…')}
              onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(r) } }} />
            <button type="button" className="btn btn-sm" disabled={!String(drafts[r.id] || '').trim() || busy === r.id} onClick={() => post(r)}>
              <Send size={13} /> {tx('Add revision note')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rrounds">
      {open.map(card)}
      {done.map(card)}
      {err && <div className="rround-err">{err}</div>}
    </div>
  )
}

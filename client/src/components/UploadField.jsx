import { useEffect, useRef, useState } from 'react'
import { UploadCloud, Check, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { startUpload, cancelUpload, useUploads, sizeLabel } from '../lib/uploads.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- upload first, a link if you must (the owner, 13 Oct) ---------------------
//
// "Where is the footage?" used to be a box for a Google Drive link. The files
// are on the operator's phone or card, not on Drive yet — so the question is
// answered by uploading them: as many as the shoot made, each with its own
// bar, straight to the task's folder on the team's Drive (lib/uploads.js, the
// same path the hand-in uses). The first one to land fills the link; pasting
// a link stays, folded below, for footage already somewhere on Drive.
//
// Without the team's Drive connected there is nothing to upload to: then it is
// the link box alone, as before.

export default function UploadField({ item, kind, value, onLink, busy = false, id, placeholder }) {
  const [drive, setDrive] = useState(null)
  useEffect(() => { api.cached('/drive/status').then((s) => setDrive(!!s?.connected)).catch(() => setDrive(false)) }, [])
  const jobs = useUploads()
  const [keys, setKeys] = useState([])
  const [over, setOver] = useState(false)
  const pick = useRef(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const mine = keys.map((k) => jobs.find((j) => j.key === k)).filter(Boolean)
  const send = (list) => {
    const files = [...(list || [])].filter(Boolean)
    if (!files.length || busy) return
    const added = files.map((file) => startUpload({
      task: item, kind, file,
      onDone: (out) => { if (alive.current) onLink((v) => v || out.link) },
    }))
    setKeys((k) => [...k, ...added])
  }
  const linkBox = (
    <input id={id} className="input" value={value || ''} placeholder={placeholder || 'https://drive.google.com/…'} disabled={busy}
      onChange={(e) => onLink(e.target.value)} />
  )
  if (drive === false) return linkBox
  const accept = kind === 'design' ? 'image/*,application/pdf' : 'video/*'
  return (
    <div className="uf">
      <div className={'uf-drop' + (over ? ' over' : '') + (mine.length ? ' uf-small' : '')} role="button" tabIndex={0}
        aria-label={kind === 'design' ? tx('Upload the artwork') : tx('Upload the videos')}
        onClick={() => pick.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files) }}>
        <span className="hi-drop-ic" aria-hidden="true"><UploadCloud size={mine.length ? 16 : 20} /></span>
        <span className="hi-drop-t">
          <b>{mine.length ? tx('Add more') : kind === 'design' ? tx('Drop the artwork here') : kind === 'shoot' ? tx('Drop the videos from the shoot here') : tx('Drop the edit here')}</b>
          {' '}<u>{tx('or choose files')}</u>
          {!mine.length && <small>{tx('Goes straight into the piece’s Drive folder.')}</small>}
        </span>
        <input ref={pick} type="file" hidden multiple accept={accept} onChange={(e) => { send(e.target.files); e.target.value = '' }} />
      </div>
      {mine.length > 0 && (
        <ul className="uf-list" aria-live="polite">
          {mine.map((j) => {
            const pct = Math.min(100, Math.floor((j.sent / Math.max(1, j.size)) * 100))
            return (
              <li key={j.key}>
                <span className="uf-name" title={j.name}>{j.name}</span>
                {j.state === 'sending' ? (
                  <>
                    <span className="hi-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></span>
                    <button type="button" className="icon-btn" onClick={() => cancelUpload(j.key)} aria-label={tx('Cancel the upload')}><X size={13} /></button>
                  </>
                ) : j.state === 'done' ? <span className="uf-ok"><Check size={13} aria-hidden="true" />{tx('On Drive')} · {sizeLabel(j.size)}</span>
                  : <span className="uf-bad">{j.error || tx('Not sent')}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {/* Round 14 (the owner, 16 Oct): with the Drive connected, files are dropped — no link to paste. */}
    </div>
  )
}

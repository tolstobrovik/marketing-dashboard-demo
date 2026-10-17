import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCloud, ChevronDown, ChevronUp, X, Check, AlertCircle } from 'lucide-react'
import { useUploads, cancelUpload, sizeLabel, etaOf } from '../lib/uploads.js'
import { useAuth } from '../lib/auth.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- every upload, on every page (the owner, 14 Oct 2026: "like Google Drive") ----
//
// An upload already keeps going while a person opens another task or another
// page (lib/uploads.js). This is where it is seen from anywhere: a small card
// in the corner while files go — folded to one line on a press, a row opens
// its task, a cross stops one — and gone once everything is in and it is
// closed. Closing the TAB still stops an upload; the browser asks first.
export default function UploadsDock() {
  const { user } = useAuth()
  // Closing hides the card's rows; it never takes them out of the list an open
  // hand-in reads its own files from (the hunt, 15 Oct 2026).
  const [gone, setGone] = useState(() => new Set())
  const all = useUploads()
  const jobs = all.filter((j) => j.state !== 'cancelled' && !gone.has(j.key))
  // Another person signed in on this tab sees none of the last one's finished files.
  useEffect(() => { setGone(new Set(all.filter((j) => j.state !== 'sending').map((j) => j.key))) }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [shut, setShut] = useState(false)
  const box = useRef(null)
  const navigate = useNavigate()
  const shown = !!user && jobs.length > 0
  // Toasts sit above the card, not under it (--dock-h, read by .toasts).
  useEffect(() => {
    const root = document.documentElement
    const el = box.current
    const keep = () => root.style.setProperty('--dock-h', el ? `${el.offsetHeight + 12}px` : '0px')
    keep()
    const ro = el && window.ResizeObserver ? new ResizeObserver(keep) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.setProperty('--dock-h', '0px') }
  }, [shown])
  if (!shown) return null

  const going = jobs.filter((j) => j.state === 'sending')
  const failed = jobs.filter((j) => j.state === 'failed').length
  const sent = going.reduce((n, j) => n + j.sent, 0)
  const size = going.reduce((n, j) => n + j.size, 0)
  const pct = (a, b) => Math.floor((a / Math.max(1, b)) * 100)
  const head = going.length ? tx('Uploading {n} — {p}%', { n: going.length, p: pct(sent, size) })
    : failed ? tx('{n} did not upload', { n: failed }) : tx('Uploads done')
  // A screen reader hears the count and the end, not every percent.
  const said = going.length ? tx('Uploading: {n}', { n: going.length }) : failed ? tx('{n} did not upload', { n: failed }) : tx('Uploads done')
  return (
    <section className={'ud' + (shut ? ' ud-shut' : '')} ref={box} aria-label={tx('Uploads')}>
      <header className="ud-head">
        <UploadCloud size={18} aria-hidden="true" />
        <b>{head}</b>
        <span className="sr-only" aria-live="polite">{said}</span>
        <button type="button" className="ud-icon" onClick={() => setShut((v) => !v)} aria-expanded={!shut}
          aria-label={shut ? tx('Show the uploads') : tx('Fold the uploads')}>
          {shut ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
        {!going.length && <button type="button" className="ud-icon" onClick={() => setGone(new Set([...gone, ...jobs.map((j) => j.key)]))} aria-label={tx('Close')}><X size={18} aria-hidden="true" /></button>}
      </header>
      {!shut && (
        <ul className="ud-list">
          {jobs.map((j) => (
            <li key={j.key} className={`ud-row ud-${j.state}`}>
              <button type="button" className="ud-open" onClick={() => navigate(`/brief?task=${j.taskId}`)} title={tx('Open the task')}>
                <span className="ud-name">{j.name}</span>
                <span className="ud-sub">
                  {j.taskTitle} · {j.state === 'sending'
                    ? `${sizeLabel(j.sent)} / ${sizeLabel(j.size)}${etaOf(j) ? ` · ${etaOf(j)}` : ''}`
                    : j.state === 'failed' ? (j.error || tx('Did not upload')) : sizeLabel(j.size)}
                </span>
                {j.state === 'sending' && <span className="ud-bar" aria-hidden="true"><i style={{ width: `${pct(j.sent, j.size)}%` }} /></span>}
              </button>
              {j.state === 'sending'
                ? <button type="button" className="ud-icon" onClick={() => cancelUpload(j.key)} aria-label={tx('Stop this upload')}><X size={16} aria-hidden="true" /></button>
                : j.state === 'done' ? <Check className="ud-ok" size={18} aria-label={tx('Uploaded')} />
                  : <AlertCircle className="ud-bad" size={18} aria-label={tx('Did not upload')} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

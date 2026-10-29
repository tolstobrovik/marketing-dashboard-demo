import { useEffect, useRef, useState } from 'react'
import { PanZoom } from './Zoom.jsx'
import { createPortal } from 'react-dom'
import { Download, ExternalLink, Play, Image as ImageIcon, FileText, UploadCloud, X, Link2Off, Trash2, RotateCcw } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { startUpload, cancelUpload, retryUpload, useUploads, sizeLabel } from '../lib/uploads.js'
import { Thumb } from './DriveDrops.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- a task's Google Drive files, and its Drive box ------------------------------
//
// One place for every file a task points at: what the crew dropped in the Drive
// folders or in the box below, what was uploaded into the task's own folder, and
// the old Drive links in the footage / cut / artwork boxes. Each one shows what
// it is, plays (or opens) right here and downloads from here — nobody has to
// find their way round somebody's Drive. The server decides which files those
// are and streams them (server/taskfiles.js, routes/drive.js); this draws them.
//
// The box sends a file from this browser straight to the team account's Drive,
// into the folder for the task's stage, named after the task — so it uses the
// team's storage, never the sender's — and the file is on the task when it lands.
const CHANGED = 'satashkent:drivefiles'
export const driveFilesChanged = (taskId) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: taskId }))
// The hand-in box listens too: a file that lands on the task is one it can hand in.
export const onDriveFilesChanged = (taskId, fn) => {
  const on = (e) => { if (e.detail === taskId) fn() }
  window.addEventListener(CHANGED, on)
  return () => window.removeEventListener(CHANGED, on)
}

// Delete a file the board put on the Drive (r11, the owner): asked first, then
// to the Drive's bin — Google keeps it there thirty days. The server says who
// may; true when it went.
export async function removeDriveFile(taskId, f) {
  if (!window.confirm(tx('Delete «{name}»? It goes to the Drive’s bin and can be brought back from there for 30 days.', { name: f.name }))) return false
  try {
    await api.del(`/drive/tasks/${taskId}/files/${encodeURIComponent(f.id)}`)
    toast(tx('Deleted'))
    driveFilesChanged(taskId)
    return true
  } catch (e) { toast(e.message, 'err'); return false }
}

const FIELD = { ready_link: () => tx('The edit'), shot_link: () => tx('Footage'), design_link: () => tx('The artwork') }
const KIND = { footage: () => tx('Footage'), fix: () => tx('A fix'), final: () => tx('The final file') }
const lengthOf = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const isVideo = (f) => /^video\//.test(f.mime)
const isImage = (f) => /^image\//.test(f.mime)
const isDoc = (f) => /^application\/vnd\.google-apps\./.test(f.mime)
const whatOf = (f) => (f.source === 'link' ? FIELD[f.field]?.()
  : f.source === 'drop' ? [KIND[f.kind]?.(), f.folder_name && tx('from the {folder} folder', { folder: f.folder_name })].filter(Boolean).join(' ')
    : tx('Uploaded to Google Drive'))

// A play ticket lives ten minutes; a long video asks for a fresh one when the
// old one stops working, and carries on from the same second.
// The player sits in the middle of the page, big, over a dimmed half-see-through
// backdrop — not the browser's own full screen, which read as another window
// (the owner, 14 Oct 2026: "no need for a separate window, just a viewer in
// the centre with half-transparent sides"). A video's own button still goes
// full screen. Escape, the cross or a click on the sides closes it.
export function FullScreen({ onClose, children }) {
  const back = useRef(null)
  const shut = useRef(onClose)
  shut.current = onClose
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) { e.stopPropagation(); shut.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return createPortal(
    <div ref={back} className="zoom-back co-player-back" onMouseDown={onClose} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="zoom-close" aria-label={tx('Close')} onMouseDown={onClose}><X size={20} /></button>
      <div className="co-player" onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  )
}

const ticket = (taskId, f) => api.get(`/drive/tasks/${taskId}/files/${encodeURIComponent(f.id)}/play`)

function Viewer({ taskId, f, onClose }) {
  const [src, setSrc] = useState('')
  const [err, setErr] = useState('')
  const at = useRef(0)
  const renewed = useRef(false)
  useEffect(() => { ticket(taskId, f).then((r) => setSrc(r.url)).catch((e) => setErr(e.message)) }, [taskId, f])
  const renew = async (e) => {
    if (renewed.current) { setErr(tx('The file could not be played here — download it, or open it in Drive')); return }
    renewed.current = true
    at.current = e.currentTarget.currentTime || 0
    try { setSrc((await ticket(taskId, f)).url) } catch (er) { setErr(er.message) }
  }
  return (
    <FullScreen onClose={onClose}>
        {err ? <p className="co-player-err">{err}</p>
          : !src ? <span className="spinner" />
            : isVideo(f)
              ? <video src={src} controls autoPlay playsInline preload="metadata" onError={renew}
                onLoadedMetadata={(e) => { if (at.current) e.currentTarget.currentTime = at.current }} />
              : <PanZoom src={src} alt={f.name} />}
        <p className="co-player-name">{f.name}</p>
    </FullScreen>
  )
}

async function download(taskId, f) {
  try {
    const r = await ticket(taskId, f)
    const a = Object.assign(document.createElement('a'), { href: r.download, download: f.name })
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (e) { toast(e.message, 'err') }
}

// The list. `onList` hears what the server said (connected or not, and which
// link boxes it has drawn here) so the window can leave those out of its links.
export function TaskFiles({ taskId, onList }) {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    let alive = true
    // A list Google would not give is not "Drive is off": whether Drive is
    // connected is /drive/status's answer, and the window keeps its box and
    // says the files are late (24 Oct 2026 — the box vanished with them).
    const load = () => api.get(`/drive/tasks/${taskId}/files`)
      .then((r) => { if (alive) { setList(r); onList?.(r) } })
      .catch(() => api.cached('/drive/status').then((s) => !!s?.connected).catch(() => false)
        .then((connected) => { if (alive) { setList({ connected, files: [], error: true }); onList?.({ connected, files: [], handled: [] }) } }))
    load()
    const off = onDriveFilesChanged(taskId, load)
    return () => { alive = false; off() }
  }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (list?.error && list.connected) return <p className="co-none">{tx('Google Drive did not answer — the files will show when it does')}</p>
  if (!list?.files?.length) return null
  return (
    <>
      <ul className="co-dfiles" aria-label={tx('Files in Google Drive')}>
        {list.files.map((f) => (f.state === 'ok' ? (
          <li key={`${f.source}:${f.id}`} className="co-dfile">
            {isVideo(f) || isImage(f)
              ? (
                <button type="button" className="co-dfile-thumb" onClick={() => setOpen(f)} aria-label={isVideo(f) ? tx('Play') : tx('View')}>
                  <Thumb path={`/drive/tasks/${taskId}/files/${encodeURIComponent(f.id)}/thumb`} />
                  {isVideo(f) && <span className="co-dfile-play"><Play size={18} aria-hidden="true" /></span>}
                </button>
              )
              : <span className="co-drop-thumb co-drop-wait"><FileText size={20} aria-hidden="true" /></span>}
            <div className="co-drop-info">
              <b>{f.name}</b>
              <span>{[whatOf(f), f.size ? sizeLabel(f.size) : null, f.duration_ms ? lengthOf(f.duration_ms) : null].filter(Boolean).join(' · ')}</span>
              <span className="co-dfile-acts">
                {(isVideo(f) || isImage(f)) && (
                  <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setOpen(f)}>
                    {isVideo(f) ? <Play size={16} aria-hidden="true" /> : <ImageIcon size={16} aria-hidden="true" />}{isVideo(f) ? tx('Play') : tx('View')}
                  </button>
                )}
                {!isDoc(f) && (
                  <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => download(taskId, f)}
                    title={tx('After you press: the file is saved to this device, straight from the team’s Google Drive')}>
                    <Download size={16} aria-hidden="true" />{tx('Download')}
                  </button>
                )}
                <a className="co-link" href={f.link} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{tx('Open in Drive')}</a>
                {f.can_remove && (
                  <button type="button" className="co-btn co-btn-s co-btn-sm co-del" onClick={() => removeDriveFile(taskId, f)}
                    title={tx('After you press: you are asked first, then the file goes to the Drive’s bin')}>
                    <Trash2 size={16} aria-hidden="true" />{tx('Delete')}
                  </button>
                )}
              </span>
            </div>
          </li>
        ) : (
          <li key={`${f.source}:${f.id}`} className="co-dfile co-dfile-no">
            <span className="co-drop-thumb co-drop-wait"><Link2Off size={20} aria-hidden="true" /></span>
            <div className="co-drop-info">
              <b>{FIELD[f.field]?.() || tx('A link')}</b>
              <span>{f.state === 'empty' ? tx('The folder «{name}» has no files yet', { name: f.name }) : tx('This link isn’t shared with the team account')}</span>
              <a className="co-link" href={f.url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{tx('Open the link')}</a>
            </div>
          </li>
        )))}
      </ul>
      {open && <Viewer taskId={taskId} f={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// The box. `register` hands the window this box's way in, so a file pasted or
// dropped anywhere on the task that is not a photo comes here.
export function DriveBox({ task, folder, register }) {
  const pick = useRef(null)
  const [over, setOver] = useState(false)
  const [gone, setGone] = useState([])
  const jobs = useUploads().filter((j) => j.taskId === task.id && j.kind === 'box' && j.state !== 'done' && !gone.includes(j.key))
  const add = (fs) => {
    const list = [...(fs || [])]
    if (!list.length) return false
    for (const file of list) startUpload({ task, kind: 'box', file, onDone: () => driveFilesChanged(task.id) })
    toast(list.length > 1 ? tx('Sending {n} files to Google Drive — each shows here when it is in', { n: list.length }) : tx('Sending the file to Google Drive — it shows here when it is in'))
    return true
  }
  const addRef = useRef(add)
  addRef.current = add
  useEffect(() => { register?.((fs) => addRef.current(fs)); return () => register?.(null) }, [register])
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files')
  return (
    <div className="co-dbox">
      <button type="button" className={'rm-tile rm-add co-dbox-add' + (over ? ' over' : '')} onClick={() => pick.current?.click()}
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); add(e.dataTransfer.files) }}>
        <UploadCloud size={18} aria-hidden="true" /><span>{tx('Add')}</span>
      </button>
      {jobs.length > 0 && (
        <ul className="co-dbox-jobs">
          {jobs.map((j) => {
            const pct = Math.floor((j.sent / Math.max(1, j.size)) * 100)
            return (
              <li key={j.key} className="co-dbox-job">
                <span className="co-dbox-name">{j.name}</span>
                {j.state === 'sending'
                  ? <span className="co-dbox-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={j.name}><i style={{ width: `${pct}%` }} /></span>
                  : <span className="co-dbox-err">{j.state === 'cancelled' ? tx('Stopped') : tx(j.error || 'Did not upload')}</span>}
                <span className="co-dbox-pct">{j.state === 'sending' ? `${pct}% · ${sizeLabel(j.size)}` : ''}</span>
                {/* Failed: tried again under the same key, from where Google stopped (24 Oct 2026). */}
                {j.state === 'failed' && j.file
                  ? (
                    <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => retryUpload(j.key)} aria-label={tx('Try again')}>
                      <RotateCcw size={16} aria-hidden="true" />{tx('Try again')}
                    </button>
                  )
                  : (
                    <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => (j.state === 'sending' ? cancelUpload(j.key) : setGone((g) => [...g, j.key]))}
                      aria-label={j.state === 'sending' ? tx('Stop sending {name}', { name: j.name }) : tx('Hide')}>
                      <X size={16} aria-hidden="true" />{j.state === 'sending' ? tx('Stop') : tx('Hide')}
                    </button>
                  )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="rm-hint">{folder
        ? tx('Drop, paste (Ctrl+V / ⌘V) or add videos and other files: they go to the team’s Google Drive → {folder}, named after this task. Photos pasted on the task go to Photos and videos.', { folder })
        : tx('Drop, paste (Ctrl+V / ⌘V) or add videos and other files: they go to the team’s Google Drive, named after this task. Photos pasted on the task go to Photos and videos.')}</p>
      <input ref={pick} type="file" multiple hidden onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; add(f) }} />
    </div>
  )
}

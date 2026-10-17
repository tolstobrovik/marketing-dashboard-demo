import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus, Play, X, UploadCloud } from 'lucide-react'
import { api } from '../lib/api.js'
import { readPicture, isPicture } from '../lib/picture.js'
import { startUpload, useUploads } from '../lib/uploads.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import Zoom, { PanZoom } from './Zoom.jsx'
import { LinkViewer } from './LinkView.jsx'

// ---- a task's reference photos and videos -------------------------------------
//
// Up to twenty a task, photos and videos together (the old album's photos
// count). Added by the button, by pasting (Ctrl+V / ⌘V) anywhere over the open
// task, or by dropping files from the desktop anywhere over it — several at
// once, on Windows and on a Mac alike. A photo is downscaled here and kept on
// the server (routes/content.js, /media); a video goes to the task's Google
// Drive folder through the same resumable upload a cut uses, and is noted on
// the task when it lands — even if this window was closed by then.
//
// Pictures are behind the sign-in, so each is fetched with the token and drawn
// from a blob, the way a pravka's screenshot is (PravkaNote).
//
// Where the window has a Drive box (`onOther`, the task window), a paste or a
// drop anywhere on the task is split: photos come here as always, and videos
// and every other file go to the box — to the team's Drive, named after the
// task. Without a box, a video still comes here as a reference.
export const MEDIA_MAX = 20
const isVideo = (f) => /^video\//.test(f?.type || '')
const REFRESH = 'satashkent:refmedia'

function useBlob(path) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!path) return undefined
    let alive = true
    let made = ''
    api.blob(path).then((b) => { if (!alive) return; made = URL.createObjectURL(b); setUrl(made) }).catch(() => {})
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [path])
  return url
}

function Photo({ m, onOpen }) {
  const src = useBlob(`/content/media/${m.id}?thumb=1`)
  return (
    <button type="button" className="rm-tile" onClick={() => onOpen(m)} aria-label={m.name}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="rm-wait" />}
    </button>
  )
}

function Viewer({ m, onClose }) {
  const src = useBlob(`/content/media/${m.id}`)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div className="zoom-back" onMouseDown={onClose} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="zoom-close" aria-label={tx('Close')} onMouseDown={onClose}><X size={20} /></button>
      {src ? <PanZoom src={src} alt={m.name} /> : <span className="spinner" />}
    </div>,
    document.body,
  )
}

// `adds`: the Add box and its hint are drawn (the task window: only for the
// task's owner, after "+ Add" — the owner, 14 Oct 2026: no empty boxes).
export default function RefMedia({ task, initial, user, plans, legacy = [], onRemoveLegacy, catchAll = true, onOther = null, onHeld = null, adds = true }) {
  const [media, setMedia] = useState(initial || null)
  const [open, setOpen] = useState(null)
  const [video, setVideo] = useState(null) // r11: a reference video plays here, not on Drive's site
  const [over, setOver] = useState(false)
  const pick = useRef(null)
  const load = () => api.get(`/content/${task.id}/media`).then(setMedia).catch(() => {})
  useEffect(() => { if (!initial) load() }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // A video lands after this window may have closed; whoever is showing the
  // task then hears about it here.
  useEffect(() => {
    const on = (e) => { if (e.detail === task.id) load() }
    window.addEventListener(REFRESH, on)
    return () => window.removeEventListener(REFRESH, on)
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sending = useUploads().filter((j) => j.taskId === task.id && j.kind === 'reference' && j.state === 'sending')
  const list = media || []
  const held = legacy.length + list.length + sending.length
  // The task window draws the reference block only when there is something in it.
  useEffect(() => { onHeld?.(held) }, [held]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- adding: one path for the button, a paste and a drop ----
  const room = useRef(0)
  room.current = MEDIA_MAX - held
  const add = async (files) => {
    const usable = [...files].filter((f) => isPicture(f) || isVideo(f))
    if (!usable.length) { if (files.length) toast(tx('Only photos and videos go here'), 'err'); return }
    if (usable.length > room.current) toast(tx('That is as many photos and videos as one task carries — {n}', { n: MEDIA_MAX }), 'err')
    for (const f of usable.slice(0, Math.max(0, room.current))) {
      room.current -= 1
      if (isVideo(f)) {
        startUpload({
          task, kind: 'reference', file: f,
          onDone: async (out) => {
            try {
              await api.post(`/content/${task.id}/media`, { kind: 'video', name: f.name, size: f.size, mime: f.type, link: out.link })
              window.dispatchEvent(new CustomEvent(REFRESH, { detail: task.id }))
            } catch (e) { toast(e.message, 'err') }
          },
        })
        toast(tx('Uploading the video to Google Drive — it shows here when it is in'))
        continue
      }
      try {
        const pic = await readPicture(f)
        const r = await api.post(`/content/${task.id}/media`, { name: f.name || 'screenshot', photo: pic.photo, thumb: pic.thumb })
        setMedia(r.media)
      } catch (e) { toast(e.message, 'err') }
    }
  }
  const remove = async (m) => {
    try { setMedia((await api.del(`/content/media/${m.id}`)).media) } catch (e) { toast(e.message, 'err') }
  }

  // ---- anywhere over the open task: paste and drop ----
  // A paste into a text box is still a paste of text; a paste somebody else
  // already took (a pravka note, a hand-in box) is theirs.
  const other = useRef(onOther)
  other.current = onOther
  // Photos to this box; the rest to the Drive box when there is one. True when
  // anything was taken.
  const route = (list) => {
    const all = [...(list || [])]
    const pics = all.filter((f) => isPicture(f))
    const rest = all.filter((f) => !isPicture(f))
    const sent = rest.length > 0 && !!other.current && other.current(rest) !== false
    const mine = [...pics, ...(sent ? [] : rest.filter(isVideo))]
    if (mine.length) add(mine)
    return mine.length > 0 || sent
  }
  useEffect(() => {
    const said = (list) => { if ([...(list || [])].length) toast(tx('Only photos and videos go here'), 'err') }
    const onPaste = (e) => {
      if (!catchAll || e.defaultPrevented) return
      if (route(e.clipboardData?.files)) e.preventDefault()
    }
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files')
    const onOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (catchAll) setOver(true) }
    const onLeave = (e) => { if (!e.relatedTarget) setOver(false) }
    const onDrop = (e) => {
      setOver(false)
      if (e.defaultPrevented || !hasFiles(e)) return
      e.preventDefault()
      if (catchAll && !route(e.dataTransfer.files)) said(e.dataTransfer.files)
    }
    document.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [catchAll, task.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const mayRemove = (m) => m.uploaded_by === user.id || plans
  return (
    <div className="rm">
      <div className="rm-grid">
        {legacy.map((p, i) => (
          <span key={`l${i}`} className="rm-cell">
            <span className="rm-tile"><Zoom src={p.thumb || p.photo} full={p.photo || p.thumb} alt="" /></span>
            {plans && onRemoveLegacy && (
              <button type="button" className="rm-x" onClick={() => onRemoveLegacy(i)} aria-label={tx('Remove')}><X size={12} /></button>
            )}
          </span>
        ))}
        {list.map((m) => (
          <span key={m.id} className="rm-cell">
            {m.kind === 'video'
              ? (
                <button type="button" className="rm-tile rm-video" onClick={() => setVideo(m.link)} title={m.name}>
                  <Play size={20} aria-hidden="true" /><span>{m.name}</span>
                </button>
              )
              : <Photo m={m} onOpen={setOpen} />}
            {mayRemove(m) && (
              <button type="button" className="rm-x" onClick={() => remove(m)} aria-label={tx('Remove')}><X size={12} /></button>
            )}
          </span>
        ))}
        {sending.map((j) => (
          <span key={j.key} className="rm-cell">
            <span className="rm-tile rm-video rm-sending">
              <UploadCloud size={18} aria-hidden="true" /><span>{Math.floor((j.sent / Math.max(1, j.size)) * 100)}%</span>
            </span>
          </span>
        ))}
        {adds && held < MEDIA_MAX && (
          <button type="button" className="rm-tile rm-add" onClick={() => pick.current?.click()}>
            <ImagePlus size={18} aria-hidden="true" /><span>{tx('Add')}</span>
          </button>
        )}
      </div>
      {adds && (
        <p className="rm-hint">
          {tx('Paste (Ctrl+V / ⌘V) or drop photos and videos anywhere on the task')} · {tx('{n} of {max}', { n: held, max: MEDIA_MAX })}
        </p>
      )}
      <input ref={pick} type="file" accept="image/*,video/*" multiple hidden
        onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; add(f) }} />
      {over && catchAll && (
        <div className="rm-drop" aria-hidden="true"><UploadCloud size={28} />
          <b>{onOther ? tx('Drop: photos go to Photos and videos, everything else to the team’s Google Drive') : tx('Drop to add to this task’s references')}</b>
        </div>
      )}
      {open && <Viewer m={open} onClose={() => setOpen(null)} />}
      {video && <LinkViewer url={video} onClose={() => setVideo(null)} />}
    </div>
  )
}

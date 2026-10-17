import { useEffect, useRef, useState } from 'react'
import { UploadCloud, X, FileText, Paperclip } from 'lucide-react'
import { tr as tx } from '../../lib/i18n.jsx'
import TelegramFields from '../TelegramFields.jsx'

// The last step — anything else? The brief as a short template — Reference,
// Script, ТЗ — one line each that grows as it is written into (the
// description is asked with the name, on the first step), and one place to
// drop pictures and files. The lines are the task's own fields, the same
// boxes the full sheet shows, so what is written here is where the crew looks
// for it. Everything is optional unless the admin made a description
// compulsory for this kind of task, and then the Notes line says so.
//
// Pictures become the task's reference album (shown on its card); any other
// file is attached to the task once it exists — a file needs a task to hang
// on, and the task does not exist until Create is pressed.
//
// A task going to a written (Telegram) channel is asked one thing that is NOT
// optional, first: what the piece is — Just a post, Post plus or Webinar —
// with the Guiding post switch under it (see TelegramFields).
const grow = (el) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`
}

function Line({ label, value, onChange, placeholder, onSubmit, first }) {
  const ref = useRef(null)
  useEffect(() => { grow(ref.current); if (first) ref.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="tb-line">
      <span className="tb-line-label">{label}<i aria-hidden="true">—</i></span>
      <textarea ref={ref} className="tb-line-input" rows={1} value={value} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); grow(e.target) }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit() } }} />
    </label>
  )
}

export default function StepMore({
  brief, onBrief, show, booking, telegram, ask, sub,
  photos, files, onAdd, onRemovePhoto, onRemoveFile, onSubmit,
}) {
  const pick = useRef(null)
  const [over, setOver] = useState(false)
  const take = (list) => { const fs = [...(list || [])]; if (fs.length) onAdd(fs) }
  const lines = [
    show.reference && ['reference', tx('Reference'), tx('A link, or what it should look like')],
    show.script && ['script', tx('Script'), tx('What is said and shown, line by line')],
    show.tz && ['tz', 'ТЗ', tx('What the editor makes — length, pace, captions, music')],
  ].filter(Boolean)
  return (
    <div className="tb-q">
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><Paperclip size={18} /></span>{ask || tx('Anything else?')}</h2>
      <p className="tb-sub">
        {booking || (telegram ? tx('Say what this Telegram piece is — the rest is optional.')
          : sub || tx('Optional — skip it and press Create.'))}
      </p>
      {telegram && (
        <TelegramFields type={telegram.type} guiding={telegram.guiding} required bad={telegram.missing}
          onType={(v) => onBrief({ telegram_type: v || '' })} onGuiding={(v) => onBrief({ is_guiding: v })} />
      )}
      <div className="tb-brief">
        {lines.map(([k, label, ph], i) => (
          <Line key={k} label={label} value={brief[k]} placeholder={ph} first={i === 0}
            onSubmit={onSubmit}
            onChange={(v) => onBrief({ [k]: v })} />
        ))}
      </div>
      <div className={'tb-drop' + (over ? ' over' : '')} role="button" tabIndex={0}
        onClick={() => pick.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}>
        <UploadCloud size={22} />
        <b>{tx('Add pictures or files')}</b>
        <span>{tx('Drop them here, tap to choose, or paste a screenshot')}</span>
        <input ref={pick} type="file" multiple hidden onChange={(e) => { take(e.target.files); e.target.value = '' }} />
      </div>
      {(photos.length > 0 || files.length > 0) && (
        <div className="tb-files">
          {photos.map((p, i) => (
            <span key={`p${i}`} className="tb-thumb">
              <img src={p.thumb || p.photo} alt="" />
              <button type="button" className="tb-thumb-x" onClick={() => onRemovePhoto(i)} aria-label={tx('Remove')}><X size={12} /></button>
            </span>
          ))}
          {files.map((f, i) => (
            <span key={`f${i}`} className="tb-file">
              <FileText size={13} /> <span className="tb-file-name">{f.name}</span>
              <button type="button" className="tb-file-x" onClick={() => onRemoveFile(i)} aria-label={tx('Remove')}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Paperclip, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { tr as tx } from '../lib/i18n.jsx'
import { isPicture, readDocument, scaleWithin, PICTURE_MAX_BYTES } from '../lib/picture.js'
import PravkaNote from './PravkaNote.jsx'

// Where a pravka is written. A reviewer describing a wrong frame in words is
// doing the slow version of pasting it, so this box takes the picture itself:
// paste a screenshot (Ctrl/⌘+V), drop one or a file on it, or pick them —
// the only way on a phone. Each is uploaded the moment it arrives and the
// Markdown that points at it is appended to the note, so what is saved is
// still one plain block of text (see PravkaNote for how it is drawn).
const DOCS = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.csv'
const append = (note, md) => {
  const s = String(note || '')
  return `${s}${s && !s.endsWith('\n') ? '\n' : ''}${md}\n`
}
const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tx('Could not read that image'))) }
  img.src = url
})

// `onChange` is handed either the next text or a function of the current one:
// an upload lands after the reviewer has typed on, and must not undo it.
export default function PravkaBox({ taskId, value, onChange, onError, onUploading, phone, disabled, placeholder }) {
  const [pending, setPending] = useState(0)
  const [over, setOver] = useState(false)
  const pickRef = useRef(null)
  useEffect(() => { onUploading?.(pending > 0) }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (file) => {
    if (!file) return
    setPending((n) => n + 1)
    try {
      let name = file.name || 'screenshot.png'
      let data
      if (isPicture(file)) {
        if (file.size > PICTURE_MAX_BYTES) throw new Error(tx('Image is too large — keep it under 15 MB'))
        data = scaleWithin(await loadImage(file), 1600, 0.85)
        name = `${name.replace(/\.[^.]*$/, '') || 'screenshot'}.jpg`
      } else {
        data = await readDocument(file)
      }
      const out = await api.post(`/content/${taskId}/pravka-files`, { name, data })
      onChange((note) => append(note, out.md))
      onError?.('')
    } catch (e) {
      onError?.(e.message)
    } finally {
      setPending((n) => n - 1)
    }
  }
  const sendAll = (files) => { for (const f of files) send(f) }

  // A paste of words is a paste of words; only a file on the clipboard is
  // taken over. Stopped here so the sheet's own paste (which files a picture
  // as the task's reference) never sees it.
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])]
      .filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean)
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    sendAll(files)
  }
  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])]
    setOver(false)
    if (!files.length) return
    e.preventDefault()
    e.stopPropagation()
    sendAll(files)
  }
  const hasMedia = /\]\(\/api\/content\/pravka-files\/\d+\)/.test(value || '')

  return (
    <div className={`pravka-box${over ? ' over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}>
      <textarea className="input" rows={4} autoFocus={!phone} value={value} disabled={disabled}
        onPaste={onPaste}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} />
      <div className="pravka-attach-row">
        <button type="button" className="btn btn-sm pravka-attach" disabled={disabled}
          onClick={() => pickRef.current?.click()}>
          <Paperclip size={13} /> {phone ? tx('Attach a screenshot or file') : tx('Paste screenshot or drop file')}
        </button>
        <input ref={pickRef} type="file" multiple accept={`image/*,${DOCS}`} style={{ display: 'none' }}
          onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ''; sendAll(files) }} />
        {pending > 0 && (
          <span className="stat-sub pravka-up" role="status" aria-live="polite">
            <Loader2 size={12} className="spin" /> {tx('Uploading…')}
          </span>
        )}
      </div>
      {hasMedia && (
        <div className="pravka-preview">
          <PravkaNote text={value} />
        </div>
      )}
    </div>
  )
}

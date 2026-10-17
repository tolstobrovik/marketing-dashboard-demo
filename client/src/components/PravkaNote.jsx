import { useEffect, useState } from 'react'
import { Paperclip, ExternalLink, ImageOff } from 'lucide-react'
import { api } from '../lib/api.js'
import { tr as tx } from '../lib/i18n.jsx'
import Zoom from './Zoom.jsx'
import { LinkText } from './LinkView.jsx'

// A pravka note, drawn.
//
// The note is stored as the reviewer typed it: plain text, with a Markdown
// link for every screenshot pasted into it — ![image](url) — and every file
// dropped on it — [name](url). Nothing here is fed to innerHTML; the note is
// split into pieces and each one becomes a React element, so a note can say
// anything and still only ever draw text, pictures and links.
//
// Pictures come from behind the sign-in (see /content/pravka-files), and an
// <img src> cannot carry the token, so each one is fetched once with it and
// drawn from a local object URL. A picture link pointing anywhere ELSE is left
// as a link rather than loaded: a note should not make everybody who opens it
// call out to an address somebody typed.
export const PRAVKA_ASSET = /^\/api\/content\/pravka-files\/\d+$/
const LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g

export function pravkaParts(text) {
  const s = String(text || '')
  const out = []
  let last = 0
  for (const m of s.matchAll(LINK)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    out.push({ t: m[1] ? 'img' : 'file', label: m[2], url: m[3] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

// One fetch per picture for the life of the page: the same screenshot in the
// sheet's history and on the editor's day is the same bytes.
const fetched = new Map()
const objectUrl = (url) => {
  if (!fetched.has(url)) {
    fetched.set(url, api.blob(url.replace(/^\/api/, ''))
      .then((b) => URL.createObjectURL(b))
      .catch((e) => { fetched.delete(url); throw e }))
  }
  return fetched.get(url)
}

function Shot({ url }) {
  const [src, setSrc] = useState(null)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    let live = true
    objectUrl(url).then((s) => { if (live) setSrc(s) }).catch(() => { if (live) setBad(true) })
    return () => { live = false }
  }, [url])
  if (bad) return <span className="pn-miss"><ImageOff size={13} /> {tx('Picture unavailable')}</span>
  if (!src) return <span className="pn-shot pn-wait" aria-busy="true" />
  return <span className="pn-shot"><Zoom src={src} full={src} alt={tx('Screenshot')} /></span>
}

function FileLink({ url, label }) {
  const [busy, setBusy] = useState(false)
  if (!PRAVKA_ASSET.test(url)) {
    if (!/^https?:\/\//i.test(url)) return <span>{label || url}</span>
    return (
      <a className="pn-file" href={url} target="_blank" rel="noreferrer">
        <ExternalLink size={12} /> {label || url}
      </a>
    )
  }
  // Saved under its own name — the bytes are fetched with the token, then
  // handed to the browser as a download.
  const save = async () => {
    setBusy(true)
    try {
      const a = document.createElement('a')
      a.href = await objectUrl(url)
      a.download = label || 'file'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch { /* the button stays, and can be pressed again */ } finally { setBusy(false) }
  }
  return (
    <button type="button" className="pn-file" disabled={busy} onClick={save}>
      <Paperclip size={12} /> {label || tx('File')}
    </button>
  )
}

export default function PravkaNote({ text, className = '' }) {
  const parts = pravkaParts(text)
  return (
    <span className={`pravka-note${className ? ` ${className}` : ''}`}>
      {parts.map((p, i) => {
        if (p.t === 'text') return <span key={i}><LinkText text={p.v} /></span>
        if (p.t === 'img' && PRAVKA_ASSET.test(p.url)) return <Shot key={i} url={p.url} />
        return <FileLink key={i} url={p.url} label={p.t === 'img' ? (p.label || tx('Picture')) : p.label} />
      })}
    </span>
  )
}

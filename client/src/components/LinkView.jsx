import { useState } from 'react'
import { ExternalLink, Link2 } from 'lucide-react'
import { URL_RE } from '../lib/text.js'
import { tr as tx } from '../lib/i18n.jsx'
import { FullScreen } from './DriveFiles.jsx'

// ---- links, opened here (r11, the editor's and operator's feedback) -----------
//
// "Links in the text don't work when pressed — and they shouldn't throw you out
// to Instagram." A link written into a brief, a reference or a comment is drawn
// as a link, and pressing it opens it ON the platform: the post, the reel, the
// video or the Drive file plays in a full-screen viewer, and closing it is back
// where you were. Only the sites that allow being shown inside another page can
// be (their own embed addresses below); any other address opens to a card with
// the address and one button to open it in a new tab — the person's choice,
// never a jump by itself.

const full = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)

// The address a site lets other pages show, and the shape it plays in.
export function embedOf(raw) {
  let u
  try { u = new URL(full(raw)) } catch { return null }
  const h = u.hostname.replace(/^(www\.|m\.)/, '')
  let m
  if (h === 'instagram.com' && (m = /^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/.exec(u.pathname)))
    return { src: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed`, tall: m[1] !== 'p' }
  if (h === 'youtu.be' && (m = /^\/([\w-]{6,})/.exec(u.pathname))) return { src: `https://www.youtube.com/embed/${m[1]}` }
  if (h === 'youtube.com') {
    if ((m = /^\/shorts\/([\w-]{6,})/.exec(u.pathname))) return { src: `https://www.youtube.com/embed/${m[1]}`, tall: true }
    if ((m = /^\/(?:embed|live)\/([\w-]{6,})/.exec(u.pathname))) return { src: `https://www.youtube.com/embed/${m[1]}` }
    const v = u.searchParams.get('v')
    if (v) return { src: `https://www.youtube.com/embed/${v}` }
  }
  if (h === 'tiktok.com' && (m = /\/video\/(\d+)/.exec(u.pathname))) return { src: `https://www.tiktok.com/embed/v2/${m[1]}`, tall: true }
  if (h === 'vimeo.com' && (m = /^\/(\d+)/.exec(u.pathname))) return { src: `https://player.vimeo.com/video/${m[1]}` }
  if (h === 'drive.google.com') {
    const id = (/\/file\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(u.pathname) || [])[1] || u.searchParams.get('id')
    if (id) return { src: `https://drive.google.com/file/d/${id}/preview` }
    if ((m = /\/folders\/([\w-]+)/.exec(u.pathname))) return { src: `https://drive.google.com/embeddedfolderview?id=${m[1]}#grid`, page: true }
  }
  if (h === 'docs.google.com' && (m = /^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(u.pathname)))
    return { src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview`, page: true }
  if (h === 't.me' && (m = /^\/([\w]+)\/(\d+)/.exec(u.pathname))) return { src: `https://t.me/${m[1]}/${m[2]}?embed=1`, page: true }
  return null
}

const shortOf = (raw) => {
  try {
    const u = new URL(full(raw))
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : ''
    const s = u.hostname.replace(/^www\./, '') + path
    return s.length > 42 ? `${s.slice(0, 40)}…` : s
  } catch { return raw }
}

export function LinkViewer({ url, onClose }) {
  const e = embedOf(url)
  const href = full(url)
  return (
    <FullScreen onClose={onClose}>
      {e ? (
        <div className={'lv-frame' + (e.tall ? ' lv-tall' : '') + (e.page ? ' lv-page' : '')}>
          <iframe title={shortOf(url)} src={e.src} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
        </div>
      ) : (
        <div className="lv-card">
          <Link2 size={22} aria-hidden="true" />
          <b>{shortOf(url)}</b>
          <p>{tx('This site doesn’t let other pages show it, so it can’t open here.')}</p>
        </div>
      )}
      <p className="co-player-name lv-foot">
        <a className="lv-out" href={href} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{tx('Open in a new tab')}</a>
      </p>
    </FullScreen>
  )
}

// A reference link drawn as what it is, not as its address (the owner, 14 Oct
// 2026: "add it with a reference like a preview, on the platform itself"): a
// video's picture, a reel or post shown small, or the site's name. Pressing it
// opens the viewer above. The small page inside is only a picture of the post —
// it takes no clicks; the button laid over it does.
export function LinkPreview({ url, onOpen }) {
  const e = embedOf(url)
  const yt = /youtube\.com\/embed\/([\w-]+)/.exec(e?.src || '')?.[1]
  const kind = yt ? 'lp-wide' : e && !e.page ? (e.tall ? 'lp-tall' : 'lp-wide') : 'lp-card'
  return (
    <div className={`lp ${kind}`}>
      {yt ? <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" loading="lazy" />
        : kind !== 'lp-card' ? <iframe src={e.src} title={shortOf(url)} tabIndex={-1} aria-hidden="true" loading="lazy" />
          : <span className="lp-site"><Link2 size={18} aria-hidden="true" />{shortOf(url)}</span>}
      <button type="button" className="lp-open" onClick={() => onOpen(url)} aria-label={tx('Open the reference: {name}', { name: shortOf(url) })} title={full(url)} />
    </div>
  )
}

// Text with its links made pressable; each opens in the viewer above.
export function LinkText({ text, className }) {
  const [open, setOpen] = useState(null)
  const s = String(text ?? '')
  const parts = []
  let last = 0
  for (const m of s.matchAll(URL_RE)) {
    // a sentence's full stop or a closing bracket is not part of the address
    const url = m[0].replace(/[.,;:!?)\]»"']+$/, '')
    if (m.index > last) parts.push(s.slice(last, m.index))
    parts.push(<button key={m.index} type="button" className="lv-link" onClick={() => setOpen(url)} title={full(url)}>{shortOf(url)}</button>)
    last = m.index + url.length
  }
  if (last < s.length) parts.push(s.slice(last))
  return (
    <>
      {className ? <span className={className}>{parts}</span> : parts}
      {open && <LinkViewer url={open} onClose={() => setOpen(null)} />}
    </>
  )
}

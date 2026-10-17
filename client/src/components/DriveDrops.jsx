import { useEffect, useState } from 'react'
import { Copy, ExternalLink, FileText } from 'lucide-react'
import { api, getToken } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { sizeLabel } from '../lib/uploads.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- Drive drop-in, in the task window ------------------------------------------
//
// "Copy file name" hands over the name that makes a file dropped into the
// team's Drive folders find this task (server/dropin.js); its tooltip names the
// folder the SERVER says this task's stage sends files to. Below the files,
// what has arrived that way: a preview fetched through the server (it is
// behind the sign-in, like the file), a video's length, and the way to open
// it in Drive. It decides nothing — which task, which folder and what a file
// is are all the server's answers.

const KIND = { footage: () => tx('Footage'), fix: () => tx('A fix'), final: () => tx('The final file') }
const lengthOf = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// A phone browser can refuse the clipboard API; the old way still copies.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {
    try {
      const el = Object.assign(document.createElement('textarea'), { value: text, readOnly: true })
      el.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(el)
      el.select()
      const done = document.execCommand('copy')
      el.remove()
      return done
    } catch { return false }
  }
}

export function CopyName({ drop }) {
  const [watching, setWatching] = useState(null)
  useEffect(() => { api.cached('/drive/status').then((s) => setWatching(!!s?.drop?.on)).catch(() => setWatching(false)) }, [])
  if (!drop?.file_name) return null
  const folder = drop.folder_name
  const copy = async () => {
    if (await copyText(drop.file_name)) toast(tx('Copied: {name}', { name: drop.file_name }))
    else toast(tx('Could not copy. Select the name and copy it yourself.'), 'err')
  }
  return (
    <div className="co-dropname">
      <div className="co-dropname-row">
        <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={copy}
          title={tx('Name your file this, then drop it in the {folder} folder in Google Drive', { folder })}>
          <Copy size={16} aria-hidden="true" />{tx('Copy file name')}
        </button>
        <code className="co-dropname-text">{drop.file_name}</code>
      </div>
      <p className="co-help co-dropname-help">
        {watching
          ? tx('After you press: the name is copied. Give your file this name and drop it in Google Drive → {folder}. It shows up here by itself in a few minutes.', { folder })
          : tx('After you press: the name is copied. Give your file this name, so everybody can tell which task it is for.')}
        {watching && drop.folder_url && (
          <> <a className="co-link" href={drop.folder_url} target="_blank" rel="noreferrer">{tx('Open the {folder} folder', { folder })}</a></>
        )}
      </p>
    </div>
  )
}

// Fetched with the token (an <img src> cannot carry it). The answer also
// says how long a video is, which Google often knows only once the preview is
// made — so the length can appear with the picture, not one visit later.
export function Thumb({ d, path, onLength }) {
  const [src, setSrc] = useState(null)
  const [why, setWhy] = useState('')
  useEffect(() => {
    let alive = true
    let made = null
    fetch(`/api${path || `/drive/drops/${d.id}/thumb`}`, { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {} })
      .then(async (r) => {
        if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status })
        const ms = Number(r.headers.get('x-duration-ms'))
        const b = await r.blob()
        if (!alive) return
        if (ms) onLength?.(ms)
        made = URL.createObjectURL(b)
        setSrc(made)
      })
      .catch((e) => { if (alive) setWhy(e.status === 404 ? tx('Preview is being made by Google') : tx('No preview: Google Drive did not answer')) })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [d?.id, path]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className={'co-drop-thumb' + (src ? '' : ' co-drop-wait')}>
      {src ? <img src={src} alt="" /> : <small>{why}</small>}
    </span>
  )
}

export function DropList({ drops }) {
  const [lengths, setLengths] = useState({})
  if (!drops?.length) return null
  return (
    <ul className="co-drops" aria-label={tx('Files dropped in Google Drive')}>
      {drops.map((d) => ({ ...d, duration_ms: d.duration_ms || lengths[d.id] || null })).map((d) => (
        <li key={d.id} className="co-drop">
          {/^(image|video)\//.test(d.mime || '')
            ? <Thumb d={d} onLength={(ms) => setLengths((l) => ({ ...l, [d.id]: ms }))} />
            : <span className="co-drop-thumb co-drop-wait"><FileText size={22} aria-hidden="true" /></span>}
          <div className="co-drop-info">
            <b>{d.name}</b>
            <span>
              {[KIND[d.kind]?.(), tx('from the {folder} folder', { folder: d.folder_name }), d.size ? sizeLabel(d.size) : null,
                d.duration_ms ? lengthOf(d.duration_ms) : null].filter(Boolean).join(' · ')}
            </span>
            <a className="co-link" href={d.link} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />{tx('Open in Drive')}</a>
          </div>
        </li>
      ))}
    </ul>
  )
}

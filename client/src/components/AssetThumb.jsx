import { useEffect, useMemo, useState } from 'react'
import { FileImage, Folder } from 'lucide-react'
import { parseAsset, thumbOf } from '../lib/assetLink.js'
import { tr as tx } from '../lib/i18n.jsx'
import Zoom from './Zoom.jsx'

// The artwork itself on a card: 16:9, cropped to the middle, one press to see
// it full size. Drive draws a thumbnail for a file the viewer may open; for
// one it will not show, a folder, or a link that is not a picture, the box
// says what it is instead of drawing a broken image.
export default function AssetThumb({ link, title = '' }) {
  const a = useMemo(() => parseAsset(link), [link])
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [link])
  if (a.kind === 'none') return null
  const src = thumbOf(a)
  if (src && !broken) {
    return (
      <div className="asset-thumb">
        <Zoom src={src} full={thumbOf(a, 1600)} alt={title} onError={() => setBroken(true)} />
      </div>
    )
  }
  const Icon = a.kind === 'folder' ? Folder : FileImage
  return (
    <a className="asset-thumb asset-thumb-icon" href={a.url} target="_blank" rel="noreferrer"
      onClick={(e) => e.stopPropagation()}>
      <Icon size={22} />
      <span>{a.kind === 'folder' ? (a.label || tx('Folder')) : tx('No preview')}</span>
    </a>
  )
}

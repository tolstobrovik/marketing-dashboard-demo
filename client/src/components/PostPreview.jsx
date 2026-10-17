import { useState } from 'react'
import { Play } from 'lucide-react'
import { Thumb } from './DriveDrops.jsx'
import { LinkViewer } from './LinkView.jsx'
import { deliveryHref } from '../lib/text.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- what went out, on its card (the owner, 13 Oct: "in Published there
// should be a preview of the reels, videos…") ------------------------------------
//
// The picture is the final edit's own frame from the team's Drive (the
// board's file route, behind the sign-in); without one, a plain play tile.
// Pressed, it plays on the platform: the published post when its link is
// there (an Instagram reel, a YouTube video — LinkView embeds them), else the
// final edit from Drive. Nothing when there is neither.

const driveIdOf = (url) => (/\/d\/([\w-]{10,})/.exec(url || '') || /[?&]id=([\w-]{10,})/.exec(url || '') || [])[1] || null

export default function PostPreview({ item }) {
  const [open, setOpen] = useState(false)
  const post = deliveryHref(item.post_link)
  const edit = deliveryHref(item.ready_link) || deliveryHref(item.design_link)
  const url = post || edit
  if (!url) return null
  const id = driveIdOf(edit)
  return (
    <>
      <button type="button" className="postpv" data-notrack onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        aria-label={post ? tx('Watch the published post') : tx('Watch the final edit')}>
        {id ? <Thumb path={`/drive/tasks/${item.id}/files/${encodeURIComponent(id)}/thumb`} /> : <span className="postpv-blank" />}
        <span className="postpv-play"><Play size={18} aria-hidden="true" /></span>
        <span className="postpv-tag">{post ? tx('The post') : tx('The final edit')}</span>
      </button>
      {open && <span onClick={(e) => e.stopPropagation()}><LinkViewer url={url} onClose={() => setOpen(false)} /></span>}
    </>
  )
}

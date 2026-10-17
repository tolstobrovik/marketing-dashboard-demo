import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ArrowRight, Check, Clock } from 'lucide-react'
import { api } from '../lib/api.js'
import { deliveryHref } from '../lib/text.js'
import { todayISO } from '../lib/constants.js'
import { dayInLine } from './CoachParts.jsx'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- "Also TikTok", "Also Shorts" ----------------------------------------------
//
// One video, posted again (server/reposts.js). Drawn from what GET /content/:id
// says — `info` is its `reposts` — and nothing is decided here: which channels
// are offered, whether this person may tick them, and that a tick changes
// nothing once the piece is out are all the server's. The ticks go to
// PUT /content/:id/reposts, which answers with the same shape.
//
//   on a video being made     the ticks, and who gets the reposts
//   once it is out            each repost: on its way or out, with its link
//   on a repost task          where it came from, and the video to post
//
// The task window (CoachTask.jsx) and the full sheet (ContentModal.jsx) both
// draw it.
export default function Reposts({ taskId, info, onInfo }) {
  const [busy, setBusy] = useState(false)
  if (!info) return null
  const { offer = [], ticked = [], may, out, made = [], from, poster } = info

  const tick = async (key, on) => {
    if (busy) return
    setBusy(true)
    try {
      const to = on ? [...ticked, key] : ticked.filter((k) => k !== key)
      onInfo?.(await api.put(`/content/${taskId}/reposts`, { to }))
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const labelOf = (key) => offer.find((o) => o.key === key)?.label || key
  const open = (id) => `/brief?task=${id}`

  // A repost task: where it came from, and the one file it is about.
  if (from) {
    const video = deliveryHref(from.video)
    return (
      <section className="co-blk co-rep">
        <h3>{tx('Posted again')}</h3>
        <p>{from.label
          ? tx('This is «{title}» from {channel}, posted again here.', { title: from.title, channel: from.label })
          : tx('This is «{title}», posted again here.', { title: from.title })}</p>
        <div className="co-files">
          {video
            ? <a className="co-file" href={video} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />{tx('The video to post')}</a>
            : <span className="co-none">{tx('The original has no video link yet — ask whoever edited it.')}</span>}
          <Link className="co-file" to={open(from.id)}>{tx('Open the original')} <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>
    )
  }
  if (!offer.length) return null

  return (
    <section className="co-blk co-rep">
      <h3>{tx('TikTok and Shorts')}</h3>
      {!out && may && (
        <>
          <div className="co-ticks">
            {offer.map((o) => (
              <label key={o.key} className="co-tick">
                <input type="checkbox" checked={ticked.includes(o.key)} disabled={busy}
                  onChange={(e) => tick(o.key, e.target.checked)} />
                {tx('Also {channel}', { channel: o.label })}
              </label>
            ))}
          </div>
          <p className="co-help">{ticked.length
            ? tx('When it is published: {name} gets a task for each one — the same video and caption, to post the next day.', { name: poster || tx('The team') })
            : tx('Not ticked: it goes out on this channel only.')}</p>
        </>
      )}
      {!out && !may && (
        <p className="co-help">{ticked.length
          ? tx('When it is published, it also goes to {channels}.', { channels: ticked.map(labelOf).join(', ') })
          : tx('It goes out on this channel only. Whoever runs it can add TikTok or Shorts.')}</p>
      )}
      {out && made.length === 0 && (
        <p className="co-none">{tx('It went out on this channel only — nothing was ticked before it was published.')}</p>
      )}
      {made.length > 0 && (
        <ul className="co-rep-list">
          {made.map((m) => (
            <li key={m.channel}>
              {m.out ? <Check size={16} aria-hidden="true" className="co-rep-out" /> : <Clock size={16} aria-hidden="true" className="co-rep-wait" />}
              <span>
                <b>{tx('Also on {channel}: {state}', { channel: m.label, state: m.out ? tx('published') : tx('waiting to be posted') })}</b>
                {!m.out && <em>{!m.poster ? tx('Nobody is named to post it yet')
                  : m.due ? tx('{name} posts it by {day}', { name: m.poster.split(' ')[0], day: dayInLine(m.due, todayISO()) })
                    : tx('{name} posts it', { name: m.poster.split(' ')[0] })}</em>}
              </span>
              {m.out && deliveryHref(m.post_link)
                ? <a className="co-link" href={deliveryHref(m.post_link)} target="_blank" rel="noreferrer">{tx('See the post')} <ExternalLink size={14} aria-hidden="true" /></a>
                : <Link className="co-link" to={open(m.id)}>{tx('Open')} <ArrowRight size={14} aria-hidden="true" /></Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

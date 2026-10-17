import { useChannels } from '../lib/channels.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- how long the post is, against where it is going ----------------------------
//
// X takes 280 characters, Threads 500, LinkedIn 3000. The limit is the
// channel's own data (channels.char_limit), and the server refuses a move to
// Ready or past it over the limit (content.js, `tooLong`) — this only shows
// the count while the words are typed, so nobody finds out at the button.
// Across several channels the tightest limit holds, as on the server.
// Characters are counted the server's way: code points, so an emoji is one.
export function limitOf(keys, byKey) {
  let best = null
  for (const k of keys || []) {
    const c = byKey?.[k]
    if (c?.char_limit > 0 && (!best || c.char_limit < best.char_limit)) best = c
  }
  return best
}
export const charsOf = (text) => [...String(text || '')].length

export default function CharCount({ text, channels }) {
  const { byKey } = useChannels()
  const lim = limitOf(channels, byKey)
  if (!lim) return null
  const n = charsOf(text)
  const over = n > lim.char_limit
  return (
    <div className={'co-count' + (over ? ' co-count-over' : '')} aria-live="polite">
      <span className="co-count-n">{tx('{n} / {limit} characters', { n, limit: lim.char_limit })}</span>
      {over && <span>{tx('Too long for {channel} — shorten it to {limit} characters.', { channel: lim.label, limit: lim.char_limit })}</span>}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { Check, Shapes } from 'lucide-react'
import { typeInfo, iconFor } from '../../lib/constants.js'
import { tr as tx } from '../../lib/i18n.jsx'

// Step 2 — what kind of thing is it? Big pictures, one press. Ordered by
// how often the team actually makes each (the last month: reels 64%, posts
// 23%, ads 9%, long videos 3%), with a few words under each so nobody has to
// know what "Target" means on this board to pick it.
export const KINDS = [
  { key: 'reel', hint: 'Short vertical video' },
  { key: 'post', hint: 'Picture or carousel' },
  { key: 'target', hint: 'Paid ad' },
  { key: 'video', hint: 'Long video' },
  { key: 'story', hint: 'Gone in 24 hours' },
  { key: 'other', hint: 'Anything else' },
]

// What each kind of channel actually gets (the last 120 days of the live
// board): Instagram makes reels and the odd post or story, the ads account
// reels and paid targets, YouTube long videos, Telegram posts and nothing
// else. Those are the big tiles; everything else is one small row under them,
// still one press away.
export const USUAL = {
  social: ['reel', 'post', 'story'],
  ads: ['reel', 'target', 'post'],
  video: ['video', 'reel'],
  text: ['post'],
}

export default function StepType({ type, onPick, channel, channels, onChannel, format }) {
  const group = useRef(null)
  // The chosen kind has the focus, so Enter accepts it and the arrows move
  // from it — the keyboard path through this step is one key.
  useEffect(() => {
    group.current?.querySelector('.tb-kind.on')?.focus()
  }, [])
  const usual = USUAL[format] || USUAL.social
  // A kind picked from the small row joins the big ones, so what is chosen
  // is always what is seen.
  const big = KINDS.filter((k) => usual.includes(k.key) || k.key === type)
  const rest = KINDS.filter((k) => !big.includes(k))
  const move = (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 }
    if (!(e.key in keys)) return
    const all = [...group.current.querySelectorAll('.tb-kind')]
    const at = all.indexOf(document.activeElement)
    if (at < 0) return
    e.preventDefault()
    all[Math.max(0, Math.min(all.length - 1, at + keys[e.key]))].focus()
  }
  return (
    <div className="tb-q">
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><Shapes size={18} /></span>{tx('What kind is it?')}</h2>
      {/* Only when there is really a choice to make: every task this month
          went to exactly one channel, and nearly always the one on screen. */}
      {channels.length > 1 && (
        <div className="tb-where">
          <span className="tb-where-label">{tx('Where does it go?')}</span>
          <div className="tb-pills">
            {channels.map((c) => {
              const Icon = iconFor(c.icon)
              return (
                <button key={c.key} type="button" className={'tb-pill' + (c.key === channel ? ' on' : '')}
                  aria-pressed={c.key === channel} onClick={() => onChannel(c.key)}>
                  <Icon size={14} /> {c.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className={'tb-kinds' + (big.length < 3 ? ' tb-kinds-few' : '')} role="radiogroup" aria-label={tx('What kind is it?')} ref={group} onKeyDown={move}>
        {big.map((k) => {
          const info = typeInfo(k.key)
          const Icon = info.icon
          const on = type === k.key
          return (
            <button key={k.key} type="button" role="radio" aria-checked={on} data-kind={k.key}
              className={'tb-kind' + (on ? ' on' : '')} onClick={() => onPick(k.key)}>
              <span className="tb-kind-icon"><Icon size={22} /></span>
              <b>{tx(info.label)}</b>
              <span className="tb-kind-hint">{tx(k.hint)}</span>
              {on && <span className="tb-kind-tick" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>}
            </button>
          )
        })}
      </div>
      {rest.length > 0 && (
        <div className="tb-kinds-more">
          <span className="tb-where-label">{tx('Something else')}</span>
          <div className="tb-pills">
            {rest.map((k) => {
              const info = typeInfo(k.key)
              const Icon = info.icon
              return (
                <button key={k.key} type="button" className="tb-pill" data-kind={k.key} onClick={() => onPick(k.key)}>
                  <Icon size={14} /> {tx(info.label)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

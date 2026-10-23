import { useEffect, useRef } from 'react'
import { MapPin } from 'lucide-react'
import { ChanMark } from '../CoachBits.jsx'
import { tr as tx } from '../../lib/i18n.jsx'

// The first question, when the page did not say: where does it go? One tile
// a channel, among the person's own; the press moves on, and the kind of work
// follows the channel (a reel on Instagram, a post on Telegram). Opened from
// a channel's page this step is not drawn at all.
export default function StepWhere({ channels, value, onPick }) {
  const box = useRef(null)
  useEffect(() => { box.current?.querySelector('.qt-chan.on, .qt-chan')?.focus() }, [])
  return (
    <div className="tb-q" ref={box}>
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><MapPin size={18} /></span>{tx('Where does it go?')}</h2>
      <p className="tb-sub">{tx('The channel decides what is asked next.')}</p>
      <div className="qt-where" role="radiogroup" aria-label={tx('Where does it go?')}>
        {channels.map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={c.key === value}
            className={'qt-chan' + (c.key === value ? ' on' : '')} onClick={() => onPick(c.key)}>
            <ChanMark channel={c} size={22} /><b>{c.label}</b>
          </button>
        ))}
      </div>
    </div>
  )
}

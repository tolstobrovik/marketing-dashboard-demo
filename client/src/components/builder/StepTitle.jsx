import { useEffect, useRef } from 'react'
import { PenLine } from 'lucide-react'
import { tr as tx } from '../../lib/i18n.jsx'
import CharCount from '../CharCount.jsx'
import { KindPills } from './StepType.jsx'

// Step 1 — the idea. A name, already focused, and Enter moves on; under it
// what kind of piece it is, with the channel's usual kind already chosen
// (a reel on Instagram), and the idea itself in a few words. A name is the
// only thing a task cannot be born without — with it alone "Save for now"
// makes an idea, on today, and every other question waits.
export default function StepTitle({ value, onChange, onNext, description, onDescription, required, channels = [], kinds = null }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="tb-q">
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><PenLine size={18} /></span>{tx('What needs to be made?')}</h2>
      <p className="tb-sub">{tx('A short name is enough — you can change it later.')}</p>
      <input ref={ref} className="input tb-title" value={value} maxLength={200}
        placeholder={tx('e.g. SAT results reel')} aria-label={tx('Task name')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); if (value.trim()) onNext() }
        }} />
      {kinds && <KindPills type={kinds.type} format={kinds.format} onPick={kinds.onPick} />}
      <label className={'tb-line tb-desc' + (required ? ' req' : '')}>
        <span className="tb-line-label">{tx('The idea')}{!required && <span className="crew-opt"> {tx('optional')}</span>}</span>
        <textarea className="tb-line-input" rows={2} value={description} maxLength={4000}
          placeholder={required ? tx('This kind of task needs a short description.') : tx('What is it about, in a few words')}
          onChange={(e) => onDescription(e.target.value)} />
      </label>
      <CharCount text={description} channels={channels} />
      <p className="tb-hint"><kbd>Enter</kbd> {tx('to continue')}</p>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import { api } from '../../lib/api.js'
import { tr as tx } from '../../lib/i18n.jsx'
import FacePicker from './FacePicker.jsx'
import { DueStepper } from './StepEdit.jsx'

// The artwork — for the kinds that are designed. Who designs it and the day
// it is due, with how full that person's day already is: a designer is not
// booked by the hour, so their load is the number that matters.
export default function StepDesign({ designers, designerId, onDesigner, art, artFloor, release, onArt }) {
  const [load, setLoad] = useState({})
  useEffect(() => {
    if (!art) return
    let alive = true
    api.get(`/content/load?hat=designer_id&day=${art}`).then((r) => { if (alive) setLoad(r || {}) }).catch(() => {})
    return () => { alive = false }
  }, [art])
  const mine = designerId && load[designerId]
  return (
    <div className="tb-q">
      <h2 className="tb-ask"><span className="tb-ask-icon" aria-hidden="true"><Palette size={18} /></span>{tx('The artwork')}</h2>
      <FacePicker label={tx('Who designs it?')} Icon={Palette} people={designers} value={designerId} onChange={onDesigner} />
      {art && <DueStepper Icon={Palette} label={tx('Artwork due')} day={art} floor={artFloor} ceil={release} onDay={onArt} />}
      {mine?.cap > 0 && (
        <p className={'tb-sub' + (mine.taken >= mine.cap ? ' tb-full' : '')}>
          {tx('{taken} of {cap} that day', { taken: mine.taken, cap: mine.cap })}
          {mine.taken >= mine.cap ? ` · ${tx('day is full')}` : ''}
        </p>
      )}
    </div>
  )
}

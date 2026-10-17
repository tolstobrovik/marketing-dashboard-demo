import { Plus } from 'lucide-react'
import Avatar from '../Avatar.jsx'
import { tr as tx } from '../../lib/i18n.jsx'

// A row of faces instead of a dropdown of names. The people this person picks
// most come first (lib/picks.js), so the usual answer is one press on a face
// they recognise; anybody else is behind the last face, "Other", which is the
// same shape as the rest so the row stays one row.
//
// Pressing the chosen face again un-chooses it, unless `required` — a task
// always belongs to somebody. With `multi` the value is a list (who is in a
// shoot) and each face toggles on its own.
export default function FacePicker({ label, Icon, people, value, onChange, required = false, top = 4, multi = false }) {
  if (!people.length) return null
  const picked = multi ? (value || []) : [value]
  const isOn = (id) => picked.includes(id)
  const choose = (id) => (multi
    ? onChange(isOn(id) ? picked.filter((x) => x !== id) : [...picked, id])
    : onChange(isOn(id) && !required ? null : id))
  const shown = people.slice(0, top)
  // The chosen people stay in the row even when they are not among the
  // usual few, so what is picked is always what is seen.
  for (const u of people.filter((p) => isOn(p.id) && !shown.includes(p))) shown.push(u)
  const rest = people.filter((u) => !shown.includes(u))
  return (
    <div className="tb-faces">
      <div className="tb-faces-label">{Icon && <Icon size={14} />} {label}</div>
      <div className="tb-face-row">
        {shown.map((u) => {
          const on = isOn(u.id)
          return (
            <button key={u.id} type="button" className={'tb-face' + (on ? ' on' : '')} aria-pressed={on}
              onClick={() => choose(u.id)}>
              <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
              <span>{u.name.split(' ')[0]}</span>
            </button>
          )
        })}
        {rest.length > 0 && (
          // A real select under a face-shaped cover: the phone's own picker
          // opens, and nothing has to be built to scroll forty names.
          <label className="tb-face tb-face-other">
            <span className="tb-face-plus"><Plus size={16} /></span>
            <span>{tx('Other')}</span>
            <select className="tb-face-select" value="" aria-label={`${label} — ${tx('Someone else…')}`}
              onChange={(e) => e.target.value && choose(Number(e.target.value))}>
              <option value="">{tx('Someone else…')}</option>
              {rest.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}

import { monthRowLabel, monthTick } from '../lib/month.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the year, one bar a month ---------------------------------------------
//
// A month on its own says nothing. Fifty-three pieces is a good month or a
// collapse depending entirely on what the three before it were, and no
// arrangement of tiles about September can answer that — which is why both
// pages that report a month now open on the months around it.
//
// Each bar is what WENT OUT that month, split into the part that made its
// release day and the part that did not. The notch across the bar is what the
// month had promised: bar under the notch is a month that owes work, bar over
// it is a month that cleared its backlog. Clicking a month opens it.
export default function MonthBars({ months = [], selected, onPick, height = 132 }) {
  if (!months.length) return null
  const top = Math.max(1, ...months.map((m) => Math.max(m.out || 0, m.planned || 0)))
  const h = (v) => `${Math.round((Math.max(0, v) / top) * 100)}%`
  return (
    <div className="mo-bars" style={{ '--mo-h': `${height}px` }}>
      {months.map((m, i) => {
        // The red bar is the whole month; the green one is drawn over the
        // bottom of it. Two bars from the same floor would hide each other —
        // a stack has to start where the one under it stopped.
        const on = m.on_time || 0
        const all = Math.max(0, m.out || 0)
        return (
          <button key={m.month} type="button"
            className={'mo-col' + (m.month === selected ? ' on' : '')}
            onClick={() => onPick?.(m.month)}
            data-tip={`${monthRowLabel(m)} — ${tx('{n} went out', { n: m.out || 0 })}, ${tx('{n} on time', { n: on })}, ${tx('{n} planned', { n: m.planned || 0 })}`}>
            <span className="mo-n">{m.out || 0}</span>
            <span className="mo-track">
              {m.planned > 0 && <i className="mo-plan" style={{ bottom: h(m.planned) }} />}
              <i className="mo-late" style={{ height: h(all) }} />
              <i className="mo-on" style={{ height: h(on) }} />
            </span>
            <span className="mo-lab">{monthTick(m.month, months[i - 1]?.month)}</span>
          </button>
        )
      })}
    </div>
  )
}

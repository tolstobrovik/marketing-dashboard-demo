import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts'
import { monthName } from '../lib/constants.js'
import { monthRowLabel } from '../lib/month.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the two pictures on the Statistics page --------------------------------
//
// 1. On time or late, month by month — the cuts and artwork that came due,
//    judged against their own day (the re-promised one where there is one:
//    the server's step model, the same one every other number here uses).
//    Late is the one red; on time recedes, because late is the story. The
//    knock-ons came due too and are in neither bar — nobody's lateness — so
//    the tooltip counts them beside the bar rather than letting a month's
//    bar come up short by a number nobody can see.
// 2. What the window made, by type — a pie of at most six slices, with the
//    counts beside it, so the proportions and the numbers are both on screen.
//    StatsReport hands it over already counted (`mix`): the order, the
//    reader's words for the types and shares that add up to 100 are worked
//    out once there, because the spreadsheet prints the same rows.
//
// This file is the only one on the board that imports Recharts, and it is
// loaded on its own (lazy, in StatsReport) so the tiles never wait for it.
// Whether there is anything to draw at all is decided THERE, on the selected
// window's own numbers; this file only ever draws a window that has some.
//
// Colours are the --viz-* tokens in styles.css — the type chips' own colours,
// read off the page so they follow the theme. Text never wears a series
// colour — names and numbers are in ink, and the colour sits beside them in a
// swatch.

const VARS = ['--viz-reel', '--viz-post', '--viz-story', '--viz-video', '--viz-target', '--viz-other',
  '--viz-late', '--viz-ontime', '--viz-grid', '--ink', '--ink-2', '--muted', '--surface']

// The theme lives on <html data-theme>; the colours are re-read when it flips.
function useVizColors() {
  // Each token is resolved through a probe element to the colour the browser
  // computed — rgb() for a hex, color(srgb …) for a token built with
  // color-mix() — because an SVG attribute is not guaranteed to understand
  // var() or color-mix() itself: Chromium draws them, older Safari does not.
  const read = () => {
    const probe = document.createElement('i')
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const out = Object.fromEntries(VARS.map((v) => {
      probe.style.color = `var(${v})`
      return [v.slice(2), getComputedStyle(probe).color]
    }))
    probe.remove()
    return out
  }
  const [c, setC] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setC(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    return () => mo.disconnect()
  }, [])
  return c
}

// The bars' tooltip reads the month's own row rather than looping over the
// bars, because the knock-ons are in the row and not in a bar. Its head is the
// month's name and year — and, for the first or last month of a custom window,
// the days of it the bar actually counts: a bar that counts the 15th to the
// 30th should not be called "September". The rule is lib/month.js's, so the
// table and the spreadsheet name the same row the same way.
const BarTip = ({ active, payload, c }) => {
  const m = active && payload?.[0]?.payload
  if (!m) return null
  return (
    <div className="viz-tip" role="status">
      <div className="viz-tip-head">{monthRowLabel(m)}</div>
      <div className="viz-tip-row"><i style={{ background: c['viz-ontime'] }} aria-hidden="true" /><b>{m.onTime}</b> <span>{tx('On time')}</span></div>
      <div className="viz-tip-row"><i style={{ background: c['viz-late'] }} aria-hidden="true" /><b>{m.late}</b> <span>{tx('Late')}</span></div>
      {m.knock > 0 && <div className="viz-tip-row viz-tip-aside">{tx('{n} knock-on', { n: m.knock })}</div>}
    </div>
  )
}

// The pie's tooltip gives what the legend gives — the count AND the share —
// so hovering a slice is never a poorer answer than reading across to it.
const PieTip = ({ active, payload }) => {
  const s = active && payload?.[0]?.payload
  if (!s) return null
  return (
    <div className="viz-tip" role="status">
      <div className="viz-tip-row"><i style={{ background: s.fill }} aria-hidden="true" /><b>{s.value}</b> <span>{s.name} · {s.pct}</span></div>
    </div>
  )
}

// The month axis on a phone. Twelve months in the width of a phone is about
// twenty pixels a month, and a month's name needs more than that — so the
// axis names every second or third month, counted back from the LATEST one
// (the month the reader is in is never the one left unnamed). And where the
// months cross into another year, the year is written once under the first
// named month and again under the first named month of each new year: "Jan"
// on its own does not say which January.
const TICK_ROOM = 34 // px a month's name needs, with air either side of it
function monthTicks(bars, width) {
  const n = bars.length
  const plot = Math.max(1, width - 36) // less the numbers down the left
  const step = n ? Math.max(1, Math.ceil(TICK_ROOM / (plot / n))) : 1
  const named = new Set(bars.map((b, i) => i).filter((i) => (n - 1 - i) % step === 0))
  const crosses = n > 0 && bars[0].month.slice(0, 4) !== bars[n - 1].month.slice(0, 4)
  const yearAt = new Set()
  let last = null
  for (let i = 0; i < n; i++) {
    if (!named.has(i)) continue
    const y = bars[i].month.slice(0, 4)
    if (crosses && y !== last) yearAt.add(i)
    last = y
  }
  const at = new Map(bars.map((b, i) => [b.month, i]))
  return { named, yearAt, at, crosses }
}

// The shortest a late segment is ever drawn, in px. The bars' 2px stroke takes
// a pixel from its top and one from its bottom, and this leaves three of red
// whatever the scale.
const LATE_MIN = 5

export default function StatsCharts({ months = [], mix = { total: 0, rows: [] } }) {
  const c = useVizColors()
  const [hover, setHover] = useState(null)
  const bars = months.map((m) => ({
    month: m.month, from: m.from, to: m.to,
    onTime: m.made_on_time || 0, late: m.made_late || 0, knock: m.made_knock_on || 0,
  }))
  const anyBars = bars.some((b) => b.onTime + b.late + b.knock > 0)
  // The plot's width, measured before the first paint and again whenever it
  // changes (a phone turned sideways, the sidebar opened), so the month axis
  // knows how many names it has room for. Read here rather than off the
  // chart's own resize callback, which only fires once the browser gets round
  // to observing it — and not at all in a tab that is not being drawn.
  const plotRef = useRef(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    const el = plotRef.current
    if (!el) return undefined
    const read = () => setWidth(el.clientWidth || 600)
    read()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [anyBars])
  const slices = mix.rows.map((r) => ({ ...r, fill: c[`viz-${r.key}`] }))
  const total = mix.total
  const ticks = monthTicks(bars, width)

  // Uzbek month names come from the board's own book (Chromium has none).
  const short = (ym) => monthName(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 'short')
  // Drawn by a function rather than a component, so the axis is not handed a
  // new component type — and asked to rebuild every tick — on each render.
  const monthTick = ({ x, y, payload }) => {
    const i = ticks.at.get(payload?.value)
    if (i === undefined || !ticks.named.has(i)) return null
    return (
      <text x={x} y={y} dy={11} textAnchor="middle" fill={c.muted} fontSize={11} className="recharts-cartesian-axis-tick-value">
        <tspan x={x}>{short(payload.value)}</tspan>
        {ticks.yearAt.has(i) && <tspan x={x} dy={13}>{payload.value.slice(0, 4)}</tspan>}
      </text>
    )
  }

  return (
    <div className="viz-row">
      <figure className="card viz-card">
        <figcaption>
          <b>{tx('On time or late')}</b>
          <span className="stat-sub">{tx('Edits and artwork, against their own due day')}</span>
          {/* The span, said: the bars are the months running up to the
              window's end, not the window — and a young board has fewer of
              them than twelve, so the number is the count of bars drawn.
              One is its own sentence: "Last 1 months" is English nobody
              writes, and Russian's plural adjective cannot agree with it. */}
          {bars.length > 0 && (
            <span className="stat-sub">{bars.length === 1 ? tx('One month, by when each step was due')
              : tx('Last {n} months, by the month each step was due', { n: bars.length })}</span>
          )}
        </figcaption>
        <div className="viz-legend" aria-hidden="true">
          <span><i style={{ background: c['viz-ontime'] }} />{tx('On time')}</span>
          <span><i style={{ background: c['viz-late'] }} />{tx('Late')}</span>
        </div>
        {anyBars ? (
          <div className="viz-plot" ref={plotRef} role="img"
            aria-label={bars.map((b) => `${monthRowLabel(b)}: ${b.onTime} ${tx('on time')}, ${b.late} ${tx('late')}`
              + (b.knock ? `, ${tx('{n} knock-on', { n: b.knock })}` : '')).join('; ')}>
            <ResponsiveContainer width="100%" height={220 + (ticks.crosses ? 12 : 0)}>
              {/* Room down the left for three digits: a whole team's month
                  runs past a hundred, and a Y axis pulled further off the
                  edge than this cut "120" to "20". */}
              <BarChart data={bars} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke={c['viz-grid']} strokeWidth={1} />
                <XAxis dataKey="month" tick={monthTick} interval={0} tickLine={false}
                  axisLine={{ stroke: c['viz-grid'] }} height={ticks.crosses ? 36 : 24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: c.muted, fontSize: 11 }} width={40} />
                <Tooltip cursor={{ fill: c['viz-grid'], opacity: 0.5 }} content={<BarTip c={c} />} />
                {/* The surface-coloured stroke is the gap between the two
                    halves of a bar, and it is painted a pixel INSIDE each
                    edge — so a month's one late cut beside a hundred on time
                    (about a pixel and a half at this height) was all stroke
                    and no red, and read as a month with none late. A late
                    count is therefore never drawn shorter than LATE_MIN.
                    Recharts hands the callback the top of the stack, not the
                    segment's own value, so it asks the row by its index. */}
                <Bar dataKey="onTime" name={tx('On time')} stackId="a" fill={c['viz-ontime']} maxBarSize={24}
                  stroke={c.surface} strokeWidth={2} isAnimationActive={false} />
                <Bar dataKey="late" name={tx('Late')} stackId="a" fill={c['viz-late']} maxBarSize={24} radius={[4, 4, 0, 0]}
                  stroke={c.surface} strokeWidth={2} minPointSize={(_, i) => (bars[i]?.late > 0 ? LATE_MIN : 0)}
                  isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="viz-none">{tx('No edits or artwork came due in these months')}</div>}
      </figure>

      <figure className="card viz-card">
        <figcaption>
          <b>{tx('What was made, by type')}</b>
          <span className="stat-sub">{tx('Every piece created in this window')}</span>
        </figcaption>
        {total ? (
          <div className="viz-pie">
            <div className="viz-pie-plot" role="img"
              aria-label={slices.map((s) => `${s.name}: ${s.value} (${s.pct})`).join('; ')}>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%"
                    startAngle={90} endAngle={-270} stroke={c.surface} strokeWidth={2} isAnimationActive={false}>
                    {slices.map((s) => (
                      <Cell key={s.key} fill={s.fill} fillOpacity={hover && hover !== s.key ? 0.25 : 1} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="viz-pie-total"><b>{total}</b><span>{tx('pieces')}</span></div>
            </div>
            {/* The legend is the table: each type named, counted and shared
                out. Pointing at a row lights its slice and dims the rest, so
                a slice can be found by where it is and not only by its
                colour — two of the chip colours are one colour to a reader
                who cannot tell red from green. */}
            <ul className="viz-types" onMouseLeave={() => setHover(null)}>
              {slices.map((s) => (
                <li key={s.key} onMouseEnter={() => setHover(s.key)}>
                  <i style={{ background: s.fill }} aria-hidden="true" />
                  <span className="viz-type-name">{s.name}</span>
                  <b>{s.value}</b>
                  <span className="viz-type-pct">{s.pct}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <div className="viz-none">{tx('Nothing new was created in this period')}</div>}
      </figure>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import { todayISO } from '../../lib/constants.js'
import { monthOf, monthEdges, monthWords } from '../../lib/month.js'
import { tr as tx } from '../../lib/i18n.jsx'
import MonthBars from '../MonthBars.jsx'
import { BarChart, ChartCard, Stat } from '../Chart.jsx'
import { Views } from './Reports.jsx'

// Numbers → Month (N-02): where the board and the month stand. The retired
// Overview's top row and "Who is carrying it" (N-07), then the Reports tab's
// "Views" and "What worked best" — one month, read off the server's own
// answers (/reports/stats, /reports/activity, /reports/views).
//
// Two of the six numbers are the board RIGHT NOW and the rest are the month
// being read, and they are labelled as such. The last two are the People
// tab's own headline, in its words and from the same numbers: the lateness is
// the month's row of the series — the cuts and the artwork that came due in
// it, against their own day, with the knock-ons counted beside them and in
// neither — the same count the People tab makes for the same month. The
// revisions are the change requests the month closed on with nobody having
// answered them: for the month that is running, today's. Nothing is worked
// out again here — the rule lives in server/stats.js, and two pages counting
// one word their own way is how "539" and "53" happened.
export default function Month({ month, channel = 'all', onMonth }) {
  const edges = useMemo(() => monthEdges(month), [month])
  const [act, setAct] = useState(null)
  const [rep, setRep] = useState(null)
  useEffect(() => {
    let alive = true
    api.get(`/reports/activity?from=${edges.from}&to=${edges.to}`)
      .then((d) => { if (alive) setAct(d) })
      .catch(() => { if (alive) setAct(null) })
    api.get(`/reports/stats?from=${edges.from}&to=${edges.to}&months=12`)
      .then((d) => { if (alive) setRep(d) })
      .catch(() => { if (alive) setRep(null) })
    return () => { alive = false }
  }, [edges.from, edges.to])

  const today = todayISO()
  const p = rep?.pieces
  const onTime = rep?.rates?.on_time ?? null
  const words = monthWords(month)
  const running = month === monthOf(today)
  const cur = rep?.months?.find((m) => m.month === month) || null
  const madeJudged = cur ? cur.made_on_time + cur.made_late : 0
  const madeKnock = cur?.made_knock_on || 0
  const lateness = madeJudged > 0 ? Math.round((cur.made_late / madeJudged) * 100) : null
  const latenessSub = !cur ? undefined
    : madeJudged + madeKnock === 0 ? tx('nothing came due in this window')
      : tx('{a} of {b} edits and artwork late', { a: cur.made_late, b: madeJudged })
        + (madeKnock > 0 ? ` · ${tx('{n} knock-on', { n: madeKnock })}` : '')
  const behind = rep?.now ? rep.now.behind : null

  return (
    <>
      {/* Six figures do not fit one row on a laptop, so this row breaks three
          and three rather than five and a stray one (.stat-row-6). */}
      <div className="stat-row stat-row-6">
        <Stat label="Open right now" value={rep?.now ? rep.now.open : '—'} sub={tx('pieces on the board today')} />
        <Stat label="Behind schedule" value={behind ?? '—'}
          tone={behind > 0 ? 'late' : undefined}
          sub={behind === 0 ? tx('nothing overdue') : tx('pieces with a step past its day')} />
        <Stat label="Went out" value={p ? p.out : '—'}
          sub={tx('pieces published in {month}', { month: words })}
          trend={act?.active_days >= 4 ? act.totals : null} color="var(--chart-4)" />
        <Stat label="On time" value={onTime === null ? '—' : `${onTime}%`}
          tone={onTime !== null && onTime >= 80 ? 'good' : onTime !== null && onTime < 50 ? 'late' : undefined}
          sub={p ? tx('{a} of {b} that had a release day', { a: p.on_time, b: p.on_time + p.late }) : tx('of what went out')} />
        <Stat label="Lateness Rate" value={lateness === null ? '—' : `${lateness}%`}
          tone={lateness === null ? undefined : lateness > 50 ? 'late' : lateness <= 20 ? 'good' : undefined}
          sub={latenessSub} />
        <Stat label="Pending revisions" value={rep ? (rep.revisions_open ?? 0) : '—'}
          tone={rep?.revisions_open > 0 ? 'late' : undefined}
          sub={tx('change requests open at the end of this window')} />
      </div>
      {running && <p className="stat-sub nb-sofar">{tx('{month} so far', { month: words })}</p>}

      <ChartCard title={tx('Month by month')}
        sub={tx('What went out each month, and how much of it made its release day')}>
        <MonthBars months={rep?.months || []} selected={month} onPick={onMonth} />
      </ChartCard>

      <ChartCard title={tx('Who is carrying it')} sub={tx('Steps finished, by the person who finished them')}>
        <BarChart
          rows={(act?.people || []).slice(0, 8).map((p2) => ({ key: p2.id, label: p2.name, value: p2.n }))}
          emptyText={tx('No work finished in this window')}
        />
      </ChartCard>

      <Views range={edges} channel={channel} />
    </>
  )
}

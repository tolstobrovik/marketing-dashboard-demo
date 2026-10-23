import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  BarChart3, ChevronLeft, ChevronRight, ChevronDown, Clapperboard, Scissors, Send,
  Palette, HelpCircle, TrendingUp, TrendingDown, Download, GitPullRequestArrow,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, dateLabel, typeLabel, monthName } from '../lib/constants.js'
import { monthOf, shiftMonth, monthEdges, monthLabel, monthRowLabel } from '../lib/month.js'
import { loadFailed } from '../lib/toast.js'
import MonthBars from './MonthBars.jsx'
import { typeMix } from '../lib/typemix.js'
import { tr as tx } from '../lib/i18n.jsx'

// The two pictures are drawn with Recharts, a library the size of a small
// page, and they are the only thing on the board that needs it. So they are
// fetched on their own (the `charts` chunk, see vite.config.js) and the tiles,
// the months and the lists do not wait for a charting library to arrive
// before they can be read.
const StatsCharts = lazy(() => import('./StatsCharts.jsx'))

// ---- the report ------------------------------------------------------------
//
// What was here before was not wrong, it was unreadable — four tiles whose
// numbers were counted four different ways, a percentage disagreeing with the
// bar drawn underneath it, a pie of 110 steps split across denominators of 74,
// 68 and 74, and a headline that said "50 finished late" because the list it
// counted stops at fifty.
//
// Every figure on this page now comes from one place on the server, and every
// one of them is shown WITH THE NUMBER IT IS OUT OF. "27%" is a claim; "12 of
// 44 that had a release day" is a fact somebody can check, argue with, or act
// on — and the three of those are the whole reason a team opens a statistics
// page at all.
//
// The window is a MONTH by default, because that is the unit the team plans
// and is paid in, and because the months before it are what make one month
// mean anything.

const STEP_ICON = { shoot: Clapperboard, edit: Scissors, design: Palette, review: Send }

const n0 = (v) => (Number(v) || 0).toLocaleString()
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
const say = (v) => (v === null || v === undefined ? '—' : `${v}%`)

// A tone for a percentage, the same way everywhere: good from 80, warned from
// 50, bad below it. One ladder, so a colour means the same thing on every card.
const tone = (v) => (v === null ? '' : v >= 80 ? 'good' : v >= 50 ? 'warn' : 'bad')

const Bar = ({ value, of, tone: t }) => (
  <span className="stat-bar"><i className={'stat-bar-fill' + (t ? ` sb-${t}` : '')}
    style={{ width: `${of > 0 ? Math.min(100, Math.round((value / of) * 100)) : 0}%` }} /></span>
)

// Three lengths of one bar that add up to the whole plan: out, overdue, and
// the days still to come. The number above it and the bar under it are then
// the same statement, which is more than the old card managed.
const PlanBar = ({ out, overdue, toCome }) => {
  const total = Math.max(1, out + overdue + toCome)
  const w = (v) => `${(v / total) * 100}%`
  return (
    <span className="st-seg" role="img"
      aria-label={`${out} out, ${overdue} overdue, ${toCome} to come`}>
      <i className="sg-out" style={{ width: w(out) }} />
      <i className="sg-late" style={{ width: w(overdue) }} />
      <i className="sg-todo" style={{ width: w(toCome) }} />
    </span>
  )
}

function Section({ id, title, count, sub, open, onToggle, children }) {
  return (
    <div className="card st-sec">
      <button type="button" className="st-sec-head" onClick={() => onToggle(id)} aria-expanded={open}>
        <b>{tx(title)}</b>
        {count !== undefined && <span className="count">{count}</span>}
        {sub && <span className="stat-sub st-sec-sub">{sub}</span>}
        <span className="spacer" />
        <ChevronDown size={16} className={'dz-caret' + (open ? ' open' : '')} />
      </button>
      {open && <div className="st-sec-body">{children}</div>}
    </div>
  )
}

const RANGES = [
  { key: 'month', label: 'A month' },
  { key: '3mo', label: '3 months' },
  { key: 'year', label: 'This year' },
  { key: 'custom', label: 'Custom…' },
]

export default function StatsReport({ onOpenPiece }) {
  const { user } = useAuth()
  const { visible: channels } = useChannels()
  const isAdmin = user.role === 'admin'
  const today = todayISO()

  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(`satashkent_report_${user.id}`) || '{}') || {} } catch { return {} }
  }, [user.id])
  const [mode, setMode] = useState(saved.mode || 'month')
  const [month, setMonth] = useState(saved.month && saved.month <= monthOf(today) ? saved.month : monthOf(today))
  const [from, setFrom] = useState(saved.from || '')
  const [to, setTo] = useState(saved.to || '')
  const [chan, setChan] = useState(saved.chan || 'all')
  const [person, setPerson] = useState(saved.person || 0)
  const [project, setProject] = useState(saved.project || 0)
  const [open, setOpen] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('satashkent_stats_open') || '["months","steps"]')) }
    catch { return new Set(['months', 'steps']) }
  })
  const toggle = (k) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    try { localStorage.setItem('satashkent_stats_open', JSON.stringify([...next])) } catch { /* fine */ }
    return next
  })
  useEffect(() => {
    try {
      localStorage.setItem(`satashkent_report_${user.id}`,
        JSON.stringify({ mode, month, from, to, chan, person, project }))
    } catch { /* fine */ }
  }, [mode, month, from, to, chan, person, project, user.id])

  const [team, setTeam] = useState([])
  const [projects, setProjects] = useState([])
  useEffect(() => {
    if (isAdmin) api.cached('/users').then(setTeam).catch(() => {})
    api.cached('/projects').then((p) => setProjects(Array.isArray(p) ? p : [])).catch(() => {})
  }, [isAdmin])

  // The window, in the one place that decides it. Everything below reads these
  // two dates and nothing computes a window of its own — which is how the page
  // used to end up with three of them at once. Its months are named from the
  // board's own book (monthLabel), because the label is the first cell of the
  // spreadsheet too, and the browser's Uzbek for September is "M09".
  const window_ = useMemo(() => {
    if (mode === 'month') return { ...monthEdges(month), label: monthLabel(month) }
    if (mode === '3mo') {
      const start = shiftMonth(month, -2)
      return { from: monthEdges(start).from, to: monthEdges(month).to, label: `${monthLabel(start)} – ${monthLabel(month)}` }
    }
    if (mode === 'year') {
      const y = month.slice(0, 4)
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: y }
    }
    return { from: from || `${monthOf(today)}-01`, to: to || today, label: `${from || '…'} → ${to || today}` }
  }, [mode, month, from, to, today])

  // The charts' code is asked for the moment the page opens, beside the
  // numbers it will draw, so it has usually arrived by the time they have.
  useEffect(() => { import('./StatsCharts.jsx').catch(() => {}) }, [])

  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  // The months drawn beside the window: the year running up to its end — or,
  // for a custom window longer than a year, enough of them to reach back to
  // its first month (the server draws two years at most). A window that is
  // cut off on the left is a chart that quietly disagrees with its tiles.
  const span = (Number(window_.to.slice(0, 4)) - Number(window_.from.slice(0, 4))) * 12
    + Number(window_.to.slice(5, 7)) - Number(window_.from.slice(5, 7)) + 1
  const monthsAsked = String(Math.min(24, Math.max(12, span || 0)))
  useEffect(() => {
    const q = new URLSearchParams({
      from: window_.from, to: window_.to, channel: chan, months: monthsAsked,
      ...(person ? { person: String(person) } : {}),
      ...(project ? { project: String(project) } : {}),
    })
    setData(null); setErr('')
    let alive = true
    api.get(`/reports/stats?${q}`)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) { setErr(e.message); loadFailed(e) } })
    return () => { alive = false }
  }, [window_.from, window_.to, chan, person, project, monthsAsked])

  const p = data?.pieces
  const steps = data?.steps
  const prev = useMemo(() => {
    if (!data?.months || mode !== 'month') return null
    const i = data.months.findIndex((m) => m.month === month)
    return i > 0 ? data.months[i - 1] : null
  }, [data, month, mode])

  // Whose numbers these are, read off the scope the SERVER applied rather
  // than off the picker. A member who names nobody is answered with the whole
  // team's totals — the page's scoping, on purpose: the shape of the month is
  // not a secret — and the line used to call those numbers "your work", in
  // the file it exported too. A member who does name somebody is answered
  // with their own work, whoever they named; and the server names the
  // person, because a member is never sent the team to look an id up in.
  const scope = data?.scope
  const whose = !scope || scope.whole_team ? tx('the whole team')
    : scope.person === user.id && !isAdmin ? tx('your work')
      : (scope.person_name || team.find((u) => u.id === scope.person)?.name || tx('one person'))
  const chanName = scope?.channel ? (channels.find((c) => c.key === scope.channel)?.label || scope.channel) : null
  const projName = scope?.project ? (projects.find((pr) => pr.id === scope.project)?.name || `#${scope.project}`) : null

  // Lateness, the way the spec for this page defines it: the cuts and the
  // artwork that came due in the window, against their own day — the
  // re-promised day where there is one, as the server judges every step. A
  // knock-on (a step that could only start after its day had gone, because
  // the one before it handed over late) is nobody's lateness and is left out,
  // as it is everywhere else on this page.
  const made = (steps?.by_step || []).filter((st) => st.step === 'edit' || st.step === 'design')
  const madeLate = made.reduce((n, st) => n + st.late, 0)
  const madeJudged = made.reduce((n, st) => n + st.on_time + st.late, 0)
  const madeKnock = made.reduce((n, st) => n + st.knock_on, 0)
  const lateness = pctOf(madeLate, madeJudged)
  // A window where no cut and no artwork came due has no rate, and "0 of 0
  // late" beside a dash reads like a fault in the page rather than a fact
  // about the window.
  const latenessSub = madeJudged + madeKnock === 0
    ? tx('nothing came due in this window')
    : tx('{a} of {b} edits and artwork late', { a: madeLate, b: madeJudged })
      + (madeKnock > 0 ? ` · ${tx('{n} knock-on', { n: madeKnock })}` : '')

  // Is there anything in THIS window? Decided on the window's own numbers —
  // nothing went out, nothing was promised, no step came due, nothing was made
  // — and never on the months drawn beside it, which carry a year of history
  // into every window: the first of the month, a future custom range or a
  // filter whose work is all in the past used to draw eleven full months of
  // bars under a window with nothing in it.
  const periodEmpty = !!p && !p.out && !p.planned && !steps?.due && !steps?.open
    && !Object.values(data?.by_type || {}).some(Boolean)
  // …and the months beside it with nothing in them either: then the month by
  // month section is a chart of zeros, and it goes with the charts.
  const monthsQuiet = (data?.months || []).every((m) => !m.out && !m.planned && !m.late_steps && !m.knock_on && !m.views)
  // The type mix, counted once for the pie, its legend and the spreadsheet —
  // in the pie's order, with shares that add up to 100 and each type named in
  // the reader's language (lib/typemix.js).
  const mix = useMemo(() => typeMix(data?.by_type, typeLabel), [data])

  // "Download report": exactly this view, as a spreadsheet — the scope as the
  // server applied it (whose, which channel, which project), the tiles with
  // their lines, the months in the order and the words the table shows them
  // in, the type mix in the legend's order and the reader's language, and the
  // channels. The file is named for the window and the scope, so two of them
  // side by side in a Downloads folder can be told apart. The leading BOM is
  // what makes Excel read Cyrillic as Cyrillic.
  const download = () => {
    if (!data) return
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      [tx('Report'), window_.label, whose, chanName || tx('All channels'),
        projName ? tx('Project: {name}', { name: projName }) : tx('All projects')],
      [],
      [tx('Total published'), data.pieces.out, tx('pieces published in this window')],
      [tx('Lateness Rate'), say(lateness), latenessSub],
      [tx('Pending revisions'), data.revisions_open ?? 0, tx('change requests open at the end of this window')],
      [tx('The plan'), data.pieces.planned_out, tx('of'), data.pieces.planned,
        tx('overdue'), data.pieces.planned_overdue, tx('still to come'), data.pieces.planned_to_come],
      [],
      [tx('Month'), tx('Planned'), tx('Went out'), tx('On time'), `${tx('On time')} %`, tx('Overdue'), tx('Missed steps'), tx('Views'),
        tx('Edits and artwork on time'), tx('Edits and artwork late'), tx('Edits and artwork, knock-on')],
      ...[...(data.months || [])].reverse().map((m) => [
        monthRowLabel(m) + (m.running ? ` · ${tx('so far')}` : ''),
        m.planned, m.out, m.on_time, say(m.on_time_pct), m.overdue, m.late_steps,
        m.views_counted ? m.views : tx('not counted'),
        m.made_on_time ?? '', m.made_late ?? '', m.made_knock_on ?? '',
      ]),
      [],
      [tx('Type'), tx('Pieces made'), tx('Share of the total')],
      ...mix.rows.map((r) => [r.name, r.value, r.pct]),
      [],
      [tx('By channel')],
      [tx('Channel'), tx('Planned'), tx('Went out'), tx('On time'), `${tx('On time')} %`, tx('Overdue'), tx('Missed steps'), tx('Views')],
      ...data.channels.map((c) => [c.label, c.planned, c.out, c.on_time, say(pctOf(c.on_time, c.on_time + c.late)),
        c.overdue, c.late_steps, c.views || '—']),
    ]
    const text = '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    // The window from the server, and the scope as it was applied: the whole
    // team, or the person's name, then the channel and the project if one
    // was picked. Letters of any alphabet survive; nothing else does.
    const slug = (v) => String(v).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase()
    const who = !scope || scope.whole_team ? 'team' : slug(scope.person_name || `person ${scope.person}`)
    const a = document.createElement('a')
    a.href = url
    a.download = ['report', data.window.from, data.window.to, who,
      scope?.channel && slug(scope.channel), projName && slug(projName)].filter(Boolean).join('-') + '.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <>
      <div className="section-head st-head">
        <BarChart3 size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx('The report')}</h2>
        <span className="spacer" />
        <button type="button" className="btn btn-sm st-download" onClick={download} disabled={!data}
          data-tip={tx('This view — the tiles, the months, the type mix and the channels — as a spreadsheet')} data-tip-left="">
          <Download size={14} /> {tx('Download Report')}
        </button>
        {mode !== 'custom' && mode !== 'year' && (
          <div className="at-month">
            <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}
              aria-label={tx('Previous month')}><ChevronLeft size={18} /></button>
            <b>{monthLabel(month)}</b>
            <button className="icon-btn" disabled={month >= monthOf(today)}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              aria-label={tx('Next month')}><ChevronRight size={18} /></button>
          </div>
        )}
      </div>

      <div className="st-filters">
        <div className="pill-group">
          {RANGES.map((r) => (
            <button key={r.key} className={'pill' + (mode === r.key ? ' active' : '')}
              onClick={() => setMode(r.key)}>{tx(r.label)}</button>
          ))}
        </div>
        {mode === 'custom' && (
          <span className="miss-custom">
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="drow-dash">–</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
        <span className="spacer" />
        {isAdmin && team.length > 0 && (
          <select className="select" value={person} data-tip={tx("Only this person's work")}
            onChange={(e) => setPerson(Number(e.target.value))}>
            <option value={0}>{tx('The whole team')}</option>
            {[...team].sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        )}
        {projects.length > 0 && (
          <select className="select" value={project} data-tip={tx("Only tasks tied to this project's campaigns")}
            onChange={(e) => setProject(Number(e.target.value))}>
            <option value={0}>{tx('All projects')}</option>
            {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select>
        )}
      </div>

      <div className="pill-group st-chans">
        <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>{tx('All channels')}</button>
        {channels.map((c) => (
          <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')}
            onClick={() => setChan(chan === c.key ? 'all' : c.key)}>{c.label}</button>
        ))}
      </div>

      {err && <div className="form-error">{err}</div>}
      {!data || !p ? <div className="app-loading"><span className="spinner" /></div> : (
        <>
          {/* One sentence, naming the window and whose work it is, so no tile
              below it has to be read twice to find out what it is about. */}
          <p className="st-whose">
            <b>{window_.label}</b> · {whose}
            {chanName ? ` · ${chanName}` : ''}
            {projName ? ` · ${tx('Project: {name}', { name: projName })}` : ''}
          </p>

          <div className="st-tiles">
            {/* 1. what went out */}
            <div className="card st-tile">
              <span className="st-k">{tx('Total published')}</span>
              <b>{n0(p.out)}</b>
              <span className="stat-sub">{tx('pieces published in this window')}</span>
              {prev && (
                <span className={'st-delta' + (p.out >= prev.out ? ' up' : ' down')}>
                  {p.out >= prev.out ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {/* The month before, named and counted rather than
                      prepositioned: "−51 · August 104" needs no grammar to
                      survive being translated into three languages. */}
                  {p.out - prev.out > 0 ? '+' : ''}{p.out - prev.out} · {monthName(Number(prev.month.slice(0, 4)), Number(prev.month.slice(5, 7)))} {prev.out}
                </span>
              )}
            </div>

            {/* 2. how much of the made work was late */}
            <div className="card st-tile">
              <span className="st-k">{tx('Lateness Rate')}</span>
              <b className={lateness !== null && lateness > 50 ? 'pay-bad' : ''}>{say(lateness)}</b>
              <Bar value={madeLate} of={madeJudged} tone={lateness === null ? '' : lateness <= 20 ? 'good' : lateness <= 50 ? 'warn' : 'bad'} />
              <span className="stat-sub">{latenessSub}</span>
            </div>

            {/* 3. the changes asked for and not yet made, as the window closed */}
            <div className="card st-tile">
              <span className="st-k">{tx('Pending revisions')}</span>
              <b className={data.revisions_open ? 'pay-bad' : ''}>{n0(data.revisions_open)}</b>
              <span className="stat-sub">
                <GitPullRequestArrow size={12} /> {tx('change requests open at the end of this window')}
              </span>
            </div>

            {/* 4. the plan, as three lengths of one bar */}
            <div className="card st-tile">
              <span className="st-k">{tx('The plan')}</span>
              <b>{n0(p.planned_out)} <span className="st-of">{tx('of')} {n0(p.planned)}</span></b>
              <PlanBar out={p.planned_out} overdue={p.planned_overdue} toCome={p.planned_to_come} />
              <span className="stat-sub">
                {p.planned_overdue} {tx('overdue')}
                {p.planned_to_come > 0 ? ` · ${p.planned_to_come} ${tx('still to come')}` : ''}
              </span>
            </div>

          </div>

          {/* The two pictures: on time or late, month by month; and the type
              mix. A window with nothing in it gets one sentence, centred, in
              their place — not two empty cards, and not a year of bars
              that belong to other months. The fallback holds the pictures'
              room while their code arrives, so nothing below them jumps. */}
          {periodEmpty ? (
            <div className="card card-pad viz-empty" role="status">{tx('No data available for this period')}</div>
          ) : (
            <Suspense fallback={<div className="viz-row viz-wait" aria-busy="true"><div className="card viz-card" /><div className="card viz-card" /></div>}>
              <StatsCharts months={data.months} mix={mix} />
            </Suspense>
          )}

          {/* ---- month by month ---- */}
          {!(periodEmpty && monthsQuiet) && (
          <Section id="months" title={tx('Month by month')} open={open.has('months')} onToggle={toggle}
            sub={tx('Click a month to open it')}>
            <MonthBars months={data.months} selected={mode === 'month' ? month : null}
              onPick={(m) => { setMode('month'); setMonth(m) }} />
            <div className="tbl-wrap">
              <table className="tbl st-tbl">
                <thead><tr>
                  <th>{tx('Month')}</th><th>{tx('Planned')}</th><th>{tx('Went out')}</th>
                  <th>{tx('On time')}</th><th>{tx('Overdue')}</th><th>{tx('Missed steps')}</th><th>{tx('Views')}</th>
                </tr></thead>
                <tbody>
                  {[...data.months].reverse().map((m) => (
                    <tr key={m.month} className={m.month === month ? 'st-row-on' : ''}>
                      <td><b>{monthRowLabel(m)}</b>{m.running ? ` · ${tx('so far')}` : ''}</td>
                      <td>{m.planned}</td>
                      <td>{m.out}</td>
                      <td className={m.on_time_pct !== null && m.on_time_pct < 50 ? 'pay-bad' : ''}>
                        {m.on_time} <span className="stat-sub">{say(m.on_time_pct)}</span>
                      </td>
                      <td className={m.overdue ? 'pay-bad' : ''}>{m.overdue}</td>
                      <td>{m.late_steps}</td>
                      <td>{m.views_counted ? n0(m.views) : <span className="stat-sub">{tx('not counted')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          )}

          {/* ---- where the time goes ---- */}
          <Section id="steps" title={tx('Where the time goes')} open={open.has('steps')} onToggle={toggle}
            sub={tx('Steps whose own day fell in this window')}>
            <div className="st-steps">
              {steps.by_step.filter((s) => s.due || s.open).map((s) => {
                const Icon = STEP_ICON[s.step] || Clapperboard
                const share = pctOf(s.late, s.due)
                return (
                  <div key={s.step} className="st-step">
                    <span className="st-step-name"><Icon size={14} /> {tx(s.label)}</span>
                    <Bar value={s.late} of={s.due || 1} tone={s.late ? 'bad' : 'good'} />
                    <span className="st-step-n">
                      <b className={s.late ? 'pay-bad' : ''}>{s.late}</b> {tx('of')} {s.due}
                      {share !== null ? ` · ${share}%` : ''}
                    </span>
                    <span className="stat-sub st-step-sub">
                      {s.days_lost > 0 ? tx('{n} days lost', { n: s.days_lost }) : tx('nothing lost')}
                      {s.knock_on > 0 ? ` · ${tx('{n} knock-on', { n: s.knock_on })}` : ''}
                      {s.open > 0 ? ` · ${tx('{n} not due yet', { n: s.open })}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="stat-sub st-note">
              {tx('Each piece is judged step by step: the shoot, the edit, the artwork and the release each have their own day and their own owner.')}
              {' '}
              {steps.by_side.production + steps.by_side.make > 0 && tx('{a} of the missed steps sit with production, {b} with content.', { a: steps.by_side.production, b: steps.by_side.make })}
            </p>
          </Section>

          {/* ---- by channel ---- */}
          <Section id="channels" title={tx('By channel')} count={data.channels.length} open={open.has('channels')} onToggle={toggle}>
            <div className="tbl-wrap">
              <table className="tbl st-tbl">
                <thead><tr>
                  <th>{tx('Channel')}</th><th>{tx('Planned')}</th><th>{tx('Went out')}</th>
                  <th>{tx('On time')}</th><th>{tx('Overdue')}</th><th>{tx('Missed steps')}</th><th>{tx('Views')}</th>
                </tr></thead>
                <tbody>
                  {data.channels.map((c) => {
                    const ot = pctOf(c.on_time, c.on_time + c.late)
                    return (
                      <tr key={c.key}>
                        <td><b>{c.label}</b></td>
                        <td>{c.planned}</td>
                        <td>{c.out}</td>
                        <td className={ot !== null && ot < 50 ? 'pay-bad' : ''}>{c.on_time} <span className="stat-sub">{say(ot)}</span></td>
                        <td className={c.overdue ? 'pay-bad' : ''}>{c.overdue}</td>
                        <td>{c.late_steps}</td>
                        <td>{c.views ? n0(c.views) : <span className="stat-sub">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ---- the people ---- */}
          {data.people.length > 0 && (
            <Section id="people" title={tx('Who did what')} count={data.people.length} open={open.has('people')} onToggle={toggle}
              sub={tx('What each person finished, beside what they missed')}>
              <div className="tbl-wrap">
                <table className="tbl st-tbl">
                  <thead><tr>
                    <th>{tx('Person')}</th><th>{tx('Filmed')}</th><th>{tx('Edited')}</th><th>{tx('Designed')}</th>
                    <th>{tx('Published')}</th><th>{tx('On time')}</th><th>{tx('Missed steps')}</th><th>{tx('Days lost')}</th>
                  </tr></thead>
                  <tbody>
                    {data.people.map((r) => (
                      <tr key={r.id}>
                        <td><b>{r.name || `#${r.id}`}</b></td>
                        <td>{r.work.filmed || <span className="stat-sub">—</span>}</td>
                        <td>{r.work.edited || <span className="stat-sub">—</span>}</td>
                        <td>{r.work.designed || <span className="stat-sub">—</span>}</td>
                        <td>{r.work.published || <span className="stat-sub">—</span>}</td>
                        <td>{r.on_time}</td>
                        <td className={r.late >= 3 ? 'pay-bad' : ''}>{r.late}</td>
                        <td>{r.days_lost || <span className="stat-sub">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ---- what got watched ---- */}
          <Section id="reach" title={tx('What got watched')} open={open.has('reach')} onToggle={toggle}
            sub={p.views_counted ? n0(p.views) : tx('nothing counted yet')}>
            {p.views_counted === 0 ? (
              <p className="stat-sub">
                {tx('Nobody has written down the views on any of the {n} pieces that went out in this window. Until somebody does, this window has no reach to report — and the number above is not zero views, it is no readings.', { n: p.out })}
              </p>
            ) : (
              <>
                <div className="st-reach">
                  <div><b>{n0(p.views)}</b><span className="stat-sub">{tx('views counted')}</span></div>
                  <div><b>{n0(Math.round(p.views / Math.max(1, p.views_counted)))}</b><span className="stat-sub">{tx('average per piece')}</span></div>
                  <div><b>{p.views_counted} <span className="st-of">{tx('of')} {p.out}</span></b><span className="stat-sub">{tx('pieces counted')}</span></div>
                </div>
                {p.views_missing > 0 && (
                  <p className="stat-sub st-note">
                    {tx('{n} of them have no reading yet, so the total is what has been counted, not what the window got.', { n: p.views_missing })}
                  </p>
                )}
                <div className="pub-list">
                  {(data.watched || []).map((w) => (
                    <div key={w.id} className="pub-row">
                      <button className="pub-name st-link" onClick={() => onOpenPiece?.(w.id)}>{w.title}</button>
                      <span className="pub-bar"><span style={{ width: `${Math.round((w.views / (data.watched[0]?.views || 1)) * 100)}%` }} /></span>
                      <b className="pub-n">{n0(w.views)}</b>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Section>

          {/* ---- every missed step ---- */}
          {data.misses.length > 0 && (
            <Section id="each" title={tx('Every missed step, worst first')} count={data.misses_total ?? data.misses.length}
              open={open.has('each')} onToggle={toggle}>
              <div className="st-misses">
                {data.misses.map((m, i) => (
                  <div key={`${m.id}-${m.step}-${i}`} className="st-miss">
                    <span className={'chip ' + (m.side === 'production' ? 'chip-prod' : 'chip-make')}>
                      {tx(m.side === 'production' ? 'production' : 'content')}
                    </span>
                    <span className="st-miss-main">
                      <button className="st-link" onClick={() => onOpenPiece?.(m.id)}><b>{m.title}</b></button>
                      <span className="stat-sub">
                        {tx(m.label)} · {tx('due')} {dateLabel(m.due)} · {m.why}
                        {m.decided ? ` — ${tx('an admin decided this')}` : ''}
                        {m.open ? ` · ${tx('still not done')}` : ''}
                      </span>
                    </span>
                    <span className="st-miss-days">{m.days_late}{tx('d')}</span>
                    <span className="st-miss-who stat-sub">{m.who.join(', ') || tx('nobody')}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ---- and what the words mean ---- */}
          <Section id="how" title={tx('How these are counted')} open={open.has('how')} onToggle={toggle}
            sub={<><HelpCircle size={13} /> {tx('the whole vocabulary, in six lines')}</>}>
            <dl className="st-gloss">
              <dt>{tx('A piece')}</dt>
              <dd>{tx('One item of content, counted once — however many channels it goes out on and however many people touched it.')}</dd>
              <dt>{tx('Went out')}</dt>
              <dd>{tx('It was published, dated by the day it went out on the Tashkent clock.')}</dd>
              <dt>{tx('Planned')}</dt>
              <dd>{tx('Its release day falls inside the window. That is the plan — the board’s own promise, not a number anybody types in.')}</dd>
              <dt>{tx('On time')}</dt>
              <dd>{tx('It went out on or before its release day. A piece with no release day is neither on time nor late, and is counted separately.')}</dd>
              <dt>{tx('A step')}</dt>
              <dd>{tx('One person’s part of one piece: the shoot, the edit, the artwork, the release. Each has its own day and its own owner, and belongs to the window that day falls in.')}</dd>
              <dt>{tx('Missed, and knock-on')}</dt>
              <dd>{tx('A missed step finished after its day, or has not finished with the day gone. A knock-on step could only start after its own day had already gone, because the step before it handed over late — it is the same delay seen twice, so it is counted apart and charged to nobody.')}</dd>
            </dl>
          </Section>
        </>
      )}
    </>
  )
}

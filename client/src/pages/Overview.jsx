import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, addDaysISO, deptColor, onColor, iconFor, isDeletedLabel, tashkentDay} from '../lib/constants.js'
import { nextDue } from '../lib/due.js'
import { stageRankOf } from '../lib/gaps.js'
import { monthOf, shiftMonth, monthEdges, monthWords } from '../lib/month.js'
import { loadFailed, toast } from '../lib/toast.js'
import Avatar from '../components/Avatar.jsx'
import MonthBars from '../components/MonthBars.jsx'
import { AreaChart, BarChart, ChartCard, Stat } from '../components/Chart.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import { CountDot } from '../components/Dot.jsx'
import ClashDialog, { isClash } from '../components/ClashDialog.jsx'

// The board's front page.
//
// It used to be a wall: twelve channel cards of equal weight, five of them
// saying "no open tasks", with a two-column strip of campaigns above them that
// the Projects page already draws better. Every channel shouted the same
// volume, so nothing on it was the answer to the question anybody actually
// opens a dashboard with — how are we doing, and what needs me.
//
// Now it answers in that order:
//   the numbers           where the board and the month stand
//   when we work          the shape of it, day by day — a total for a month
//                         cannot tell four-a-week from nineteen-in-three-days
//   who and when          the busiest weekday, and who is carrying it
//   what needs answering  days waiting on this admin's yes
//   the channels          ranked by what is wrong, with the quiet ones folded
//
// The campaigns strip is gone. It was two columns of the same rows the
// Projects page shows, and a front page that repeats another page is a front
// page with nothing of its own to say.

// The deadlines a person can be asked to move, in the words the ask uses.
const DAY_LABEL = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the edit is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}

const MONTH_KEY = 'satashkent_overview_month'

export default function Overview() {
  const { channels } = useChannels()
  const navigate = useNavigate()
  const [boot] = useState(() => cache.get('overview'))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [loading, setLoading] = useState(!boot)
  const [showQuiet, setShowQuiet] = useState(false)

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/statuses')])
      .then(([ct, st]) => {
        setContent(ct); setStatuses(st)
        cache.set('overview', { content: ct.map(({ photo_thumb: _t, ...rest }) => rest), statuses: st })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [])

  // ---- the month the front page is standing in ----
  // The window used to be a rolling 30, 90 or 180 days, which is a window
  // nobody plans in: the team promises a month, is paid a month and argues
  // about a month. So the front page is read a month at a time, with the
  // months before it drawn beside it — and the day-by-day shape underneath is
  // that same month, not a different span that happens to end today.
  const [month, setMonth] = useState(() => {
    try { return localStorage.getItem(MONTH_KEY) || monthOf(todayISO()) } catch { return monthOf(todayISO()) }
  })
  const [act, setAct] = useState(null)
  const [rep, setRep] = useState(null)
  const edges = useMemo(() => monthEdges(month), [month])
  useEffect(() => {
    // The month you are living in is the default, not a choice: written down,
    // it kept the front page on October for the whole of November.
    try {
      if (month === monthOf(todayISO())) localStorage.removeItem(MONTH_KEY)
      else localStorage.setItem(MONTH_KEY, month)
    } catch { /* fine */ }
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

  // ---- per-channel reading ----
  const depts = useMemo(() => {
    // Killed pieces (Deleted stage) are records, not open work — they must
    // not inflate a channel's open/overdue counts or its stage chips.
    const dead = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    const rank = stageRankOf(statuses)
    return channels.map((c, i) => {
      const tasks = content.filter((t) => t.channels.includes(c.key))
      const open = tasks.filter((t) => !t.done_at && !dead.has(t.status_id))
      // Past the shooting stage is filmed, stamp or no stamp — as the server
      // reads it (phasePassed), and as the channel's own page now does.
      const dateOf = (t) => nextDue(rank(t.status_id) === 'shot' && !t.shot_at ? { ...t, shot_at: t.created_at } : t, today)
      const overdue = open.filter((t) => dateOf(t) && dateOf(t) < today)
      const weekAgo = addDaysISO(today, -7)
      const doneWeek = tasks.filter((t) => t.done_at && tashkentDay(t.done_at) >= weekAgo)
      const byStage = statuses
        .map((s) => ({ s, n: open.filter((t) => t.status_id === s.id).length }))
        .filter((x) => x.n > 0)
      return { c, color: deptColor(i), open, overdue, doneWeek, byStage }
    })
  }, [channels, content, statuses, today])

  // What is wrong comes first, then what is busiest. A channel with nothing
  // open is not ranked at all — it is folded away below, because a card
  // reading "no open tasks" is a card asking to be skipped, and eleven of
  // them are why nobody reads the four that matter.
  const busy = useMemo(() => depts
    .filter((d) => d.open.length > 0)
    .sort((a, b) => b.overdue.length - a.overdue.length || b.open.length - a.open.length), [depts])
  const quiet = useMemo(() => depts.filter((d) => d.open.length === 0), [depts])

  // ---- the four numbers ----
  const nums = useMemo(() => {
    const dead = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    const open = content.filter((t) => !t.done_at && !dead.has(t.status_id))
    const rank = stageRankOf(statuses)
    const dateOf = (t) => nextDue(rank(t.status_id) === 'shot' && !t.shot_at ? { ...t, shot_at: t.created_at } : t, today)
    const late = open.filter((t) => dateOf(t) && dateOf(t) < today)
    return { open: open.length, late: late.length }
  }, [content, statuses, today])

  // Waiting on this admin. Non-admins get an empty list from the server, so
  // there is nothing to guard here.
  const [asks, setAsks] = useState([])
  const [busyAsk, setBusyAsk] = useState(0)
  // Saying yes to a new shoot day can land the operator on another of their
  // shoots; the server asks first, in the booking window.
  const [askClash, setAskClash] = useState(null) // { a, data }
  useEffect(() => {
    const loadAsks = () => api.pollView('/content/date-requests/open')
      .then((d) => { if (Array.isArray(d)) setAsks(d) }).catch(() => {})
    loadAsks()
    const id = setInterval(() => { if (!document.hidden) loadAsks() }, 10000)
    return () => clearInterval(id)
  }, [])
  const answer = async (a, approve, force = false) => {
    setBusyAsk(a.id)
    try {
      await api.post(`/content/date-requests/${a.id}/decide`, { approve, ...(force ? { force: true } : {}) })
      setAskClash(null)
      setAsks((prev) => prev.filter((x) => x.id !== a.id))
      toast(approve ? 'Moved — they hear it right away' : 'Kept where it was — they hear why')
    } catch (e) {
      if (e.status === 409 && isClash(e.data)) setAskClash({ a, data: e.data })
      else { setAskClash(null); toast(e.message, 'err') }
    } finally { setBusyAsk(0) }
  }

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const p = rep?.pieces
  const onTime = rep?.rates?.on_time ?? null
  const words = monthWords(month)
  const running = month === monthOf(today)

  // The Statistics page's headline, here too. /missed leads with the Lateness
  // Rate and the change requests still waiting, and the front page went on
  // leading with "On time" alone — so an admin reading the same month on the
  // two screens they open first was given one lateness figure on each, over
  // two different sets of work, and no way to tell which one the team is held
  // to. "On time" stays: it answers a different question (did what went out
  // go out on its release day), and each card says what it is out of.
  //
  // Both new cards are read off the server's own answer. The lateness is the
  // month's row of the series — the cuts and the artwork that came due in it,
  // against their own day (the re-promised one where there is one), with the
  // knock-ons counted beside them and in neither — which is the same count the
  // Statistics page makes for the same month. The revisions are the change
  // requests the month closed on with nobody having answered them: for the
  // month that is running, today's. Nothing is worked out again here — the
  // rule lives in server/stats.js, and two pages counting one word their own
  // way is how "539" and "53" happened.
  const cur = rep?.months?.find((m) => m.month === month) || null
  const madeJudged = cur ? cur.made_on_time + cur.made_late : 0
  const madeKnock = cur?.made_knock_on || 0
  const lateness = madeJudged > 0 ? Math.round((cur.made_late / madeJudged) * 100) : null
  const latenessSub = !cur ? undefined
    : madeJudged + madeKnock === 0 ? tx('nothing came due in this window')
      : tx('{a} of {b} edits and artwork late', { a: cur.made_late, b: madeJudged })
        + (madeKnock > 0 ? ` · ${tx('{n} knock-on', { n: madeKnock })}` : '')

  return (
    <>
      {askClash && (
        <ClashDialog clash={askClash.data} busy={busyAsk === askClash.a.id}
          onBack={() => setAskClash(null)} onForce={() => answer(askClash.a, true, true)} />
      )}
      {/* ---- which month this page is about ---- */}
      <div className="section-head ov-month-head">
        <CalendarClock size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{words}{running ? ` · ${tx('so far')}` : ''}</h2>
        <span className="spacer" />
        <div className="at-month">
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label={tx('Previous month')}><ChevronLeft size={18} /></button>
          <button className="icon-btn" disabled={month >= monthOf(today)}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={tx('Next month')}><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* ---- where the board stands ----
          Two of these are the board RIGHT NOW and the rest are the month being
          read, and they are labelled as such. "Delivered 539" used to sit
          here: that was every craft step counted separately — filmed, edited,
          designed, published — printed under a word everybody reads as
          "pieces". Fifty-three pieces went out that month.

          The last two are the Statistics page's own headline, in its words
          and from the same numbers (see `cur` above). Six figures do not fit
          one row on a laptop, so this row breaks three and three rather than
          five and a stray one (.stat-row-6). */}
      <div className="stat-row stat-row-6">
        <Stat label="Open right now" value={rep?.now ? rep.now.open : nums.open}
          sub={tx('across {n} channels', { n: busy.length })} />
        <Stat label="Behind schedule" value={rep?.now ? rep.now.behind : nums.late}
          tone={(rep?.now ? rep.now.behind : nums.late) > 0 ? 'late' : undefined}
          sub={(rep?.now ? rep.now.behind : nums.late) === 0 ? tx('nothing overdue')
            : tx('pieces with a step past its day')} />
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

      {/* ---- the months, side by side ---- */}
      <ChartCard title={tx('Month by month')}
        sub={tx('What went out each month, and how much of it made its release day')}>
        <MonthBars months={rep?.months || []} selected={month} onPick={setMonth} />
      </ChartCard>

      {/* ---- the shape of the month ----
          This chart counts STEPS, not pieces: one piece is filmed, cut and
          published, which is three readings on three different days, and that
          is exactly what makes the shape of a month legible. It says so now,
          because "539 pieces finished" beside a month of 53 was the single
          most misread number on this board. */}
      <ChartCard
        title={tx('When the team works')}
        sub={act ? (act.rate
          ? `${tx('{n} steps finished', { n: act.done })} · ${tx('{n} pieces went out', { n: act.pieces?.out ?? 0 })} · ${
            act.rate.per === 'day' ? tx('{n} a day on average', { n: act.rate.n })
              : act.rate.per === 'week' ? tx('{n} a week on average', { n: act.rate.n })
                : tx('{n} a month on average', { n: act.rate.n })}`
          : tx('Nothing finished in this window')) : 'Loading…'}
      >
        <AreaChart
          series={act?.series || []}
          labels={act?.days || []}
          height={230}
          valueLabel={tx('Steps finished')}
          emptyText={tx('No work finished in this window')}
        />
        {act?.peak && (
          <p className="chart-note">
            {tx('Busiest day: {day} with {n}.', {
              day: new Date(`${act.peak.day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }),
              n: act.peak.n,
            })}
            {act.quiet_run > 2 ? ' ' + tx('Longest quiet stretch: {n} days.', { n: act.quiet_run }) : ''}
            {' '}{tx('A step is one person’s part of a piece — filmed, edited, designed or published.')}
          </p>
        )}
      </ChartCard>

      {/* ---- who, and which day ---- */}
      <div className="ov-two">
        <ChartCard title={tx('Which day of the week')} sub="Every step finished this month, by weekday">
          <BarChart
            rows={(act?.weekday || []).map((d) => ({ ...d, label: tx(d.label) }))}
            emptyText={tx('No work finished in this window')}
          />
        </ChartCard>
        <ChartCard title={tx('Who is carrying it')} sub="Steps finished, by the person who finished them">
          <BarChart
            rows={(act?.people || []).slice(0, 8).map((p2) => ({ key: p2.id, label: p2.name, value: p2.n }))}
            emptyText={tx('No work finished in this window')}
          />
        </ChartCard>
      </div>

      {/* Deadlines waiting on this admin's yes. The asking mechanism is only
          as good as the answering: the bell scrolls away, and a request
          nobody sees is a deadline that quietly stays wrong. Answered right
          here — the reason is the whole of what there is to read. */}
      {asks.length > 0 && (
        <div className="card card-pad ov-asks">
          <div className="ov-asks-head">
            <CalendarClock size={16} />
            <b>{asks.length} day{asks.length === 1 ? '' : 's'} waiting on you</b>
          </div>
          {asks.map((a) => (
            <div key={a.id} className="ov-ask">
              <button className="ov-ask-main" onClick={() => navigate(`/brief?task=${a.content_id}`)}>
                <span className="ov-ask-title">{a.title}</span>
                <span className="ov-ask-move">
                  {DAY_LABEL[a.field] || a.field}: <b>{a.from_date}</b> → <b>{a.to_date || 'cleared'}</b>{a.to_time ? `, ${a.to_time}${a.to_end ? `–${a.to_end}` : ''}` : ''}
                </span>
                <span className="ov-ask-why">“{a.reason}” — {a.asked_name}</span>
              </button>
              <span className="ov-ask-do">
                <button className="btn btn-sm" disabled={busyAsk === a.id} onClick={() => answer(a, false)}>{tx("Keep")}</button>
                <button className="btn btn-sm btn-primary" disabled={busyAsk === a.id} onClick={() => answer(a, true)}>{tx("Move it")}</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- the channels that have work on them ---- */}
      <div className="section-head ov-chan-head">
        <h2>{tx('Channels')}</h2>
        <span className="count">· {busy.length}</span>
      </div>
      <div className="ov-grid">
        {busy.map(({ c, color, open, overdue, doneWeek, byStage }) => {
          const Icon = iconFor(c.icon)
          return (
            <button key={c.key} className="card ov-card" onClick={() => navigate(`/dept/${c.key}`)}>
              <div className="ov-head">
                <span className="ov-icon" style={{ background: color, color: onColor(color) }}><Icon size={15} /></span>
                <span className="ov-name">{c.label}</span>
                <span style={{ flex: 1 }} />
                {c.head_name
                  ? <Avatar name={c.head_name} color={c.head_color} src={c.head_avatar} size="sm" />
                  : <span className="no-owner-badge" data-tip={tx("Nobody owns this channel — assign a head or hire one")} data-tip-left="">{tx("no owner")}</span>}
              </div>

              {/* the pipeline, labeled — the stage name rides ON its color,
                  so nobody has to decode a bare strip */}
              <div className="ov-stages">
                {byStage.map(({ s, n }) => (
                  <span key={s.id} className="ov-stage">
                    <i className="dot" style={{ background: s.color }} /> {s.label} <b>{n}</b>
                  </span>
                ))}
              </div>

              {/* The same marks the channel register, the missed register and
                  the crew deck use, so the one number somebody scans for —
                  the red one — looks the same everywhere. */}
              <div className="ov-counts">
                <CountDot n={overdue.length} tone="late" />
                <CountDot n={open.length} tone="open" />
                <CountDot n={doneWeek.length} tone="done" tip="Finished in the last 7 days" />
              </div>
            </button>
          )
        })}
      </div>

      {/* The quiet ones, as one line. They are still reachable — a channel
          with nothing open is not a channel that has stopped existing — but
          they do not get a card each, because eleven identical cards saying
          nothing is how the four that matter got lost. */}
      {quiet.length > 0 && (
        <div className="ov-quiet">
          <button className="ov-quiet-head" onClick={() => setShowQuiet((v) => !v)} aria-expanded={showQuiet}>
            <ChevronDown size={15} className={showQuiet ? 'open' : ''} />
            {quiet.length === 1
            ? tx('1 channel with nothing open')
            : tx('{n} channels with nothing open', { n: quiet.length })}
          </button>
          {showQuiet && (
            <div className="ov-quiet-list">
              {quiet.map(({ c, color }) => {
                const Icon = iconFor(c.icon)
                return (
                  <button key={c.key} className="ov-quiet-chip" onClick={() => navigate(`/dept/${c.key}`)}>
                    <span className="ov-quiet-icon" style={{ background: color, color: onColor(color) }}><Icon size={12} /></span>
                    {c.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}

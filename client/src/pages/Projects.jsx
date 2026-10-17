import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2, Briefcase, Megaphone, GanttChartSquare, X, UserRound, ChevronDown } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import CampaignForm from '../components/CampaignForm.jsx'
import CampaignGantt from '../components/CampaignGantt.jsx'
import { StatusBadge, CampaignRow, PhotoField, PROJECT_STATUSES, NEEDS_REASON, ownerOptions } from '../components/ProjectBits.jsx'
import { dateLabel, todayISO, monthName } from '../lib/constants.js'
import { loadFailed } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

const CAMP_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'idea', label: 'Not ready' },
  { key: 'done', label: 'Done' },
]

// Admin's project editor (create + the fields the table needs).
// Twenty projects in a sitting all run over the same stretch, and typing the
// same two dates twenty times is how the second one gets left blank. The last
// range used is remembered in this browser and offered as the starting point
// for the next NEW project; opening an existing one always shows its own dates.
const RANGE_KEY = 'satashkent_project_range'
// Which month of the board you had open. Remembered so that closing a project
// puts you back where you were rather than at the top of everything.
const MONTH_KEY = 'satashkent_project_month'
const lastRange = () => { try { return JSON.parse(localStorage.getItem(RANGE_KEY) || 'null') || {} } catch { return {} } }
const rememberRange = (start_date, deadline) => {
  try { localStorage.setItem(RANGE_KEY, JSON.stringify({ start_date: start_date || '', deadline: deadline || '' })) } catch { /* fine */ }
}

// One completion rate as a bar: a label, the bar, the percent, and the count
// that the percent comes from. Green only when it is complete — a bar that is
// green at 40% has stopped meaning anything by the time it is green at 100%.
function Meter({ label, pct, sub }) {
  const done = pct >= 100
  return (
    <span className={'proj-meter' + (done ? ' done' : '')}>
      <span className="proj-meter-key">{label}</span>
      <span className="proj-meter-track">
        <span className="proj-meter-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </span>
      <b className="proj-meter-pct">{pct}%</b>
      <span className="proj-meter-sub">{sub}</span>
    </span>
  )
}

export function ProjectForm({ project, team, metrics, onClose, onSaved, onDeleted, isAdmin = false }) {
  const creating = !project
  const [err, setErr] = useState('')
  const [form, setForm] = useState(() => ({
    name: project?.name || '',
    owner_id: project?.owner_id ?? '',
    start_date: project?.start_date || (project ? '' : lastRange().start_date || ''),
    deadline: project?.deadline || (project ? '' : lastRange().deadline || ''),
    status: project?.status || 'on_track',
    status_reason: project?.status_reason || '',
    description: project?.description || '',
    budget: project?.budget ?? '',
  }))
  // Numbers and criteria are edited as their own lists, not as form fields.
  // An existing number is carried WHOLE — its current value, and the stamp of
  // who last moved it, belong to the number and are none of this form's
  // business. The form only ever sets a name and a target.
  const [numbers, setNumbers] = useState(() => (project?.numbers || []).map((n) => ({ ...n })))
  const [criteria, setCriteria] = useState(() => (project?.criteria || []).map((c) => ({ ...c })))
  const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const addNumber = () => setNumbers((xs) => [...xs, { id: newId(), name: '', current: 0, target: '' }])
  const setNumber = (i, patchN) => setNumbers((xs) => xs.map((n, k) => (k === i ? { ...n, ...patchN } : n)))
  const dropNumber = (i) => setNumbers((xs) => xs.filter((_, k) => k !== i))
  const addCriterion = () => setCriteria((xs) => [...xs, { text: '', done: false }])
  const setCriterion = (i, text) => setCriteria((xs) => xs.map((c, k) => (k === i ? { ...c, text } : c)))
  const dropCriterion = (i) => setCriteria((xs) => xs.filter((_, k) => k !== i))
  const [photo, setPhoto] = useState({ changed: false, photo: project?.photo ?? project?.photo_thumb ?? null, photo_thumb: project?.photo_thumb ?? null })
  const save = async () => {
    if (!form.name.trim()) { setErr('Give the project a name'); return }
    setErr('')
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        owner_id: form.owner_id || null,
        start_date: form.start_date || null,
        deadline: form.deadline || null,
        budget: form.budget === '' ? null : Number(form.budget),
        // Blank rows are what a "+ Add" button leaves behind when somebody
        // changes their mind; they are dropped rather than saved empty.
        numbers: numbers.filter((n) => String(n.name).trim()).map((n) => ({ ...n, target: Number(n.target) || 0 })),
        criteria: criteria.filter((c) => String(c.text).trim()),
        status_reason: NEEDS_REASON.includes(form.status) ? form.status_reason : '',
        ...(photo.changed ? { photo: photo.photo, photo_thumb: photo.photo_thumb } : {}),
      }
      const saved = creating ? await api.post('/projects', payload) : await api.patch(`/projects/${project.id}`, payload)
      // Only a NEW project teaches the next one where to start; correcting an
      // old project's dates should not move everybody else's default.
      if (creating) rememberRange(form.start_date, form.deadline)
      onSaved(saved)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  const del = async () => {
    if (!confirm(`Delete the project “${project.name}”?\n\nIts campaigns stay but lose the project link; project notes are removed.`)) return
    try { await api.del(`/projects/${project.id}`); onDeleted?.(project); onClose() } catch (e) { setErr(e.message) }
  }
  return (
    <Modal
      title={creating ? tx('New project') : tx('Project')}
      onClose={onClose}
      footer={<>
        {!creating && isAdmin && <button className="btn btn-danger" onClick={del}><Trash2 size={15} /> Delete</button>}
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>{creating ? 'Create project' : 'Save'}</button>
      </>}
    >
      {err && <div className="pc-strip" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="field"><label>Name</label>
        <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. YouTube growth" />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>Owner <span className="stat-sub">— one person</span></label>
          <select className="select" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value === '' ? '' : Number(e.target.value) })}>
            <option value="">— no owner yet (renders red) —</option>
            {ownerOptions(team).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
        <div className="field"><label>Status</label>
          <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {PROJECT_STATUSES.map((o) => <option key={o.value} value={o.value}>{tx(o.label)}</option>)}
          </select>
        </div>
      </div>
      {NEEDS_REASON.includes(form.status) && (
        <div className="field"><label>Why <span className="stat-sub">— one line, shown under the status</span></label>
          <input className="input" value={form.status_reason} maxLength={300}
            onChange={(e) => setForm({ ...form, status_reason: e.target.value })}
            placeholder={form.status === 'at_risk' ? 'e.g. the venue has not confirmed' : 'e.g. printing slipped two weeks'} />
        </div>
      )}
      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Runs</label>
          <div className="proj-range">
            <input className="input" type="date" aria-label="From" value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <span className="proj-range-to">→</span>
            <input className="input" type="date" aria-label="To" value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="field"><label>Description <span className="stat-sub">(optional)</span></label>
        <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What this area of the business is…" />
      </div>
      {/* Numbers. A project has as many as it measures; the current value is
          not here, because it is updated on the project page by whoever has
          the figure, not in the form by whoever is editing the plan. */}
      <div className="field">
        <label>Numbers <span className="stat-sub">— what this project is counting</span></label>
        {numbers.map((n, i) => (
          <div key={n.id || i} className="row-edit">
            <input className="input" list="pf-metric-names" value={n.name} maxLength={60}
              onChange={(e) => setNumber(i, { name: e.target.value })} placeholder="e.g. Visitors" />
            <input className="input row-edit-num" type="number" min="0" value={n.target ?? ''}
              onChange={(e) => setNumber(i, { target: e.target.value })} placeholder="target" />
            <button className="icon-btn del-btn" onClick={() => dropNumber(i)} aria-label="Remove this number"><X size={14} /></button>
          </div>
        ))}
        {/* Suggestions, not a menu: the box takes any name. The ten the board
            already knows are offered because "Leads" spelled three ways is
            three numbers nobody can add up. */}
        <datalist id="pf-metric-names">{metrics.map((m) => <option key={m} value={m} />)}</datalist>
        <button className="btn btn-sm" onClick={addNumber}><Plus size={14} /> Add number</button>
      </div>

      {/* Criteria. Not the checklist: these are the things that must be TRUE
          when the project is finished, and every one of them has to be ticked
          before the project can be marked Done. */}
      <div className="field">
        <label>Success criteria <span className="stat-sub">— what must be true at the end</span></label>
        {criteria.map((c, i) => (
          <div key={i} className="row-edit">
            <input className="input" value={c.text} maxLength={300}
              onChange={(e) => setCriterion(i, e.target.value)}
              placeholder="e.g. Banners up before promotion starts" />
            <button className="icon-btn del-btn" onClick={() => dropCriterion(i)} aria-label="Remove this criterion"><X size={14} /></button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={addCriterion}><Plus size={14} /> Add criterion</button>
      </div>
      <div className="field"><label>Budget <span className="stat-sub">(optional)</span></label>
        <input className="input" type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
      </div>
      <PhotoField
        photo={photo.photo}
        onChange={({ photo: ph, photo_thumb: th }) => setPhoto({ changed: true, photo: ph, photo_thumb: th })}
      />
    </Modal>
  )
}

// Projects — the missing layer. Landing table sorted red-first, the campaign
// list, and the four-column campaign board with the form gate on drag.
export default function Projects() {
  const { user } = useAuth()
  const { byKey } = useChannels()
  const navigate = useNavigate()
  const isAdmin = user.role === 'admin'
  const [view, setViewState] = useState(() => localStorage.getItem('satashkent_pc_view') || 'projects')
  const setView = (v) => { setViewState(v); localStorage.setItem('satashkent_pc_view', v) }
  const [projects, setProjects] = useState([])
  const [camps, setCamps] = useState([])
  const [team, setTeam] = useState([])
  const [metrics, setMetrics] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [campSort, setCampSort] = useState('start')    // start | end | daysleft
  // The month you were looking at, remembered.
  //
  // It was plain state, so coming back from a project reset the strip to All
  // and the project you had just closed was no longer on screen: you picked
  // the month again, found it again, every single time. The view beside it has
  // been remembered in localStorage since it was built; this is the same idea,
  // and the same key prefix.
  //
  // Restored only if that month still holds something — see the effect below.
  // A remembered month from a quarter ago would otherwise open the board on an
  // empty list, which is a worse first screen than All.
  const [month, setMonthState] = useState(() => localStorage.getItem(MONTH_KEY) || null)
  const setMonth = (m) => {
    setMonthState(m)
    try { m ? localStorage.setItem(MONTH_KEY, m) : localStorage.removeItem(MONTH_KEY) } catch { /* fine */ }
  }
  const [projectModal, setProjectModal] = useState(null) // null | 'new' | project
  const [campModal, setCampModal] = useState(null)       // null | 'new' | campaign
  // Yours first. Everybody who can open this page sees every project — they
  // are the team's goals — and the server marks `mine` on the ones you own or
  // run a campaign in. This narrows the list to those. Anyone who is not an
  // admin lands on their own; an admin, who answers for all of them, lands on
  // everything. The choice is remembered, like the view and the month.
  const [mineOnly, setMineOnlyState] = useState(() => {
    try { const v = localStorage.getItem('satashkent_pc_mine'); if (v !== null) return v === '1' } catch { /* fine */ }
    return !isAdmin
  })
  const setMineOnly = (v) => {
    setMineOnlyState(v)
    try { localStorage.setItem('satashkent_pc_mine', v ? '1' : '0') } catch { /* fine */ }
  }

  const load = () => Promise.all([
    api.get('/projects'), api.get('/campaigns'), api.get('/users'), api.get('/projects/metrics'),
  ]).then(([ps, cs, us, ms]) => { setProjects(ps); setCamps(cs); setTeam(us); setMetrics(ms) })
  useEffect(() => { load().catch(loadFailed).finally(() => setLoading(false)) }, [])

  // A number being typed into on a card: {pid, id, value}.
  const [editingNum, setEditingNum] = useState(null)

  // Which cards are showing their detail. Closed by default: a list of
  // projects is for finding the one that needs you, and the two bars on a
  // closed card are enough to do that.
  const [openCards, setOpenCards] = useState(() => new Set())
  const toggleCard = (id) => setOpenCards((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Live refresh, same rhythm as the rest of the app.
  //
  // Held while a number is being typed on a card. The poll replaces the whole
  // list every ten seconds, and a replace landing mid-edit would put the old
  // value back under somebody's cursor — the one thing an edit box must not do.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || projectModal || campModal || editingNum) return
      api.poll('/projects').then((f) => { if (f) setProjects(f) }).catch(() => {})
      api.poll('/campaigns').then((f) => { if (f) setCamps(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [projectModal, campModal, editingNum])

  const filtered = useMemo(() => {
    const list = filter === 'all' ? [...camps] : camps.filter((c) => c.status === filter)
    const key = { start: 'start_date', end: 'end_date' }[campSort]
    if (key) list.sort((a, b) => (a[key] ? (b[key] ? a[key].localeCompare(b[key]) : -1) : 1))
    else list.sort((a, b) => (a.days_left ?? 9e9) - (b.days_left ?? 9e9))
    return list
  }, [camps, filter, campSort])

  // One order, and it is the useful one: what needs a person is at the top,
  // then the soonest deadline. Four sort buttons over a handful of projects
  // asked people to choose an ordering before they had read anything.
  // ---- one month at a time -------------------------------------------------
  // A project is not a day, it is a stretch: started then, due then. So the
  // month filter asks whether the stretch TOUCHES the month rather than
  // whether the deadline falls inside it — a project that ran from 20 August
  // to the middle of September is an August project and a September project,
  // and it shows up under both. Filtering on the deadline alone would have
  // dropped it out of August entirely, which is the month most of the work
  // happened in.
  //
  // What the stretch is, from what already exists on a project:
  //   with a deadline   from when it was started to the day it is due
  //   open, undated     this month, and only this month. It is live rather
  //                     than scheduled: stretching it back to the day it was
  //                     started would put one open-ended project into every
  //                     month since, and drag months into the strip that hold
  //                     nothing else at all
  //   closed, undated   the day it was made — the one day it can be placed on
  // Nothing lands outside every month, so nothing can be hidden by this.
  const spanOf = (p) => {
    // A project that says when it starts is believed. Before there was a start
    // date the day it was created was the only honest guess at one; now it is
    // only the fallback.
    const made = String(p.start_date || p.created_at || '').slice(0, 10)
    if (p.deadline) {
      const from = made && made < p.deadline ? made : p.deadline
      return { from, to: p.deadline > from ? p.deadline : from }
    }
    if (!made) return null
    const done = p.status === 'done' || p.status === 'closed'
    const day = done ? made : todayISO()
    return { from: day, to: day }
  }
  // "September", not "M09" and not "Sep 2026". The year is only worth the
  // width when it is not this one — a strip that reads September, October,
  // November says everything, and repeating 2026 on each of them says nothing.
  const monthPill = (ym) => {
    const [y, m] = ym.split('-').map(Number)
    const name = monthName(y, m, 'long')
    return y === new Date().getFullYear() ? name : `${name} ${y}`
  }
  const monthEnd = (ym) => {
    const [y, m] = ym.split('-').map(Number)
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  }
  // What "Mine" narrows to. It narrows the LIST, not the month strip.
  //
  // It used to be applied before the strip too, so only months holding one of
  // your own projects were offered. The aim was right — never offer a month
  // that opens on nothing — but it cost more than it saved: the strip hides
  // itself at one month, so anybody whose own projects all fall in one month
  // pressed "Mine" and watched the whole control disappear and the page jump
  // up under them. A filter that removes the other filter is not two filters.
  //
  // So the strip is the board's, and "Mine" and the month combine. The aim is
  // kept a different way: under "Mine" a month with none of yours is drawn
  // dimmed, so you can see it is empty before you press it, and pressing it
  // anyway says so and offers everybody's in one click.
  //
  // Somebody with nothing of their own is never shown an empty list for it:
  // with no project marked `mine`, the button is not drawn and the filter is
  // not applied.
  const mineCount = useMemo(() => projects.filter((p) => p.mine).length, [projects])
  const onlyMine = mineOnly && mineCount > 0
  const shownProjects = useMemo(() => (onlyMine ? projects.filter((p) => p.mine) : projects), [projects, onlyMine])

  // Every month any project touches, newest first — so the strip only ever
  // offers months that have something in them.
  // The months a set of projects touches, newest first.
  const monthsOf = (list) => {
    const seen = new Set()
    for (const p of list) {
      const sp = spanOf(p)
      if (!sp) continue
      const d = new Date(`${sp.from.slice(0, 7)}-01T00:00:00Z`)
      const last = sp.to.slice(0, 7)
      for (let i = 0; i < 60; i++) {
        const ym = d.toISOString().slice(0, 7)
        seen.add(ym)
        if (ym >= last) break
        d.setUTCMonth(d.getUTCMonth() + 1)
      }
    }
    return [...seen].sort().reverse()
  }
  // The strip: every month the BOARD touches, whatever "Mine" says.
  const months = useMemo(() => monthsOf(projects), [projects]) // eslint-disable-line react-hooks/exhaustive-deps
  // Under "Mine", the months that hold something of yours — the rest are dimmed.
  const mineMonths = useMemo(
    () => new Set(onlyMine ? monthsOf(shownProjects) : months),
    [onlyMine, shownProjects, months]) // eslint-disable-line react-hooks/exhaustive-deps

  // A remembered month that no longer holds anything drops back to All.
  //
  // Months come and go: the one you were looking at in July is not offered in
  // October, and restoring it would open the board on an empty list with a
  // month button that is not even in the strip. Waits for the projects to
  // arrive — before that the list is empty and EVERY month looks stale.
  useEffect(() => {
    if (!month || projects.length === 0) return
    if (!months.includes(month)) setMonth(null)
  }, [months, projects.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const inMonth = useMemo(() => {
    if (!month) return shownProjects
    const from = `${month}-01`
    const to = monthEnd(month)
    return shownProjects.filter((p) => {
      const sp = spanOf(p)
      return sp && sp.from <= to && sp.to >= from
    })
  }, [shownProjects, month])

  // Off track first, then At risk, then On track, and Done at the bottom —
  // the same intent the old health order had, now read from what somebody
  // actually said about the project rather than guessed from its dates.
  const STATUS_RANK = { off_track: 0, at_risk: 1, on_track: 2, done: 3, closed: 4 }
  const sortedProjects = useMemo(() => [...inMonth].sort((a, b) =>
    (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
    || (a.deadline ? (b.deadline ? a.deadline.localeCompare(b.deadline) : -1) : 1)
    || a.name.localeCompare(b.name)), [inMonth])

  // Ticking a criterion from the list, without opening the project. The card
  // is a link, so the box stops the click before it navigates; the row is
  // swapped in place so the tick lands instantly and the fetch catches up.
  const tickCriterion = async (p, i, done) => {
    const next = (p.criteria || []).map((c, n) => (n === i ? { ...c, done } : c))
    setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, criteria: next } : x)))
    try {
      const saved = await api.patch(`/projects/${p.id}`, { criteria: next })
      // MERGED, not replaced. A PATCH answers with the project alone — no
      // owner_name or owner_color, and no `mine`, all of which only the list
      // endpoint adds — so swapping the row for the reply wiped the owner off
      // the card and, with "Mine" on, dropped the project out of the list
      // altogether until the next poll put it back.
      setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...saved } : x)))
    } catch (e) {
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)))
      alert(e.message)
    }
  }

  // Updating a number from the list, without opening the project. Only the
  // CURRENT value — the target is the plan, and the plan is changed in the
  // project form by whoever owns it, not by a click on a card. Same shape as
  // ticking a criterion: swap it in place, let the save catch up, put it back
  // if the save is refused.
  const saveNumber = async (p, id, raw) => {
    setEditingNum(null)
    const v = Math.max(0, Math.round(Number(raw)))
    const was = (p.numbers || []).find((n) => n.id === id)
    if (!Number.isFinite(v) || !was || v === Number(was.current)) return
    const next = p.numbers.map((n) => (n.id === id ? { ...n, current: v } : n))
    setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, numbers: next } : x)))
    try {
      const saved = await api.patch(`/projects/${p.id}`, { numbers: next })
      setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...saved } : x)))
    } catch (e) {
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)))
      alert(e.message)
    }
  }

  const replaceCamp = (saved) => setCamps((prev) => {
    const has = prev.some((c) => c.id === saved.id)
    const next = has ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved]
    return next
  })

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  // Three views, each answering a question the other two cannot.
  //
  // There were four. "Board" was a kanban of the same campaigns the Campaigns
  // list already shows, in the same order, with the same rows — the only thing
  // it could do that the list could not was drag a campaign between stages,
  // and the campaign itself has a stage control on it. A third rendering of
  // one list is not a view, it is a place to be lost.
  //
  // "Gantt" is a word for a chart, not for what somebody wants: they want to
  // know what overlaps when, so it is called Timeline.
  const VIEWS = [
    { key: 'projects', label: 'Projects', icon: Briefcase },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
    { key: 'gantt', label: 'Timeline', icon: GanttChartSquare },
  ]

  return (
    <>
      <div className="pill-group" style={{ marginBottom: 14, alignItems: 'center' }}>
        {VIEWS.map((v) => {
          const Icon = v.icon
          return (
            <button key={v.key} className={'pill' + (view === v.key ? ' active' : '')} onClick={() => setView(v.key)}>
              <Icon size={14} /> {v.label}
            </button>
          )
        })}
        {view === 'projects' && mineCount > 0 && (
          <button className={'pill pill-mine' + (onlyMine ? ' active' : '')} aria-pressed={onlyMine}
            onClick={() => setMineOnly(!onlyMine)}>
            <UserRound size={14} /> {tx('Mine')} · {mineCount}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {isAdmin && view === 'projects' && (
          <button className="btn btn-primary btn-sm" onClick={() => setProjectModal('new')}><Plus size={15} /> {tx('New project')}</button>
        )}
        {isAdmin && view !== 'projects' && (
          <button className="btn btn-primary btn-sm" onClick={() => setCampModal('new')}><Plus size={15} /> {tx('New campaign')}</button>
        )}
      </div>

      {view === 'projects' && (
        <>
          {/* One card per project instead of seven columns. A table asks you to
              read across a row and hold six values in your head; the question
              people actually arrive with is "which of these needs me, and who
              is on it", and that answer fits on two lines. The order already
              answers the first half — what needs a person is at the top — so
              the four sort buttons went with the columns. */}
          {/* One row of months, and "All". Only months that actually hold a
              project are offered, so the strip is as long as the work is and
              never longer, and a project that straddles two months sits under
              both. */}
          {months.length > 1 && (
            <div className="pill-group proj-months">
              <button className={'pill' + (month === null ? ' active' : '')} onClick={() => setMonth(null)}>{tx('All')}</button>
              {months.map((ym) => {
                // Dimmed, not removed: under "Mine" a month with none of yours
                // stays in the strip so the strip does not jump, but says it is
                // empty before you press it.
                const none = !mineMonths.has(ym)
                return (
                  <button key={ym} className={'pill' + (month === ym ? ' active' : '') + (none ? ' pill-none' : '')}
                    onClick={() => setMonth(ym)} data-tip={none ? tx('None of yours this month') : undefined}>
                    {monthPill(ym)}
                  </button>
                )
              })}
            </div>
          )}
          <div className="proj-list">
            {sortedProjects.map((p) => {
              // Past its date is only a warning while the project is open. A
              // finished one — Done or Closed — printed "was due 25 Aug" in red on
              // every card, an alarm about work that was already over.
              const finished = p.status === 'done' || p.status === 'closed'
              const late = !finished && p.deadline && p.deadline < todayISO()
              // Who may change this project: its owner or an admin — the
              // server's canWrite. NOT `p.mine`, which is also true for
              // somebody who only runs a campaign in it: they can see it as
              // theirs, but the numbers and the criteria are the owner's.
              const canEdit = isAdmin || p.owner_id === user.id
              const t = p.tally || {}
              const hasProgress = t.numbers_avg != null || t.criteria_pct != null
              const open = openCards.has(p.id)
              return (
                /* A block, not a <button>: it holds inputs and checkboxes, and
                   a button may not contain anything interactive — a space or
                   Enter typed into an input nested in one can press it and
                   navigate away mid-edit. The whole card still opens the
                   project on a click; the NAME is the real link. */
                <div key={p.id} className={`proj-card status-${p.status}` + (open ? ' open' : '')}
                  onClick={(e) => {
                    if (e.target.closest('input, a, button, label')) return
                    navigate(`/projects/${p.id}`)
                  }}>

                  {/* WHAT IT IS — name, state, who, when. */}
                  <div className="proj-head">
                    <div className="proj-head-top">
                      <span className="proj-main">
                        {p.photo_thumb && <img className="pc-thumb" src={p.photo_thumb} alt="" />}
                        <Link className="proj-name" to={`/projects/${p.id}`}>{p.name}</Link>
                        <StatusBadge status={p.status} />
                      </span>
                      {/* Top right, beside the name, where it never wraps onto
                          a row of its own and is in the same place on every
                          card. */}
                      {hasProgress && (
                        <button type="button" className={'proj-toggle' + (open ? ' open' : '')} aria-expanded={open}
                          onClick={() => toggleCard(p.id)}>
                          {open ? 'Hide' : 'Details'} <ChevronDown size={14} />
                        </button>
                      )}
                    </div>
                    {p.status_reason && <span className={'pc-status-why' + (p.status === 'closed' ? ' ended' : '')}>{p.status_reason}</span>}
                    <span className="proj-meta">
                      {p.owner_name && (
                        <span className="proj-who">
                          <Avatar name={p.owner_name} color={p.owner_color} size={20} /> {p.owner_name}
                        </span>
                      )}
                      <span className={'proj-due' + (late ? ' late' : '')}>
                        {p.start_date && p.deadline
                          ? `${dateLabel(p.start_date)} → ${dateLabel(p.deadline)}`
                          : p.deadline ? (late ? tx('was due {day}', { day: dateLabel(p.deadline) }) : tx('due {day}', { day: dateLabel(p.deadline) })) : tx('no deadline')}
                      </span>
                      {/* Said only when there is something to say. "no
                          campaigns yet" on every card was a line of noise
                          repeated down the whole page. */}
                      {p.progress?.campaigns_total > 0 && (
                        <span className="proj-camps">{p.live_campaigns} of {p.progress.campaigns_total} campaigns live</span>
                      )}
                    </span>
                  </div>

                  {/* HOW FAR ALONG — two bars, and nothing else until asked.
                      The card used to show every number and every criterion at
                      once, so a list of projects read like a stack of reports.
                      The two rates are the summary that lets the detail fold
                      away. */}
                  {hasProgress && (
                    <div className="proj-progress">
                      {t.numbers_avg != null && (
                        <Meter label="Numbers" pct={t.numbers_avg} sub={`${t.numbers_hit} of ${t.numbers_total} hit`} />
                      )}
                      {t.criteria_pct != null && (
                        <Meter label="Criteria" pct={t.criteria_pct} sub={`${t.criteria_done} of ${t.criteria_total} ticked`} />
                      )}
                    </div>
                  )}

                  {/* THE DETAIL — only when asked for, in the same order as the
                      two bars, so the eye goes straight down from a bar to what
                      it is made of. */}
                  {open && (
                    <div className="proj-detail">
                      {(p.numbers || []).length > 0 && (
                        <div className="proj-detail-col">
                          <div className="proj-detail-h">Numbers</div>
                          {p.numbers.map((n) => {
                            const target = Number(n.target) || 0
                            const current = Number(n.current) || 0
                            const pct = target > 0 ? Math.round((current / target) * 100) : 0
                            const hit = target <= 0 || current >= target
                            const editing = editingNum?.pid === p.id && editingNum?.id === n.id
                            return (
                              <div key={n.id} className={'proj-num' + (hit ? ' hit' : '')}>
                                <div className="proj-num-top">
                                  <span className="proj-num-name">{n.name}</span>
                                  <span className="proj-num-val">
                                    {/* The current value is editable; the target
                                        is not — that is the plan, changed in the
                                        project form by whoever owns it. */}
                                    {editing ? (
                                      <input
                                        className="input proj-num-input" type="number" min="0" autoFocus
                                        value={editingNum.value}
                                        onChange={(e) => setEditingNum({ ...editingNum, value: e.target.value })}
                                        onBlur={() => saveNumber(p, n.id, editingNum.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveNumber(p, n.id, editingNum.value)
                                          if (e.key === 'Escape') setEditingNum(null)
                                        }}
                                      />
                                    ) : canEdit ? (
                                      <button type="button" className="proj-num-cur edit" data-tip="Update this number"
                                        onClick={() => setEditingNum({ pid: p.id, id: n.id, value: String(current) })}>
                                        {current.toLocaleString()}
                                      </button>
                                    ) : (
                                      <b className="proj-num-cur">{current.toLocaleString()}</b>
                                    )}
                                    <span className="proj-num-of">/ {target.toLocaleString()}</span>
                                    <span className="proj-num-pct">{pct}%</span>
                                  </span>
                                </div>
                                <span className="proj-num-track">
                                  <span className="proj-num-fill" style={{ width: `${Math.min(100, pct)}%` }} />
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {(p.criteria || []).length > 0 && (
                        <div className="proj-detail-col">
                          <div className="proj-detail-h">Criteria</div>
                          {p.criteria.map((c, i) => (
                            <label key={i} className={'proj-crit-row' + (c.done ? ' met' : '')}>
                              {/* Tickable by the owner or an admin. Everybody
                                  can SEE every card now; a box that ticks and
                                  then un-ticks itself on a 403 is worse than one
                                  that plainly cannot. */}
                              <input type="checkbox" checked={!!c.done} disabled={!canEdit}
                                onChange={(e) => tickCriterion(p, i, e.target.checked)} />
                              <span>{c.text}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {projects.length === 0 && (
            <div className="card card-pad empty">
              <Briefcase size={28} />
              <div>No projects yet{isAdmin ? ' — create the first one.' : '.'}</div>
            </div>
          )}
          {/* A month can be empty while the board is not. Say so, rather than
              showing a blank where the list was. */}
          {projects.length > 0 && sortedProjects.length === 0 && (
            onlyMine ? (
              // The month has projects, just none of yours. Say that, and give
              // the one press that answers the next question.
              <div className="card card-pad empty">
                <div className="stat-sub">{tx('None of your projects this month')}</div>
                <button className="btn btn-sm" onClick={() => setMineOnly(false)}>{tx("Show everyone's")}</button>
              </div>
            ) : (
              <div className="card card-pad empty"><div className="stat-sub">{tx('Nothing this month')}</div></div>
            )
          )}
        </>
      )}

      {view === 'campaigns' && (
        <>
          <div className="pill-group" style={{ marginBottom: 10, alignItems: 'center' }}>
            {CAMP_FILTERS.map((f) => (
              <button key={f.key} className={'pill' + (filter === f.key ? ' active' : '')} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
            <span style={{ flex: 1 }} />
            <span className="stat-sub" style={{ fontWeight: 700 }}>Sort:</span>
            <button className={'pill' + (campSort === 'start' ? ' active' : '')} onClick={() => setCampSort('start')} data-tip="Earliest start on top">Start ↑</button>
            <button className={'pill' + (campSort === 'end' ? ' active' : '')} onClick={() => setCampSort('end')} data-tip="Earliest end on top">End ↑</button>
            <button className={'pill' + (campSort === 'daysleft' ? ' active' : '')} onClick={() => setCampSort('daysleft')} data-tip="Fewest days left on top" data-tip-left="">Days left ↑</button>
          </div>
          <div className="pc-camp-list">
            {filtered.map((c) => <CampaignRow key={c.id} c={c} byKey={byKey} onOpen={(x) => navigate(`/campaigns/${x.id}`)} />)}
            {filtered.length === 0 && <div className="card card-pad empty">{tx('No projects')}</div>}
          </div>
        </>
      )}

      {view === 'gantt' && (
        <CampaignGantt camps={camps} onOpen={(c) => navigate(`/campaigns/${c.id}`)} />
      )}

      {projectModal && (
        <ProjectForm
          project={projectModal === 'new' ? null : projectModal}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          onClose={() => setProjectModal(null)}
          onSaved={() => load()}
          onDeleted={() => load()}
        />
      )}
      {campModal && (
        <CampaignForm
          campaign={campModal === 'new' ? null : campModal}
          projects={projects}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          onClose={() => setCampModal(null)}
          onSaved={replaceCamp}
          onDeleted={(c) => setCamps((prev) => prev.filter((x) => x.id !== c.id))}
        />
      )}
    </>
  )
}


import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageGuide from '../components/PageGuide.jsx'
import CalendarViews from '../components/CalendarViews.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Send, Clapperboard, AlertCircle, CalendarDays, Download, CalendarRange, X, Layers } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { rewardIfFinished } from '../lib/reward.js'
import { toast, loadFailed } from '../lib/toast.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { can, todayISO, dateLabel, typeInfo, isDeletedLabel, fixMonth, addDaysISO, mondayOfISO, fmtDay } from '../lib/constants.js'
import ContentModal from '../components/ContentModal.jsx'
import ContentCalendar from '../components/ContentCalendar.jsx'
import DayAgenda from '../components/DayAgenda.jsx'
import { assigneesOf } from '../components/ContentFilters.jsx'
import { BLANK, HATS, cleanFilter, isOn, matches, matchesPerson, matchesStages, seatedOf } from '../lib/schedFilter.js'
import Avatar from '../components/Avatar.jsx'
import { StageMark } from '../components/CoachParts.jsx'
import { stageRankOf } from '../lib/gaps.js'
import { cascadeDates, pullBackDates, LABELS } from '../lib/formState.js'
import BulkMove from '../components/BulkMove.jsx'
import { useClash } from '../components/ClashDialog.jsx'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { isCarried, carriedFrom, monthLongOf } from '../lib/planMonth.js'
import { useIsPhone } from '../lib/usePhone.js'

// How many overdue chips the strip shows before it stops being a strip.
const LATE_SHOWN = 3   // one line (round 10); the rest behind "Show all"
// A day inside a sentence: "26 Sept", never a capitalised "Tomorrow" mid-line.
// Through fixMonth, because Chromium has no Latin-Uzbek month names and says
// "M09 26" instead; English and Russian pass through it untouched. (The
// dateLabel() days on the same page still wait for the date sweep that
// constants.js describes.)
const plainDay = (iso) => fixMonth(
  fmtDay(iso),
  Number(iso.slice(5, 7)) - 1)
// A phone turned on its side is still a phone: 852px wide and 393 tall, and
// still a finger. So a short touch screen counts as well as a narrow one — a
// tablet, taller than 500px, still plans at a desk's pace and keeps its drag.
const LOOK_ONLY_Q = '(max-width: 640px), (pointer: coarse) and (max-height: 500px)'

// Everything that comes OUT, and everything that gets SHOT — across every
// channel at once. The release calendar is the MASTER CALENDAR (/calendar):
// several channels side by side, cards dragged between days, and a stack of
// them moved on to a stage at once (Bulk Actions). The channel pages answer "what is happening on Instagram
// Main"; these answer the question the week actually starts with, which is
// "what are we releasing" and "what are we filming", wherever it lives.
//
// Both are calendars. A schedule is a shape before it is a list: you plan
// around the gaps, and a gap is something you SEE — a fortnight with nothing
// in it is invisible in a list of rows and obvious in a grid. Reading is the
// smaller half anyway; the working gesture is moving a day, and on a grid that
// is one drag from where it is to where it should be.
//
// One component, two modes. They differ only in which date they read and what
// the empty state says, so keeping them apart would be two copies of the same
// page drifting away from each other.

const MODES = {
  release: {
    label: tx('Calendar'), icon: CalendarRange, dateField: 'release_date', timeField: 'release_time',
    lead: tx('everything going out, every channel'),
    master: true,
    empty: tx('Nothing is scheduled to go out yet.'),
    file: 'releases',
    // A post is written, not filmed — but everything gets released.
    applies: () => true,
  },
  recording: {
    label: tx('Recordings'), icon: Clapperboard, dateField: 'recording_date', timeField: 'recording_time',
    empty: tx('No shoots are booked yet.'),
    file: 'recordings',
    applies: (t) => t.type !== 'post',
  },
}

// A spreadsheet of exactly what is on screen: the same rows the filters left
// standing, over the span the calendar is parked on, late work included. The
// leading BOM is what makes Excel read a Cyrillic title as Cyrillic instead of
// mojibake, and the file name stays ASCII because Chromium silently drops a
// non-ASCII one from <a download>.
const CSV_HEAD = ['Date', 'Time', 'Title', 'Type', 'Channels', 'Stage', tx('Operator'), tx('Editor'), tx('Designer'), 'Assignees']
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvOf = (rows) => '\uFEFF' + [CSV_HEAD, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
const saveText = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function Schedule({ mode }) {
  const M = MODES[mode]
  const { user } = useAuth()
  const { byKey } = useChannels()
  const [params, setParams] = useSearchParams()

  const boot = useMemo(() => cache.get(`sched:${user.id}`), [user.id])
  const [items, setItems] = useState(() => boot?.content || [])
  // A shoot dragged onto a day where its operator is already filming asks, in
  // the booking window, rather than snapping back under a toast.
  const [clashUi, askClash] = useClash()
  const [statuses, setStatuses] = useState(() => boot?.statuses || [])
  const [team, setTeam] = useState(() => boot?.users || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)
  const [newDefaults, setNewDefaults] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  // A refused drag's way through: which task, and the day asked for. Held by
  // task id, so the ask can only ever open on the task it was made about.
  const [askFor, setAskFor] = useState(null)

  // Only what is on screen (r11, the research report's freezing fix). This page
  // used to fetch every piece the board has ever had and re-fetch all of them
  // every ten seconds; on the live board that is the calendar that froze. It
  // now asks for the span the calendar is parked on — the calendar reports it
  // through onRange — plus whatever is still open and late, which the late
  // strip shows. Until the calendar has reported, it asks for this week.
  const [span, setSpan] = useState(() => {
    const from = mondayOfISO(todayISO())
    return { from, to: addDaysISO(from, 6) }
  })
  const onRange = useCallback((from, to) => setSpan((s) => (s.from === from && s.to === to ? s : { from, to })), [])
  const listUrl = `/content?from=${span.from}&to=${span.to}`

  useEffect(() => {
    Promise.all([api.get(listUrl), api.cached('/statuses'), api.cached('/users')])
      .then(([ct, st, us]) => {
        setItems(ct); setStatuses(st); setTeam(us)
        cache.set(`sched:${user.id}`, {
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest), statuses: st, users: us,
        })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [user.id, listUrl])

  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      api.poll(listUrl).then((f) => { if (f) setItems(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem, listUrl])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const teamById = useMemo(() => Object.fromEntries(team.map((u) => [u.id, { id: u.id, name: u.name }])), [team])

  // ---- what this page is looking at ----
  // A person and the stages, pressed on the rails beside the grid (the owner,
  // 22 Oct 2026: "I don't have to click on the filter button and then
  // dropdowns"). What a name means here is the view's seat — lib/schedFilter.js.
  const [filter, setFilterState] = useState(BLANK)
  useEffect(() => {
    // First visit: your own work (r11). Everybody's pieces at once is the page
    // that froze; an admin, who runs everybody's, still starts on everyone.
    const first = user.role === 'admin' ? BLANK : { ...BLANK, person: String(user.id) }
    try {
      const saved = localStorage.getItem(`satashkent_sched2_${mode}`)
      setFilterState(saved ? cleanFilter(JSON.parse(saved)) : first)
    } catch { setFilterState(first) }
  }, [mode, user.id, user.role])
  const setFilter = (f) => { setFilterState(f); localStorage.setItem(`satashkent_sched2_${mode}`, JSON.stringify(f)) }
  const toggleStage = (id) => {
    const s = String(id)
    setFilter({ ...filter, stages: filter.stages.includes(s) ? filter.stages.filter((x) => x !== s) : [...filter.stages, s] })
  }
  // The other calendar is one press away, with the channels and the lens kept.
  const navigate = useNavigate()
  const go = (which) => {
    if (which === mode) return
    const qs = params.toString()
    navigate(`${which === 'release' ? '/calendar' : '/recordings'}${qs ? `?${qs}` : ''}`)
  }
  // Several channels at once: planning a campaign across Instagram Main and
  // Telegram is the point of one calendar. Kept in the address as
  // ?channels=a,b (the old single ?channel= still opens), so a link says
  // exactly what it shows.
  const chosen = useMemo(() => (params.get('channels') || params.get('channel') || '').split(',').filter(Boolean), [params])
  // Whether the channels on screen are ones this person picked (see "come
  // back the way you left it" below).
  const handPicked = useRef(true)
  const setChosen = (list) => {
    handPicked.current = true
    const next = new URLSearchParams(params)
    next.delete('channel')
    if (list.length) next.set('channels', list.join(',')); else next.delete('channels')
    setParams(next, { replace: true })
  }
  // …or one campaign's work, or a whole project's, wherever it goes out: the
  // campaign and project pages open the calendar this way (?campaign= /
  // ?project=). It is a lens on top of the channels, said in a chip, and one
  // press takes it off.
  const campaignId = Number(params.get('campaign')) || null
  const projectId = Number(params.get('project')) || null
  const [campaigns, setCampaigns] = useState([])
  useEffect(() => {
    if (!M.master || (!campaignId && !projectId)) return
    api.cached('/campaigns').then((c) => setCampaigns(Array.isArray(c) ? c : [])).catch(() => {})
  }, [M, campaignId, projectId])
  const lens = useMemo(() => {
    if (!M.master) return null
    if (campaignId) {
      const c = campaigns.find((x) => x.id === campaignId)
      return { label: tx('Campaign: {name}', { name: c?.name || `#${campaignId}` }), ids: new Set([campaignId]) }
    }
    if (projectId) {
      const mine = campaigns.filter((x) => x.project_id === projectId)
      return { label: tx('Project: {name}', { name: mine[0]?.project_name || `#${projectId}` }), ids: new Set(mine.map((x) => x.id)) }
    }
    return null
  }, [M, campaignId, projectId, campaigns])
  const dropLens = () => {
    const next = new URLSearchParams(params)
    next.delete('campaign'); next.delete('project')
    setParams(next, { replace: true })
  }
  const channel = chosen.length === 1 ? chosen[0] : ''

  // Come back to the page the way you left it. The address still wins: a link
  // somebody sent shows what THEY meant, not what you last looked at — so the
  // remembered channel is only consulted when the address says nothing. Which
  // month you were on is deliberately NOT remembered: a schedule opens on the
  // month you are living in, every time.
  //
  // A campaign or project link says what it means as much as a channel link
  // does: that work, on every channel it goes out on. The remembered channels
  // used to REPLACE the whole address, and the ?campaign= went with them — so
  // the one person the campaign page sent here with a channel still picked
  // from last time (the SMM of that channel, which is to say most people)
  // landed on their channel and no campaign at all. The address is merged
  // into now, never replaced, and a lens link is left exactly as it came.
  const viewKey = `satashkent_schedview_${mode}`
  useEffect(() => {
    if (['channel', 'channels', 'campaign', 'project'].some((k) => params.get(k))) return
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(viewKey) || 'null') } catch { saved = null }
    const list = saved?.channels || (saved?.channel ? [saved.channel] : [])
    if (list.length) {
      const next = new URLSearchParams(params)
      next.set('channels', list.map(String).join(','))
      setParams(next, { replace: true })
    }
  }, [viewKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // …and the other half: what is written down as "the way you left it".
  // Looking through a lens is not a view anybody comes back to, so nothing is
  // written while one is on. Nor when it is dropped: the channels on screen
  // then are still the ones the link arrived with (usually none), not a
  // choice, and writing them would wipe the channel an SMM keeps picked — one
  // campaign visit, and their own channel was gone next time. The first
  // channel pressed after that is a choice again, and is remembered.
  const lensKey = campaignId ? `campaign:${campaignId}` : projectId ? `project:${projectId}` : ''
  useEffect(() => { if (lensKey) handPicked.current = false }, [lensKey])
  useEffect(() => {
    if (lensKey || !handPicked.current) return
    try { localStorage.setItem(viewKey, JSON.stringify(chosen.length ? { channels: chosen } : {})) } catch { /* private window */ }
  }, [viewKey, chosen, lensKey])

  const today = todayISO()
  // Killed work leaves the schedule — it is not going out and not being shot.
  const alive = useMemo(
    () => items.filter((t) => M.applies(t) && !isDeletedLabel(statusesById[t.status_id]?.label)),
    [items, statusesById, M])
  const inLens = useMemo(() => (lens ? alive.filter((t) => lens.ids.has(t.campaign_id)) : alive), [alive, lens])
  const onChannel = useMemo(
    () => (chosen.length ? inLens.filter((t) => (t.channels || []).some((c) => chosen.includes(c))) : inLens),
    [inLens, chosen])
  const shown = useMemo(
    () => (isOn(filter) ? onChannel.filter((t) => matches(t, filter, mode)) : onChannel),
    [onChannel, filter, mode])

  // The rails' numbers: what each press would leave on the grid, so a channel
  // with nothing in it says 0 before it is pressed. Each facet is counted with
  // the other two applied and itself left open — the usual way, and the only
  // one where the numbers add up to what is drawn.
  const plotted = useCallback((t) => !!t[M.dateField], [M])
  const chanCount = useMemo(() => {
    const n = {}
    for (const t of inLens) {
      if (!plotted(t) || !matches(t, filter, mode)) continue
      for (const c of t.channels || []) n[c] = (n[c] || 0) + 1
    }
    n[''] = inLens.filter((t) => plotted(t) && matches(t, filter, mode)).length
    return n
  }, [inLens, filter, mode, plotted])
  const stageCount = useMemo(() => {
    const n = {}
    for (const t of onChannel) if (plotted(t) && matchesPerson(t, filter.person, mode)) n[t.status_id] = (n[t.status_id] || 0) + 1
    return n
  }, [onChannel, filter.person, mode, plotted])
  // Whose work the view can be narrowed to: the crew with this view's hat
  // (who films on Recordings; who edits or designs on the Master Calendar),
  // plus anybody sitting in that seat on the work on screen, plus yourself.
  const people = useMemo(() => {
    const seen = new Map()
    const add = (id, n) => { if (!seen.has(id)) seen.set(id, 0); if (n) seen.set(id, seen.get(id) + 1) }
    for (const u of team) if ((u.crew_roles || []).some((h) => HATS[mode].includes(h))) add(u.id, 0)
    for (const t of onChannel) {
      const counts = plotted(t) && matchesStages(t, filter.stages)
      for (const id of seatedOf(t, mode)) add(id, counts ? 1 : 0)
    }
    if (filter.person && filter.person !== String(user.id)) add(Number(filter.person), 0)
    const rows = [...seen.entries()].filter(([id]) => id !== user.id)
      .map(([id, n]) => ({ id, n, name: teamById[id]?.name || `#${id}` }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    const me = seen.has(user.id) || M.master ? [{ id: user.id, n: seen.get(user.id) || 0, name: user.name, mine: true }] : []
    return [...me, ...rows]
  }, [team, onChannel, filter.stages, filter.person, mode, plotted, teamById, user, M])
  const fullTeam = useMemo(() => Object.fromEntries(team.map((u) => [u.id, u])), [team])

  const byWhen = useCallback(
    (a, b) => (a[M.dateField] + (a[M.timeField] || '')).localeCompare(b[M.dateField] + (b[M.timeField] || '')),
    [M])
  // What this page is about: work carrying a date on THIS field. A shoot with
  // no release day set is not "an unscheduled release" — it is a shoot, and it
  // belongs to the other page. Offering the two calendars each other's undated
  // work read as a backlog nobody asked for: every release-only video piled
  // into Recordings, and every shoot into Releases. The channel pages keep the
  // unscheduled tray, where it is scoped to one channel and means something.
  const dated = useMemo(() => shown.filter((t) => t[M.dateField]), [shown, M])
  // The strip shows the nearest handful. It used to show every overdue piece
  // the board had ever accumulated — fifty chips going back a month, which is
  // not a strip, it is a backlog, and dragging them back one at a time was the
  // wrong person doing the wrong job. The rest are on their owners' My Day.
  const [allLate, setAllLate] = useState(false)
  const phone = useIsPhone()
  const [lateOpen, setLateOpen] = useState(false)
  // Only Releases carries the strip. A shoot day that has passed is not a
  // decision waiting to be made — the day happened or it did not, and the
  // piece has moved on down the pipeline either way; the strip on Recordings
  // was a list of dates in the past asking to be dragged into the future.
  // What actually matters about a late shoot — that the work behind it is
  // running late — is on the owner's My Day and in the statistics.
  const late = useMemo(
    () => (M.dateField === 'recording_date' ? [] : dated.filter((t) => {
      if (t.done_at || t[M.dateField] >= today) return false
      return true
    }).sort(byWhen)),
    [dated, today, byWhen, M])
  // How many of those were planned for an earlier month (lib/planMonth.js).
  const carriedLate = late.filter((t) => isCarried(t, today)).length

  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    rewardIfFinished(item, c)
    setItems((prev) => prev.map((x) => (x.id === item.id ? c : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setItems((prev) => prev.filter((x) => x.id !== item.id))
  }
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setItems((prev) => [c, ...prev])
    return c
  }

  // Moving one day should cost one gesture — a drag across the grid. The pill
  // jumps immediately and goes back where it was if the server refuses. A drop
  // is easy to misjudge by a column, so the confirmation carries the way back:
  // the server's own ten-second undo only photographs stage moves, and this is
  // the client putting a date it already knows straight back.
  const canMove = can(user, 'move_tasks')
  // An idea is a thought nobody has promised anything about, so anybody who
  // can see it may move its day — no move_tasks, no asking an admin. The
  // server has said so since the idea carve-out went in (content.js,
  // `wasAnIdea`) and the kanban agrees; the calendar was the last surface
  // where an idea would not budge, which reads as the board being broken
  // rather than as a rule.
  const ideaIds = useMemo(() => {
    const rank = stageRankOf(statuses)
    return new Set(statuses.filter((st) => rank(st.id) === 'idea').map((st) => st.id))
  }, [statuses])
  // On a phone the master calendar is for looking: planning a month by
  // dragging is a desk job, and a finger resting on a card should scroll,
  // not reschedule it. A phone on its side counts (LOOK_ONLY_Q, up top): it
  // is a desk's width and still a finger. The listener is this page's own
  // rather than usePhone's, because that hook answers the kanban's question
  // (is this the one-column shape?) and the channel boards lean on it as it
  // is. It carries the same two courtesies, though: Safari before 14 has
  // addListener and not addEventListener, and a rotation between the first
  // paint and the effect is caught by asking again on mount.
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function' && window.matchMedia(LOOK_ONLY_Q).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(LOOK_ONLY_Q)
    const on = () => setNarrow(mq.matches)
    on()
    if (mq.addEventListener) mq.addEventListener('change', on)
    else mq.addListener(on)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on)
      else mq.removeListener(on)
    }
  }, [])
  const viewOnly = !!M.master && narrow
  // Whose card is it to move? The server answers that (canTouch in
  // content.js: an admin whose writ covers one of its channels, anybody on one
  // of its channels, and whoever's name is on it), and every channel is on
  // this page for everybody to SEE — so a card that lifts only to bounce off
  // "not your channel" read as the calendar being broken. The lift asks the
  // same question first. If the two ever drift the server still refuses and
  // the card goes back, so the worst case is the old one, not a new one.
  const mine = useCallback((t) => {
    const chans = t.channels || []
    const runs = user.admin_channels || []
    if (user.role === 'admin' && (!runs.length || chans.some((c) => runs.includes(c)))) return true
    return chans.some((c) => (user.departments || []).includes(c))
      || assigneesOf(t).includes(user.id)
      || [t.operator_id, t.editor_id, t.designer_id].includes(user.id)
  }, [user])
  // On the master calendar a day moves for whoever may move tasks, as the
  // spec for it says — on work that is theirs to touch; the Recordings
  // calendar keeps the idea carve-out — on its own work too: the idea rule is
  // about the stage, not a pass onto somebody else's channel. A promised day
  // the server still says no to (it is an admin's to move) is answered with
  // the ask, below.
  const mayMoveDay = useCallback(
    (t) => !viewOnly && (M.master ? canMove && mine(t) : canMove || ideaIds.has(t.status_id)) && mine(t), [canMove, ideaIds, viewOnly, M, mine])
  const manageContent = can(user, 'manage_content')
  const setDay = async (t, field, iso, force = false) => {
    const before = t[field] || null
    if ((iso || null) === before) return
    // The three dates are a chain: shoot, then cut, then out. The task form
    // has always known this — moving the shoot past the cut leaves the cut due
    // before the footage exists, a promise nobody can keep — and it cascades
    // the days after it, keeping the gaps the plan had.
    //
    // The CALENDAR did not. It sent the one day it was given, so a card
    // dragged four days to the right left its cut stranded in the past, and
    // the board showed a plan it would refuse if you typed it into the form.
    // Same rule, enforced on one path and forgotten on its neighbour. It uses
    // the form's own helper now, so there is one implementation of the chain
    // rather than two that can drift, and it says what it moved — a deadline
    // that shifts under somebody in silence is worse than one that does not
    // shift at all.
    const { moved: pushed } = cascadeDates(t, field, iso)
    // A release pulled EARLIER than the cut or artwork it waits on brings
    // those days back with it, keeping their gap where it can and due today
    // where it cannot — or, when no day would do (the release itself in the
    // past with work still owed, or before the shoot), is not made at all.
    // Work already handed in stays where it was met (pullBackDates says why).
    const back = field === 'release_date' ? pullBackDates(t, iso, today) : { moved: [], problem: null }
    if (back.problem) {
      const why = back.problem.why
      toast(why === 'shoot'
        ? tx('Moving it to {day} would put the edit before the shoot — move the shoot first', { day: plainDay(iso) })
        : why === 'release'
          ? tx('Moving it to {day} would put the release before the shoot — move the shoot first', { day: plainDay(iso) })
          : tx('Moving it to {day} would put {what} in the past', { day: plainDay(iso), what: tx(LABELS[back.problem.key]) }), 'err')
      return
    }
    const moved = [...pushed, ...back.moved]
    const payload = { [field]: iso }
    for (const m of moved) payload[m.field || m.key] = m.to
    // What every touched day was, kept out here because both the undo button
    // and the failure path put it back.
    const wasBefore = { [field]: before }
    for (const m of moved) wasBefore[m.field || m.key] = m.from
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...payload } : x)))
    try {
      const c = await api.patch(`/content/${t.id}`, force ? { ...payload, force: true } : payload)
      setItems((prev) => prev.map((x) => (x.id === t.id ? c : x)))
      // An undo puts back everything the move touched, not just the day that
      // was dragged: a cascade that could not be undone whole would be a
      // button that half works.
      const undoAll = async () => {
        setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...wasBefore } : x)))
        try {
          const r = await api.patch(`/content/${t.id}`, wasBefore)
          setItems((prev) => prev.map((x) => (x.id === t.id ? r : x)))
          toast(tx('{title} · back to {day}', { title: t.title, day: before ? dateLabel(before) : tx('no day') }))
        } catch (e2) {
          // The undo was refused, so the move stands — and the card shows
          // the day the server kept, not the one it was just asked for.
          setItems((prev) => prev.map((x) => (x.id === t.id ? c : x)))
          toast(tx(e2.message), 'err')
        }
      }
      const undo = { label: tx('Undo'), onClick: undoAll }
      if (moved.length) {
        toast(tx('{what} moved with it — {days}', {
          what: moved.map((m) => tx(LABELS[m.key])).join(tx(' and ')),
          days: moved.map((m) => dateLabel(m.to)).join(', '),
        }))
      }
      toast(iso ? `${t.title} → ${dateLabel(iso)}` : tx('{title} · taken off the calendar', { title: t.title }), 'ok', undo)
    } catch (e) {
      // Put back every day the optimistic update touched, not only the one
      // that was dragged — a half-rolled-back cascade leaves the board
      // showing a plan the server rejected.
      setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...wasBefore } : x)))
      if (askClash(e, () => setDay(t, field, iso, true))) return
      // A promised day is an admin's to move, and the refusal says so. On its
      // own that is a dead end with a red toast on it; the task window already
      // turns the same refusal into the ask ("Ask an admin to move…", with a
      // reason), so the toast carries the way there. The ask is for the day
      // that was DRAGGED: pulling a release earlier sends its cut along, and
      // the server names whichever locked day it met first — usually that cut,
      // which is not what anybody asked to move.
      const ask = e.status === 403 && e.data?.ask_to_move
        ? { label: tx('Ask to move'), onClick: () => { setAskFor({ id: t.id, field, to: iso || '' }); setOpenItem(t) } }
        : null
      toast(tx(e.message), 'err', ask)
    }
  }
  const moveDate = (t, field, iso) => setDay(t, field, iso)

  // ---- Bulk Actions ----
  // Shift-, ctrl- or ⌘-click cards to pick them (or Space on one, from the
  // keyboard); the bar at the bottom moves them all to a stage through one
  // window (BulkMove), which asks for whatever each one still needs. Esc lets
  // go of the lot.
  //
  // Moving a stack is moving tasks, so it is move_tasks' — the same right the
  // drag asks for. Offered on manage_content as well, it opened the bar to
  // people the server then refused on every row past Idea, each one a red
  // "open the task to fix it" that no task window could fix.
  const mayBulk = !!M.master && !viewOnly && canMove
  const [picked, setPicked] = useState(() => new Set())
  const [bulkStage, setBulkStage] = useState(null)
  const togglePick = useCallback((t) => setPicked((cur) => {
    const next = new Set(cur)
    if (next.has(t.id)) next.delete(t.id); else next.add(t.id)
    return next
  }), [])
  // A pick lives on the Master Calendar at a desk. The router hands
  // /recordings this very page (App.jsx gives both routes a Schedule,
  // unkeyed), and a window narrowed to a phone only looks — either way the
  // picks are let go and the bulk window shut, or the bar rides along to a
  // page that cannot show what it holds and still moves it.
  useEffect(() => {
    if (mayBulk) return
    setPicked((cur) => (cur.size ? new Set() : cur))
    setBulkStage(null)
  }, [mayBulk])
  // Escape shuts the innermost thing: with a task window or a day open it is
  // that window's Escape, not the picks'. (The bulk window's own Escape is its
  // own too.) The task window's "Open the task to fix it" is exactly the
  // fill-it-then-move path, and closing it used to drop the whole selection.
  useEffect(() => {
    if (!picked.size) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !bulkStage && !openItem && !selectedDate) setPicked(new Set()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked.size, bulkStage, openItem, selectedDate])
  // Built from the living: a picked card killed in the meantime has left the
  // grid, and moving it on would bring it back from the dead.
  const pickedItems = useMemo(() => alive.filter((t) => picked.has(t.id)), [alive, picked])
  const stageList = useMemo(() => [...statuses].sort((a, b) => (a.sort - b.sort) || (a.id - b.id))
    .filter((st) => !isDeletedLabel(st.label)), [statuses])
  const channelsOf = useCallback((t) => (t.channels || []).map((k) => byKey[k]?.label || k).join(' · '), [byKey])

  // What you can see is what you get. The calendar owns where it is parked, so
  // it reports its span up here (onRange, declared at the top with the load);
  // the export carries that span plus the late strip, which is on screen too.
  const exportRows = useMemo(() => {
    const inSpan = span
      ? dated.filter((t) => t[M.dateField] >= span.from && t[M.dateField] <= span.to)
      : dated
    const seen = new Set(inSpan.map((t) => t.id))
    return [...inSpan, ...late.filter((t) => !seen.has(t.id))].sort(byWhen)
  }, [dated, late, span, byWhen, M])

  const exportCsv = () => {
    if (exportRows.length === 0) { toast(tx('Nothing to export yet'), 'err'); return }
    saveText(`${M.file}-${today}.csv`, csvOf(exportRows.map((t) => [
      t[M.dateField], t[M.timeField] || '', t.title, typeInfo(t.type).label,
      (t.channels || []).map((c) => byKey[c]?.label || c).join(' / '),
      statusesById[t.status_id]?.label || '',
      teamById[t.operator_id]?.name || '',
      teamById[t.editor_id]?.name || '',
      teamById[t.designer_id]?.name || '',
      assigneesOf(t).map((id) => teamById[id]?.name || `#${id}`).join(' / '),
    ])), 'text/csv;charset=utf-8')
    toast(tx('Saved as a spreadsheet: {n}', { n: exportRows.length }))
  }

  // Through a lens the grid opens on the campaign's own weeks — its next card
  // to come, or its last when it is all behind us — rather than on this month,
  // where a campaign planned for November is an empty grid you then have to
  // page through to find. Worked out ONCE per lens, the first time it has a
  // dated card to go on (a project's cards arrive with /campaigns), so a
  // drag or the ten-second refresh never pulls the month out from under
  // somebody who has paged away from it.
  const [lensStart, setLensStart] = useState(null) // { key, day }
  useEffect(() => {
    if (!lensKey || lensStart?.key === lensKey || !lens || !dated.length) return
    const days = dated.map((t) => t[M.dateField]).sort()
    setLensStart({ key: lensKey, day: days.find((d) => d >= today) || days[days.length - 1] })
  }, [lensKey, lens, dated, today, M, lensStart])

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const Icon = M.icon
  const channelList = Object.values(byKey)
  // A new task needs a channel to live on, and this page shows all of them at
  // once — so "+ on a day" is only offered once one channel is chosen. Guessing
  // would file somebody's shoot under the wrong account. Under a campaign lens
  // the new card joins that campaign, the way the campaign page's own "New
  // card" does — untagged, the lens hid it the moment it was made. And not on
  // a phone, where this page only looks: the week's "+" is invisible under a
  // finger there and still a 40px target beside every day.
  // …and only on a channel that is this person's to file under: POST refuses
  // "Not your channel" after the whole form has been filled in.
  // …or, with every channel on screen, the builder asks where first (23 Oct
  // 2026): the day pressed is the day the piece is born on.
  const addAt = manageContent && !viewOnly && (!channel || mine({ channels: [channel] }))
    ? (iso) => {
      setNewDefaults({ ...(channel ? { channels: [channel] } : {}), [M.dateField]: iso, ...(campaignId ? { campaign_id: campaignId } : {}) })
      setOpenItem('new')
    }
    : undefined
  // Cards and the day sheet name their channel when more than one is on
  // screen: a mixed month of Instagram Main and Telegram otherwise reads as
  // one channel's month.
  const namesChannels = M.master && chosen.length !== 1 ? channelsOf : null
  // Work in this view with no day on the grid's field. It is not plotted —
  // a calendar plots days — but it is not nothing either: a campaign whose
  // cards have no release day yet looked simply empty. So it is counted.
  const undated = shown.length - dated.length

  return (
    <>
      {clashUi}
      {/* On a phone the top bar already names the page, so the heading, its
          line and the CSV give their room to the week (r11). */}
      {/* One frame (the owner, 22 Oct 2026): the two calendars are two buttons
          at the top, the channels are a rail on the left, the stages a rail on
          the right, and a name is pressed where it is seen. No filter button,
          no menus, nothing stacked above the grid but the late line. */}
      <div className={'card sch-frame' + (phone ? ' sch-phone' : '')}>
        <div className="sch-top">
          {/* Shooting / Releasing, and Mine for whoever holds a seat (N-01). */}
          <CalendarViews active={M.master ? 'release' : 'recording'} go={go} />
          {!phone && <span className="sch-lead">{M.lead}</span>}
          {!phone && <PageGuide page={M.master ? 'calendar' : 'schedule'} statusesById={statusesById} />}
          {/* The lens is the reason most of the month is empty, so it is said. */}
          {M.master && lens && (
            <span className="mcal-lens">
              <span className="mcal-lens-label" title={lens.label}>{lens.label}</span>
              <button type="button" className="icon-btn" onClick={dropLens} aria-label={tx('Show everything')} data-tip={tx('Show everything')}><X size={13} /></button>
            </span>
          )}
          <span className="spacer" />
          {!phone && (
            <button className="btn btn-sm sch-export" onClick={exportCsv} data-tip={tx("Download exactly what is shown")}>
              <Download size={13} /> CSV
            </button>
          )}
        </div>

        {/* Late work is the only part of a schedule that needs deciding about
            today, and a calendar parked on this month would leave it behind in
            the last one. So it is one line under the top, wherever you have
            navigated to — press to open it, or put it on today in one press. */}
        {/* On a phone the late work is one chip until it is pressed: nine late
            rows above the week pushed the week off the screen (r11). */}
        {late.length > 0 && !selectedDate && phone && !lateOpen && (
          <button type="button" className="sch-late-chip" onClick={() => setLateOpen(true)} aria-expanded="false">
            <AlertCircle size={13} aria-hidden="true" /> {tx('{n} late', { n: late.length })}
          </button>
        )}
        {late.length > 0 && !selectedDate && (!phone || lateOpen) && (
          <div className={'sch-late' + (late.length > LATE_SHOWN && !allLate ? ' shut' : '')}>
            <span className="sch-late-label">
              {phone && <button type="button" className="qbtn" onClick={() => setLateOpen(false)}>{tx('Hide')}</button>}
              <AlertCircle size={13} aria-hidden="true" /> {tx('Overdue')}<b> · {late.length}</b>
              {carriedLate > 0 && <span className="sch-carried">{tx('{n} carried over from {month}', { n: carriedLate, month: monthLongOf(carriedFrom(late, todayISO())) })}</span>}
              {late.length > LATE_SHOWN && (
                <button type="button" className="qbtn" onClick={() => setAllLate((v) => !v)}>
                  {allLate ? tx('Show fewer') : `${tx('Show all')} · ${late.length}`}
                </button>
              )}
            </span>
            <div className="cal-tray-items">
              {(allLate ? late : late.slice(0, LATE_SHOWN)).map((t) => {
                const st = statusesById[t.status_id]
                return (
                  <div
                    key={t.id}
                    className={'cal-tray-chip late-chip' + (isCarried(t, today) ? ' late-chip-carried' : '')}
                    style={st ? { borderLeftColor: st.color } : undefined}
                    onClick={() => setOpenItem(t)}
                    title={`${t.title} — ${tx('due {day}', { day: dateLabel(t[M.dateField]) })}`}
                  >
                    <span className="late-when">{dateLabel(t[M.dateField])}</span>
                    <span className="ev-txt">{t.title}</span>
                    {/* "Today" is a reschedule, so it asks what a drag asks —
                        and a phone on the Master Calendar only looks. */}
                    {(M.master ? mayMoveDay(t) : canMove) && !viewOnly && (
                      <span className="tray-quick">
                        <button type="button" className="qbtn" data-tip={tx("Move to today")}
                          onClick={(e) => { e.stopPropagation(); setDay(t, M.dateField, today, false) }}>{tx("Today")}</button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="sch-body">
          {/* Left: the channels, then whose work. One press each; the press
              again lets go. Several channels at once still come from the
              address (a campaign's lens). */}
          <aside className="sch-rail sch-rail-l" aria-label={tx('Channels')}>
            <div className="sch-group">
            <div className="sch-rail-h">{tx('Channels')}</div>
            <button type="button" className={'sch-opt' + (!chosen.length ? ' active' : '')} aria-pressed={!chosen.length} onClick={() => setChosen([])}>
              <span className="sch-txt">{tx('All channels')}</span><span className="sch-n">{chanCount[''] || 0}</span>
            </button>
            {channelList.map((c) => (
              <button key={c.key} type="button" className={'sch-opt' + (chosen.includes(c.key) ? ' active' : '')} aria-pressed={chosen.includes(c.key)}
                onClick={() => setChosen(chosen.length === 1 && chosen[0] === c.key ? [] : [c.key])}>
                <span className="sch-txt">{c.label}</span><span className="sch-n">{chanCount[c.key] || 0}</span>
              </button>
            ))}
            </div>
            <div className="sch-group">
            <div className="sch-rail-h">{M.master ? tx('Who makes it') : tx('Who films')}</div>
            <button type="button" className={'sch-opt' + (!filter.person ? ' active' : '')} aria-pressed={!filter.person} onClick={() => setFilter({ ...filter, person: '' })}>
              <span className="sch-txt">{tx('Everyone')}</span>
            </button>
            {people.map((p) => {
              const u = fullTeam[p.id] || {}
              const on = filter.person === String(p.id)
              return (
                <button key={p.id} type="button" className={'sch-opt sch-person' + (on ? ' active' : '')} aria-pressed={on}
                  onClick={() => setFilter({ ...filter, person: on ? '' : String(p.id) })} title={p.name}>
                  <Avatar name={p.name} color={u.color} src={u.avatar} size="xs" />
                  <span className="sch-txt">{p.mine ? tx('Mine') : p.name.split(' ')[0]}</span><span className="sch-n">{p.n}</span>
                </button>
              )
            })}
            </div>
          </aside>

          <div className="sch-grid">
      {/* The day, whole. On the Master Calendar it is the day's RELEASES —
          the same cards its square on the grid holds, named by channel —
          rather than every shoot and cut day that happens to fall on it. */}
      {selectedDate && (
        <DayAgenda
          date={selectedDate}
          items={shown}
          statusesById={statusesById}
          canEdit={!!addAt}
          onOpen={setOpenItem}
          onAdd={addAt}
          onBack={() => setSelectedDate(null)}
          only={M.master ? 'release' : null}
          channelsOf={namesChannels}
        />
      )}
      {/* The empty card is for a board with nothing dated ANYWHERE. A channel,
          a filter or a lens with nothing in it used to swap the grid for "Nothing
          is scheduled to go out yet" — untrue for everybody else, and it took
          the month, the week and the arrows away with it. Now the grid stays,
          empty where it is empty. */}
      {!alive.some((t) => t[M.dateField]) ? (
        <div className="card card-pad empty">
          <CalendarDays size={28} />
          <div>{M.empty}</div>
        </div>
      ) : (
        <>

        <ContentCalendar
          items={dated}
          mode={mode}
          canMove={mayMoveDay}
          onMoveDate={moveDate}
          onDayClick={setSelectedDate}
          onOpenItem={setOpenItem}
          onAddAt={addAt}
          onRange={onRange}
          statusesById={statusesById}
          selected={mayBulk ? picked : null}
          onToggleSelect={mayBulk ? togglePick : null}
          channelsOf={namesChannels}
          localized={!!M.master}
          start={lens && lensStart?.key === lensKey ? lensStart.day : null}
        />
        {M.master && undated > 0 && <p className="stat-sub mcal-undated">{tx('Still without a release day: {n}', { n: undated })}</p>}
        {mayBulk && !pickedItems.length && <p className="stat-sub mcal-hint">{tx('Shift-click cards (or press Space on one) to pick several, then move them to a stage together.')}</p>}
        </>
      )}
          </div>

          {/* Right: the stages. Several at once — Idea and Editing together is
              "what is still being made". */}
          <aside className="sch-rail sch-rail-r" aria-label={tx('Stages')}>
            <div className="sch-group">
            <div className="sch-rail-h">{tx('Stages')}</div>
            {stageList.map((st) => {
              const on = filter.stages.includes(String(st.id))
              return (
                <button key={st.id} type="button" className={'sch-opt' + (on ? ' active' : '')} aria-pressed={on} onClick={() => toggleStage(st.id)}>
                  {/* The stage as the mark every screen wears for it (round 17):
                      the kind's icon, the stage's own colour as the dot. */}
                  <StageMark status={st} text={false} className="sch-stage" />
                  <span className="sch-txt">{tx(st.label)}</span><span className="sch-n">{stageCount[st.id] || 0}</span>
                </button>
              )
            })}
            {isOn(filter) && (
              <button type="button" className="sch-clear" onClick={() => setFilter({ ...BLANK })}>
                <X size={12} aria-hidden="true" /> {tx('Clear')}
              </button>
            )}
            </div>
          </aside>
        </div>
      </div>

      {/* Said out loud as it changes. Mounted from the start and never taken
          down: a live region inserted already holding its words is one most
          screen readers never announce, so the first pick went unsaid. */}
      <div className="mcal-live" role="status" aria-live="polite">
        {mayBulk && pickedItems.length > 0 ? tx('{n} picked', { n: pickedItems.length }) : ''}
      </div>
      {mayBulk && pickedItems.length > 0 && (
        <div className="bulk-bar" role="region" aria-label={tx('Bulk Actions')}>
          <b>{tx('{n} picked', { n: pickedItems.length })}</b>
          <span className="bulk-sep" aria-hidden="true" />
          <Layers size={15} aria-hidden="true" />
          <span className="bulk-label">{tx('Bulk Actions')}</span>
          <select className="select bulk-stage" value="" aria-label={tx('Move to stage')}
            onChange={(e) => { const st = stageList.find((x) => String(x.id) === e.target.value); if (st) setBulkStage(st) }}>
            <option value="">{tx('Move to stage')}…</option>
            {stageList.map((st) => <option key={st.id} value={st.id}>{tx(st.label)}</option>)}
          </select>
          <button type="button" className="icon-btn" onClick={() => setPicked(new Set())} aria-label={tx('Let go of all')} data-tip={tx('Let go of all')}>
            <X size={16} />
          </button>
        </div>
      )}
      {bulkStage && (
        <BulkMove items={pickedItems} stage={bulkStage} team={team} byKey={byKey} statusesById={statusesById}
          onMoved={(c) => setItems((prev) => prev.map((x) => (x.id === c.id ? c : x)))}
          onOpen={(t) => { setBulkStage(null); setOpenItem(t) }}
          onClose={(done) => { setBulkStage(null); if (done === true) setPicked(new Set()) }} />
      )}

      {openItem && (
        <ContentModal key={openItem?.id || 'new'}
          item={openItem === 'new' ? null : openItem}
          defaults={newDefaults || undefined}
          statuses={statuses}
          askFor={askFor && openItem !== 'new' && askFor.id === openItem.id ? askFor : undefined}
          onClose={(next) => { setOpenItem(next?.id ? next : null); setNewDefaults(null); setAskFor(null) }}
          onCreate={createContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
    </>
  )
}

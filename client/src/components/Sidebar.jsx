import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { Shield, FileQuestion, LogOut, Briefcase, Sun, BarChart3, Clapperboard, UsersRound, ScrollText, Coins, Palette, SlidersHorizontal, GripVertical, Eye, EyeOff, Check, RotateCcw, ChevronUp, ChevronDown, GraduationCap, ChevronRight, Pin, CalendarRange, ClipboardList, UploadCloud, Home, CalendarDays, Plus, Menu, X, Scissors, Volume2, VolumeX, HelpCircle, Settings } from 'lucide-react'
import { LogoLockup } from './Logo.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import LangToggle from './LangToggle.jsx'
import { ChanMark, networkOf, NETWORKS } from './CoachBits.jsx'
import { useChannels, useChannelCounts } from '../lib/channels.jsx'
import { usePages } from '../lib/pages.jsx'
import { iconFor } from '../lib/constants.js'
import { useT, tr as tx } from '../lib/i18n.jsx'
import { BUILD } from '../lib/useAutoUpdate.js'
import { api } from '../lib/api.js'
import { useUploads } from '../lib/uploads.js'
import { useSimpleLook } from '../lib/look.js'
import { soundsOn, setSounds } from '../lib/sound.js'
import { replayTour } from './CoachTour.jsx'

// ---- personal sidebar (this account, this browser) ----
// Every group — the main pages, the channels, the admin's Manage links — can
// be trimmed and rearranged: hide what you don't use, drag (or arrow) the
// rest into your own order. One "Personalize" switch at the bottom governs
// it all. A pure view preference: pages stay reachable by URL, permissions
// and platform pickers never change, and new channels always appear.
// "My Day" is the anchor and can't be hidden.
const PREFS_KEY = (uid) => `satashkent_side2_${uid}`
// Channels, Numbers and People start folded. Work is the day; the rest is
// a door you open when you need it, and a pin for the ones you need daily.
// v3 is the version of that default: prefs saved before it get the new
// folding once, and whatever the person opens from then on is theirs.
const DEFAULT_CLOSED = ['channels', 'numbers', 'people']
const PREFS_V = 3
const readLegacy = (k) => {
  try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
function readPrefs(uid) {
  try {
    const o = JSON.parse(localStorage.getItem(PREFS_KEY(uid)) || 'null')
    if (o && typeof o === 'object') {
      const closed = Array.isArray(o.closed) ? o.closed : []
      return {
        order: { main: [], channels: [], manage: [], ...(o.order || {}) },
        hidden: Array.isArray(o.hidden) ? o.hidden : [],
        closed: Number(o.v) >= PREFS_V ? closed : [...new Set([...closed, ...DEFAULT_CLOSED])],
        pinned: Array.isArray(o.pinned) ? o.pinned : [],
        v: PREFS_V,
      }
    }
  } catch { /* fall through */ }
  // First run: adopt the round-19 per-browser channel prefs, if any.
  return {
    order: { main: [], channels: readLegacy('satashkent_side_order'), manage: [] },
    hidden: readLegacy('satashkent_side_hidden'),
    closed: [...DEFAULT_CLOSED],
    pinned: [],
    v: PREFS_V,
  }
}

// The four hubs, in the order a day runs through them: what you are doing,
// where it goes, what happened, who does it. Channels sit second because they
// ARE the work — everything else is a way of looking at them.
const HUBS = [
  { g: 'work', label: () => tx('Work') },
  { g: 'channels', label: (t) => t('nav.channels') },
  { g: 'numbers', label: () => tx('Numbers') },
  { g: 'people', label: () => tx('People') },
]
const HUB_KEYS = HUBS.map((h) => h.g)

export default function Sidebar({ user, onNavigate, onLogout, onGive = null, onFold = null, rail = false, drawer = false }) {
  const { visible } = useChannels()
  const { t } = useT()
  const cls = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '')
  // Uploads is offered once the team's Google Drive is connected, and while
  // files are on their way it says how far they have got — from any page.
  const [driveOn, setDriveOn] = useState(false)
  useEffect(() => { api.cached('/drive/status').then((s) => setDriveOn(!!s?.connected)).catch(() => {}) }, [])
  const upJobs = useUploads().filter((j) => j.state === 'sending')
  const upBadge = upJobs.length
    ? `${Math.floor((upJobs.reduce((n, j) => n + j.sent, 0) / Math.max(1, upJobs.reduce((n, j) => n + j.size, 0))) * 100)}%`
    : ''

  const [prefs, setPrefs] = useState(() => readPrefs(user.id))
  // Two drawings. The Coach look gives everybody one calm sidebar (CoachSide,
  // below): the day, the calendar, the channels by network, Design, Team and
  // one More. The previous look keeps the one this file grew up with — four
  // hubs, pins and Personalize — exactly as it was, and its saved order, pins
  // and hidden pages are only read there.
  const coach = useSimpleLook(user)
  const [editing, setEditing] = useState(false)
  const dragRef = useRef(null) // { group, key }

  const save = (next) => {
    setPrefs(next)
    localStorage.setItem(PREFS_KEY(user.id), JSON.stringify(next))
    localStorage.removeItem('satashkent_side_order')
    localStorage.removeItem('satashkent_side_hidden')
  }
  const hidden = useMemo(() => new Set(prefs.hidden), [prefs])
  // Folding a hub is a customization too, so somebody who has only folded
  // things still gets the way back to the default sidebar.
  const customized = prefs.hidden.length > 0 || (prefs.pinned || []).length > 0
    || (prefs.closed || []).some((g) => !DEFAULT_CLOSED.includes(g)) || DEFAULT_CLOSED.some((g) => !(prefs.closed || []).includes(g))
    || Object.values(prefs.order).some((l) => l.length > 0)

  const { shows } = usePages()
  const isAdmin = user.role === 'admin'
  // The Admin panel is where accounts, channels and the pipeline rules live —
  // the whole board's furniture. A CHANNEL admin runs content on their own
  // channels and would meet a refusal on every tab in there, so they are not
  // shown the door. Post Production and Team stay: both are about the work.
  const runsEverything = isAdmin && !(user.admin_channels || []).length
  // The ambassador programme is a job somebody can hold without running the
  // board — see server/routes/ambassadors.js.
  const runsProgramme = !!(user.permissions && user.permissions.manage_ambassadors)
  // Reads the monthly record of how each person is doing — see
  // server/routes/people.js. A column on the account, not a permission.
  const readsPeople = !!user.superadmin
  // A page the admin switched off in Settings has no door here. Only the ones
  // that ARE switchable are asked; My Day and the channels are the work.
  //
  // Four hubs, not one wall of nine. The old sidebar listed every page an
  // account could reach in a single column, so an admin met eleven doors at
  // once and had to read all of them to find the one they wanted. The doors
  // have not changed — the sorting has:
  //
  //   Work      what you are doing today
  //   Channels  where it goes
  //   Numbers   what happened
  //   People    who does it
  //
  // A hub with nothing in it is not drawn at all — no heading, no empty
  // chevron. An operator does not get a greyed-out People section telling
  // them about a door they cannot open; they get a sidebar that looks like it
  // was built for them.
  const groups = useMemo(() => ({
    work: [
      { key: 'brief', to: '/brief', label: t('nav.brief'), icon: Sun, locked: true },
      driveOn && shows('uploads') && { key: 'uploads', to: '/uploads', label: tx('Uploads'), icon: UploadCloud },
      // Files dropped into the Drive folders that named no task (Drops.jsx).
      driveOn && runsEverything && { key: 'drops', to: '/drops', label: tx('Lost files'), icon: FileQuestion },
      // The Overview is gone (N-07): the daily list it was going to be —
      // overdue, due today, edit ASAP — is the admin's My Day (CoachAdminDay),
      // and its numbers are Numbers → Month (N-02).
      // Every channel at once: what is going out, and what is being filmed.
      shows('releases') && { key: 'releases', to: '/calendar', label: t('nav.releases'), icon: CalendarRange },
      shows('recordings') && { key: 'recordings', to: '/recordings', label: t('nav.recordings'), icon: Clapperboard },
      // The designer's own board, beside the work rather than inside a channel.
      shows('design') && { key: 'design', to: '/design', label: t('nav.design'), icon: Palette },
      // Sprints is in no menu (B-08): the page stays by its address until it
      // retires, with a banner saying when; the backlog's ideas are kept in
      // Settings → Records.
      // A campaign lives inside a project, so /campaigns/7 lights Projects up
      // rather than lighting nothing up.
      //
      // NOT admin-only. Owning a project, or running a campaign in one, opens
      // this page whatever kind of account you are — that is what `shows`
      // already answers (see STAKE in lib/pages.jsx). The extra `isAdmin &&`
      // here outranked it and quietly closed the door again: the phone shell
      // asked `shows` alone and offered the page, the desk asked for an admin
      // and did not, so the same person saw Projects on their phone and not on
      // their laptop.
      shows('projects') && { key: 'projects', to: '/projects', label: t('nav.projects'), icon: Briefcase, also: ['/campaigns'] },
    ].filter(Boolean),
    channels: visible.map((c) => ({ key: `ch:${c.key}`, to: `/dept/${c.key}`, label: c.label, icon: iconFor(c.icon) })),
    numbers: [
      // One page (N-02): the month, who is late, the pay. A member's own pay
      // is under their profile, not a door.
      (isAdmin || shows('missed')) && { key: 'numbers', to: '/numbers', label: tx('Numbers'), icon: BarChart3 },
    ].filter(Boolean),
    people: [
      // Post Production is Team → Workload (N-03).
      // The ambassador programme. Not switchable in Settings on purpose: this
      // is the only page some accounts have, and switching it off would strand
      // them on a board with nothing on it. And it is the one door here that
      // is not an admin's: whoever RUNS the programme gets it, which is the
      // point of the permission — the job without the rest of the board.
      (runsEverything || runsProgramme) && { key: 'ambassadors', to: '/ambassador', label: tx('Ambassadors'), icon: GraduationCap },
      isAdmin && shows('team') && { key: 'team', to: '/team', label: t('nav.team'), icon: UsersRound },
      // The people board: what each month was like, per person. Not an
      // admin's door — a superadmin's, which is a rank an admin does not have
      // until somebody hands it over. Not switchable in Settings either: it
      // is not the team's page to turn off.
      readsPeople && { key: 'people', to: '/people', label: tx('Notes'), icon: ClipboardList },
      ...(runsEverything ? [{ key: 'admin', to: '/admin', label: t('nav.admin'), icon: Shield }] : []),
    ].filter(Boolean),
  }), [isAdmin, runsEverything, runsProgramme, readsPeople, visible, t, shows, driveOn])

  // Which hub holds the page you are on. A deep link drops you INSIDE one —
  // /sprints/backlog, /projects/7, /dept/instagram_main — so the match is on
  // the path's segments, not on string equality, and the hub holding the
  // current page is open whatever your folding preferences say. You cannot
  // fold away the thing you are looking at.
  const loc = useLocation()
  const onPath = (to) => loc.pathname === to || loc.pathname.startsWith(to + '/')
  const isHere = (it) => onPath(it.to) || (it.also || []).some(onPath)
  const hubHere = HUB_KEYS.find((g) => (groups[g] || []).some(isHere)) || null

  // Personal order first; unknown items (new channels) keep their place at
  // the end, visible — nothing is ever born hidden. The old sidebar's three
  // groups were called main/channels/manage; the keys inside them did not
  // change when the hubs did, so an order saved before this is still read and
  // still honoured rather than being silently thrown away.
  const LEGACY = { work: 'main', numbers: 'main', people: 'manage', channels: 'channels' }
  const orderedOf = (g) => {
    const saved = (prefs.order[g] || []).length ? prefs.order[g] : (prefs.order[LEGACY[g]] || [])
    const pos = new Map(saved.map((k, i) => [k, i]))
    return [...groups[g]].sort((a, b) =>
      (pos.has(a.key) ? pos.get(a.key) : 1e9) - (pos.has(b.key) ? pos.get(b.key) : 1e9))
  }
  const closed = useMemo(() => new Set(prefs.closed || []), [prefs])
  // A pin lifts a page out of its hub into a strip at the top, whatever is
  // folded. The page stays in its hub too — the strip is a shortcut, not a
  // move — so folding and counting are untouched.
  const pinned = useMemo(() => new Set(prefs.pinned || []), [prefs])
  const togglePin = (key) => save({
    ...prefs,
    pinned: pinned.has(key) ? (prefs.pinned || []).filter((k) => k !== key) : [...(prefs.pinned || []), key],
  })
  const toggleFold = (g) => save({
    ...prefs,
    closed: closed.has(g) ? (prefs.closed || []).filter((k) => k !== g) : [...(prefs.closed || []), g],
  })
  const toggleHide = (key) => {
    const next = hidden.has(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key]
    save({ ...prefs, hidden: next })
  }
  const saveOrder = (g, keys) => save({ ...prefs, order: { ...prefs.order, [g]: keys } })
  const moveBy = (g, key, dir) => {
    const keys = orderedOf(g).map((x) => x.key)
    const i = keys.indexOf(key)
    const j = i + dir
    if (i < 0 || j < 0 || j >= keys.length) return
    keys.splice(j, 0, keys.splice(i, 1)[0])
    saveOrder(g, keys)
  }
  const onDragOverRow = (g, overKey) => {
    const from = dragRef.current
    if (!from || from.group !== g || from.key === overKey) return
    const keys = orderedOf(g).map((x) => x.key)
    const a = keys.indexOf(from.key)
    const b = keys.indexOf(overKey)
    if (a < 0 || b < 0) return
    keys.splice(b, 0, keys.splice(a, 1)[0])
    saveOrder(g, keys)
  }
  // Everything, including the hubs' own names — a reset that left an order
  // saved under a group name this sidebar no longer draws would look like it
  // had not worked.
  const resetPrefs = () => save({ order: {}, hidden: [], closed: [...DEFAULT_CLOSED], pinned: [], v: PREFS_V })

  const Group = ({ g }) => {
    const items = orderedOf(g)
    if (items.length === 0) return null
    return (
      <>
        {!editing && items.filter((it) => !hidden.has(it.key)).map((it) => {
          const Icon = it.icon
          const on = pinned.has(it.key)
          return (
            <div key={it.key} className={'nav-row' + (isHere(it) ? ' here' : '')}>
              <NavLink to={it.to} className={cls} onClick={onNavigate}>
                <Icon size={18} /> {it.label}
                {it.key === 'uploads' && upBadge && <span className="nav-badge">{upBadge}</span>}
              </NavLink>
              {!it.locked && (
                <button type="button" className={'nav-pin' + (on ? ' on' : '')} onClick={() => togglePin(it.key)}
                  aria-label={on ? tx('Unpin') : tx('Pin this page')} data-tip={on ? tx('Unpin') : tx('Pin this page')} data-tip-left="">
                  <Pin size={12} />
                </button>
              )}
            </div>
          )
        })}
        {editing && items.map((it) => {
          const Icon = it.icon
          const off = hidden.has(it.key)
          return (
            <div
              key={it.key}
              className={`side-edit-row grp-${g}` + (off ? ' off' : '')}
              draggable
              onDragStart={(e) => {
                dragRef.current = { group: g, key: it.key }
                try { e.dataTransfer.setData('text/plain', it.key); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
              }}
              onDragOver={(e) => { e.preventDefault(); onDragOverRow(g, it.key) }}
              onDragEnd={() => { dragRef.current = null }}
            >
              <span className="side-grip"><GripVertical size={13} /></span>
              <Icon size={16} />
              <span className="side-edit-name">{it.label}</span>
              <button className="side-eye" onClick={() => moveBy(g, it.key, -1)} aria-label={tx('Move {name} up', { name: it.label })}>
                <ChevronUp size={13} />
              </button>
              <button className="side-eye" onClick={() => moveBy(g, it.key, +1)} aria-label={tx('Move {name} down', { name: it.label })}>
                <ChevronDown size={13} />
              </button>
              {it.locked ? (
                <span className="side-eye locked" data-tip={tx('My Day is home — it always stays')} data-tip-left=""><Eye size={14} /></span>
              ) : (
                <button
                  className={'side-eye' + (off ? ' off' : '')}
                  onClick={() => toggleHide(it.key)}
                  data-tip={off ? tx('Show in the sidebar') : tx('Hide from the sidebar')}
                  data-tip-left=""
                  aria-label={off ? tx('Show {name}', { name: it.label }) : tx('Hide {name}', { name: it.label })}
                >
                  {off ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          )
        })}
      </>
    )
  }

  if (coach) {
    return <CoachSide user={user} groups={groups} visible={visible} upBadge={upBadge}
      onNavigate={onNavigate} onLogout={onLogout} onGive={onGive} onFold={onFold} rail={rail} drawer={drawer} />
  }

  return (
    <>
      <Link to="/" className="logo-link" onClick={onNavigate} data-tip={t('nav.home')} aria-label={t('nav.home')}>
        <LogoLockup reversed height={32} />
      </Link>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {!editing && (() => {
          const all = HUB_KEYS.flatMap((g) => orderedOf(g))
          const pins = (prefs.pinned || []).map((k) => all.find((it) => it.key === k)).filter((it) => it && !hidden.has(it.key))
          if (!pins.length) return null
          return (
            <div className="nav-pins" aria-label={tx('Pinned')}>
              {pins.map((it) => {
                const Icon = it.icon
                return (
                  <div key={`pin:${it.key}`} className={'nav-row' + (isHere(it) ? ' here' : '')}>
                    <NavLink to={it.to} className={cls} onClick={onNavigate}><Icon size={18} /> {it.label}</NavLink>
                    <button type="button" className="nav-pin on" onClick={() => togglePin(it.key)} aria-label={tx('Unpin')} data-tip={tx('Unpin')} data-tip-left="">
                      <Pin size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })()}
        {HUBS.map(({ g, label }) => {
          // What is actually on screen for THIS person, after their own
          // hiding. A hub everybody's role emptied, or that somebody hid the
          // last item out of, is not drawn at all — a heading over nothing is
          // furniture pretending to be a door. While personalizing, hidden
          // items are still listed, or you could never get them back.
          const items = orderedOf(g)
          const showing = editing ? items : items.filter((it) => !hidden.has(it.key))
          if (showing.length === 0) return null
          const here = g === hubHere
          const open = editing || here || !closed.has(g)
          return (
            <div key={g} className={'nav-hub' + (open ? ' open' : '')}>
              <button
                type="button"
                className="nav-hub-head"
                onClick={() => !here && toggleFold(g)}
                aria-expanded={open}
                // "Channels" is also the name of a tab in the Admin panel, and
                // a control whose whole accessible name is a word another
                // control on the page also answers to is ambiguous to anybody
                // arriving by screen reader or by voice. The visible word is
                // still the word; the name says which of the two this is.
                aria-label={tx('{name} section', { name: label(t) })}
                data-tip={here ? tx('The page you are on lives in here') : undefined}
              >
                <ChevronRight size={12} className="nav-hub-chev" />
                <span>{label(t)}</span>
                {!open && <span className="nav-hub-n">{showing.length}</span>}
              </button>
              {open && <div className="nav-hub-body"><Group g={g} /></div>}
            </div>
          )
        })}

        {/* One quiet switch governs the whole sidebar. */}
        <div className="side-edit-foot">
          {editing && customized && (
            <button className="side-edit-btn" onClick={resetPrefs} data-tip={tx('Back to the default sidebar — everything shown, default order')}>
              <RotateCcw size={12} /> {t('nav.reset')}
            </button>
          )}
          <button className="side-edit-btn" onClick={() => setEditing((e) => !e)}
            aria-label={editing ? tx('Finish personalizing') : tx('Personalize sidebar')}>
            {editing
              ? <><Check size={12} /> {t('nav.donepersonalizing')}</>
              : <><SlidersHorizontal size={12} /> {t('nav.personalize')}{hidden.size > 0 ? ` · ${t('nav.hiddencount', { n: hidden.size })}` : ''}</>}
          </button>
        </div>
      </nav>

      <div className="sidebar-foot">
        <div className="side-user">
          <Link to="/profile" className="side-user-link" onClick={onNavigate} data-tip={t('nav.myprofile')}>
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
            <div className="su-meta">
              <span className="su-name">{user.name}</span>
              <span className="su-role">{user.role}</span>
            </div>
          </Link>
          <LangToggle className="side-logout" />
          <ThemeToggle className="side-logout" />
          <button className="side-logout" onClick={onLogout} data-tip={t('nav.signout')} data-tip-left="" aria-label={t('nav.signout')}>
            <LogOut size={16} />
          </button>
        </div>
        {/* Which build is on screen. "Is the new thing live yet?" should be a
            question you can answer by looking. */}
        <div className="build-stamp" data-tip={tx('Which build this is')}>{BUILD}</div>
      </div>
    </>
  )
}

// ---- the Coach look's sidebar (round 8) ------------------------------------
// Three shells became one. An admin had the ruby sidebar of hubs and pins, a
// content maker a short list, and the crew — and anybody with one channel —
// no sidebar at all, only a bar across the top. The owner chose one calm
// sidebar for everybody: the day, the calendar, the channels sorted by
// network, Design, Team, and one More holding every other page this person
// may open. Which pages those are is still `groups`, above — the same lists
// and the same permissions; this only lays them out.
//
// Folded (`rail`) it is a column of icons with the same counts. On a narrow
// screen it is the drawer (`drawer`) and on a phone the sheet More brings up:
// the same component, never folded there.

// What a person is, in plain words. The account's `role` is the server's word
// ("member", "crew"), not something anybody calls themselves.
const JOBS = { editor: 'Editor', operator: 'Operator', designer: 'Designer' }
export const jobOf = (user) => {
  if (user.role === 'admin') return tx('Admin')
  if (user.role === 'member') return tx('Content maker')
  const jobs = (user.crew_roles || []).length ? user.crew_roles : [user.role]
  return jobs.filter((j) => JOBS[j]).map((j) => tx(JOBS[j])).join(' · ')
}

// The channels by network, in the order the admin keeps them. A channel of no
// network the look knows (one the admin made themselves) stands alone rather
// than being swept into an "other" pile with strangers.
export const byNetwork = (list) => {
  const nets = new Map()
  for (const c of list) {
    const net = networkOf(c)
    const k = NETWORKS[net] ? net : `one:${c.key}`
    nets.set(k, [...(nets.get(k) || []), c])
  }
  return [...nets].map(([net, channels]) => ({ net, channels }))
}
// Under its network a channel is named by what tells it apart: "Instagram
// Main" is "Main" under Instagram. A name the team wrote some other way is
// kept whole.
export const tailOf = (c, net) => {
  const label = String(c.label || '')
  return label.toLowerCase().startsWith(`${net.toLowerCase()} `) ? label.slice(net.length + 1).trim() : ''
}
// ---- the Coach look's sidebar: one list, every door on it (N-06) ----------------------
//
// Round 14 gave the menu a More group and an editor (±, drag handles, the
// phone-bar mock) because an admin had nineteen doors. The TZ of 19 October
// 2026 (section 4.0) takes the doors away instead — one Calendar, one Team,
// one Numbers — so there is nothing left to hide: the menu is one flat list in
// the order a day runs, and the channel list gets the remaining height and
// scrolls only beyond it. With More open on a 900 px screen the channels used
// to shrink to one visible row with their own scrollbar.
//
// The Calendar (N-01), Numbers (N-02) and Team (N-03) are one door each. Settings (the Admin panel) is the gear at the foot beside the
// profile, not a work door. The saved menu of round 14 (`satashkent_menu_*`)
// is no longer read.
function CoachSide({ user, groups, visible, upBadge, onNavigate, onLogout, onGive, onFold, rail, drawer }) {
  const { t } = useT()
  const { pathname } = useLocation()
  const counts = useChannelCounts()
  // The channel list did not come (S-08): the group says so, and offers the
  // next try now, instead of drawing nothing and leaving the person to guess.
  const { failed: chansFailed, retry: retryChans } = useChannels()
  const [sound, setSound] = useState(soundsOn)

  const at = (to) => pathname === to || pathname.startsWith(`${to}/`)
  const here = (it) => (it.end ? pathname === it.to : at(it.to) || (it.also || []).some(at))
  // A channel far down a long list is brought into sight when you land on it.
  // Only beside the page: a drawer or a sheet is closed while you travel.
  const list = useRef(null)
  useEffect(() => {
    if (!drawer) list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [pathname, drawer])

  // The count beside a channel: what is late, in ruby; when nothing is, a
  // quiet number of what is in editing; when neither, nothing. The server
  // counts (see useChannelCounts) — until it has answered there is nothing to
  // draw.
  const sumOf = (list) => list.reduce((a, c) => ({
    late: a.late + (Number(counts?.[c.key]?.late) || 0),
    editing: a.editing + (Number(counts?.[c.key]?.editing) || 0),
  }), { late: 0, editing: 0 })
  const said = (n) => (n.late ? tx('{n} late', { n: n.late }) : n.editing ? tx('{n} in editing', { n: n.editing }) : '')
  const named = (name, n) => (said(n) ? `${name}, ${said(n)}` : name)
  const count = (n) => (n.late
    ? <span className="co-cnt late" title={said(n)}>{n.late}</span>
    : n.editing ? <span className="co-sn-q" title={said(n)}><Scissors size={13} aria-hidden="true" />{n.editing}</span> : null)

  const row = (it, extra = null) => {
    const Icon = it.icon
    const on = here(it)
    return (
      <Link key={it.key} to={it.to} className={'co-sn' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}
        aria-label={it.label} title={rail ? it.label : undefined} onClick={onNavigate}>
        <Icon size={20} aria-hidden="true" /><span className="co-sn-t">{it.label}</span>{extra}
      </Link>
    )
  }
  const chan = (c) => {
    const on = at(`/dept/${c.key}`)
    const n = sumOf([c])
    return (
      <Link key={c.key} to={`/dept/${c.key}`} className={'co-sn' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined}
        aria-label={named(c.label, n)} title={rail ? c.label : undefined} onClick={onNavigate}>
        <ChanMark channel={c} size={rail ? 22 : 20} /><span className="co-sn-t">{c.label}</span>{count(n)}
      </Link>
    )
  }

  const all = [...groups.work, ...groups.numbers, ...groups.people]
  const pick = (key) => all.find((it) => it.key === key)
  // My Day is /brief exactly: its calendar is the next row, not the same one.
  const day = { ...pick('brief'), icon: Home, end: true }
  // One Calendar row (N-01): the crew's is their own month, the Mine view of
  // the calendar frame; everybody else's is the Master Calendar, whose frame
  // holds Shooting and Releasing one press apart (round 15) — so there is no
  // Shoots row, for an admin either.
  const crewSeat = ['editor', 'operator', 'designer', 'crew'].includes(user.role)
  const master = pick('releases') || pick('recordings')
  const cal = crewSeat
    ? { key: 'mycal', to: '/brief/calendar', label: tx('Calendar'), icon: CalendarDays }
    : master && { ...master, label: tx('Calendar'), icon: CalendarDays }
  // Design is for whoever draws, and for an admin; a maker reaches a designer's
  // board through the piece.
  const draws = user.role === 'admin' || user.role === 'designer' || (user.crew_roles || []).includes('designer')
  const design = draws && pick('design')
  // The order a day runs: the day, the calendar, the channels, then who and
  // what — with the interim doors in their successors' places (see above).
  const above = [cal].filter(Boolean)
  const below = [design, pick('team'), pick('numbers'), pick('projects')].filter(Boolean)
  const drawn = new Set(['brief', 'releases', 'recordings', 'design', 'admin', ...below.map((it) => it.key)])
  // Everything else this person may open, in the order the groups keep:
  // Uploads, Unmatched files, Ambassadors, Monthly notes.
  const rest = all.filter((it) => !drawn.has(it.key))
  const settings = pick('admin')

  const foldWord = drawer ? tx('Close the menu') : rail ? tx('Open the menu') : tx('Fold the menu')
  const soundWord = sound ? tx('Sound is on') : tx('Sound is off')
  const tourWord = tx('Replay the tour')
  return (
    <>
      <div className="co-sb-top">
        {/* The brand book's artwork (Logo.jsx), on a neutral ground: ruby mark, near-black type. */}
        <Link to="/" className="logo-link" onClick={onNavigate} title={t('nav.home')} aria-label={t('nav.home')}>
          <LogoLockup height={30} />
        </Link>
        <button type="button" className="co-sb-ib co-sb-fold" onClick={onFold} title={foldWord} aria-label={foldWord}
          aria-expanded={drawer ? undefined : !rail}>
          {drawer ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>
      {/* Whoever may create gets the button (tonal, S-03: ruby is for the one
          step to press, where you are and what is late — not for a door on every
          page); whoever may not keeps its room, so My Day is in the same place
          on every desk. */}
      {onGive ? (
        <button type="button" className="co-btn co-btn-s co-sb-new" onClick={() => { onNavigate(); onGive() }}
          title={rail ? tx('New task') : undefined} aria-label={tx('New task')}>
          <Plus size={20} aria-hidden="true" /><span>{tx('New task')}</span>
        </button>
      ) : <div className="co-sb-gap" />}
      <nav className="co-sb-nav" aria-label={tx('Main')}>
        {/* One list with its own scroll: it takes the height between the
            button and the foot, so nothing is squeezed and nothing is hidden. */}
        <div className="co-sb-list" ref={list}>
          {row(day)}
          {above.map((it) => row(it))}
          {visible.length > 0 && (
            <>
              {!rail && <p className="co-sn-l">{t('nav.channels')}</p>}
              {visible.map(chan)}
            </>
          )}
          {visible.length === 0 && chansFailed && !rail && (
            <>
              <p className="co-sn-l">{t('nav.channels')}</p>
              <p className="co-sn-note" role="status">
                {tx('Channels did not load. Retrying…')}{' '}
                <button type="button" className="co-link" onClick={retryChans}>{tx('Retry now')}</button>
              </p>
            </>
          )}
          {(below.length > 0 || rest.length > 0 || onGive) && <hr className="co-sn-hr" />}
          {below.map((it) => row(it))}
          {rest.map((it) => row(it, it.key === 'uploads' && upBadge ? <span className="nav-badge">{upBadge}</span> : null))}
          {/* r11 · whoever makes pieces chooses what their ten colours mean.
              A row until A-07 moves it under Profile → Appearance. */}
          {onGive && (
            <Link to="/colours" className={'co-sn' + (at('/colours') ? ' on' : '')} aria-current={at('/colours') ? 'page' : undefined}
              aria-label={tx('My colours')} title={rail ? tx('My colours') : undefined} onClick={onNavigate}>
              <Palette size={20} aria-hidden="true" /><span className="co-sn-t">{tx('My colours')}</span>
            </Link>
          )}
        </div>
      </nav>
      <div className="co-sb-foot">
        <Link to="/profile" className={'co-sb-me' + (at('/profile') ? ' on' : '')} onClick={onNavigate}
          title={t('nav.myprofile')} aria-label={`${user.name} — ${t('nav.myprofile')}`}>
          <Avatar name={user.name} color={user.color} src={user.avatar} />
          <span className="co-sb-who"><b>{user.name}</b><small>{jobOf(user)}</small></span>
        </Link>
        <div className="co-sb-set">
          {/* Settings is the Admin panel: the board's furniture, beside the
              person who keeps it — not among the work doors (section 4.0). */}
          {settings && (
            <Link to="/admin" className={'co-sb-ib' + (at('/admin') ? ' on' : '')} aria-current={at('/admin') ? 'page' : undefined}
              title={t('nav.admin')} aria-label={t('nav.admin')} onClick={onNavigate}>
              <Settings size={18} aria-hidden="true" />
            </Link>
          )}
          <button type="button" className="co-sb-ib" onClick={() => { onNavigate(); replayTour() }} title={tourWord} aria-label={tourWord}>
            <HelpCircle size={18} aria-hidden="true" />
          </button>
          <button type="button" className="co-sb-ib" aria-pressed={sound} aria-label={tx('Sound')} title={soundWord}
            onClick={() => { setSounds(!sound); setSound(!sound) }}>
            {sound ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
          </button>
          <ThemeToggle className="co-sb-ib" />
          <LangToggle className="co-sb-ib" />
          <button type="button" className="co-sb-ib" onClick={onLogout} title={t('nav.signout')} aria-label={t('nav.signout')}>
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
        {/* r11 cut 4: the build number is no longer shown under the name. */}
      </div>
    </>
  )
}

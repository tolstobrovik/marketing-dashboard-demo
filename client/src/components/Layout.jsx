import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import GetSetUp from './GetSetUp.jsx'
import { FileQuestion, Menu, Plus, LogOut, Sun, Home, BarChart3, ScrollText, Coins, PanelLeftClose, PanelLeftOpen, Search, Palette, ShieldAlert, LayoutGrid, User, RefreshCw, Clapperboard, Briefcase, GraduationCap, Megaphone, X, CalendarRange, ClipboardList, UploadCloud } from 'lucide-react'
import Sidebar from './Sidebar.jsx'
import MobileTabs, { MoreSheet } from './MobileTabs.jsx'
import NewTask from './NewTask.jsx'
import QuickFind from './QuickFind.jsx'
import CoachTour from './CoachTour.jsx'
import NotificationsBell from './NotificationsBell.jsx'
import Logo from './Logo.jsx'
import { ChanMark } from './CoachBits.jsx'
import Avatar from './Avatar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import LangToggle from './LangToggle.jsx'
import { useT, tr as tx, locale, lang as currentLang } from '../lib/i18n.jsx'
import { usePages } from '../lib/pages.jsx'
import { api } from '../lib/api.js'
import { useUploads } from '../lib/uploads.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { useAutoUpdate, BUILD } from '../lib/useAutoUpdate.js'
import { lastBoardChannel } from '../lib/boardChannel.js'
import { useIsPhone } from '../lib/usePhone.js'
import { useSimpleLook } from '../lib/look.js'
import { useContextMenu } from './ContextMenu.jsx'
import { watchTables } from '../lib/stackTables.js'
import { can, iconFor, todayISO, addDaysISO, fmtDay } from '../lib/constants.js'
import { trackUsage, trackPage } from '../lib/usage.js'
import { startTracking } from '../lib/track.js'

// Signed in with a password that is printed in this repository. The source is
// readable and the dashboard sits on a public URL, so this is the shortest way
// in for anyone who finds it. It follows you across every page — not a toast
// that scrolls away — and it takes one click to fix.
function WeakPasswordBanner({ user }) {
  if (!user?.weak_password) return null
  return (
    <div className="weak-pw" role="alert">
      <ShieldAlert size={16} />
      <span>
        <b>{tx('Your password is the one this app ships with.')}</b>{' '}
        {tx('Anyone who finds the dashboard can sign in as {name}.', { name: user.name })}
      </span>
      <NavLink to="/profile" className="weak-pw-go">{tx('Change it')}</NavLink>
    </div>
  )
}

// A new build is on the server and this tab is still running the old one.
// The auto-update takes it when the tab is next backgrounded; this is for the
// person who is looking right now.
function UpdateReady({ on, take }) {
  if (!on) return null
  return (
    <div className="new-build" role="status">
      <RefreshCw size={15} />
      <span>{tx('A newer version of the board is ready.')}</span>
      <button type="button" className="new-build-go" onClick={take}>{tx('Load it')}</button>
    </div>
  )
}

// A change the team should hear about BEFORE it lands — "the pay page moves
// to Documents on Monday" — written once by an admin in Settings and shown to
// everybody until each person dismisses it. This replaces the daily digest
// that used to push at people whether or not anything had happened; the thing
// worth saying is rarely daily, and a board that speaks every day is one
// people stop reading.
//
// Dismissal is per person and per NOTICE: the id of what was dismissed is
// kept, so a new announcement comes back for everybody, and pressing Save on
// an unrelated setting (same words, same id) does not.
const NOTICE_KEY = (uid) => `satashkent_notice_seen_${uid}`
function PlannedUpdate({ notice, user }) {
  const [seen, setSeen] = useState(() => { try { return Number(localStorage.getItem(NOTICE_KEY(user?.id))) || 0 } catch { return 0 } })
  const [open, setOpen] = useState(false)
  if (!notice?.text) return null
  const dismiss = () => {
    try { localStorage.setItem(NOTICE_KEY(user?.id), String(notice.id)) } catch { /* private mode — it comes back next visit, which is fine */ }
    setSeen(notice.id)
  }
  // r10 (the October survey: "notify users in advance when an update is
  // planned"): the day and hour it lands, one line, what changes on request,
  // and "Got it". It appears `lead` days ahead and goes the day after.
  const today = todayISO()
  const lead = notice.lead || 3
  if (notice.at && (today < addDaysISO(notice.at, -lead) || today > addDaysISO(notice.at, 1))) return null
  const when = notice.at ? fmtDay(notice.at) : null
  const changes = Array.isArray(notice.changes) ? notice.changes : []
  if (seen >= notice.id) {
    return (
      <div className="co-notice-again">
        <Megaphone size={14} aria-hidden="true" />
        <span>{when ? tx('Update on {day}', { day: when }) : tx('Planned update')}</span>
        <button type="button" className="co-link" onClick={() => { try { localStorage.removeItem(NOTICE_KEY(user?.id)) } catch { /* fine */ } setSeen(0) }}>{tx('Show the banner again')}</button>
      </div>
    )
  }
  return (
    <div className="notice-strip co-notice" role="status">
      <Megaphone size={16} aria-hidden="true" />
      <div className="co-notice-body">
        <span><b>{when ? tx('Update on {day}', { day: notice.time ? `${when}, ${notice.time}` : when }) : tx('Planned update')}.</b> {notice.text}</span>
        {open && changes.length > 0 && (
          <div className="co-notice-list">
            <b>{tx('What changes')}</b>
            <ul>{changes.map((c) => <li key={c}>{c}</li>)}</ul>
            <span>{tx('Everything else stays where it is.')}</span>
          </div>
        )}
      </div>
      <span className="co-notice-acts">
        {changes.length > 0 && <button type="button" className="co-btn co-btn-s co-btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? tx('Hide the list') : tx('See what changes')}</button>}
        <button type="button" className="co-btn co-btn-p co-btn-sm" onClick={dismiss}>{tx('Got it')}</button>
      </span>
    </div>
  )
}

// From 821px the sidebar stands beside the page; below that it is a drawer,
// and on a phone a sheet. The stylesheet draws that line, and reading it here
// as well keeps the markup from disagreeing with it (as lib/usePhone.js does
// for the phone).
const DESK_Q = '(min-width: 821px)'
const isDesk = () => typeof window.matchMedia !== 'function' || window.matchMedia(DESK_Q).matches
function useDesk() {
  const [is, setIs] = useState(isDesk)
  useEffect(() => {
    const on = () => setIs(isDesk())
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return is
}

// Giving a task from the shell: one door for both looks (23 Oct 2026, the
// owner: "three different task creation views … make one"). NewTask reads
// the page for the channel and opens the builder (components/builder/).
function GiveTask({ onClose }) {
  return <NewTask onClose={onClose} />
}

export default function Layout() {
  const { user, logout } = useAuth()
  const { visible, byKey } = useChannels()
  const { notice } = usePages()
  const { t } = useT()
  const location = useLocation()
  // The server learns which language this person reads, so the Telegram bot
  // can speak it too. The choice lives in this browser; told once per load
  // when the two differ (a language switch reloads the page, so it lands here).
  useEffect(() => {
    // (Not an ambassador's: their session reaches only /auth and /ambassadors — a 403 on every page.)
    if (user?.id && user.role !== 'ambassador' && user.lang !== currentLang()) api.patch('/users/me', { lang: currentLang() }).catch(() => {})
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  // Ctrl/Cmd-K quick find — reach any task or page from anywhere.
  const [finding, setFinding] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setFinding((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Full-screen mode: tuck the sidebar away and give the page every pixel.
  const [sideOff, setSideOff] = useState(() => localStorage.getItem('satashkent_side_off') === '1')
  const toggleSide = () => {
    setSideOff((v) => {
      try { localStorage.setItem('satashkent_side_off', v ? '' : '1') } catch { /* ok */ }
      return !v
    })
  }
  // Long-lived tabs pick up new deploys on their own when they are put down.
  // Somebody holding a phone and waiting for a change does not put it down,
  // so they are told and handed the button.
  const update = useAutoUpdate()

  // What the board is used for: minutes in front of it, and which buttons get
  // pressed. Counted per person per DAY and never per moment — the admin's
  // Usage tab reads it back. Starts once, with the account.
  useEffect(() => trackUsage(user), [user?.id])
  useEffect(() => startTracking(user), [user?.id])   // where people struggle (round 13)
  useEffect(() => trackPage(location.pathname), [location.pathname])
  useEffect(() => setOpen(false), [location.pathname])

  // ---- the phone shell ----
  // Giving a task used to start with finding the channel that owns it. The
  // raised button in the tab bar starts it from anywhere, in the same form the
  // channel board opens, with the channel filled in from where you were.
  const [giving, setGiving] = useState(false)
  const canGive = can(user, 'manage_content')
  // A route change closes both the More sheet and the drawer; the sheet is a
  // place you leave, not a thing you dismiss.
  useEffect(() => setMore(false), [location.pathname])
  // Tables become stacked cards on a phone, and each cell needs the name of
  // the column it came from. One watcher for the whole app.
  const phone = useIsPhone()
  useEffect(() => (phone ? watchTables() : undefined), [phone])
  const desk = useDesk()

  // The channel's own name is never translated — it is what the team called
  // it, in whichever language they called it.
  let title = ''
  if (location.pathname.startsWith('/admin')) title = t('nav.adminpanel')
  else if (location.pathname.startsWith('/brief/calendar')) title = t('nav.releases')
  else if (location.pathname.startsWith('/brief')) title = t('nav.brief')
  else if (location.pathname.startsWith('/calendar') || location.pathname.startsWith('/releases')) title = t('nav.releases')
  else if (location.pathname.startsWith('/recordings')) title = t('nav.recordings')
  else if (location.pathname.startsWith('/numbers') || location.pathname.startsWith('/missed')) title = tx('Numbers')
  else if (location.pathname.startsWith('/team') || location.pathname.startsWith('/crew')) title = t('nav.team')
  else if (location.pathname.startsWith('/sprints')) title = t('nav.sprints')
  else if (location.pathname.startsWith('/design')) title = t('nav.design')
  else if (location.pathname.startsWith('/uploads')) title = tx('Uploads')
  else if (location.pathname.startsWith('/drops')) title = tx('Lost files')
  else if (location.pathname.startsWith('/ambassador')) title = tx('Ambassadors')
  else if (location.pathname.startsWith('/people')) title = tx('Notes')
  else if (location.pathname.startsWith('/profile')) title = t('nav.myprofilepage')
  else if (location.pathname.startsWith('/projects') || location.pathname.startsWith('/campaigns')) title = t('nav.projectspage')
  else if (location.pathname.startsWith('/dept/')) title = byKey[location.pathname.split('/')[2]]?.label || t('nav.channel')

  // The Coach look (lib/look.js) gives everybody the same sidebar. The previous
  // look keeps its three shells, and this is the third: a member with a single
  // channel doesn't need a sidebar at all — everything fits in the top bar.
  const simple = useSimpleLook(user)
  const oneChannel = user.role !== 'admin' && visible.length <= 1
  const solo = oneChannel && !simple
  // An ambassador has one page and is not staff. No sidebar, no tab bar, no
  // quick find, no bell, no Give a task — none of it would answer them
  // anyway, and a door that opens onto a refusal is worse than no door.
  const ambassador = user.role === 'ambassador'
  const soloChannel = oneChannel ? visible[0] : null
  // On the phone's bar, in the Coach look, a channel wears its network's mark
  // with its star or flag (MobileTabs, `mark`); the previous look keeps its icon.
  const chanMark = (c) => (simple ? <ChanMark channel={c} size={21} /> : undefined)
  const { shows } = usePages()
  // Uploads is a door only once the team's Google Drive is connected.
  const [driveOn, setDriveOn] = useState(false)
  useEffect(() => { if (user.role !== 'ambassador') api.cached('/drive/status').then((s) => setDriveOn(!!s?.connected)).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // …and while files are on their way, how far they have got.
  const upJobs = useUploads().filter((j) => j.state === 'sending')
  const upBadge = upJobs.length
    ? `${Math.floor((upJobs.reduce((n, j) => n + j.sent, 0) / Math.max(1, upJobs.reduce((n, j) => n + j.size, 0))) * 100)}%`
    : ''
  const SoloIcon = soloChannel ? iconFor(soloChannel.icon) : null

  // Four destinations and the action, which is all a phone has room for. A
  // member with one channel gets that channel in the bar — it is their whole
  // job — and everything else moves behind More.
  // The bar has room for two destinations beside My Day and More, and a slot
  // cannot hold a page an admin switched off — so they are taken from what is
  // still there, in the order they matter, and the rest fall into More.
  const CANDIDATES = [
    // Shooting is a button inside the one calendar frame (round 15, N-01), not a slot.
    { key: 'releases', to: '/calendar', label: tx('Calendar'), icon: CalendarRange },
    ...(driveOn ? [{ key: 'uploads', to: '/uploads', label: tx('Uploads'), icon: UploadCloud }] : []),
    // Numbers (N-02) stands under the Statistics switch; a member's pay is in their profile.
    { key: 'missed', to: '/numbers', label: tx('Numbers'), icon: BarChart3 },
    { key: 'design', to: '/design', label: t('nav.design'), icon: Palette },
    { key: 'projects', to: '/projects', label: t('nav.projects'), icon: Briefcase },
  ].filter((c) => shows(c.key))
  // The crew's two slots follow their craft. "In the order they matter" was the
  // planner's order — Releases first — and an editor's bar opened with the one
  // calendar that does not concern them while their pay sat behind More. An
  // operator's page is the shoots; a designer's is the design board; after
  // that, for every crew hat, what the month has paid.
  //
  // The designer is on the list of account kinds as well. Somebody hired as
  // a designer and nothing else still carries that single legacy role (the
  // server reads their hat from it, crewRolesOf in db.js), and leaving the
  // word out handed exactly them the planner's order after all: the Master
  // Calendar first, and the design board, which is their whole job, behind
  // More.
  const crewCaps = ['editor', 'operator', 'designer', 'crew'].includes(user.role) ? (user.crew_roles || []) : null
  if (crewCaps) {
    const first = [crewCaps.includes('editor') && 'uploads', crewCaps.includes('operator') && 'releases', crewCaps.includes('designer') && 'design', 'uploads']
      .filter(Boolean)
    const rank = (c) => { const i = first.indexOf(c.key); return i < 0 ? 100 : i }
    CANDIDATES.sort((a, b) => rank(a) - rank(b))
  }
  // The simple look gives the crew ONE door — their day — and puts every other
  // page behind More. The month's usage is the reason: two thirds of everything
  // an editor, an operator or a designer opened was My Day, and the six links
  // beside it were what a new person had to read past to find it.
  const crewSimple = !!crewCaps && simple
  const navigate = useNavigate()
  const { openMenu } = useContextMenu()
  const soloFirst = !crewSimple && soloChannel
    ? { key: 'ch', to: `/dept/${soloChannel.key}`, label: soloChannel.label, icon: SoloIcon, mark: chanMark(soloChannel) }
    : crewSimple ? null : CANDIDATES[0]
  const soloSecond = crewSimple ? null : CANDIDATES.find((c) => c.key !== soloFirst?.key)
  const soloTabs = [
    { key: 'brief', to: '/brief', label: t('nav.brief'), icon: Sun },
    soloFirst,
    soloSecond,
    { key: 'more', onClick: () => setMore((v) => !v), on: more, label: tx('More'), icon: LayoutGrid },
  ].filter(Boolean)
  // Whoever runs the ambassador programme reaches it from here too. A member
  // with one channel gets this shell instead of a sidebar, so a door that only
  // exists in the sidebar is a door they do not have — and the programme is
  // their whole job, not an extra.
  const runsProgramme = (user.role === 'admin' && !(user.admin_channels || []).length)
    || !!(user.permissions && user.permissions.manage_ambassadors)
  const soloMore = [
    ...CANDIDATES.filter((c) => c.key !== soloFirst?.key && c.key !== soloSecond?.key),
    ...(runsProgramme ? [{ key: 'ambassadors', to: '/ambassador', label: tx('Ambassadors'), icon: GraduationCap }] : []),
    ...(user.superadmin ? [{ key: 'people', to: '/people', label: tx('Notes'), icon: ClipboardList }] : []),
    ...(driveOn && user.role === 'admin' && !(user.admin_channels || []).length ? [{ key: 'drops', to: '/drops', label: tx('Lost files'), icon: FileQuestion }] : []),
    { key: 'profile', to: '/profile', label: t('nav.myprofilepage'), icon: User },
  ]

  if (ambassador) {
    return (
      <div className="main solo amb-shell">
        <header className="topbar solo-bar">
          <span className="logo-link"><Logo size={30} /></span>
          <h1>{tx('Ambassadors')}</h1>
          <div className="topbar-spacer" />
          <ThemeToggle className="icon-btn solo-theme" />
          <LangToggle />
          <button className="icon-btn" onClick={logout} aria-label={tx('Sign out')}><LogOut size={17} /></button>
        </header>
        <main className="content">
          <UpdateReady on={update.ready} take={update.take} />
          {/* r11 cut 1: the planned-update banner no longer sits at the top of every page. */}
          <WeakPasswordBanner user={user} />
          <Outlet />
          {simple && <CoachTour user={user} />}
        </main>
      </div>
    )
  }

  if (solo) {
    return (
      <div className="main solo">
        <header className="topbar solo-bar">
          <Link to="/" className="logo-link" data-tip={t('nav.home')} aria-label={t('nav.home')}>
            <Logo size={30} />
          </Link>
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          <NavLink to="/brief" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
            <Sun size={16} /> {t('nav.brief')}
          </NavLink>
          {crewSimple ? (
            <button type="button" className="solo-link solo-more" aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                openMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 6 }, soloMore.map((l) => ({
                  label: l.label, icon: l.icon, onClick: () => navigate(l.to),
                })))
              }}>
              <LayoutGrid size={16} /> {tx('More')}
            </button>
          ) : (
            <>
            {/* Uploads, second only to the day itself: for an editor it IS the
                hand-over, and this bar is the only menu they have. */}
            {driveOn && shows('uploads') && (
              <NavLink to="/uploads" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <UploadCloud size={16} /> {tx('Uploads')}{upBadge && <span className="nav-badge">{upBadge}</span>}
              </NavLink>
            )}
            {soloChannel && (
              <NavLink to={`/dept/${soloChannel.key}`} className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <SoloIcon size={16} /> {soloChannel.label}
              </NavLink>
            )}
            {/* The Master Calendar, and the Projects story below all over again.
                The sidebar offers it and both phone bars offer it, but a member
                with one channel works in THIS bar on a desk, and this bar lists
                its doors by hand, so on the screen the calendar was planned for
                they had no door to it at all: Quick Find, a bookmark, or the
                button on a campaign. And the head of one channel is exactly who
                the page is for. Their own channel is one press away already;
                what they cannot see from it is everybody else's week. Asked of
                `shows` like its neighbours, so an admin who switches the page
                off or aims it elsewhere takes this door away with the rest. */}
            {shows('releases') && (
              <NavLink to="/calendar" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <CalendarRange size={16} /> {t('nav.releases')}
              </NavLink>
            )}
            {/* The shoots, for the fourth time the same story: the sidebar and
                both phone bars offer Recordings, and this bar, listing its doors
                by hand, never did — so an operator, and the head of one channel
                who books the shoots, had no door to the filming week on a desk. */}
            {shows('recordings') && (
              <NavLink to="/recordings" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <Clapperboard size={16} /> {t('nav.recordings')}
              </NavLink>
            )}
            {shows('missed') && (
              <NavLink to="/numbers" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <BarChart3 size={16} /> {tx('Numbers')}
              </NavLink>
            )}
            {shows('design') && (
              <NavLink to="/design" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <Palette size={16} /> {t('nav.design')}
              </NavLink>
            )}
            {/* Sprints is in no menu (B-08); it stays by its address until it retires. */}
            {/* And Projects, for the third time the same story — this one cost
                somebody three projects they owned and could not open.

                A member with one channel gets THIS bar rather than a sidebar,
                and this bar listed its doors by hand. Projects was never among
                them, so `shows('projects')` — which has known since the stake
                landed that owning a project opens the page whatever your role
                is — had nothing to open. The phone offered it, the sidebar
                offered it, and the one shell most of the team actually works in
                did not. */}
            {shows('projects') && (
              <NavLink to="/projects" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <Briefcase size={16} /> {t('nav.projects')}
              </NavLink>
            )}
            {/* Same story as Projects, for the same reason: somebody who runs the
                ambassador programme and works on one channel gets this bar
                instead of a sidebar, so a door that only exists in the sidebar
                is a door they do not have — and the programme is their job, not
                an extra. */}
            {runsProgramme && (
              <NavLink to="/ambassador" className={({ isActive }) => 'solo-link' + (isActive ? ' active' : '')}>
                <GraduationCap size={16} /> {tx('Ambassadors')}
              </NavLink>
            )}
            </>
          )}
          <button className="icon-btn" onClick={() => setFinding(true)} data-tip={t('nav.find')} aria-label={t('nav.quickfind')}><Search size={17} /></button>
          <NotificationsBell user={user} />
          {/* Named so a phone can put it away: theme, language, the profile
              and Sign out all live in the More sheet there. */}
          <ThemeToggle className="icon-btn solo-theme" />
          <NavLink to="/profile" className="solo-avatar" data-tip={t('nav.myprofile')} data-tip-left="" aria-label={t('nav.myprofilepage')}>
            <Avatar name={user.name} color={user.color} src={user.avatar} size="sm" />
          </NavLink>
          <button className="icon-btn" onClick={logout} data-tip={tx('Sign out')} data-tip-left="" aria-label={tx('Sign out')}><LogOut size={17} /></button>
        </header>
        <main className="content">
          <UpdateReady on={update.ready} take={update.take} />
          {/* r11 cut 1: the planned-update banner no longer sits at the top of every page. */}
          <GetSetUp />
          <WeakPasswordBanner user={user} />
          <Outlet />
          {simple && <CoachTour user={user} />}
        </main>
        {finding && <QuickFind onClose={() => setFinding(false)} />}
        <MobileTabs tabs={soloTabs} canGive={canGive}
          onNew={() => (canGive ? setGiving(true) : setFinding(true))}
          newLabel={canGive ? tx('Give a task') : tx('Find anything')} />
        <MoreSheet open={more} onClose={() => setMore(false)} links={soloMore}
          foot={<>
            <ThemeToggle />
            <LangToggle />
            <button type="button" className="mob-sheet-out" onClick={logout}><LogOut size={16} /> {tx('Sign out')}</button>
            <span className="build-stamp" title={tx('Which build this is')}>{BUILD}</span>
          </>} />
        {giving && <GiveTask onClose={() => setGiving(false)} />}
      </div>
    )
  }

  // Same two slots, same rule: what is switched off is not offered. (Sprints
  // is no longer a default slot — N-06; it stays a door in the sidebar.)
  const barPicks = [
    { key: 'releases', to: '/calendar', label: tx('Calendar'), icon: CalendarRange },
    { key: 'missed', to: '/numbers', label: tx('Numbers'), icon: BarChart3 },
    { key: 'design', to: '/design', label: t('nav.design'), icon: Palette },
  ].filter((c) => shows(c.key)).slice(0, 2)
  // The simple look, on a phone, for whoever runs channels: their day, their
  // first two channels and More — the same doors their sidebar keeps open.
  const memberSimple = simple && user.role === 'member'
  // Here with one channel or none means the Coach look (the previous one left
  // by the top bar above). The phone keeps the slots that bar's tabs had —
  // the crew's one door, a one-channel member's channel — and More brings up
  // the sidebar, which everybody has now.
  // The Coach look's two slots (N-06, section 4.0 of the TZ): Calendar and
  // the Board for everyone who has channels; Calendar and Design for whoever
  // draws; Calendar alone for the rest of the crew. The crew's calendar is
  // their own (the sidebar's "Calendar" for them, CoachCalendar.jsx). The
  // round-14 menu editor that let a person choose the slots is gone with More.
  const coachSlots = () => {
    const drawsHere = !!crewCaps && (crewCaps.includes('designer') || user.role === 'designer')
    const cal = crewCaps
      ? { key: 'mycal', to: '/brief/calendar', label: tx('Calendar'), icon: CalendarRange }
      : shows('releases') ? { key: 'releases', to: '/calendar', label: tx('Calendar'), icon: CalendarRange } : null
    if (crewCaps) return [cal, drawsHere && shows('design') && { key: 'design', to: '/design', label: t('nav.design'), icon: Palette }].filter(Boolean)
    const board = visible.length ? { key: 'board', to: `/dept/${lastBoardChannel(user.id, visible)}`, label: tx('Board'), icon: LayoutGrid } : null
    return [cal, board].filter(Boolean)
  }
  const defaultSlots = simple
    ? coachSlots()
    : oneChannel
      ? [soloFirst, soloSecond].filter(Boolean)
      : barPicks
  const tabs = [
    { key: 'brief', to: '/brief', label: t('nav.brief'), icon: simple ? Home : Sun },
    ...defaultSlots,
    { key: 'more', onClick: () => setOpen((v) => !v), on: open, label: tx('More'), icon: LayoutGrid },
  ]
  // In the Coach look the sidebar folds to a rail of icons instead of leaving
  // (the same preference, kept under the same key), and only on a desk: as a
  // drawer or a phone's sheet it is always whole.
  const rail = simple && sideOff && desk

  return (
    <div className={'layout' + (simple ? (rail ? ' co-railed' : '') : sideOff ? ' side-off' : '')}>
      <aside className={`sidebar${open ? ' open' : ''}${simple ? ' co-sb' : ''}`}>
        <Sidebar key={user.id} user={user} onNavigate={() => setOpen(false)} onLogout={logout}
          onGive={canGive ? () => setGiving(true) : null} rail={rail} drawer={!desk}
          onFold={desk ? toggleSide : () => setOpen(false)} />
      </aside>
      <div className={`scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen(true)} data-tip={t('nav.menu')} aria-label={t('nav.openmenu')}>
            <Menu size={22} />
          </button>
          {/* The Coach look's fold button is in the sidebar, beside the logo. */}
          {!simple && (
            <button className="side-toggle" onClick={toggleSide}
              data-tip={sideOff ? t('nav.showside') : t('nav.hideside')}
              aria-label={sideOff ? t('nav.showside') : t('nav.hideside')}>
              {sideOff ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
          )}
          <div>
            <h1>{title}</h1>
          </div>
          <span className="topbar-spacer" />
          {/* Giving a task from any page on a desk, as the phone's tab bar
              always could: the same form, with the page's channel in it. */}
          {/* On a channel page the page has its own "New task" in the simple
              look; two buttons for one thing was one to read past. And on a
              desk that look's sidebar carries "New task" on every page, so
              this one is only for the width where the sidebar is a drawer. */}
          {canGive && !(simple && (desk || location.pathname.startsWith('/dept/'))) && (
            <button type="button" className="btn btn-primary btn-sm topbar-give" onClick={() => setGiving(true)}>
              <Plus size={15} /> {simple ? tx('New task') : tx('Give a task')}
            </button>
          )}
          <button className="icon-btn topbar-find" onClick={() => setFinding(true)}
            data-tip={t('nav.find')} data-tip-left="" aria-label={t('nav.quickfind')}>
            <Search size={18} />
          </button>
          <NotificationsBell user={user} />
        </header>
        <main className="content">
          <UpdateReady on={update.ready} take={update.take} />
          {/* r11 cut 1: the planned-update banner no longer sits at the top of every page. */}
          <GetSetUp />
          <WeakPasswordBanner user={user} />
          <Outlet />
          {simple && <CoachTour user={user} />}
        </main>
        {finding && <QuickFind onClose={() => setFinding(false)} />}
        {/* The same four slots for everyone else. More opens the sidebar,
            which on a phone comes up from the bottom as a sheet instead of
            sliding in from the left as a desktop drawer that was never a
            phone thing to begin with. */}
        <MobileTabs tabs={tabs} canGive={canGive}
          onNew={() => (canGive ? setGiving(true) : setFinding(true))}
          newLabel={canGive ? tx('Give a task') : tx('Find anything')} />
        {giving && <GiveTask onClose={() => setGiving(false)} />}
      </div>
    </div>
  )
}

import { lazy, Suspense } from 'react'
import Boom from './components/Boom.jsx'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { usePages } from './lib/pages.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'

// Pages load on demand: the first paint (login / app shell) ships only what
// it needs, and each section's code arrives when it is first opened.
const Department = lazy(() => import('./pages/Department.jsx'))
const Projects = lazy(() => import('./pages/Projects.jsx'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'))
const CampaignDetail = lazy(() => import('./pages/CampaignDetail.jsx'))
const Colours = lazy(() => import('./pages/Colours.jsx'))
const Brief = lazy(() => import('./pages/Brief.jsx'))
const Uploads = lazy(() => import('./pages/Uploads.jsx'))
const Drops = lazy(() => import('./pages/Drops.jsx'))
const Schedule = lazy(() => import('./pages/Schedule.jsx'))
const Team = lazy(() => import('./pages/Team.jsx'))
const Numbers = lazy(() => import('./pages/Numbers.jsx'))
const Design = lazy(() => import('./pages/Design.jsx'))
const Sprints = lazy(() => import('./pages/Sprints.jsx'))
const SprintBacklog = lazy(() => import('./pages/SprintBacklog.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const Ambassadors = lazy(() => import('./pages/Ambassadors.jsx'))
const People = lazy(() => import('./pages/People.jsx'))

const Loading = () => <div className="app-loading"><span className="spinner" /></div>

function Protected({ children, adminOnly = false, page = null, ambassador = false, superadmin = false }) {
  const { user, loading } = useAuth()
  const { shows } = usePages()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  // An ambassador has one address. The server refuses everything else outright
  // — this only stops the browser drawing a page it is about to be refused the
  // data for, and sends them back to the page that is theirs.
  //
  // The check has to let their OWN address through, because the shell they
  // reach it in is wrapped in this same guard: bouncing every path to
  // /ambassador bounced /ambassador too, and the page never drew at all.
  if (user.role === 'ambassador' && !ambassador && location.pathname !== '/ambassador') {
    // A task link (/brief?task=7 — what a notification carries) keeps its
    // task, so it opens that task's brief on their own page.
    const task = new URLSearchParams(location.search).get('task')
    return <Navigate to={task && /^\d+$/.test(task) ? `/ambassador?task=${task}` : '/ambassador'} replace />
  }
  // The programme's page is for the students AND for whoever runs it — which
  // is a job, not a rank: an admin has it by being one, and a member has it
  // when an admin gives it to them. Anybody else lands back on their own work.
  const runsProgramme = (user.role === 'admin' && !(user.admin_channels || []).length)
    || !!(user.permissions && user.permissions.manage_ambassadors)
  if (ambassador && user.role !== 'ambassador' && !runsProgramme) return <Navigate to="/" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />
  // The people board. A rank of its own: an admin is not one unless somebody
  // handed it to them, and the server refuses the data either way — this only
  // stops the browser drawing a page it is about to be refused.
  if (superadmin && !user.superadmin) return <Navigate to="/" replace />
  // A page the admin switched off has no address either. Its own door is gone
  // from the sidebar, so what this catches is a bookmark, a pasted link and a
  // browser's back button — all of which would otherwise land on a page the
  // team has been told they do not have.
  if (page && !shows(page)) return <Navigate to="/" replace />
  return children
}

// Everybody lands on My Day. An admin used to land on the Overview — a page
// that was in nobody's menu since the Coach look, so the first thing an admin
// saw was a screen they could not get back to (round 10); it is gone (N-07).
function HomeRedirect() {
  const { user } = useAuth()
  if (user?.role === 'ambassador') return <Navigate to="/ambassador" replace />
  return <Navigate to="/brief" replace />
}

// Signed in: back to the page the sign-in interrupted — the task link from a
// Telegram message, a bookmark — which Protected wrote down on the way here
// and nothing ever read. Only an address inside the app; anything else, home.
function AfterLogin() {
  const from = useLocation().state?.from
  const path = from?.pathname
  const safe = typeof path === 'string' && /^\/(?![/\\])/.test(path) && path !== '/login'
  return <Navigate to={safe ? `${path}${from.search || ''}${from.hash || ''}` : '/'} replace />
}

// /releases became /calendar; a bookmark carries its channel across.
function ToCalendar() {
  const { search } = useLocation()
  return <Navigate to={`/calendar${search}`} replace />
}

export default function App() {
  const { user } = useAuth()
  return (
    <Boom>
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={user ? <AfterLogin /> : <Login />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<HomeRedirect />} />
          {/* Numbers (N-02): Statistics (/missed), Payment (/docs), Admin →
              Reports, Admin → Pay and the Overview (/overview, gone in N-07)
              are one page with three tabs; which tabs a person has is the
              page's own question. The old addresses land on it — a member's
              Payment is "My pay" under their profile. */}
          <Route path="/numbers" element={<Numbers />} />
          <Route path="/overview" element={<Navigate to="/numbers" replace />} />
          <Route path="/missed" element={<Navigate to="/numbers?tab=people" replace />} />
          <Route path="/docs" element={<Navigate to="/profile#pay" replace />} />
          <Route path="/projects" element={<Protected page="projects"><Projects /></Protected>} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/dept/:key" element={<Department />} />
          <Route path="/brief" element={<Brief />} />
          {/* A content maker's own month — their shoots and releases on one
              grid. The same page as My Day, drawn as a calendar, so the two
              share one load and one task window. */}
          <Route path="/brief/calendar" element={<Brief calendar />} />
          {/* Drop a file, watch it land on Google Drive, play it back. */}
          <Route path="/uploads" element={<Protected page="uploads"><Uploads /></Protected>} />
          {/* Drive drop-in's Unmatched files: an admin of the whole board's (the server says so too). */}
          <Route path="/drops" element={<Protected adminOnly><Drops /></Protected>} />
          {/* The Master Calendar: every channel's releases on one grid. It was
              /releases, and old links and bookmarks still land here. */}
          <Route path="/calendar" element={<Protected page="releases"><Schedule mode="release" /></Protected>} />
          <Route path="/releases" element={<ToCalendar />} />
          <Route path="/recordings" element={<Protected page="recordings"><Schedule mode="recording" /></Protected>} />
          {/* Team (N-03): People, Workload and Access as tabs; Post Production
              (/crew) is the Workload tab and Admin → Team the Access tab. */}
          <Route path="/team" element={<Protected adminOnly page="team"><Team /></Protected>} />
          <Route path="/crew" element={<Navigate to="/team?tab=workload" replace />} />
          {/* The designer's own board — every piece waiting on artwork, with
              its Drive folder, its brief and somewhere to hand the file back. */}
          <Route path="/design" element={<Protected page="design"><Design /></Protected>} />
          <Route path="/sprints" element={<Protected page="sprints"><Sprints /></Protected>} />
          <Route path="/sprints/backlog" element={<Protected page="sprints"><SprintBacklog /></Protected>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/colours" element={<Colours />} />
          <Route path="/ambassador" element={<Protected ambassador><Ambassadors /></Protected>} />
          <Route path="/people" element={<Protected superadmin><People /></Protected>} />
          <Route
            path="/admin"
            element={
              <Protected adminOnly>
                <Admin />
              </Protected>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
      </Boom>
  )
}

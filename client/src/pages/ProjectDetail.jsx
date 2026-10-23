import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Trash2, Target, Hash, CalendarRange } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { usePages } from '../lib/pages.jsx'
import CampaignForm from '../components/CampaignForm.jsx'
import { ProjectForm } from './Projects.jsx'
import { ProjectStatus, StatusReason, PcChecklist, NotesBlock, CampaignRow, NumberTable, CriteriaList } from '../components/ProjectBits.jsx'
import { dateLabel, todayISO } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'

// Project detail — four sections, nothing else: header, campaigns in this
// project, checklist, notes.
export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { byKey } = useChannels()
  const { shows } = usePages()
  const [p, setP] = useState(null)
  const [team, setTeam] = useState([])
  const [metrics, setMetrics] = useState([])
  const [projects, setProjects] = useState([])
  const [err, setErr] = useState('')
  const [campModal, setCampModal] = useState(null)
  const [projModal, setProjModal] = useState(false)

  const canWrite = user.role === 'admin' || (p?.owner_id && p.owner_id === user.id)
  const isAdmin = user.role === 'admin'

  const load = () => Promise.all([
    api.get(`/projects/${id}`), api.get('/users'), api.get('/projects/metrics'), api.get('/projects'),
  ]).then(([proj, us, ms, ps]) => { setP(proj); setTeam(us); setMetrics(ms); setProjects(ps) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live sync: everything on this page follows the rest of the app.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || campModal || projModal) return
      api.pollView(`/projects/${id}`).then((f) => { if (f) setP(f) }).catch(() => {})
    }
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [id, campModal, projModal])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!p) return <div className="app-loading"><span className="spinner" /></div>

  const t = p.tally || { numbers_hit: 0, numbers_total: 0, criteria_done: 0, criteria_total: 0 }

  const patch = async (body) => {
    try { setP({ ...p, ...(await api.patch(`/projects/${p.id}`, body)), campaigns: p.campaigns, notes: p.notes }) }
    catch (e) { alert(e.message) }
  }

  return (
    <>
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate('/projects')}><ArrowLeft size={14} /> {tx('Projects')}</button>

      {/* A. WHAT THIS IS — name, who owns it, what it means, when it is due.
          Everything on this card answers "what am I looking at". The numbers
          and the criteria used to be crammed in here too, under the
          description, where five tiles and a checkbox list read as a wall.
          They are their own boards now. */}
      <div className="card card-pad pc-header">
        {p.photo && <img className="pc-banner" src={p.photo} alt="" />}
        <div className="pc-camp-top">
          <h2 className="pc-title">{p.name}</h2>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ProjectStatus
              status={p.status} reason={p.status_reason} canWrite={canWrite}
              onChange={(status, reason) => patch({ status, status_reason: reason })}
            />
            {isAdmin && (
              <button className="icon-btn" data-tip={tx('Edit project fields')} data-tip-left="" onClick={() => setProjModal(true)} aria-label="Edit">
                <Pencil size={15} />
              </button>
            )}
            {isAdmin && (
              <button className="icon-btn del-btn" data-tip={tx('Delete this project')} data-tip-left=""
                onClick={async () => {
                  if (!confirm(`Delete the project “${p.name}”?\n\nIts campaigns stay but lose the project link; project notes are removed.`)) return
                  try { await api.del(`/projects/${p.id}`); navigate('/projects') } catch (e) { alert(e.message) }
                }} aria-label={tx('Delete project')}>
                <Trash2 size={15} />
              </button>
            )}
          </span>
        </div>
        <StatusReason status={p.status} reason={p.status_reason} />

        {/* Owner and deadline together, because they are the same question
            asked twice: who do I ask, and by when. They were at opposite ends
            of the card with everything else in between. */}
        <div className="pc-facts">
          <span className="pc-fact">
            <span className="pc-fact-key">{tx('Owner')}</span>
            <b>{p.owner_name || <span className="pc-red">{tx('nobody — assign one')}</span>}</b>
          </span>
          {p.deadline && (() => {
            const days = Math.ceil((Date.parse(`${p.deadline}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000)
            const late = days < 0 && p.status !== 'done' && p.status !== 'closed'
            return (
              <span className="pc-fact">
                <span className="pc-fact-key">{late ? 'Was due' : 'Due'}</span>
                <b className={late ? 'late' : ''}>
                  {dateLabel(p.deadline)}
                  <span className="pc-fact-sub">
                    {days > 0 ? ` · ${days} days left` : days === 0 ? ' · today'
                      : p.status === 'done' ? ' · and done' : p.status === 'closed' ? ' · closed' : ' · and still open'}
                  </span>
                </b>
              </span>
            )
          })()}
        </div>

        {p.description && <p className="pc-desc">{p.description}</p>}
      </div>

      {/* B + C. The two things that decide whether this is Done, side by side.
          Stacked, they pushed the campaigns off the bottom of the screen and
          left the right half of a 1200px page empty — five tiles used about a
          quarter of the width and the rest was paper. They only stack on a
          screen too narrow to hold both. */}
      {(p.numbers?.length > 0 || p.criteria?.length > 0 || canWrite) && (
        <div className="pc-split">
          {(p.numbers?.length > 0 || canWrite) && (
            <div className="card card-pad pc-panel">
              <div className="pc-panel-head">
                <h3><Hash size={14} /> {tx('Numbers')}</h3>
                {t.numbers_total > 0 && (
                  <span className={'pc-panel-count' + (t.numbers_hit === t.numbers_total ? ' met' : '')}>
                    {t.numbers_avg != null && <b>{t.numbers_avg}%</b>}
                    {t.numbers_avg != null && ' · '}{t.numbers_hit} of {t.numbers_total} hit
                  </span>
                )}
              </div>
              {p.numbers?.length > 0 ? (
                <NumberTable
                  numbers={p.numbers} team={team} canWrite={canWrite}
                  onChange={(numbers) => patch({ numbers })}
                  // The steps under each number write through routes of their
                  // own — anybody on the team may add and tick one — and every
                  // one of them answers with the whole project, so the page
                  // takes the new state rather than asking for it again.
                  projectId={p.id} onProject={setP}
                />
              ) : (
                <button className="lnk" onClick={() => setProjModal(true)}>{tx('add the numbers this project is counting →')}</button>
              )}
            </div>
          )}

          {(p.criteria?.length > 0 || canWrite) && (
            <div className="card card-pad pc-panel">
              <div className="pc-panel-head">
                <h3><Target size={14} /> {tx('Success criteria')}</h3>
                {t.criteria_total > 0 && (
                  <span className={'pc-panel-count' + (t.criteria_done === t.criteria_total ? ' met' : '')}>
                    <b>{t.criteria_pct}%</b> · {t.criteria_done} of {t.criteria_total} ticked
                  </span>
                )}
              </div>
              {p.criteria?.length > 0
                ? <CriteriaList criteria={p.criteria} canWrite={canWrite}
                    onChange={(criteria) => patch({ criteria })} big />
                : <button className="lnk" onClick={() => setProjModal(true)}>{tx('say what must be true at the end →')}</button>}
              {p.status !== 'done' && p.done_blockers?.length === 0 && (t.numbers_total > 0 || t.criteria_total > 0) && (
                <div className="pc-standing-ok">{tx('Everything is met — this can be marked Done.')}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* B. Campaigns in this project */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>{tx('Campaigns in this project')}</h2>
        <span className="count">· {p.campaigns.length}</span>
        <span className="spacer" />
        {/* Every campaign's cards at once, across their channels, and only
            for somebody the Master Calendar is open to: switched off, or
            aimed at other kinds of account, its route sends them home, and a
            button that lands on the front page says nothing about why. The
            same question the sidebar asks before it offers the page. */}
        {p.campaigns.length > 0 && shows('releases') && (
          <button className="btn btn-sm" onClick={() => navigate(`/calendar?project=${p.id}`)}>
            <CalendarRange size={14} /> {tx('Open in Master Calendar')}
          </button>
        )}
        {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setCampModal('new')}><Plus size={15} /> {tx('New campaign')}</button>}
      </div>
      {p.campaigns.length === 0 ? (
        /* "This project is not moving" was printed in red on a project that
           had met its target and ticked its last box. A project with nothing
           running is only a problem when it is supposed to be running: open,
           started, and not yet where it was going. Anything else — paused,
           closed, finished, not begun — gets the plain sentence. */
        (() => {
          const started = !p.start_date || p.start_date <= todayISO()
          const stalled = !['done', 'closed'].includes(p.status) && started && p.done_blockers?.length > 0
          return stalled
            ? <div className="card card-pad pc-stalled">{tx('Nothing is running on this project, and it has not reached its number yet.')}</div>
            : <div className="card card-pad empty">{tx('No campaigns on this project.')}</div>
        })()
      ) : (
        <div className="pc-camp-list">
          {p.campaigns.map((c) => <CampaignRow key={c.id} c={c} byKey={byKey} onOpen={(x) => navigate(`/campaigns/${x.id}`)} />)}
        </div>
      )}

      {/* C. Checklist */}
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <PcChecklist
          items={p.checklist}
          team={team}
          canTick={canWrite}
          canEditItems={isAdmin}
          onChange={(items) => patch({ checklist: items })}
        />
      </div>

      {/* D. Notes */}
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <NotesBlock
          notes={p.notes}
          onAdd={async (text) => {
            const n = await api.post(`/projects/${p.id}/notes`, { text })
            setP({ ...p, notes: [n, ...p.notes] })
          }}
          onDelete={async (n) => {
            await api.del(`/projects/${p.id}/notes/${n.id}`)
            setP((prev) => ({ ...prev, notes: prev.notes.filter((x) => x.id !== n.id) }))
          }}
          canDelete={(n) => isAdmin || n.author_id === user.id}
        />
      </div>

      {campModal && (
        <CampaignForm
          campaign={campModal === 'new' ? null : campModal}
          projects={projects}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          defaults={{ project_id: p.id }}
          onClose={() => setCampModal(null)}
          onSaved={() => load()}
          onDeleted={() => load()}
        />
      )}
      {projModal && (
        <ProjectForm
          project={p}
          team={team}
          metrics={metrics}
          isAdmin={isAdmin}
          onClose={() => setProjModal(false)}
          onSaved={() => load()}
          onDeleted={() => navigate('/projects')}
        />
      )}
    </>
  )
}

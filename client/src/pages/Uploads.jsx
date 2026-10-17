import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UploadCloud, Check, X, Play, ExternalLink, AlertCircle, Search, FileVideo, HardDrive, RotateCcw, Trash2, History, Replace } from 'lucide-react'
import Modal from '../components/Modal.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { can, dateLabel, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import { startUpload, cancelUpload, clearFinished, useUploads, sizeLabel, speedOf, etaOf } from '../lib/uploads.js'
import { canResume } from '../lib/driveUpload.js'
import { removeDriveFile } from '../components/DriveFiles.jsx'

// ---- Uploads: drop it, watch it land, play it back ----------------------------
//
// One page for the files that are too big for anything else. Drop a cut on
// its task (or on the big box, then say which task) and it goes from this
// browser straight into that task's folder on the team's Google Drive —
// never through this server, whatever its size. The bar says how far it has
// got; the file appears under its task the moment it lands, and it PLAYS
// right here: nobody has to open Drive, find the folder and come back.
//
// Big files are the normal case, not the exception: an upload keeps going
// while you use the rest of the board (lib/uploads.js), and a dropped
// connection — or a closed laptop — is picked up again by dropping the same
// file on the same task (lib/driveUpload.js keeps the session for a week).

const JOB = {
  edit: { label: 'The edit', col: 'ready_link', milestone: 'edited' },
  shoot: { label: 'Footage', col: 'shot_link', milestone: 'shot' },
  design: { label: 'Artwork', col: 'design_link', milestone: 'designed' },
}
const HAT = { edit: 'editor_id', shoot: 'operator_id', design: 'designer_id' }

export default function Uploads() {
  const { user } = useAuth()
  const { byKey } = useChannels()
  const jobs = useUploads()
  const [status, setStatus] = useState(null)
  const [content, setContent] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [files, setFiles] = useState({})
  const [scope, setScope] = useState('mine')
  const [q, setQ] = useState('')
  const [over, setOver] = useState(null)      // the task id (or 'all') a file is being dragged over
  const [loose, setLoose] = useState(null)    // a file dropped on the big box, waiting for its task
  const [preview, setPreview] = useState(null)
  const [view, setView] = useState('tasks')   // tasks | history (r11, the owner)
  const pick = useRef(null)
  const pickFor = useRef(null)
  const planner = user.role === 'admin' || can(user, 'manage_content')
  // Who may delete a file here: the server's rule (routes/drive.js mayRemove),
  // drawn so the button is not offered to somebody it would refuse.
  const mayRemove = (t) => planner || [t.operator_id, t.editor_id, t.designer_id, t.assignee_id].includes(user.id) || (t.assignees || []).includes(user.id)

  const loadStatus = () => api.get('/drive/status').then(setStatus).catch(() => setStatus({ connected: false }))
  useEffect(() => {
    loadStatus()
    api.get('/content').then(setContent).catch(() => setContent([]))
    api.cached('/statuses').then(setStatuses).catch(() => {})
  }, [])

  // ---- which tasks this page is about ----
  const stById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const alive = (t) => {
    const st = stById[t.status_id]
    return !t.done_at && !(st && (st.is_final || isDeletedLabel(st.label)))
  }
  const mineOn = (t) => t.operator_id === user.id || t.editor_id === user.id || t.designer_id === user.id
    || (Array.isArray(t.assignees) ? t.assignees : [t.assignee_id]).includes(user.id)
  const onMyChannels = (t) => user.role === 'admin' || (t.channels || []).some((c) => (user.departments || []).includes(c))
  const tasks = useMemo(() => {
    if (!content) return []
    const needle = q.trim().toLowerCase()
    return content
      .filter((t) => alive(t) && (scope === 'mine' ? mineOn(t) : onMyChannels(t)))
      .filter((t) => !needle || t.title.toLowerCase().includes(needle))
      .sort((a, b) => (a.edit_ready_date || a.release_date || '9999').localeCompare(b.edit_ready_date || b.release_date || '9999'))
      .slice(0, 150)
  }, [content, scope, q, stById]) // eslint-disable-line react-hooks/exhaustive-deps

  // What is already in each task's folder — one look at the Drive for the lot.
  const idsKey = tasks.map((t) => t.id).join(',')
  const loadFiles = useCallback(() => {
    if (!idsKey || !status?.connected) return
    api.get(`/drive/files?tasks=${idsKey}`).then((r) => setFiles(r.files || {})).catch(() => {})
  }, [idsKey, status?.connected])
  useEffect(() => { loadFiles() }, [loadFiles])

  // The job a file on this task is: the seat you hold on it, or — for a
  // planner uploading on somebody's behalf — what the task is waiting for.
  // Somebody who films AND cuts the same piece is offered the footage first,
  // while there is none: asked "editor?" before "operator?", they were only
  // ever offered Cut, and the raw footage went up as the finished cut.
  const kindFor = (t) => (t.operator_id === user.id && !t.shot_at && !t.shot_link ? 'shoot'
    : t.editor_id === user.id ? 'edit' : t.operator_id === user.id ? 'shoot' : t.designer_id === user.id ? 'design'
    : t.type === 'post' ? 'design' : t.shot_link ? 'edit' : 'shoot')

  const send = (t, file) => {
    if (!file) return
    const kind = kindFor(t)
    startUpload({
      task: t, kind, file,
      onDone: (out) => { toast(tx('{name} is on Google Drive', { name: out.name }), 'ok'); loadFiles(); loadStatus() },
    })
    if (canResume(t.id, kind, file)) toast(tx('Carrying on from where it stopped'))
  }

  const handIn = async (t, f) => {
    const kind = kindFor(t)
    const job = JOB[kind]
    try {
      await api.patch(`/content/${t.id}`, { milestone: job.milestone, [job.col]: f.link })
      toast(tx('Handed in — «{title}»', { title: t.title }), 'ok')
      setContent((cur) => cur.map((x) => (x.id === t.id ? { ...x, [job.col]: f.link } : x)))
      api.get('/content').then(setContent).catch(() => {})
    } catch (e) { toast(e.message, 'err') }
  }

  const dropProps = (id, onFile) => ({
    onDragOver: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(id) } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o === id ? null : o)) },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); setOver(null); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) },
  })

  if (!status || !content) return <div className="app-loading"><span className="spinner" /></div>

  if (!status.connected) {
    return (
      <div className="up">
        <h2 className="up-title"><UploadCloud size={20} /> {tx('Uploads')}</h2>
        <div className="card card-pad up-off">
          <HardDrive size={22} />
          <div>
            <b>{tx('Google Drive isn’t connected yet.')}</b>
            <p className="stat-sub">{user.role === 'admin'
              ? tx('Connect it once in Admin → Google Drive; then every file dropped here goes straight to the team’s Drive.')
              : tx('An admin connects it once in Admin → Google Drive; then every file dropped here goes straight to the team’s Drive.')}</p>
          </div>
        </div>
      </div>
    )
  }

  const quota = status.quota
  const used = quota?.limit ? Math.min(100, Math.round((quota.usage / quota.limit) * 100)) : null
  const live = jobs.filter((j) => j.state === 'sending')
  const ended = jobs.filter((j) => j.state !== 'sending')

  return (
    <div className="up" {...dropProps('all', (f) => setLoose(f))}>
      <div className="up-head">
        <h2 className="up-title"><UploadCloud size={20} /> {tx('Uploads')}</h2>
        {quota && (
          <div className={'up-room' + (used >= 90 ? ' tight' : '')} data-tip={tx('Space on the team’s Google Drive')}>
            <HardDrive size={14} />
            <span className="up-room-bar"><i style={{ width: `${used ?? 0}%` }} /></span>
            <span>{quota.limit
              ? tx('{free} free of {all}', { free: sizeLabel(Math.max(0, quota.limit - quota.usage)), all: sizeLabel(quota.limit) })
              : tx('{used} used', { used: sizeLabel(quota.usage) })}</span>
          </div>
        )}
      </div>

      <div className="pill-group up-view" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'tasks'} className={'pill' + (view === 'tasks' ? ' active' : '')} onClick={() => setView('tasks')}><UploadCloud size={14} /> {tx('Upload')}</button>
        <button type="button" role="tab" aria-selected={view === 'history'} className={'pill' + (view === 'history' ? ' active' : '')} onClick={() => setView('history')}><History size={14} /> {tx('History')}</button>
      </div>

      {view === 'history' ? <UploadHistory onPlay={setPreview} /> : (<>
      {/* The big box: drop anything, then say which task it is for. */}
      <div className={'up-drop' + (over === 'all' ? ' over' : '')} role="button" tabIndex={0}
        onClick={() => { pickFor.current = null; pick.current?.click() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFor.current = null; pick.current?.click() } }}>
        <UploadCloud size={28} />
        <b>{tx('Drop a file here')}</b>
        <span>{tx('Any size — it goes straight to Google Drive, not through this site. Or drop it right on its task below.')}</span>
      </div>
      <input ref={pick} type="file" hidden onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = ''
        if (!f) return
        if (pickFor.current) send(pickFor.current, f); else setLoose(f)
      }} />

      {/* What is on its way, and what just landed. */}
      {jobs.length > 0 && (
        <section className="up-jobs" aria-label={tx('On its way')}>
          {live.map((j) => {
            const pct = Math.floor((j.sent / Math.max(1, j.size)) * 100)
            const v = speedOf(j)
            const eta = etaOf(j)
            return (
              <div key={j.key} className="up-job" role="status">
                <div className="up-job-top">
                  <FileVideo size={15} />
                  <b className="up-job-name">{j.name}</b>
                  <span className="stat-sub up-job-task">→ {j.taskTitle}</span>
                  <button type="button" className="icon-btn" onClick={() => cancelUpload(j.key)} aria-label={tx('Cancel the upload')} data-tip={tx('Cancel the upload')}><X size={14} /></button>
                </div>
                <div className="hi-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
                <span className="stat-sub">
                  {pct}% · {sizeLabel(j.sent)} {tx('of')} {sizeLabel(j.size)}{v ? ` · ${sizeLabel(v)}/s` : ''}{eta ? ` · ${tx('{t} left', { t: eta })}` : ''}
                </span>
              </div>
            )
          })}
          {ended.map((j) => (
            <div key={j.key} className={'up-job ' + j.state}>
              <div className="up-job-top">
                {j.state === 'done' ? <Check size={15} /> : j.state === 'failed' ? <AlertCircle size={15} /> : <X size={15} />}
                <b className="up-job-name">{j.name}</b>
                <span className="stat-sub up-job-task">→ {j.taskTitle}</span>
              </div>
              <span className="stat-sub">
                {j.state === 'done' ? tx('Uploaded to Google Drive')
                  : j.state === 'failed' ? <>{j.error} · {tx('Drop the same file on the same task to carry on.')}</>
                    : tx('Cancelled — drop the same file again to carry on.')}
              </span>
            </div>
          ))}
          {ended.length > 0 && !live.length && (
            <button type="button" className="tb-link up-clear" onClick={clearFinished}>{tx('Clear the list')}</button>
          )}
        </section>
      )}

      <div className="up-bar">
        <label className="up-search">
          <Search size={14} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Find a task')} aria-label={tx('Find a task')} />
        </label>
        {planner && (
          <div className="pill-group">
            <button type="button" className={'pill' + (scope === 'mine' ? ' active' : '')} onClick={() => setScope('mine')}>{tx('Mine')}</button>
            <button type="button" className={'pill' + (scope === 'all' ? ' active' : '')} onClick={() => setScope('all')}>{tx('My channels')}</button>
          </div>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="card card-pad empty">{scope === 'mine' ? tx('Nothing of yours is waiting for a file.') : tx('No tasks here yet.')}</div>
      ) : (
        <ul className="up-tasks">
          {tasks.map((t) => {
            const kind = kindFor(t)
            const job = JOB[kind]
            const here = files[t.id] || []
            const mineHat = t[HAT[kind]] === user.id
            const sending = live.find((j) => j.taskId === t.id)
            return (
              <li key={t.id} className={'up-task' + (over === t.id ? ' over' : '')} {...dropProps(t.id, (f) => send(t, f))}>
                <div className="up-task-top">
                  <div className="up-task-name">
                    <b>{t.title}</b>
                    <span className="stat-sub">
                      {(t.channels || []).map((k) => byKey[k]?.label || k).join(' · ')}
                      {t.edit_ready_date || t.release_date ? ` · ${dateLabel(t.edit_ready_date || t.release_date)}` : ''}
                    </span>
                  </div>
                  <span className="chip chip-muted">{tx(job.label)}</span>
                  <button type="button" className="btn btn-sm" disabled={!!sending}
                    onClick={() => { pickFor.current = t; pick.current?.click() }}>
                    <UploadCloud size={14} /> {sending ? `${Math.floor((sending.sent / Math.max(1, sending.size)) * 100)}%` : tx('Add a file')}
                  </button>
                </div>
                {here.length === 0 ? (
                  <span className="up-none">{over === t.id ? tx('Let go to upload it here') : tx('No file yet — drop one here')}</span>
                ) : (
                  <ul className="up-files">
                    {here.map((f) => (
                      <li key={f.id} className="up-file">
                        <button type="button" className="up-play" onClick={() => setPreview({ file: f, task: t })} aria-label={tx('Play {name}', { name: f.name })}>
                          <Play size={14} />
                        </button>
                        <button type="button" className="up-file-name" onClick={() => setPreview({ file: f, task: t })}>{f.name}</button>
                        <span className="stat-sub">{sizeLabel(f.size)}{f.at ? ` · ${dateLabel(tashkentDay(f.at))}` : ''}</span>
                        {mineHat && t[job.col] !== f.link && (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => handIn(t, f)}>
                            <Check size={14} /> {tx('Hand in this one')}
                          </button>
                        )}
                        {t[job.col] === f.link && <span className="up-in"><Check size={13} /> {tx('Handed in')}</span>}
                        {mayRemove(t) && (
                          <button type="button" className="icon-btn up-del" aria-label={tx('Delete')} title={tx('Delete')}
                            onClick={async () => { if (await removeDriveFile(t.id, f)) { setFiles((o) => ({ ...o, [t.id]: (o[t.id] || []).filter((x) => x.id !== f.id) })); loadFiles() } }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      </>)}

      {/* A file dropped on the big box: which task is it for? */}
      {loose && (
        <Modal title={tx('Which task is «{name}» for?', { name: loose.name })} onClose={() => setLoose(null)}>
          <p className="stat-sub" style={{ marginTop: 0 }}>{sizeLabel(loose.size)}</p>
          <ul className="up-pick">
            {tasks.map((t) => (
              <li key={t.id}>
                <button type="button" className="up-pick-row" onClick={() => { send(t, loose); setLoose(null) }}>
                  <b>{t.title}</b>
                  <span className="stat-sub">{(t.channels || []).map((k) => byKey[k]?.label || k).join(' · ')} · {tx(JOB[kindFor(t)].label)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {/* It plays here: Google's own player, in the page. */}
      {preview && (
        <Modal wide title={preview.file.name} onClose={() => setPreview(null)}>
          <div className="up-player">
            <iframe title={preview.file.name} src={`https://drive.google.com/file/d/${preview.file.id}/preview`}
              allow="autoplay; fullscreen" allowFullScreen />
          </div>
          <div className="up-player-foot">
            <span className="stat-sub">{preview.task.title} · {sizeLabel(preview.file.size)}</span>
            <span className="stat-sub up-hint"><RotateCcw size={12} /> {tx('A video just uploaded may need a few minutes on Google’s side before it plays.')}</span>
            <a className="btn btn-sm" href={preview.file.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tx('Open in Google Drive')}</a>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ---- History (r11, the owner) -------------------------------------------------
// Everything this person uploaded, newest first — so a wrong file is found and
// fixed later: played to check it, replaced by the right one (which takes its
// place in the task's box if it was the one handed in), or deleted. Deleted
// ones stay on the list, crossed out, with the day.
const HAND_COL = { shoot: 'shot_link', edit: 'ready_link', design: 'design_link' }
function UploadHistory({ onPlay }) {
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const pick = useRef(null)
  const target = useRef(null)
  const load = useCallback(() => api.get('/drive/history').then((r) => setList(r.uploads || [])).catch(() => setList([])), [])
  useEffect(() => { load() }, [load])

  const replace = (r, file) => {
    if (!file) return
    setBusy(r.file_id)
    startUpload({
      task: { id: r.content_id, title: r.title }, kind: r.kind, file,
      onDone: async (out) => {
        try {
          // The right file takes the wrong one's place in the box it was handed in with.
          if (r.handed_in && HAND_COL[r.kind]) await api.patch(`/content/${r.content_id}`, { [HAND_COL[r.kind]]: out.link })
          await removeDriveFile(r.content_id, { id: r.file_id, name: r.name })
        } catch (e) { toast(e.message, 'err') }
        setBusy(null); load()
      },
    })
  }

  if (!list) return <div className="card card-pad"><span className="spinner" /></div>
  if (!list.length) return <div className="card card-pad empty">{tx('Nothing uploaded yet. Every file you upload is listed here, so a wrong one can be fixed later.')}</div>
  return (
    <>
      <ul className="up-hist">
        {list.map((r) => (
          <li key={r.file_id} className={'up-file up-hist-row' + (r.deleted_at ? ' gone' : '')}>
            {!r.deleted_at && (
              <button type="button" className="up-play" onClick={() => onPlay({ file: { id: r.file_id, name: r.name, size: r.size, link: r.link }, task: { title: r.title } })} aria-label={tx('Play {name}', { name: r.name })}>
                <Play size={14} />
              </button>
            )}
            <span className="up-hist-what">
              <b className="up-file-name">{r.name}</b>
              <span className="stat-sub">{r.title} · {sizeLabel(r.size)} · {dateLabel(tashkentDay(r.created_at))}</span>
            </span>
            {r.deleted_at ? <span className="stat-sub">{tx('Deleted')} · {dateLabel(tashkentDay(r.deleted_at))}</span>
              : r.handed_in ? <span className="up-in"><Check size={13} /> {tx('Handed in')}</span> : null}
            {r.can_remove && (
              <span className="up-hist-acts">
                <button type="button" className="btn btn-sm" disabled={busy === r.file_id}
                  title={tx('After you press: pick the right file — it is uploaded to the same task and takes this one’s place')}
                  onClick={() => { target.current = r; pick.current?.click() }}>
                  <Replace size={14} /> {busy === r.file_id ? tx('Uploading…') : tx('Replace')}
                </button>
                <button type="button" className="icon-btn up-del" aria-label={tx('Delete')} title={tx('Delete')}
                  onClick={async () => { if (await removeDriveFile(r.content_id, { id: r.file_id, name: r.name })) load() }}>
                  <Trash2 size={14} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <input ref={pick} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (target.current) replace(target.current, f) }} />
    </>
  )
}

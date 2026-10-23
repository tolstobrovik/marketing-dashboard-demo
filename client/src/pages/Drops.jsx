import { useEffect, useMemo, useState } from 'react'
import { Link2, RotateCcw } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tashkentDay, dateLabel } from '../lib/constants.js'
import { DropList } from '../components/DriveDrops.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- Unmatched files (More → Unmatched files) -----------------------------------
//
// Files dropped into the team's Drive folders whose names named no task — no
// #id, and no title that exactly one open task has (server/dropin.js). An
// admin of the whole board says which task each is for; attached, it leaves
// the list and shows up on that task. Each file is here once: the server
// claims it the first time it is seen.

export default function Drops() {
  const [files, setFiles] = useState(null)
  const [drop, setDrop] = useState(null)
  const [tasks, setTasks] = useState([])
  const [err, setErr] = useState('')
  const load = () => api.get('/drive/drops/unmatched')
    .then((r) => { setFiles(r.files || []); setDrop(r.drop || null); setErr('') })
    .catch((e) => { setFiles([]); setErr(e.message) })
  useEffect(() => {
    load()
    api.get('/content').then((c) => setTasks(Array.isArray(c) ? c : [])).catch(() => {})
  }, [])

  return (
    <div className="co-drops-page">
      <header className="co-drops-head">
        <h2>{tx('Lost files')}</h2>
        <p className="co-help">{tx('Files dropped into the Google Drive folders whose names did not say which task they are for. Pick the task, and the file shows up on it.')}</p>
      </header>
      {err && <div className="form-error" role="alert">{err}</div>}
      {drop && !drop.on && (
        <div className="co-note co-n-wait" role="status">
          <span>{tx('Drop-in is not watching the folders right now. Admin → Google Drive says why.')}</span>
        </div>
      )}
      {files === null
        ? <p className="co-none">{tx('Loading…')}</p>
        : files.length === 0
          ? <p className="co-none">{tx('Nothing to attach. Every file dropped in Drive has found its task — a name with “#” and the task number always does.')}</p>
          : (
            <ul className="co-unm">
              {files.map((f) => <Row key={f.id} f={f} tasks={tasks} onDone={(left) => setFiles(left)} />)}
            </ul>
          )}
      <button type="button" className="co-btn co-btn-s co-btn-sm co-unm-again" onClick={load}><RotateCcw size={16} aria-hidden="true" />{tx('Check again')}</button>
    </div>
  )
}

function Row({ f, tasks, onDone }) {
  const [find, setFind] = useState('')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  // Open work first, then the rest; the thirty that match what was typed.
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    return tasks
      .filter((t) => !q || String(t.title || '').toLowerCase().includes(q) || String(t.id) === q.replace('#', ''))
      .sort((a, b) => (!!a.done_at - !!b.done_at) || (b.id - a.id))
      .slice(0, 30)
  }, [tasks, find])
  const attach = async () => {
    if (!pick || busy) return
    setBusy(true)
    try {
      const r = await api.post(`/drive/drops/${f.id}/attach`, { task_id: Number(pick) })
      toast(tx('Attached. It is on the task now.'), 'ok')
      onDone(r.files || [])
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const when = f.created_at ? dateLabel(tashkentDay(f.created_at)) : ''
  return (
    <li className="co-unm-row">
      <DropList drops={[f]} />
      <p className="co-help">{tx('In the {folder} folder · seen {when}', { folder: f.folder_name, when })}</p>
      <div className="co-unm-pick">
        <input className="input" value={find} onChange={(e) => setFind(e.target.value)}
          placeholder={tx('Type part of the task’s name')} aria-label={tx('Find the task')} />
        <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={tx('The task this file is for')}>
          <option value="">{shown.length ? tx('Pick the task…') : tx('No task has that in its name')}</option>
          {shown.map((t) => <option key={t.id} value={t.id}>{`${t.title} #${t.id}${t.done_at ? ` · ${tx('published')}` : ''}`}</option>)}
        </select>
        <button type="button" className="co-btn co-btn-p co-btn-sm" disabled={!pick || busy} onClick={attach}>
          <Link2 size={16} aria-hidden="true" />{tx('Attach to task')}
        </button>
      </div>
      <p className="co-help">{tx('After you press: the file shows up on that task, its owner is told, and it leaves this list. Nothing moves in Drive.')}</p>
    </li>
  )
}

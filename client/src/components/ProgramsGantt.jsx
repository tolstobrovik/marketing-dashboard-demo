import { useEffect, useMemo, useState } from 'react'
import { Plus, Play, Pause, Flag, CalendarClock, Trash2, AlertCircle, Rocket, ImagePlus, X, Pencil } from 'lucide-react'
import { api } from '../lib/api.js'
import Modal from './Modal.jsx'
import { useContextMenu } from './ContextMenu.jsx'
import { todayISO, addDaysISO, dateLabel } from '../lib/constants.js'
import { PcChecklist, scalePhoto } from './ProjectBits.jsx'
import { playLaunch, playHalt, playDone } from '../lib/sound.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import Zoom from './Zoom.jsx'
import ProgramsTimeline from './ProgramsTimeline.jsx'

// Launch programs on a timeline — built for the Target team. Each program is
// a bar: blue while planned, green while running, amber when halted, gray
// when finished. The red line is today; a running program past its end date
// asks to be finished or extended.

export const PROGRAM_STATES = [
  { key: 'planned', label: 'Planned', color: '#2a78d6', icon: CalendarClock, hint: 'Queued — hasn’t launched yet' },
  { key: 'running', label: 'Running', color: '#1D9E75', icon: Play, hint: 'Live right now' },
  { key: 'paused', label: 'Halted', color: '#BA7517', icon: Pause, hint: 'Stopped mid-flight — can resume' },
  { key: 'done', label: 'Finished', color: '#6d6a70', icon: Flag, hint: 'Wrapped up' },
]
const stateOf = (k) => PROGRAM_STATES.find((s) => s.key === k) || PROGRAM_STATES[0]

// Where the ads run. Solid, distinctive colors; 'both' shows in every lens.
export const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', short: 'IG', color: '#d6499b' },
  { key: 'telegram', label: 'Telegram', short: 'TG', color: '#2a9fd6' },
  { key: 'both', label: 'Both', short: 'IG+TG', color: '#7b5ad6' },
]
const platformOf = (k) => PLATFORMS.find((s) => s.key === k) || PLATFORMS[2]

// The branches (filials) a launch is aimed at — worn big on the bar itself.
export const BRANCHES = [
  { key: 'shahristan', label: 'Shahristan' },
  { key: 'chilanzar', label: 'Chilanzar' },
  { key: 'drujba', label: 'Drujba' },
  { key: 'andijan', label: 'Andijan' },
  { key: 'bukhara', label: 'Bukhara' },
]
const branchLabel = (k) => (BRANCHES.find((b) => b.key === k)?.label || k).toUpperCase()
const branchesOf = (p) => { try { return JSON.parse(p.branches || '[]') } catch { return [] } }
// Every branch selected reads as one word — not a wall of city names.
const branchTxt = (p) => {
  const bs = branchesOf(p)
  if (bs.length === 0) return null
  return bs.length === BRANCHES.length ? 'ALL' : bs.map(branchLabel).join(' · ')
}
const creativesN = (p) => { try { return JSON.parse(p.creatives || '[]').length } catch { return 0 } }
// The owner's order (13 Oct): running on top, planned in the middle, halted at
// the bottom. Finished ones leave the timeline for the Finished list under it.
const ORDER = { running: 0, planned: 1, paused: 2, done: 3 }

const day = (iso) => Date.parse(`${iso}T00:00:00Z`)
const DAY = 86400000

/* Creatives — each ad variation: name, the script, an optional photo. */
function CreativesEditor({ items, canEdit, onChange }) {
  const set = (i, patch) => onChange(items.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const pickPhoto = async (i, e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { alert('Image is too large — keep it under 15 MB'); return }
    try {
      const [main, thumb] = await Promise.all([scalePhoto(file, 700, 0.8), scalePhoto(file, 120, 0.7)])
      set(i, { photo: main, photo_thumb: thumb })
    } catch (err) { alert(err.message) }
  }
  return (
    <div className="field" style={{ marginTop: 4 }}>
      <div className="pc-check-head">
        <h3>{tx('Creatives')}</h3>
        <span className="stat-sub">{items.length ? `${items.length} of 20` : 'scripts and visuals for this run'}</span>
      </div>
      {items.map((c, i) => (
        <div key={i} className="creative-card">
          <div className="creative-top">
            {c.photo_thumb || c.photo ? (
              <Zoom className="creative-thumb" src={c.photo_thumb || c.photo} full={c.photo || c.photo_thumb} alt={c.title || ''} />
            ) : canEdit ? (
              <label className="creative-thumb creative-pick" data-tip={tx('Attach a photo')}>
                <ImagePlus size={16} />
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pickPhoto(i, e)} />
              </label>
            ) : null}
            <input className="input pc-mini" style={{ flex: 1, fontWeight: 700 }} disabled={!canEdit}
              value={c.name} placeholder={tx('Creative name…')}
              onChange={(e) => set(i, { name: e.target.value })} />
            {canEdit && (c.photo || c.photo_thumb) && (
              <button type="button" className="icon-btn" data-tip={tx('Remove the photo')} data-tip-left=""
                onClick={() => set(i, { photo: null, photo_thumb: null })} aria-label={tx('Remove photo')}><X size={14} /></button>
            )}
            {canEdit && (
              <button type="button" className="icon-btn del-btn" data-tip={tx('Delete this creative')} data-tip-left=""
                onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={tx('Delete creative')}><Trash2 size={14} /></button>
            )}
          </div>
          <textarea className="input" rows={2} disabled={!canEdit} value={c.script}
            placeholder={tx('Script / description — hook, text, CTA…')}
            onChange={(e) => set(i, { script: e.target.value })} />
        </div>
      ))}
      {canEdit && items.length < 20 && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 6 }}
          onClick={() => onChange([...items, { name: '', script: '', photo: null, photo_thumb: null }])}>
          <Plus size={14} /> Add creative
        </button>
      )}
    </div>
  )
}

function ProgramForm({ program, channel, isAdmin, onClose, onSaved, onDeleted, preset = null }) {
  const creating = !program
  const [err, setErr] = useState('')
  const [form, setForm] = useState(() => ({
    name: program?.name || '',
    status: program?.status || 'planned',
    platform: program?.platform || 'both',
    start_date: program?.start_date || preset?.start_date || todayISO(),
    end_date: program?.end_date || preset?.end_date || '',
    budget: program?.budget ?? '',
    note: program?.note || '',
    checklist: (() => { try { return JSON.parse(program?.checklist || '[]') } catch { return [] } })(),
    creatives: (() => { try { return JSON.parse(program?.creatives || '[]') } catch { return [] } })(),
    branches: (() => { try { return JSON.parse(program?.branches || '[]') } catch { return [] } })(),
  }))
  const toggleBranch = (k) =>
    setForm((f) => ({ ...f, branches: f.branches.includes(k) ? f.branches.filter((b) => b !== k) : [...f.branches, k] }))
  const save = async () => {
    if (!form.name.trim()) { setErr('Give the program a name'); return }
    setErr('')
    try {
      const payload = { ...form, name: form.name.trim(), start_date: form.start_date || null, end_date: form.end_date || null, budget: form.budget === '' ? null : Number(form.budget) }
      if (!isAdmin) delete payload.checklist // the server allows checklist edits for admins only
      payload.creatives = form.creatives.filter((c) => c.name.trim())
      const saved = creating
        ? await api.post('/programs', { ...payload, channel })
        : await api.patch(`/programs/${program.id}`, payload)
      toast(creating ? 'Program launched — synced' : 'Program saved — synced')
      onSaved(saved)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  const del = async () => {
    if (!confirm(`Delete the program “${program.name}”?`)) return
    try { await api.del(`/programs/${program.id}`); toast(tx('Program deleted')); onDeleted(program); onClose() } catch (e) { setErr(e.message) }
  }
  return (
    <Modal
      title={creating ? 'New program' : 'Program'}
      onClose={onClose}
      footer={<>
        {!creating && <button className="btn btn-danger" onClick={del}><Trash2 size={15} /> {tx('Delete')}</button>}
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
        <button className="btn btn-primary" onClick={save}>{creating ? 'Launch plan' : 'Save'}</button>
      </>}
    >
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      <div className="field"><label>{tx('Name')}</label>
        <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={tx('e.g. Lead gen — August intake')} />
      </div>
      <div className="field"><label>{tx('State')}</label>
        <div className="prog-states">
          {PROGRAM_STATES.map((s) => {
            const Icon = s.icon
            const on = form.status === s.key
            return (
              <button key={s.key} type="button" data-tip={s.hint}
                className={'prog-state' + (on ? ' on' : '')}
                style={on ? { background: s.color, borderColor: s.color, color: '#fff' } : undefined}
                onClick={() => setForm({ ...form, status: s.key })}>
                <Icon size={14} /> {s.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="field"><label>{tx('Platform')}</label>
        <div className="prog-states">
          {PLATFORMS.map((pl) => {
            const on = form.platform === pl.key
            return (
              <button key={pl.key} type="button" data-tip={pl.key === 'both' ? 'Runs on Instagram and Telegram' : `Runs on ${pl.label}`}
                className={'prog-state' + (on ? ' on' : '')}
                style={on ? { background: pl.color, borderColor: pl.color, color: '#fff' } : undefined}
                onClick={() => setForm({ ...form, platform: pl.key })}>
                {pl.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="field"><label>{tx('Branch')} <span className="stat-sub">{tx('— which filial this launch targets (pick several if needed)')}</span></label>
        <div className="checkbox-row">
          {BRANCHES.map((b) => (
            <label key={b.key} className={'checkbox-chip chip-sm' + (form.branches.includes(b.key) ? ' on' : '')}>
              <input type="checkbox" checked={form.branches.includes(b.key)} onChange={() => toggleBranch(b.key)} />
              {b.label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx('Start')}</label>
          <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </div>
        <div className="field"><label>{tx('End')} <span className="stat-sub">(blank = open-ended)</span></label>
          <input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>{tx('Budget')} <span className="stat-sub">{tx('(optional)')}</span></label>
        <input className="input" type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
      </div>
      <div className="field"><label>{tx('Note')} <span className="stat-sub">{tx('(optional)')}</span></label>
        <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          placeholder={tx('Audience, creative, landing…')} />
      </div>
      <CreativesEditor
        items={form.creatives}
        canEdit
        onChange={(items) => setForm({ ...form, creatives: items })}
      />
      {/* The launch checklist — a to-do list in miniature, admin's hands only */}
      {(isAdmin || form.checklist.length > 0) && (
        <div className="field" style={{ marginTop: 4 }}>
          <PcChecklist
            items={form.checklist}
            canTick={isAdmin} canEditItems={isAdmin} compact
            onChange={(items) => setForm({ ...form, checklist: items })}
          />
        </div>
      )}
    </Modal>
  )
}

export default function ProgramsGantt({ channel, canManage, isAdmin = false, lens = 'all', big = false }) {
  const [programs, setPrograms] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [modal, setModal] = useState(null) // null | 'new' | program
  const [preset, setPreset] = useState(null) // the dates a new one was drawn with on the timeline

  useEffect(() => {
    setLoaded(false)
    api.get(`/programs?channel=${channel}`).then((p) => { setPrograms(p); setLoaded(true) }).catch(() => setLoaded(true))
  }, [channel])
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || modal) return
      api.poll(`/programs?channel=${channel}`).then((f) => { if (f) setPrograms(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    return () => clearInterval(id)
  }, [channel, modal])

  const today = todayISO()
  const replace = (saved) => setPrograms((prev) => {
    const has = prev.some((p) => p.id === saved.id)
    return has ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]
  })
  const quickState = async (p, status, quiet = false) => {
    try {
      replace(await api.patch(`/programs/${p.id}`, { status }))
      if (quiet) return
      if (status === 'running') playLaunch()
      else if (status === 'paused') playHalt()
      else if (status === 'done') playDone()
      if (status === 'done') {
        // It leaves the timeline for the Finished list — said, and undoable.
        toast(tx('«{name}» finished — moved to Finished', { name: p.name }), 'ok', { label: tx('Undo'), onClick: () => quickState(p, p.status, true) })
      } else toast(status === 'running' ? tx('Program running — synced') : tx('Program halted — synced'))
    } catch (e) { toast(e.message, 'err') }
  }

  // A bar moved on the timeline: drawn at once, then saved; put back if the
  // server says no, and Undo puts the old dates back.
  const moveDates = async (p, patch, quiet = false) => {
    const before = { start_date: p.start_date, end_date: p.end_date }
    replace({ ...p, ...patch })
    try {
      const saved = await api.patch(`/programs/${p.id}`, patch)
      replace(saved)
      if (!quiet) {
        toast(tx('{name} moved: {from} → {to}', { name: p.name, from: dateLabel(saved.start_date), to: saved.end_date ? dateLabel(saved.end_date) : tx('open-ended') }), 'ok',
          { label: tx('Undo'), onClick: () => moveDates(saved, Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])), true) })
      }
    } catch (e) {
      replace(p)
      toast(e.message, 'err')
    }
  }

  // Right-click a row: run / halt / finish / open / delete in one gesture.
  const { openMenu } = useContextMenu()
  const removeProgram = async (prog) => {
    if (!confirm(`Delete the program “${prog.name}”?`)) return
    try {
      await api.del(`/programs/${prog.id}`)
      setPrograms((prev) => prev.filter((x) => x.id !== prog.id))
      toast(tx('Program deleted'))
    } catch (e) { alert(e.message) }
  }
  const rowMenu = (e, prog) => canManage && openMenu(e, [
    { label: 'Open', icon: Pencil, onClick: () => setModal(prog) },
    prog.status !== 'running' && prog.status !== 'done' && { label: 'Start / resume', icon: Play, onClick: () => quickState(prog, 'running') },
    prog.status === 'running' && { label: 'Halt', icon: Pause, onClick: () => quickState(prog, 'paused') },
    prog.status !== 'done' && { label: 'Mark as finished', icon: Flag, onClick: () => quickState(prog, 'done') },
    { sep: true },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeProgram(prog) },
  ])

  // The lens: Instagram / Telegram / both. 'both' programs show everywhere.
  const visible = useMemo(
    () => (lens === 'all' ? programs : programs.filter((p) => p.platform === 'both' || p.platform === lens)),
    [programs, lens])
  const dated = useMemo(
    () => [...visible].filter((p) => p.start_date && p.status !== 'done')
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.end_date || '9999').localeCompare(b.end_date || '9999')),
    [visible])
  const undated = useMemo(() => visible.filter((p) => !p.start_date && p.status !== 'done'), [visible])
  // Finished: off the timeline, kept — newest end first; opened, restarted or deleted from there.
  const finished = useMemo(() => visible.filter((p) => p.status === 'done')
    .sort((a, b) => (b.end_date || b.start_date || '').localeCompare(a.end_date || a.start_date || '')), [visible])
  const counts = useMemo(() => {
    const c = { running: 0, paused: 0, planned: 0, done: 0 }
    for (const p of visible) c[p.status] = (c[p.status] || 0) + 1
    return c
  }, [visible])

  if (!loaded) return <div className="card card-pad empty">{tx('Loading programs…')}</div>

  if (programs.length === 0) {
    return (
      <div className="card card-pad empty" style={{ textAlign: 'center' }}>
        <Rocket size={26} style={{ color: 'var(--brand-500)' }} />
        <div style={{ fontWeight: 700, color: 'var(--ink-2)', margin: '6px 0 2px' }}>{tx('No programs yet')}</div>
        <div className="stat-sub">{tx('Track every launch as a bar on the timeline — running, halted, finished.')}</div>
        {canManage && (
          <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setModal('new')}>
            <Plus size={15} /> New program
          </button>
        )}
        {modal === 'new' && <ProgramForm channel={channel} isAdmin={isAdmin} onClose={() => setModal(null)} onSaved={replace} />}
      </div>
    )
  }

  return (
    <>
      {/* the fleet at a glance — the running count in BIG type */}
      <div className="prog-summary">
        <span className="prog-big" data-tip={tx('Programs live right now')}>
          <b>{counts.running}</b> running now
        </span>
        {PROGRAM_STATES.map((s) => (
          s.key !== 'running' && counts[s.key] > 0 && (
            <span key={s.key} className="prog-count" data-tip={s.hint}>
              <span className="rp-dot" style={{ background: s.color }} />
              <b>{counts[s.key]}</b> {s.label.toLowerCase()}
            </span>
          )
        ))}
        <span className="spacer" />
        {canManage && (
          <button className="btn btn-primary btn-sm" onClick={() => setModal('new')}><Plus size={15} /> {tx('New program')}</button>
        )}
      </div>

      <ProgramsTimeline
        dated={dated} undated={undated} finished={finished} today={today} canManage={canManage} big={big}
        stateOf={stateOf} platformOf={platformOf} branchTxt={branchTxt}
        onOpen={(p) => canManage && setModal(p)}
        onNew={(dates) => { setPreset(dates); setModal('new') }}
        onPatch={moveDates}
        onMenu={rowMenu}
        onQuick={quickState}
      />

      {modal && (
        <ProgramForm
          program={modal === 'new' ? null : modal}
          preset={modal === 'new' ? preset : null}
          channel={channel}
          isAdmin={isAdmin}
          onClose={() => { setModal(null); setPreset(null) }}
          onSaved={replace}
          onDeleted={(p) => setPrograms((prev) => prev.filter((x) => x.id !== p.id))}
        />
      )}
    </>
  )
}

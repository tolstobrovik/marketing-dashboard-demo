import { useState } from 'react'
import { playTick } from '../lib/sound.js'
import { Check, X, Plus, ImagePlus, ListChecks, ChevronDown } from 'lucide-react'
import { dateLabel, todayISO } from '../lib/constants.js'
import Zoom from './Zoom.jsx'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// Browser-side downscale for cover photos: main ≤1000px, thumbnail ≤160px.
export function scalePhoto(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxW / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      } catch (e) { reject(e) } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

// Cover-photo field for project & campaign forms.
export function PhotoField({ photo, onChange }) {
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { alert('Image is too large — keep it under 15 MB'); return }
    try {
      const [main, thumb] = await Promise.all([scalePhoto(file, 1000, 0.82), scalePhoto(file, 160, 0.72)])
      onChange({ photo: main, photo_thumb: thumb })
    } catch (err) { alert(err.message) }
  }
  return (
    <div className="field">
      <label>{tx('Cover photo')} <span className="stat-sub">{tx('(optional)')}</span></label>
      {photo ? (
        <div className="photo-wrap">
          <img src={photo} alt={tx('cover')} />
          <button type="button" className="photo-remove" data-tip={tx('Remove the photo')} data-tip-left=""
            onClick={() => onChange({ photo: null, photo_thumb: null })} aria-label={tx('Remove photo')}><X size={14} /></button>
        </div>
      ) : (
        <label className="photo-pick">
          <ImagePlus size={16} /> Attach an image
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
        </label>
      )}
    </div>
  )
}

// Shared pieces for Projects & Campaigns. Spec colors, solid fills only:
// green #1D9E75, amber #BA7517, red = the brand ruby (var(--critical)), track = light grey.
// Who can be picked as the owner of a project or a campaign, and how each is
// labelled.
//
// Ambassadors are left out: they cannot open Projects at all (the gate in
// auth.js refuses them), so owning one would mean owning something they can
// never see — and the server now refuses it too. Leaving them in is how an
// ambassador account made under a staff member's own name ended up beside the
// real one, identical, and three projects went to the wrong one.
//
// Any name that still appears twice gets its username beside it. A name is
// not an identity; two people can share one, and a list that cannot tell
// them apart will eventually hand somebody's work to the other.
export function ownerOptions(team = []) {
  const staff = team.filter((u) => u.role !== 'ambassador' && !String(u.username || '').startsWith('removed_'))
  const seen = {}
  for (const u of staff) seen[u.name] = (seen[u.name] || 0) + 1
  return staff.map((u) => ({ id: u.id, label: seen[u.name] > 1 && u.username ? `${u.name} (@${u.username})` : u.name }))
}

export const PC = { green: '#1D9E75', amber: '#BA7517', red: 'var(--critical)', blue: '#2a78d6', track: 'var(--track)', ink: 'var(--ink)' }

const STATUS_COLORS = {
  // done/closed wear a readable slate, not near-black ink — it must survive dark mode
  idea: '#6d6a70', incoming: '#2a78d6', live: PC.green, blocked: PC.red, done: '#5a5560',
  active: PC.green, paused: PC.amber, closed: '#8a6a4f',
  // The four a project can be. Done is the same slate as a closed campaign:
  // finished is not an alarm, and green here would compete with On track.
  on_track: PC.green, at_risk: PC.amber, off_track: PC.red,
  // Closed is NOT Done's grey. They are both "finished", and on a card that
  // is exactly the moment they must read differently: one met everything,
  // one fell short. A muted bronze — over, and not an alarm.
}
const STATUS_LABELS = {
  idea: 'Idea', incoming: 'Incoming', live: 'Live', blocked: 'Blocked', done: 'Done',
  active: 'Active', paused: 'Paused', closed: 'Closed',
  on_track: 'On track', at_risk: 'At risk', off_track: 'Off track',
}

export function StatusBadge({ status }) {
  return (
    <span className="pc-badge" style={{ background: STATUS_COLORS[status] || '#6d6a70' }}>
      {STATUS_LABELS[status] ? tx(STATUS_LABELS[status]) : status}
    </span>
  )
}

// PROJECT_STATUSES is the whole of "how is this going" now. There used to be
// a computed HealthPill beside it — Needs you / Slipping / Not started — which
// meant the board gave two answers to one question and the two could disagree
// in front of you. A person says which it is; At risk and Off track say why.
export const PROJECT_STATUSES = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
  { value: 'done', label: 'Done' },
  { value: 'closed', label: 'Closed' },
]
export const NEEDS_REASON = ['at_risk', 'off_track', 'closed']

// The status control, and the reason under it.
//
// Choosing At risk or Off track asks for the one line immediately: a warning
// with no reason on it is the state this replaced. The reason is asked for
// BEFORE the change is saved, because the server refuses a reasonless one and
// the person would otherwise meet that refusal as an error about a dropdown
// they had already let go of.
export function ProjectStatus({ status, reason, canWrite, onChange }) {
  if (!canWrite) return <StatusBadge status={status} />
  const pick = (next) => {
    if (NEEDS_REASON.includes(next)) {
      const asked = prompt(
        next === 'at_risk' ? 'In one line — why is this at risk?'
          : next === 'off_track' ? 'In one line — why is this off track?'
          // Closed asks how it ENDED, not what went wrong: the answer is the
          // lesson for the next one ("50 of 100 came — the venue capped it").
          : 'In one line — how did it end? e.g. “50 of 100 came — the venue capped it at 60”',
        NEEDS_REASON.includes(status) ? (reason || '') : '',
      )
      // Cancelled: leave the status where it was rather than setting one
      // nobody has explained.
      if (asked === null) return
      if (!asked.trim()) { alert('That status needs one line saying why.'); return }
      onChange(next, asked.trim())
      return
    }
    onChange(next, '')
  }
  return (
    <select className="select pc-mini pc-status-select" value={status} data-tip={tx('Project status')} aria-label={tx('Project status')}
      onChange={(e) => pick(e.target.value)}>
      {PROJECT_STATUSES.map((o) => <option key={o.value} value={o.value}>{tx(o.label)}</option>)}
    </select>
  )
}

// The reason, on its own full-width line under the header.
//
// It used to sit inside the header row beside the status. On a phone that row
// is the project's NAME and a control, so a sentence dropped into it got a
// column about 170px wide: the reason wrapped to three lines and squeezed the
// title to two. A sentence is not a chip — it gets a line.
export function StatusReason({ status, reason }) {
  if (!reason || !NEEDS_REASON.includes(status)) return null
  return <div className={'pc-why-row' + (status === 'off_track' ? ' bad' : status === 'closed' ? ' ended' : '')}>{reason}</div>
}

// Progress track with a time tick: fill = share of target hit, tick = share
// of time elapsed. Fill behind the tick means behind pace.
export function PaceBar({ pace, height = 10 }) {
  if (!pace) return null
  return (
    <div className="pace-track" style={{ height }}>
      <div className="pace-fill" style={{ width: `${pace.fill_pct}%`, background: pace.behind ? PC.amber : PC.green }} />
      <div className="pace-tick" style={{ left: `${pace.time_pct}%` }} />
    </div>
  )
}

// Plain progress bar (projects: actual vs target, checklists: done vs total).
export function PlainBar({ pct, color = PC.green, height = 10 }) {
  return (
    <div className="pace-track" style={{ height }}>
      <div className="pace-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  )
}

// The checklist: text, owner, due date, done. Click an item's text to edit
// it in place; the × removes it — a to-do list in miniature. `canTick` and
// `canEditItems` split rights: owners tick their steps, admins shape the
// list. Overdue dates show red; unowned items a red dash.
export function PcChecklist({ items, team = [], canEdit, canTick, canEditItems, onChange, compact = false }) {
  // Back-compat: old callers pass a single canEdit meaning "everything".
  const tick = canTick ?? canEdit ?? false
  const editItems = canEditItems ?? canEdit ?? false
  const [text, setText] = useState('')
  const [editIdx, setEditIdx] = useState(null)
  const [editText, setEditText] = useState('')
  const today = todayISO()
  const done = items.filter((c) => c.done).length
  const add = () => {
    if (!text.trim()) return
    onChange([...items, { text: text.trim(), owner_id: null, due: null, done: false }])
    setText('')
  }
  const set = (i, patch) => onChange(items.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const commitEdit = () => {
    if (editIdx === null) return
    const t = editText.trim()
    if (t) set(editIdx, { text: t.slice(0, 300) })
    setEditIdx(null)
  }
  return (
    <div>
      <div className="pc-check-head">
        <h3>{tx('Checklist')}</h3>
        <span className="stat-sub">{done} / {items.length} done</span>
      </div>
      {items.length > 0 && <PlainBar pct={(done / Math.max(1, items.length)) * 100} height={8} />}
      <div className="subtask-list" style={{ marginTop: 8 }}>
        {items.map((c, i) => {
          const overdue = !c.done && c.due && c.due < today
          return (
            <div key={i} className="subtask-row pc-check-row">
              <button
                type="button"
                className={`mini-check${c.done ? ' on' : ''}`}
                disabled={!tick}
                data-tip={c.done ? 'Mark as not done' : 'Mark as done'}
                onClick={() => { if (!tick) return; if (!c.done) playTick(); set(i, { done: !c.done, done_at: c.done ? null : today }) }}
              >
                {c.done && <Check size={12} strokeWidth={3} />}
              </button>
              {editIdx === i ? (
                <input
                  className="input pc-mini" autoFocus value={editText} style={{ flex: 1, minWidth: 140 }}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit() } if (e.key === 'Escape') setEditIdx(null) }}
                />
              ) : (
                <span
                  className={(c.done ? 'done-txt' : '') + (editItems ? ' pc-check-txt' : '')}
                  style={{ flex: 1, minWidth: 140 }}
                  data-tip={editItems ? 'Click to edit this step' : undefined}
                  onClick={() => { if (editItems) { setEditIdx(i); setEditText(c.text) } }}
                >{c.text}</span>
              )}
              {!compact && (editItems && team.length > 0 ? (
                <select
                  className="select pc-mini"
                  value={c.owner_id ?? ''}
                  data-tip={tx('Who does this step')}
                  onChange={(e) => set(i, { owner_id: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">{tx('— no owner —')}</option>
                  {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : team.length > 0 ? (
                <span className={c.owner_id ? 'stat-sub' : 'pc-red'}>
                  {c.owner_id ? (team.find((u) => u.id === c.owner_id)?.name || '—') : '—'}
                </span>
              ) : null)}
              {c.done ? (
                <span className="stat-sub">done {c.done_at ? dateLabel(c.done_at) : ''}</span>
              ) : editItems ? (
                <input className="input pc-mini" type="date" value={c.due || ''} data-tip={tx('Due date')}
                  style={overdue ? { color: PC.red, fontWeight: 700 } : undefined}
                  onChange={(e) => set(i, { due: e.target.value || null })} />
              ) : (
                <span className={overdue ? 'pc-red' : 'stat-sub'}>{c.due ? `due ${dateLabel(c.due)}` : '—'}</span>
              )}
              {editItems && (
                <button type="button" className="icon-btn" style={{ padding: 2 }} data-tip={tx('Remove this step')} data-tip-left=""
                  onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={tx('Remove')}>
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {editItems && (
        <div className="add-inline" style={{ padding: '6px 0 0' }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={tx('Add a step…')}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <button type="button" className="btn btn-sm" onClick={add} data-tip={tx('Add this step')} aria-label={tx('Add this step')}><Plus size={14} /></button>
        </div>
      )}
    </div>
  )
}

// Dated notes, newest first. Author and date are automatic. When onDelete is
// given, canDelete(note) decides which notes show the remove button — the
// server enforces author-or-admin regardless.
export function NotesBlock({ notes, onAdd, onDelete, canDelete = () => true }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try { await onAdd(text.trim()); setText('') } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  return (
    <div>
      <div className="pc-check-head">
        <h3>{tx('Notes')}</h3>
      </div>
      <div className="add-inline" style={{ paddingBottom: 8 }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('Add a note — prose lives here…')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} />
        <button className="btn btn-sm" onClick={submit} disabled={busy}><Plus size={14} /> {tx('Add note')}</button>
      </div>
      {notes.length === 0 && <div className="stat-sub">{tx('No notes yet.')}</div>}
      {notes.map((n) => (
        <div key={n.id} className="pc-note">
          <span className="stat-sub" style={{ whiteSpace: 'nowrap' }}>{n.created_at.slice(0, 10)}</span>
          <span className="pc-note-author">{n.author_name || 'system'}</span>
          <span style={{ flex: 1 }}>{n.text}</span>
          {onDelete && canDelete(n) && (
            <button type="button" className="icon-btn" style={{ padding: 2 }} data-tip={tx('Delete this note')} data-tip-left=""
              onClick={async () => {
                if (!confirm('Delete this note?')) return
                try { await onDelete(n) } catch (e) { alert(e.message) }
              }} aria-label={tx('Delete note')}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// Days from today until an ISO date (negative = already passed).
export const daysUntil = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 864e5)

// One campaign row — used by the campaign list and inside project detail.
export function CampaignRow({ c, byKey, onOpen }) {
  const startsIn = c.status === 'incoming' && c.start_date ? daysUntil(c.start_date) : null
  return (
    <button className="pc-camp-row" onClick={() => onOpen(c)}>
      {c.photo_thumb && <Zoom className="pc-row-thumb" src={c.photo_thumb} full={c.photo || c.photo_thumb} alt={c.title || ''} />}
      <div className="pc-row-body">
      <div className="pc-camp-top">
        <span className="pc-camp-name">{c.name}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {startsIn != null && startsIn >= 0 ? (
            <span className="pc-days" data-tip={tx('Days until the start date')}>starts in {startsIn}d</span>
          ) : c.days_left != null && c.status !== 'done' && c.days_left >= 0 ? (
            <span className="pc-days" data-tip={tx('Days until the end date')}>{c.days_left}d left</span>
          ) : null}
          <StatusBadge status={c.status} />
        </span>
      </div>
      {/* On drafts the strip below itemizes every gap — repeating it in red
          here would just be noise, so placeholders go muted. */}
      <div className="pc-camp-when">
        {c.start_date && c.end_date
          ? <span>{dateLabel(c.start_date)} → {dateLabel(c.end_date)}</span>
          : <span className={c.status === 'idea' ? 'stat-sub' : 'pc-red'}>{tx('no dates yet')}</span>}
      </div>
      <div className="pc-camp-sub">
        {c.project_name ? <span>{c.project_name}</span> : <span className={c.status === 'idea' ? 'stat-sub' : 'pc-red'}>{tx('no project')}</span>}
        <span>·</span>
        {c.owner_name ? <span>{c.owner_name}</span> : <span className={c.status === 'idea' ? 'stat-sub' : 'pc-red'}>{tx('no owner')}</span>}
      </div>
      {c.description && <div className="pc-desc-clamp">{c.description}</div>}
      {c.channels.length > 0 && (
        <div className="pc-camp-chips">
          {c.channels.map((ch) => <span key={ch} className="chip chip-muted">{byKey[ch]?.label || ch}</span>)}
        </div>
      )}
      {c.status === 'blocked' && c.blocking ? (
        <div className="pc-strip">Blocked by: {c.blocking.text} — due {dateLabel(c.blocking.due)}</div>
      ) : c.status === 'idea' && c.missing.length > 0 ? (
        <div className="pc-strip-soft">Draft — still needs: {c.missing.join(', ')}</div>
      ) : (
        <>
          <PaceBar pace={c.pace} />
          <div className="pc-camp-foot">
            <span><b>{c.actual.toLocaleString()}</b> / {c.target.toLocaleString()} {c.metric}</span>
            {c.status === 'live' && c.pace && (
              <span style={{ color: c.pace.behind ? PC.amber : PC.green, fontWeight: 700 }}>
                · {c.pace.behind ? 'behind' : 'ahead'} pace
              </span>
            )}
            {c.status === 'incoming' && c.start_date && (
              <span style={{ color: '#2a78d6', fontWeight: 700 }}>· starts {dateLabel(c.start_date)}</span>
            )}
          </div>
        </>
      )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Numbers: a project's targets, as many as it has.

// "2 days ago" / "today". Whole days in the browser's own reckoning, which is
// what somebody comparing it against their calendar means by a day.
export const daysSince = (iso) => {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate())
  const n = new Date()
  const b = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
  return Math.max(0, Math.round((b - a) / 864e5))
}

// A week without a new value is the point at which the tile stops being a
// measurement and starts being a memory, so that is where the line turns red.
export const STALE_DAYS = 7

// ---- the little steps under a number ---------------------------------------
//
// A number is a destination — 500 downloads, 40 reviews. It says nothing about
// how anybody gets there, so the gap between "we are at 120" and "500" lived in
// people's heads and in chat.
//
// These are that gap, written down where the number is. ANYBODY on the team
// can add one and tick one, on purpose: the person who will actually do the
// third step is rarely the person who owns the project, and a list only the
// owner could write is a list that stays empty. Editing the number itself is
// still the owner's.
//
// Folded when there is nothing to show, because a project with eight numbers
// should not open on eight empty boxes asking to be filled in.
function NumberSteps({ projectId, number, onProject }) {
  const steps = Array.isArray(number.steps) ? number.steps : []
  const done = steps.filter((s) => s.done).length
  const [open, setOpen] = useState(steps.length > 0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const call = async (fn) => {
    setBusy(true)
    try { onProject(await fn()) } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const add = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    await call(() => api.post(`/projects/${projectId}/numbers/${number.id}/steps`, { text: t }))
  }
  const tick = (s) => {
    if (!s.done) playTick()
    return call(() => api.patch(`/projects/${projectId}/numbers/${number.id}/steps/${s.id}`, { done: !s.done }))
  }
  const drop = (s) => call(() => api.del(`/projects/${projectId}/numbers/${number.id}/steps/${s.id}`))

  return (
    <div className="num-steps">
      <button type="button" className="num-steps-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ListChecks size={12} />
        {steps.length === 0
          ? tx('Add the steps to get there')
          : <>{tx('Steps')} <b>{done}/{steps.length}</b></>}
        {steps.length > 0 && (
          <span className="num-steps-bar">
            <i style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
          </span>
        )}
        <ChevronDown size={12} className={'num-steps-caret' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="num-steps-body">
          {steps.map((s) => (
            <div key={s.id} className={'num-step' + (s.done ? ' done' : '')}>
              <label>
                <input type="checkbox" checked={!!s.done} disabled={busy} onChange={() => tick(s)} />
                <span className="num-step-text">{s.text}</span>
              </label>
              {/* Who wrote it, and who ticked it. An open list where anybody
                  can add a line is only trustworthy if every line has a name
                  on it. */}
              <span className="num-step-who stat-sub">
                {s.done && s.done_name ? tx('ticked by {name}', { name: s.done_name.split(' ')[0] })
                  : s.by_name ? s.by_name.split(' ')[0] : ''}
              </span>
              <button className="icon-btn num-step-x" disabled={busy}
                onClick={() => drop(s)} aria-label={tx('Remove')} data-tip={tx('Remove')}>
                <X size={12} />
              </button>
            </div>
          ))}
          <div className="num-step-add">
            <input className="input" value={text} disabled={busy}
              placeholder={tx('A step towards this number')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
            <button className="btn btn-sm" disabled={busy || !text.trim()} onClick={add}>
              <Plus size={13} /> {tx('Add')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
export function NumberTable({ numbers = [], team = [], canWrite, onChange, projectId = null, onProject = null }) {
  const [editing, setEditing] = useState(null)   // {id, value} while typing
  const nameOf = (id) => team.find((u) => u.id === id)?.name || null

  if (!numbers.length) return null

  const commit = () => {
    if (!editing) return
    const { id, value } = editing
    setEditing(null)
    const v = Math.max(0, Math.round(Number(value)))
    const was = numbers.find((n) => n.id === id)
    if (!Number.isFinite(v) || !was || v === Number(was.current)) return
    onChange(numbers.map((n) => (n.id === id ? { ...n, current: v } : n)))
  }

  return (
    <div className="num-table">
      {numbers.map((n) => {
        const target = Number(n.target) || 0
        const current = Number(n.current) || 0
        // Not clamped: a project that beat its target should be able to say
        // so. The BAR stops at its end, because a bar past its track is a
        // broken bar.
        const pct = target > 0 ? Math.round((current / target) * 100) : 0
        const hit = target <= 0 || current >= target
        const since = daysSince(n.updated_at)
        const stale = since !== null && since >= STALE_DAYS
        const who = nameOf(n.updated_by)
        return (
          <div key={n.id} className={'num-row' + (hit ? ' hit' : '')}>
            <div className="num-row-name" title={n.name}>{n.name}</div>
            <div className="num-row-val">
              {editing?.id === n.id ? (
                <input
                  className="input num-input" type="number" min="0" autoFocus
                  value={editing.value}
                  onChange={(e) => setEditing({ id: n.id, value: e.target.value })}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <b
                  className={canWrite ? 'num-cur num-cur-edit' : 'num-cur'}
                  data-tip={canWrite ? 'Click to update this number' : undefined}
                  onClick={() => canWrite && setEditing({ id: n.id, value: String(current) })}
                >{current.toLocaleString()}</b>
              )}
              <span className="num-of">/ {target.toLocaleString()}</span>
            </div>
            <div className={'num-row-pct' + (pct > 100 ? ' beat' : hit ? ' met' : '')}>{pct}%</div>
            {/* The bar and the stamp share the second line, so the NAME gets
                the whole of the first. Five columns on one line is what put
                "SATOPLAM READING DOWNLOADS" back behind an ellipsis, and the
                name is the only thing saying which number this is. */}
            <div className="num-row-foot">
              <PlainBar pct={pct} color={hit ? PC.green : PC.blue} height={4} />
              <span className={'num-row-when' + (stale ? ' stale' : '')}>
                {since === null
                  ? 'not updated'
                  : `${since === 0 ? 'today' : since === 1 ? 'yesterday' : `${since}d ago`}${who ? ` · ${who}` : ''}`}
              </span>
            </div>
            {/* …and how anybody gets from the number on the left to the one on
                the right. Drawn only where the page can save them: the same
                table is used in places that have no project to write to. */}
            {projectId && onProject && (
              <NumberSteps projectId={projectId} number={n} onProject={onProject} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// Criteria: what must be TRUE at the end. Separate from the checklist, which
// is the steps taken to get there — the two were one list before, and a step
// somebody had done kept being read as a promise the project had met.
export function CriteriaList({ criteria = [], canWrite, onChange, big = false }) {
  if (!criteria.length) {
    return <div className="stat-sub">{tx('No criteria yet — add them in the project form.')}</div>
  }
  return (
    <div className={'crit-list' + (big ? ' crit-big' : '')}>
      {criteria.map((c, i) => (
        <label key={i} className={'crit-row' + (c.done ? ' done' : '')}>
          <input
            type="checkbox" checked={!!c.done} disabled={!canWrite}
            onChange={(e) => onChange(criteria.map((x, n) => (n === i ? { ...x, done: e.target.checked } : x)))}
          />
          <span>{c.text}</span>
        </label>
      ))}
    </div>
  )
}

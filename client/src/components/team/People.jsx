import { useEffect, useMemo, useState } from 'react'
import { UsersRound, Phone, Clock, Pencil, Check, Trash2, Plus } from 'lucide-react'
import { api, cache } from '../../lib/api.js'
import { useChannels } from '../../lib/channels.jsx'
import { scheduleLabel, WORK_DAYS, PERMISSIONS, dateLabel, tashkentDay } from '../../lib/constants.js'
import Avatar from '../Avatar.jsx'
import Modal from '../Modal.jsx'
import { useContextMenu } from '../ContextMenu.jsx'
import RolePicker from '../RolePicker.jsx'
import { toast, loadFailed } from '../../lib/toast.js'
import { tr as tx } from '../../lib/i18n.jsx'

// Team → People (N-03): the team in one place — who we have, how to reach
// them, when they work and what they answer for. Admin-only. Solid colors,
// big type, zero clutter. Editing a member covers everything the Access tab
// does, except the password. Hiring and Candidates, which sat folded under
// the team, are gone (decided in the TZ of 19 October 2026); their tables
// stay for one release.

const roleWord = (u) => {
  if (u.role === 'admin') return 'Admin'
  const caps = u.crew_roles || []
  if (caps.length) return caps.map((c) => c[0].toUpperCase() + c.slice(1)).join(' & ')
  return 'Member'
}

function MemberModal({ member, channels, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: member.name,
    username: member.username,
    email: member.email || '',
    role: member.role,
    crew_roles: [...(member.crew_roles || [])],
    departments: [...(member.departments || [])],
    permissions: { ...(member.permissions || {}) },
    position: member.position || '',
    phone: member.phone || '',
    duties: member.duties || '',
    work_start: member.work_start || '',
    work_end: member.work_end || '',
    work_days: Array.isArray(member.work_days) ? member.work_days : [],
  }))
  const [err, setErr] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggleDay = (d) => set({ work_days: form.work_days.includes(d) ? form.work_days.filter((x) => x !== d) : [...form.work_days, d].sort() })
  const toggleDept = (k) => set({ departments: form.departments.includes(k) ? form.departments.filter((x) => x !== k) : [...form.departments, k] })
  const togglePerm = (k) => set({ permissions: { ...form.permissions, [k]: !form.permissions[k] } })
  const save = async () => {
    setErr('')
    try {
      const u = await api.patch(`/users/${member.id}`, {
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim() || null,
        role: form.role,
        crew_roles: form.crew_roles,
        departments: form.departments,
        permissions: form.permissions,
        position: form.position.trim() || null,
        phone: form.phone.trim() || null,
        duties: form.duties.trim() || null,
        work_start: form.work_start || null,
        work_end: form.work_end || null,
        work_days: form.work_days.length ? form.work_days : null,
      })
      toast(tx('Member saved — synced'))
      onSaved(u)
      onClose()
    } catch (e) { setErr(e.message) }
  }
  return (
    <Modal title={member.name} wide onClose={onClose}
      footer={<>
        <span className="stat-sub">{tx("Passwords are changed in Admin → People.")}</span>
        <span className="foot-gap" />
        <button className="btn" onClick={onClose}>{tx("Cancel")}</button>
        <button className="btn btn-primary" onClick={save} disabled={!form.name.trim() || !form.username.trim()}><Check size={15} />{' '}{tx("Save")}</button>
      </>}>
      {err && <div className="form-error">{err}</div>}
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx("Name")}</label>
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field"><label>{tx("Username")}</label>
          <input className="input" autoCapitalize="none" autoCorrect="off" value={form.username} onChange={(e) => set({ username: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx('Email')} <span className="stat-sub">({tx('optional')})</span></label>
          <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </div>
        <div className="field"><label>{tx("Role")}</label>
          <RolePicker role={form.role} crewRoles={form.crew_roles}
            onChange={(role, crew_roles) => set({ role, crew_roles })} />
        </div>
      </div>
      {form.role === 'member' && (
        <>
          <div className="field"><label>{tx("Channels")}</label>
            <div className="checkbox-row">
              {channels.map((c) => (
                <label key={c.key} className={'checkbox-chip' + (form.departments.includes(c.key) ? ' on' : '')}>
                  <input type="checkbox" checked={form.departments.includes(c.key)} onChange={() => toggleDept(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
          <div className="field"><label>{tx("Permissions")}</label>
            <div className="perm-list">
              {PERMISSIONS.map((p) => (
                <button key={p.key} type="button" className={'perm-row' + (form.permissions[p.key] ? ' on' : '')} onClick={() => togglePerm(p.key)}>
                  <span className={'perm-toggle' + (form.permissions[p.key] ? ' on' : '')}>{form.permissions[p.key] && <Check size={12} strokeWidth={3.5} />}</span>
                  <span>
                    <span className="perm-label">{p.label}</span>
                    <span className="perm-desc">{p.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field"><label>{tx("Position")}</label>
          <input className="input" value={form.position} placeholder={tx("Videographer, SMM manager…")} onChange={(e) => set({ position: e.target.value })} />
        </div>
        <div className="field"><label>{tx("Phone")}</label>
          <input className="input" type="tel" value={form.phone} placeholder="+998 90 123 45 67" onChange={(e) => set({ phone: e.target.value })} />
        </div>
      </div>
      <div className="field"><label>{tx("Responsibilities")}</label>
        <textarea className="input" rows={2} value={form.duties} placeholder={tx("What this person answers for…")} onChange={(e) => set({ duties: e.target.value })} />
      </div>
      <div className="field"><label>{tx("Working schedule")}</label>
        <div className="wd-row">
          {WORK_DAYS.map((d) => (
            <button key={d.n} type="button" className={'wd-chip' + (form.work_days.includes(d.n) ? ' on' : '')} onClick={() => toggleDay(d.n)}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="sched-hours">
          <label className="sched-field">from
            <input className="input" type="time" value={form.work_start} onChange={(e) => set({ work_start: e.target.value })} />
          </label>
          <label className="sched-field">to
            <input className="input" type="time" value={form.work_end} onChange={(e) => set({ work_end: e.target.value })} />
          </label>
        </div>
      </div>
    </Modal>
  )
}

export default function People() {
  const { channels, byKey } = useChannels()
  const [boot] = useState(() => cache.get('team'))
  const [users, setUsers] = useState(boot?.users || [])
  const [loading, setLoading] = useState(!boot)
  const [editing, setEditing] = useState(null)
  const [view, setViewState] = useState(() => localStorage.getItem('satashkent_team_view') || 'cards')
  const setView = (v) => { setViewState(v); localStorage.setItem('satashkent_team_view', v) }

  useEffect(() => {
    api.get('/users')
      .then((us) => { setUsers(us); cache.set('team', { users: us }) })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  const team = useMemo(() => [...users].sort((a, b) =>
    (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || a.name.localeCompare(b.name)), [users])
  // Right-click: cards answer directly.
  const { openMenu } = useContextMenu()
  const memberMenu = (e, u) => openMenu(e, [
    { label: 'Edit member', icon: Pencil, onClick: () => setEditing(u) },
    u.phone && { label: 'Copy phone number', icon: Phone, onClick: () => navigator.clipboard?.writeText(u.phone).catch(() => {}) },
  ])

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  return (
    <>
      {/* ---- the team we have ---- */}
      <div className="section-head" style={{ marginTop: 0 }}>
        <UsersRound size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx("The team now")}</h2>
        <span className="count">· {team.length}</span>
        <span className="spacer" />
        {/* One menu for the four ways to look at the team. */}
        <select className="select cf-sel" aria-label={tx('View')} value={view} onChange={(e) => setView(e.target.value)}>
          <option value="cards">{tx("Cards")}</option>
          <option value="table">{tx("Table")}</option>
          <option value="board">{tx("Board")}</option>
          <option value="dash">{tx("Dashboard")}</option>
        </select>
      </div>

      {view === 'cards' && (
        <div className="team-grid">
          {team.map((u) => {
            const sched = scheduleLabel(u)
            const depts = (u.departments || []).map((d) => byKey[d]?.label || d)
            return (
              <div key={u.id} className="team-card" style={{ borderTopColor: u.color }} onContextMenu={(e) => memberMenu(e, u)}>
                <div className="team-top">
                  <Avatar name={u.name} color={u.color} src={u.avatar} />
                  <div className="team-who">
                    <b>{u.name}</b>
                    {u.position && <span className="team-pos">{u.position}</span>}
                  </div>
                  <span className={'role-badge rb-' + u.role}>{roleWord(u)}</span>
                  <button className="icon-btn" data-tip={tx("Edit card")} data-tip-left="" aria-label={tx("Edit")}
                    onClick={() => setEditing(u)}><Pencil size={14} /></button>
                </div>
                {(u.phone || sched) && (
                  <div className="team-rows">
                    {u.phone && <span className="team-row"><Phone size={13} /><a href={`tel:${u.phone.replace(/[^+\d]/g, '')}`}>{u.phone}</a></span>}
                    {sched && <span className="team-row"><Clock size={13} />{sched}</span>}
                  </div>
                )}
                {(u.duties || depts.length > 0) && <div className="team-duty">{u.duties || depts.join(', ')}</div>}
              </div>
            )
          })}
        </div>
      )}

      {view === 'table' && (
        <div className="card table-wrap">
          <table className="tbl">
            <thead><tr><th>{tx("Member")}</th><th>{tx("Role")}</th><th>{tx("Phone")}</th><th>{tx("Working hours")}</th><th>{tx("Responsibilities")}</th><th /></tr></thead>
            <tbody>
              {team.map((u) => {
                const sched = scheduleLabel(u)
                const depts = (u.departments || []).map((d) => byKey[d]?.label || d)
                return (
                  <tr key={u.id} onContextMenu={(e) => memberMenu(e, u)}>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                        <span>
                          <span style={{ fontWeight: 700, display: 'block' }}>{u.name}</span>
                          <span className="stat-sub">{u.position || '@' + u.username}</span>
                        </span>
                      </span>
                    </td>
                    <td><span className={'role-badge rb-' + u.role}>{roleWord(u)}</span></td>
                    <td>{u.phone ? <a href={`tel:${u.phone.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--brand-600)', fontWeight: 600 }}>{u.phone}</a> : <span className="stat-sub">—</span>}</td>
                    <td>{sched || <span className="stat-sub">—</span>}</td>
                    <td className="team-tbl-duty">{u.duties || (depts.length ? depts.join(', ') : '—')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="icon-btn" data-tip={tx("Edit")} data-tip-left="" aria-label={tx("Edit")} onClick={() => setEditing(u)}><Pencil size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'board' && (
        <div className="team-board">
          {[
            { label: 'Admins', match: (u) => u.role === 'admin' },
            { label: 'Members', match: (u) => u.role === 'member' },
            { label: 'Operators', match: (u) => (u.crew_roles || []).includes('operator') },
            { label: 'Editors', match: (u) => (u.crew_roles || []).includes('editor') },
            { label: tx('Designers'), match: (u) => (u.crew_roles || []).includes('designer') },
          ].map((col) => {
            const list = team.filter(col.match)
            return (
              <div key={col.label} className="team-col">
                <div className="team-col-head">{col.label} <span className="count">{list.length}</span></div>
                {list.map((u) => (
                  <button key={u.id} className="team-mini" style={{ borderLeftColor: u.color }}
                    onClick={() => setEditing(u)} onContextMenu={(e) => memberMenu(e, u)}>
                    <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                    <span>
                      <b>{u.name}</b>
                      <small>{u.position || (u.departments || []).map((d) => byKey[d]?.label || d).join(', ') || '—'}</small>
                    </span>
                  </button>
                ))}
                {list.length === 0 && <div className="board-empty">—</div>}
              </div>
            )
          })}
        </div>
      )}

      {view === 'dash' && (() => {
        const phones = team.filter((u) => u.phone).length
        const scheds = team.filter((u) => u.work_start && u.work_end).length
        const roleRows = [
          { label: 'Admins', n: team.filter((u) => u.role === 'admin').length, color: 'var(--brand-500)' },
          { label: 'Members', n: team.filter((u) => u.role === 'member').length, color: '#5a6b7a' },
          { label: 'Operators', n: team.filter((u) => (u.crew_roles || []).includes('operator')).length, color: '#2a78d6' },
          { label: 'Editors', n: team.filter((u) => (u.crew_roles || []).includes('editor')).length, color: '#7b5ad6' },
          { label: tx('Designers'), n: team.filter((u) => (u.crew_roles || []).includes('designer')).length, color: '#0e8a6d' },
        ].filter((r) => r.n > 0)
        return (
          <div className="team-dash">
            <div className="card card-pad">
              <div className="pc-check-head"><h3>{tx("Roles")}</h3><span className="stat-sub">{team.length} people</span></div>
              <div className="ov-stages" style={{ margin: 0 }}>
                {roleRows.map((r) => (
                  <span key={r.label} className="ov-stage" style={{ background: r.color, color: '#fff' }}>{r.label} <b>{r.n}</b></span>
                ))}
              </div>
              <div className="stat-sub" style={{ marginTop: 12 }}>{tx("Profile completeness")}</div>
              <div className="crew-nums" style={{ marginTop: 6 }}>
                <span className="crew-num"><Phone size={13} /> {phones}/{team.length} phones set</span>
                <span className="crew-num"><Clock size={13} /> {scheds}/{team.length} schedules set</span>
              </div>
            </div>
            <div className="card card-pad">
              <div className="pc-check-head"><h3>{tx("Channel coverage")}</h3><span className="stat-sub">{tx("owner + people per channel")}</span></div>
              {channels.map((c) => {
                const heads = users.find((u) => u.id === c.head_id)
                const members = users.filter((u) => (u.departments || []).includes(c.key))
                return (
                  <div key={c.key} className="cover-row">
                    <span className="cover-name">{c.label}</span>
                    {heads
                      ? <span className="tt-who" style={{ gap: 6 }}><Avatar name={heads.name} color={heads.color} src={heads.avatar} size="xs" /> <b style={{ fontSize: 12.5 }}>{heads.name.split(' ')[0]}</b></span>
                      : <span className="no-owner-badge">{tx("no owner")}</span>}
                    <span className="spacer" />
                    <span className="stat-sub">{members.length} member{members.length === 1 ? '' : 's'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {editing && (
        <MemberModal member={editing} channels={channels} onClose={() => setEditing(null)}
          onSaved={(u) => setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)))} />
      )}
    </>
  )
}

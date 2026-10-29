import { useEffect, useState } from 'react'
import { Video, Trash2, ShieldCheck, Plus, Pencil, Check, AlertCircle } from 'lucide-react'
import { api } from '../../lib/api.js'
import { toast } from '../../lib/toast.js'
import { PERMISSIONS } from '../../lib/constants.js'
import { useChannels } from '../../lib/channels.jsx'
import { tr as tx } from '../../lib/i18n.jsx'
import Avatar from '../Avatar.jsx'
import Modal from '../Modal.jsx'
import RolePicker from '../RolePicker.jsx'

// Team → Access (N-03): the Admin panel's Team tab, lifted whole — every
// account, its role, channels, permissions and whether it owns sprints.
// Admins who run the whole board; the cards are the People tab.
const BLANK_USER = { name: '', username: '', password: '', role: 'member', crew_roles: [], departments: [], admin_channels: [], crew_channels: [], daily_cap: 0, permissions: {} }

// Who owns sprints. Kept beside the people table because that is where the
// question is asked: this person, yes or no. An admin sets it; being an admin
// is not the same as being one.
function useSprintOwners() {
  const [owners, setOwners] = useState([])
  useEffect(() => { api.get('/sprints/owners').then(setOwners).catch(() => setOwners([])) }, [])
  const toggle = async (id, on) => {
    try { setOwners(await api.put(`/sprints/owners/${id}`, { owner: on })) }
    catch (e) { toast(e.message, 'err') }
  }
  return { owners, toggle }
}

export default function Access() {
  const { owners, toggle: toggleOwner } = useSprintOwners()
  const { channels } = useChannels()
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(BLANK_USER)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [usernameTouched, setUsernameTouched] = useState(false)

  useEffect(() => { api.get('/users').then(setUsers) }, [])

  const openAdd = () => { setForm(BLANK_USER); setUsernameTouched(false); setEditing(null); setErr(''); setModal(true) }
  const openEdit = (u) => {
    setForm({ name: u.name, username: u.username, password: '', role: u.role, crew_roles: [...(u.crew_roles || [])], departments: u.departments, admin_channels: [...(u.admin_channels || [])], crew_channels: [...(u.crew_channels || [])], daily_cap: u.daily_cap || 0, permissions: { ...u.permissions } })
    setUsernameTouched(true); setEditing(u.id); setErr(''); setModal(true)
  }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      if (editing) {
        // The crew's scope and daily ceiling belong to a crew hat. Somebody
        // moved off one keeps neither: sent as they were, a crew member made a
        // member carried a hidden channel list and cap into the new role.
        const crewKind = ['editor', 'operator', 'designer', 'crew'].includes(form.role)
        const body = { name: form.name, username: form.username, role: form.role, crew_roles: form.crew_roles, departments: form.departments, admin_channels: form.admin_channels || [], crew_channels: crewKind ? form.crew_channels || [] : [], daily_cap: crewKind ? Number(form.daily_cap) || 0 : 0, permissions: form.permissions }
        if (form.password) body.password = form.password
        const u = await api.patch(`/users/${editing}`, body)
        setUsers((prev) => prev.map((x) => (x.id === editing ? u : x)))
      } else {
        const u = await api.post('/users', { ...form, color: colorFor(form.username || form.name) })
        setUsers((prev) => [...prev, u])
      }
      setModal(false)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const del = async (u) => {
    if (!confirm(`Remove ${u.name}?`)) return
    try { await api.del(`/users/${u.id}`); setUsers((prev) => prev.filter((x) => x.id !== u.id)) }
    catch (e) { alert(e.message) }
  }

  const toggleDept = (k) =>
    setForm((f) => ({ ...f, departments: f.departments.includes(k) ? f.departments.filter((d) => d !== k) : [...f.departments, k] }))
  const toggleAdminChan = (k) =>
    setForm((f) => {
      const cur = f.admin_channels || []
      return { ...f, admin_channels: cur.includes(k) ? cur.filter((d) => d !== k) : [...cur, k] }
    })
  const toggleCrewChan = (k) =>
    setForm((f) => {
      const cur = f.crew_channels || []
      return { ...f, crew_channels: cur.includes(k) ? cur.filter((d) => d !== k) : [...cur, k] }
    })
  const togglePerm = (k) =>
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [k]: !f.permissions[k] } }))

  return (
    <>
      <div className="section-head">
        <h2>{tx('Team members')}</h2>
        <span className="count">· {users.length}</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={openAdd}><Plus size={15} /> {tx('Add member')}</button>
      </div>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>{tx('Member')}</th><th>{tx('Role')}</th><th>{tx('Channels')}</th><th>{tx('Permissions')}</th><th>{tx('Sprint owner')}</th>
                  <th style={{ textAlign: 'right' }} /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="u-row">
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={u.name} color={u.color} src={u.avatar} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div className="stat-sub">@{u.username}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {u.role === 'admin' ? <span className="badge"><ShieldCheck size={12} /> {(u.admin_channels || []).length ? 'Channel admin' : 'Admin'}</span>
                    : (u.crew_roles || []).length > 0 ? <span className="badge badge-muted"><Video size={12} /> {(u.crew_roles || []).map((c) => c[0].toUpperCase() + c.slice(1)).join(' & ')}</span>
                    : <span className="badge badge-muted">{tx('Member')}</span>}
                </td>
                <td>
                  <div className="dept-chips">
                    {u.role === 'admin'
                      ? ((u.admin_channels || []).length
                        ? u.admin_channels.map((d) => {
                          const c = channels.find((x) => x.key === d)
                          return <span key={d} className="badge">{c?.label || d}</span>
                        })
                        : <span className="stat-sub">{tx('All channels')}</span>)
                      : (u.crew_roles || []).length > 0
                        ? <span className="stat-sub">{tx('Their work, any channel')}</span>
                        : u.departments.map((d) => {
                            const c = channels.find((x) => x.key === d)
                            return <span key={d} className="badge badge-muted">{c?.label || d}</span>
                          })}
                  </div>
                </td>
                <td>
                  {u.role === 'admin'
                    ? <span className="stat-sub">{tx('Everything')}</span>
                    : (u.crew_roles || []).length > 0
                      ? <span className="stat-sub">{tx('Move own work')}</span>
                      : <span className="stat-sub">{PERMISSIONS.filter((p) => u.permissions[p.key]).length}/{PERMISSIONS.length} enabled</span>}
                </td>
                <td>
                  {/* Owners may promote an idea into a sprint and change a
                      sprint after it freezes. Nothing else in the module cares
                      who you are. */}
                  <label className="checkbox-chip chip-sm">
                    <input type="checkbox" checked={owners.includes(u.id)}
                      onChange={(e) => toggleOwner(u.id, e.target.checked)} />
                    {owners.includes(u.id) ? tx('Owner') : tx('No')}
                  </label>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => openEdit(u)} data-tip={tx('Edit member, channels & rights')} aria-label="Edit"><Pencil size={15} /></button>
                    {/* Deleting somebody's account had exactly the weight of
                        editing it: two buttons side by side, one of them red,
                        on every row of a long table. It is still one press
                        away — on the row you are actually pointing at. */}
                    <button className="btn btn-danger btn-sm btn-icon u-onhover" onClick={() => del(u)} data-tip={tx('Remove this member')} data-tip-left="" aria-label={tx('Delete')}><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={editing ? tx('Edit member') : tx('Add member')}
          onClose={() => setModal(false)}
          footer={<>
            <button className="btn" onClick={() => setModal(false)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{editing ? 'Save changes' : 'Create member'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="field"><label>{tx('Name')}</label>
            <input className="input" value={form.name} autoFocus placeholder={tx('e.g. Dilnoza Karimova')}
              onChange={(e) => {
                const name = e.target.value
                setForm((f) => ({ ...f, name, username: usernameTouched ? f.username : slug(name) }))
              }} />
          </div>
          <div className="field"><label>{tx('Username')} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('— used to sign in')}</span></label>
            <input className="input" type="text" autoCapitalize="none" autoCorrect="off" value={form.username} placeholder={'dilnoza'}
              onChange={(e) => { setUsernameTouched(true); setForm({ ...form, username: e.target.value }) }} />
          </div>
          <div className="field"><label>{editing ? 'New password (leave blank to keep)' : 'Password'}</label>
            <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={tx('Set a password')} />
          </div>
          <div className="field"><label>{tx('Role')}</label>
            <RolePicker role={form.role} crewRoles={form.crew_roles}
              onChange={(role, crew_roles) => setForm({ ...form, role, crew_roles })} />
          </div>
          {form.role === 'admin' && (
            <div className="field">
              <label>{tx('Which channels do they run?')}</label>
              <div className="checkbox-row">
                {channels.map((c) => (
                  <label key={c.key} className={'checkbox-chip' + ((form.admin_channels || []).includes(c.key) ? ' on' : '')}>
                    <input type="checkbox" checked={(form.admin_channels || []).includes(c.key)} onChange={() => toggleAdminChan(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
              <div className="cm-hint">
                {(form.admin_channels || []).length === 0
                  ? 'Nothing ticked — an admin of the whole board: every channel, plus accounts, channels and the pipeline rules.'
                  : 'They run these channels only. Full reach over the work there — the dates, the crew, publishing — and no access to accounts, channels or the pipeline rules.'}
              </div>
            </div>
          )}
          {form.role === 'member' && (
            <>
              <div className="field"><label>{tx('Channels')}</label>
                <div className="checkbox-row">
                  {channels.map((c) => (
                    <label key={c.key} className={'checkbox-chip' + (form.departments.includes(c.key) ? ' on' : '')}>
                      <input type="checkbox" checked={form.departments.includes(c.key)} onChange={() => toggleDept(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field"><label>{tx('Permissions')}</label>
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
          {form.role === 'admin' && <span className="stat-sub">{tx('Admins can access every channel and do everything.')}</span>}
          {!['member', 'admin'].includes(form.role) && (
            <>
              <div className="field">
                <label>{tx('Which channels do they work on?')}</label>
                <div className="checkbox-row">
                  {channels.map((c) => (
                    <label key={c.key} className={'checkbox-chip' + ((form.crew_channels || []).includes(c.key) ? ' on' : '')}>
                      <input type="checkbox" checked={(form.crew_channels || []).includes(c.key)} onChange={() => toggleCrewChan(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
                <div className="cm-hint">
                  {(form.crew_channels || []).length === 0
                    ? 'Nothing ticked — they can be given work on any channel.'
                    : 'They only appear in the crew pickers on these channels, and cannot be assigned work on the others.'}
                </div>
              </div>
              <div className="field">
                <label>{tx('How many pieces a day?')}</label>
                <input className="input" type="number" min="0" max="50" style={{ maxWidth: 120 }}
                  value={form.daily_cap ?? 0}
                  onChange={(e) => setForm({ ...form, daily_cap: e.target.value })} />
                <div className="cm-hint">
                  {Number(form.daily_cap) > 0
                    ? `At most ${Number(form.daily_cap)} for one day — handing them one more is refused, so it is caught while it can still be moved. Counted on the day the work is due FROM them: an edit day, a shoot day, an artwork day, never the release.`
                    : 'No limit, which is what everybody was before this existed. Set a number and over-assignment is refused rather than discovered on the day.'}
                </div>
              </div>
              <span className="stat-sub">
                Production crew: no channels, no metrics, no task creation. They sign in to a daily brief of
                the tasks where they hold a hat ({(form.crew_roles || []).join(', ') || 'crew'}) — set on each task’s
                Crew row — with deadlines and hours, and they move that work through the pipeline themselves.
              </span>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

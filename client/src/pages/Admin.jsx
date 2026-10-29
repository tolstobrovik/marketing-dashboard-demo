import { useCallback, useEffect, useMemo, useState } from 'react'
import { HousekeepingSettings } from '../components/Housekeeping.jsx'
import { useSearchParams, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Users, PanelLeft, KanbanSquare, FileBarChart, Plus, Pencil, Trash2, AlertCircle, ShieldCheck, ArrowUp, ArrowDown, Check, Megaphone, ListChecks, Clapperboard, Send, Pin, Network, X, CheckSquare, Scissors, Video, History, Eye, EyeOff, Wallet, Gauge, Palette, UserCheck, RotateCcw, Languages, Loader2, SlidersHorizontal, Activity, Banknote, CheckCircle2, Undo2, HardDrive, ExternalLink, Download } from 'lucide-react'
import { api } from '../lib/api.js'
import { rewardIfFinished } from '../lib/reward.js'
import { toast, loadFailed } from '../lib/toast.js'
import { markDone } from '../lib/finish.js'
import Fold from '../components/Fold.jsx'
import { useChannels } from '../lib/channels.jsx'
import RolePicker from '../components/RolePicker.jsx'
import { CHANNEL_ICONS, iconFor, PERMISSIONS, CONTENT_TYPES, todayISO, addDaysISO, dateLabel, typeInfo, onColor, deptColor, tashkentDay, longDayLabel } from '../lib/constants.js'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import ContentModal from '../components/ContentModal.jsx'
import { useContextMenu } from '../components/ContextMenu.jsx'
import Whiteboard from '../components/Whiteboard.jsx'
import { activityLine } from '../lib/activity.js'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { StageDot, Dot, Dots } from '../components/Dot.jsx'
import TrackReports from '../components/TrackReports.jsx'

// Distinct hues so member avatars/chips are tellable apart (matches Profile).
const SWATCHES = ['#A22036', '#2a78d6', '#1D9E75', '#BA7517', '#7b5ad6', '#0e8f8f', '#d6499b', '#5a6b7a']
const STATUS_COLORS = ['#8b8388', '#fab219', '#ec835a', '#CB3351', '#A22036', '#2a78d6', '#7c5cd6', '#0ca30c']
const slug = (s) => s.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '')
const colorFor = (seed) => {
  let h = 0
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SWATCHES[h % SWATCHES.length]
}

// Round 10: thirteen tabs wrapped onto two rows. The five an admin sets the
// team's work up with are tabs; the rest (`more`) are one menu beside them.
// Settings (N-04, TZ of 19 October 2026, section 4.0): the Admin panel had
// five tabs and a "More…" select with eight more entries. Four groups now,
// each one page of the sections that belong together; what was a tab is a
// section with an anchor, so every old ?tab= link still lands on its section.
//
//   Board          the planned update and the reminders first, then the
//                  channels, the pipeline, the task form and who must be
//                  on a task, and the pay ladders
//   Team           the Telegram bridge, and which pages each kind of account has
//   Integrations   Google Drive, language help
//   Records        history, usage, every open task (until B-03 makes it a
//                  lens of the channel board), the whiteboard
const GROUPS = [
  { key: 'board', label: 'Board', icon: KanbanSquare },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'integrations', label: 'Integrations', icon: HardDrive },
  { key: 'records', label: 'Records', icon: History },
]
// The old tabs, as sections of the groups. A link to ?tab=drive lands on
// Integrations with the Drive section in view (the Drive sign-in comes back
// to exactly that address, drive-suite pins it). The old Whiteboard tab was
// ?tab=board, which is the Board group now; its section is #whiteboard.
const SECTIONS = [
  { key: 'channels', group: 'board', label: 'Channels' },
  { key: 'pipeline', group: 'board', label: 'Pipeline' },
  { key: 'settings', group: 'board', label: 'The task form' },
  { key: 'telegram', group: 'team', label: 'Telegram' },
  { key: 'pages', group: 'team', label: 'Pages' },
  { key: 'drive', label: 'Google Drive', group: 'integrations' }, // drive-suite reads this pair
  { key: 'ai', group: 'integrations', label: 'Language help' },
  { key: 'history', group: 'records', label: 'History' },
  { key: 'usage', group: 'records', label: 'Usage' },
  { key: 'tasks', group: 'records', label: 'Tasks' },
  { key: 'whiteboard', group: 'records', label: 'Whiteboard' },
]
const Sec = ({ id, children }) => <section id={`adm-${id}`} className="adm-sec">{children}</section>

export default function Admin() {
  // The group is in the URL, so a group can be linked to; a section is the
  // hash. An old tab key is turned into its group and section once, on the
  // way in.
  const [params] = useSearchParams()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const wanted = params.get('tab')
  const old = SECTIONS.find((s) => s.key === wanted && !GROUPS.some((g) => g.key === wanted))
  useEffect(() => {
    if (!old) return
    const next = new URLSearchParams(params)
    next.set('tab', old.group)
    navigate({ search: `?${next}`, hash: `#${old.key}` }, { replace: true })
  }, [wanted]) // eslint-disable-line react-hooks/exhaustive-deps
  const tab = GROUPS.some((g) => g.key === wanted) ? wanted : 'board'
  const setTab = (key) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    navigate({ search: `?${next}`, hash: '' }, { replace: true })
  }
  // The section the hash names comes into view once its group has drawn.
  useEffect(() => {
    if (!hash) return
    // After the sections above it have fetched and grown — a section that
    // scrolled into view at 350 ms was pushed down by the Drive card's answer.
    const t = setTimeout(() => document.getElementById(`adm-${hash.slice(1)}`)?.scrollIntoView({ block: 'start' }), 900)
    return () => clearTimeout(t)
  }, [hash, tab])
  // A channel row's "Report" button opens that channel's month on Numbers
  // (N-02): the reports and the payroll live there now, not in this panel.
  const openReport = (key) => navigate(`/numbers?tab=month&channel=${key}`)
  if (wanted === 'reports' || wanted === 'pay') return <Navigate to={`/numbers?tab=${wanted === 'pay' ? 'pay' : 'month'}`} replace />
  // …and the team's table is Team → Access (N-03).
  if (wanted === 'team' && !old) return <Navigate to="/team?tab=access" replace />
  return (
    <>
      <div className="tabs">
        {GROUPS.map((g) => {
          const Icon = g.icon
          return (
            <button key={g.key} className={'tab' + (tab === g.key ? ' active' : '')} onClick={() => setTab(g.key)}>
              <Icon size={16} /> {tx(g.label)}
            </button>
          )
        })}
      </div>
      {tab === 'board' && (
        <>
          <Sec id="notice"><SettingsTab only={['notice', 'reminders']} /></Sec>
          <Sec id="channels"><ChannelsTab onOpenReport={openReport} /></Sec>
          <Sec id="pipeline"><PipelineTab /></Sec>
          <Sec id="settings"><SettingsTab only={['taskform']} /></Sec>
        </>
      )}
      {tab === 'team' && (
        <>
          <Sec id="telegram"><TelegramTab /></Sec>
          <Sec id="pages"><SettingsTab only={['pages']} /></Sec>
        </>
      )}
      {tab === 'integrations' && (
        <>
          <Sec id="drive"><DriveTab /></Sec>
          <Sec id="ai"><AiTab /></Sec>
        </>
      )}
      {tab === 'records' && (
        <>
          <Sec id="history"><HistoryTab /></Sec>
          <Sec id="usage"><UsageTab /></Sec>
          <Sec id="tasks"><TasksTab /></Sec>
          <Sec id="whiteboard"><Whiteboard /></Sec>
        </>
      )}
    </>
  )
}

/* ==================== GOOGLE DRIVE (where footage and cuts go) ============ */
/* One connection for the whole team: an admin presses Connect and signs in to
   the team's Google account themselves — this page never sees a password. From
   then on the crew upload footage, cuts and artwork from the hand-in window
   straight into a folder per task, and the link fills itself in. Until the app
   has an identity with Google (two repository secrets), this page says how. */
function DriveTab() {
  const [st, setSt] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [params, setParams] = useSearchParams()
  const load = () => api.get('/drive/status').then(setSt).catch((e) => setMsg(e.message))
  useEffect(() => {
    load()
    // Back from Google's consent screen: say how it went, once.
    const said = params.get('drive'), bad = params.get('drive_error')
    if (said || bad) {
      if (said === 'connected') toast(tx('Google Drive connected'), 'ok')
      else setMsg(bad || (said === 'cancelled' ? tx('Connecting was cancelled on Google’s page.') : tx('Only an admin of the whole board can connect Google Drive.')))
      setParams((p) => { const n = new URLSearchParams(p); n.delete('drive'); n.delete('drive_error'); return n }, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const connectNow = async () => {
    setBusy(true); setMsg('')
    try { window.location.assign((await api.post('/drive/connect', {})).url) } catch (e) { setMsg(e.message); setBusy(false) }
  }
  const disconnectNow = async () => {
    if (!confirm(tx('Disconnect Google Drive? Files already uploaded stay in Drive; nobody can upload new ones until it is connected again.'))) return
    setBusy(true); setMsg('')
    try { await api.post('/drive/disconnect', {}); await load() } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  if (!st) return <div className="card card-pad"><div className="stat-sub">{msg || tx('Checking Google Drive…')}</div></div>
  return (
    <>
      <div className="section-head"><h2>{tx('Google Drive')}</h2></div>
      <div className="card card-pad gd-card">
        {st.connected ? (
          <>
            <div className="gd-state on">
              <CheckCircle2 size={18} />
              <span>{tx('Connected to {email}', { email: st.email || '—' })}{st.connected_by ? <span className="stat-sub"> · {st.connected_by}, {dateLabel(String(st.connected_at || '').slice(0, 10))}</span> : null}</span>
            </div>
            <div className="stat-sub">{tx('Editors, filmers and designers now see “Upload to Google Drive” when they hand work in. Each task gets its own folder; anyone with a link can view.')}</div>
            <div className="gd-row">
              {st.folder_url && <a className="btn btn-sm" href={st.folder_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tx('Open the folder')}</a>}
              <button className="btn btn-sm" onClick={disconnectNow} disabled={busy}>{tx('Disconnect')}</button>
            </div>
            <DropIn st={st} busy={busy} onConnect={connectNow} />
          </>
        ) : st.configured ? (
          <>
            <div className="gd-state"><HardDrive size={18} /><span>{tx('Not connected yet.')}</span></div>
            <div className="stat-sub">{tx('Press Connect and sign in to the team’s Google account on Google’s own page. The dashboard writes only the files it creates, and only reads the three drop folders.')}</div>
            <div className="gd-row">
              <button className="btn btn-primary btn-sm" onClick={connectNow} disabled={busy}><HardDrive size={14} /> {tx('Connect Google Drive')}</button>
            </div>
            <DropIn st={st} busy={busy} />
            <div className="stat-sub">{tx('Redirect URI on record with Google:')} <span className="gd-uri">{st.redirect_uri}</span></div>
          </>
        ) : (
          <>
            <div className="gd-state"><HardDrive size={18} /><span>{tx('Google Drive isn’t set up on the server yet — five minutes, once:')}</span></div>
            <ol className="gd-steps">
              <li>{tx('Signed in as the team’s Google account, open')} <b>{'console.cloud.google.com'}</b> {tx('→ create a project →')} <b>{tx('APIs & Services → Library')}</b> {tx('→ enable')} <b>{'Google Drive API'}</b>.</li>
              <li><b>{tx('OAuth consent screen')}</b>{tx(': External, app name “SATashkent Dashboard”, add the scopes')} <code>{'…/auth/drive.file'}</code> {tx('(uploads) and')} <code>{'…/auth/drive.readonly'}</code> {tx('(drop-in reads the three drop folders) — then')} <b>{tx('Publish app')}</b> {tx('(left in Testing, the connection expires after 7 days). Publishing asks for the home page')} <code>{'https://marketing.satashkent.uz'}</code> {tx('and the privacy policy')} <code>{'https://marketing.satashkent.uz/privacy'}</code>.</li>
              <li><b>{tx('Credentials → Create credentials → OAuth client ID → Web application')}</b>. Authorized redirect URI: <code>{st.redirect_uri}</code></li>
              <li>{tx('Copy the client ID and secret into the repository secrets')} <code>{'GOOGLE_CLIENT_ID'}</code> {tx('and')} <code>{'GOOGLE_CLIENT_SECRET'}</code> {tx('(GitHub → Settings → Secrets → Actions), then')} <b>{'Actions → deploy → Run workflow'}</b>.</li>
              <li>{tx('Come back here and press')} <b>{tx('Connect Google Drive')}</b>.</li>
            </ol>
          </>
        )}
        {msg && <div className="form-error">{msg}</div>}
      </div>
    </>
  )
}

/* Drive drop-in (server/dropin.js): files the crew drop into three folders in
   the connected Drive find their task by name. On, it shows where the folders
   are and what the crew need to use them; off, it says why, beside the button
   that fixes it. The reason is the server's (watchState); only the words are
   here. */
const DROP_OFF = {
  disconnected: () => tx('Connect Google Drive to turn on drop-in.'),
  reconnect: () => tx('Reconnect Google Drive to turn on drop-in. The connection was made without permission to read the drop folders: on Google’s page, leave every box ticked.'),
  folders: () => tx('The drop folders could not be made in Drive. Reconnect Google Drive to try again.'),
  off: () => tx('Drop-in is switched off on this server (DRIVE_WATCH=off). Remove that setting and deploy again to turn it on.'),
}
function DropIn({ st, busy, onConnect }) {
  const drop = st.drop || {}
  const f = st.drop_folders
  return (
    <div className="co-dropin">
      <h3>{tx('Drop-in from Google Drive')}</h3>
      <p className="stat-sub">{tx('Files dropped into three folders in this Drive find their task by name (“Copy file name” in every task) and show up on it within two minutes. Files nobody can match wait under More → Lost files.')}</p>
      {drop.on ? (
        <>
          <div className="gd-state on"><CheckCircle2 size={18} /><span>{tx('Drop-in is on.')}</span></div>
          {f && (
            <div className="gd-row">
              <a className="btn btn-sm" href={f.recording.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tx('Recording')}</a>
              <a className="btn btn-sm" href={f.pravka.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tx('Pravka')}</a>
              <a className="btn btn-sm" href={f.ready.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {tx('Ready')}</a>
            </div>
          )}
          <p className="stat-sub">{tx('The crew need edit access to the parent folder “SATashkent Marketing drop” to drop files: share it with them once, in Google Drive.')}{f?.parent?.url && <> <a href={f.parent.url} target="_blank" rel="noreferrer">{tx('Open the parent folder')}</a></>}</p>
        </>
      ) : (
        <div className="co-note co-n-wait" role="status">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{(DROP_OFF[drop.reason] || DROP_OFF.disconnected)()}</span>
          {onConnect && (drop.reason === 'reconnect' || drop.reason === 'folders') && (
            <span className="co-btns">
              <button type="button" className="co-btn co-btn-p co-btn-sm" onClick={onConnect} disabled={busy}><HardDrive size={16} aria-hidden="true" />{tx('Reconnect Google Drive')}</button>
            </span>
          )}
        </div>
      )}
      {onConnect && (drop.reason === 'reconnect' || drop.reason === 'folders') && (
        <p className="stat-sub">{tx('After you press: Google’s page opens. Sign in to the team’s account and allow both. Uploads keep working the whole time.')}</p>
      )}
    </div>
  )
}

/* ==================== TELEGRAM (the bot's admin panel) =================== */
/* The bridge at a glance: is it configured, where the webhook points (straight
   from Telegram, last error included), who of the team is wired up — with an
   admin unlink for people who left — and a broadcast line to everyone linked. */
function TelegramTab() {
  const [st, setSt] = useState(null)
  const [msg, setMsg] = useState('')
  const [cast, setCast] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => api.get('/telegram/admin').then(setSt).catch((e) => setMsg(e.message))
  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const activate = async () => {
    setMsg(''); setBusy(true)
    try {
      const out = await api.post('/telegram/set-webhook', {})
      setMsg(out.ok ? `Webhook set: ${out.url}` : 'Telegram refused the webhook — check the token')
      await load()
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const unlink = async (u) => {
    if (!confirm(`Disconnect ${u.name} from the bot?`)) return
    try { await api.post('/telegram/admin/unlink', { user_id: u.id }); await load() } catch (e) { setMsg(e.message) }
  }
  const broadcast = async () => {
    const text = cast.trim()
    if (!text) return
    setBusy(true); setMsg('')
    try {
      const out = await api.post('/telegram/broadcast', { text })
      toast(`Sent to ${out.sent} ${out.sent === 1 ? 'person' : 'people'}`, 'ok')
      setCast('')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  if (!st) return <div className="card card-pad"><div className="stat-sub">{tx('Checking the bridge…')}</div></div>
  const linked = st.members.filter((m) => m.linked)
  return (
    <>
      <div className="section-head"><h2>{tx('The bridge')}</h2></div>
      <div className="card card-pad">
        {!st.enabled ? (
          <div className="stat-sub">
            {tx('The bot isn’t configured. Put the @BotFather token into the repository secret')} <b>{'TELEGRAM_BOT_TOKEN'}</b>{tx(', redeploy — then press Activate here.')}
          </div>
        ) : (
          <>
            <div className="stat-sub" style={{ marginBottom: 8 }}>
              Bot: <b>{st.bot ? `@${st.bot}` : '—'}</b>
              {' · '}Webhook: {st.webhook?.url ? <b>{st.webhook.url}</b> : <b>{tx('not set')}</b>}
              {st.webhook?.last_error_message ? <> · <span style={{ color: 'var(--critical)' }}>last error: {st.webhook.last_error_message}</span></> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={activate} disabled={busy}>{tx('Activate webhook')}</button>
              <span className="stat-sub">Once after the token lands or the domain changes{st.public_url ? <> · task links point to <b>{st.public_url}</b></> : null}.</span>
            </div>
          </>
        )}
        {msg && <div className="stat-sub" style={{ marginTop: 8 }}>{msg}</div>}
      </div>

      <div className="section-head" style={{ marginTop: 18 }}><h2>{tx('Connected')}</h2><span className="count">· {linked.length} of {st.members.length}</span></div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {st.members.map((m) => (
          <div key={m.id} className="alog-row">
            <b className="alog-who">{m.name}</b>
            <span className="stat-sub">@{m.username}{m.role === 'admin' ? ' · admin' : ''}</span>
            <span style={{ flex: 1 }} />
            {m.linked
              ? <><span className="save-ok"><Check size={14} /> {tx('connected')}</span>
                <button className="btn btn-sm" onClick={() => unlink(m)}>{tx('Unlink')}</button></>
              : <span className="stat-sub">—</span>}
          </div>
        ))}
      </div>

      {st.enabled && (
        <>
          <div className="section-head" style={{ marginTop: 18 }}><h2>{tx('Broadcast')}</h2></div>
          <div className="card card-pad">
            <div className="stat-sub" style={{ marginBottom: 8 }}>{tx('One announcement to everyone connected — planning changes, «планёрка в 15:00».')}</div>
            <div className="add-inline">
              <input className="input" value={cast} placeholder={tx('Write the announcement…')}
                onChange={(e) => setCast(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); broadcast() } }} />
              <button className="btn btn-primary btn-sm" onClick={broadcast} disabled={busy || !cast.trim() || linked.length === 0}>
                <Send size={14} /> Send to {linked.length}
              </button>
            </div>
          </div>

          <Reminders members={st.members} />
        </>
      )}
    </>
  )
}

/* ---- the reminders an admin keeps ready ----------------------------------
   The nudges worth repeating — "is the week planned?", "does every task carry
   its brief?" — written once and kept. Each can be fired at anybody on the
   spot, or left to arrive by itself on chosen weekdays at a chosen hour. */
const WEEK = [{ d: 1, l: 'Mon' }, { d: 2, l: 'Tue' }, { d: 3, l: 'Wed' }, { d: 4, l: 'Thu' }, { d: 5, l: 'Fri' }, { d: 6, l: 'Sat' }, { d: 0, l: 'Sun' }]
const BLANK = { title: '', text: '', audience: 'linked', days: [], hour: 9, enabled: true }
function Reminders({ members }) {
  const [list, setList] = useState(null)
  const [edit, setEdit] = useState(null)     // the template being written
  const [picking, setPicking] = useState(null) // { tpl, ids }
  const [busy, setBusy] = useState(false)
  const load = () => api.get('/telegram/templates').then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const linked = members.filter((m) => m.linked)

  const save = async () => {
    if (!edit.title.trim() || !edit.text.trim()) return
    setBusy(true)
    try {
      if (edit.id) await api.patch(`/telegram/templates/${edit.id}`, edit)
      else await api.post('/telegram/templates', edit)
      setEdit(null); await load(); toast(tx('Reminder saved — synced'))
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const toggle = async (t) => {
    try { await api.patch(`/telegram/templates/${t.id}`, { enabled: !t.enabled }); await load() } catch (e) { alert(e.message) }
  }
  const remove = async (t) => {
    if (!confirm(`Delete the reminder “${t.title}”?`)) return
    try { await api.del(`/telegram/templates/${t.id}`); await load() } catch (e) { alert(e.message) }
  }
  const sendNow = async (tpl, ids) => {
    setBusy(true)
    try {
      const out = await api.post(`/telegram/templates/${tpl.id}/send`, ids ? { user_ids: ids } : {})
      toast(out.sent ? `Sent to ${out.sent} ${out.sent === 1 ? 'person' : 'people'}` : 'Nobody in that audience is connected yet', out.sent ? 'ok' : 'err')
      setPicking(null)
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const whoReads = (a) => (a === 'linked' ? 'everyone connected'
    : a.startsWith('role:') ? `${a.slice(5)}s`
      : a.startsWith('channel:') ? `the ${a.slice(8)} team` : 'chosen people')

  if (!list) return null
  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>{tx('Reminders')}</h2>
        <span className="count">{tx('· send on the spot, or let them arrive on their own')}</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setEdit({ ...BLANK })}><Plus size={14} /> {tx('New reminder')}</button>
      </div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {list.length === 0 && <div className="stat-sub" style={{ padding: '10px 0' }}>{tx('No reminders yet.')}</div>}
        {list.map((t) => (
          <div key={t.id} className="rem-row">
            <button className={'side-eye' + (t.enabled ? '' : ' off')} onClick={() => toggle(t)}
              data-tip={t.enabled ? 'Scheduled — turn off' : 'Manual only — turn the schedule on'}
              aria-label={t.enabled ? 'Disable schedule' : 'Enable schedule'}>
              {t.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <span className="rem-main">
              <b className="rem-title">{t.title}</b>
              <span className="rem-sub">
                {t.days.length > 0
                  ? <>every {t.days.map((d) => WEEK.find((w) => w.d === d)?.l).join(', ')} at {String(t.hour).padStart(2, '0')}:00</>
                  : <>on demand only</>}
                {' · '}{whoReads(t.audience)}
                {t.last_sent ? ` · last sent ${t.last_sent}` : ''}
              </span>
            </span>
            <button className="btn btn-sm" onClick={() => setPicking({ tpl: t, ids: linked.map((m) => m.id) })}
              disabled={busy || linked.length === 0}><Send size={13} /> {tx('Send')}</button>
            <button className="btn btn-sm" onClick={() => setEdit({ ...t })}>Edit</button>
            <button className="icon-btn" onClick={() => remove(t)} aria-label={tx('Delete reminder')}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {edit && (
        <Modal title={edit.id ? 'Edit reminder' : 'New reminder'} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn" onClick={() => setEdit(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !edit.title.trim() || !edit.text.trim()}>{tx('Save')}</button>
          </>}>
          <div className="field"><label>{tx('Name — for you, not for them')}</label>
            <input className="input" autoFocus value={edit.title} placeholder={tx('e.g. Is the week planned?')}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </div>
          <div className="field"><label>{tx('The message')}</label>
            <textarea className="input" rows={5} value={edit.text}
              placeholder={tx('Write it the way you would say it — warm, short, and ending in one clear action.')}
              onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          </div>
          <div className="field"><label>{tx('Who hears it')}</label>
            <select className="select" value={edit.audience} onChange={(e) => setEdit({ ...edit, audience: e.target.value })}>
              <option value="linked">{tx('Everyone connected')}</option>
              <option value="role:member">{tx('Members')}</option>
              <option value="role:editor">{tx('Editors')}</option>
              <option value="role:operator">{tx('Operators')}</option>
              <option value="role:designer">{tx('Designers')}</option>
              <option value="role:admin">{tx('Admins')}</option>
            </select>
          </div>
          <div className="field"><label>{tx('When it arrives by itself')}</label>
            <div className="pill-group" style={{ flexWrap: 'wrap' }}>
              {WEEK.map((w) => (
                <button key={w.d} type="button"
                  className={'pill' + (edit.days.includes(w.d) ? ' active' : '')}
                  onClick={() => setEdit({ ...edit, days: edit.days.includes(w.d) ? edit.days.filter((x) => x !== w.d) : [...edit.days, w.d] })}>
                  {w.l}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span className="stat-sub">{tx('at')}</span>
              <select className="select" style={{ maxWidth: 110 }} value={edit.hour}
                onChange={(e) => setEdit({ ...edit, hour: Number(e.target.value) })}>
                {[...Array(24)].map((_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span className="stat-sub">Tashkent{edit.days.length === 0 ? ' — pick days above, or leave it for hand-sending' : ''}</span>
            </div>
          </div>
        </Modal>
      )}

      {picking && (
        <Modal title={`Send “${picking.tpl.title}”`} onClose={() => setPicking(null)}
          footer={<>
            <button className="btn" onClick={() => setPicking(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" disabled={busy || picking.ids.length === 0}
              onClick={() => sendNow(picking.tpl, picking.ids)}>
              <Send size={14} /> Send to {picking.ids.length}
            </button>
          </>}>
          <div className="stat-sub" style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{picking.tpl.text}</div>
          <div className="field"><label>{tx('Who gets it now')}</label>
            <div className="checkbox-row">
              {linked.map((m) => (
                <label key={m.id} className={'checkbox-chip chip-sm' + (picking.ids.includes(m.id) ? ' on' : '')}>
                  <input type="checkbox" checked={picking.ids.includes(m.id)}
                    onChange={() => setPicking({
                      ...picking,
                      ids: picking.ids.includes(m.id) ? picking.ids.filter((x) => x !== m.id) : [...picking.ids, m.id],
                    })} />
                  {m.name}
                </label>
              ))}
            </div>
            {linked.length === 0 && <div className="stat-sub">{tx('Nobody has connected Telegram yet.')}</div>}
          </div>
        </Modal>
      )}
    </>
  )
}

/* ==================== HISTORY (the whole team's paper trail) ============= */
/* Every change anyone made, newest first, written as a sentence — "Mirabbos
   changed the shoot start: 10:00 → 11:00 on «Campus tour»". The task link
   opens the piece; deleted tasks keep their name on the record. */
// The sprint backlog, kept (B-08). The server writes the ideas as a dated
// Markdown note (GET /fields/records/sprint-backlog) and keeps the last one
// it wrote, so the note outlives the Sprints pages and their tables.
function BacklogNote() {
  const [note, setNote] = useState(null)
  useEffect(() => { api.get('/fields/records/sprint-backlog').then(setNote).catch(() => {}) }, [])
  if (!note?.count) return null
  const download = () => {
    const url = URL.createObjectURL(new Blob([note.markdown], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `sprint-backlog-${note.day}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return (
    <div className="card card-pad adm-backlog">
      <div className="section-head" style={{ marginTop: 0 }}>
        <h2>{tx('Sprint backlog')}</h2>
        <span className="stat-sub">{tx('Kept {day} · {n} ideas', { day: longDayLabel(note.day), n: note.count })}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm" onClick={download}><Download size={13} /> {tx('Download as Markdown')}</button>
      </div>
      <ul className="adm-backlog-list">
        {note.items.map((it) => (
          <li key={it.id}><b>{it.title}</b>{it.added_by ? <span className="stat-sub"> · {it.added_by}</span> : null}</li>
        ))}
      </ul>
    </div>
  )
}

function HistoryTab() {
  const [rows, setRows] = useState([])
  const [who, setWho] = useState('all')
  useEffect(() => {
    let on = true
    const load = () => api.get('/content/activity/all').then((r) => { if (on) setRows(r) }).catch(() => {})
    load()
    const id = setInterval(load, 15000)
    return () => { on = false; clearInterval(id) }
  }, [])
  const people = useMemo(() => [...new Set(rows.map((r) => r.user_name).filter(Boolean))].sort(), [rows])
  const shown = who === 'all' ? rows : rows.filter((r) => r.user_name === who)
  const when = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
  return (
    <>
      <BacklogNote />
      <div className="section-head">
        <h2>{tx('History')}</h2><span className="count">· {shown.length}</span>
        <span style={{ flex: 1 }} />
        <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label={tx('Filter by person')}>
          <option value="all">{tx('Everyone')}</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {shown.map((a) => (
          <div key={a.id} className="alog-row">
            <span className="alog-when">{when(a.created_at)}</span>
            <b className="alog-who">{a.user_name || '?'}</b>
            <span className="alog-text">
              {activityLine(a)} on{' '}
              {a.kind !== 'deleted' && a.content_id
                ? <a className="alog-task" href={`/brief?task=${a.content_id}`}>«{a.content_title}»</a>
                : <>«{a.content_title}»</>}
            </span>
          </div>
        ))}
        {shown.length === 0 && <div className="empty">{tx('No changes')}</div>}
      </div>
    </>
  )
}

/* ==================== USAGE (is it being used, and for what) ============= */
/* Two questions with no answer before this: is this person on the platform at
   all, and which parts of it does anybody touch. Both are counted per person
   per DAY — minutes with the board in front of them, and presses of buttons
   the app itself names. There is deliberately no moment-by-moment log: see
   server/routes/usage.js. */
function UsageTab() {
  const [span, setSpan] = useState('7')
  const [data, setData] = useState(null)
  const [who, setWho] = useState(0)
  const to = todayISO()
  const from = span === 'today' ? to : addDaysISO(to, -(Number(span) - 1))
  useEffect(() => {
    let on = true
    setData(null)
    api.get(`/usage?from=${from}&to=${to}`).then((r) => { if (on) setData(r) }).catch(() => { if (on) setData({ rows: [], buttons: [], pages: [], per_person: {} }) })
    return () => { on = false }
  }, [from, to])

  // "3h 20m" reads; 12000 does not.
  const spell = (secs) => {
    const m = Math.round((Number(secs) || 0) / 60)
    if (m < 1) return '—'
    const h = Math.floor(m / 60)
    return h ? `${h}h ${m % 60}m` : `${m}m`
  }
  const seen = (iso) => (iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    : tx('never'))

  if (!data) return <div className="card"><span className="spinner" /></div>
  const rows = data.rows || []
  const busiest = Math.max(1, ...rows.map((r) => r.seconds || 0))
  const mine = who ? (data.per_person?.[who] || []) : (data.buttons || [])
  const topN = Math.max(1, ...mine.map((b) => b.n))
  const quiet = rows.filter((r) => !r.seconds).length

  return (
    <>
      <div className="section-head">
        <h2>{tx('Usage')}</h2>
        <span className="count">· {tx('{n} on the board', { n: rows.length - quiet })}</span>
        <span style={{ flex: 1 }} />
        <div className="pill-group usage-span">
          {[['today', tx('Today')], ['7', tx('7 days')], ['30', tx('30 days')]].map(([k, label]) => (
            <button key={k} className={'pill' + (span === k ? ' active' : '')} onClick={() => setSpan(k)}>{label}</button>
          ))}
        </div>
      </div>
      <p className="stat-sub" style={{ margin: '0 0 10px' }}>
        {tx('Minutes with the board open in front of somebody, and the buttons they pressed, per day. Below: every page and press by name since 14 October, to find where the board is hard to use — never what anybody typed.')}
      </p>

      <div className="usage-grid">
        <div className="card usage-people">
          <table className="tbl usage-tbl">
            <thead>
              <tr>
                <th>{tx('Person')}</th>
                <th>{tx('Time on the platform')}</th>
                <th>{tx('Days')}</th>
                <th>{tx('Presses')}</th>
                <th>{tx('Last seen')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={(who === r.id ? 'on ' : '') + (r.seconds ? '' : 'usage-quiet')}
                  onClick={() => setWho(who === r.id ? 0 : r.id)}>
                  <td>
                    <span className="usage-who">
                      <Avatar name={r.name} color={r.color} src={r.avatar} size="sm" />
                      <span>{r.name}</span>
                    </span>
                  </td>
                  <td>
                    <span className="usage-bar" aria-hidden="true">
                      <i style={{ width: `${Math.round((r.seconds / busiest) * 100)}%` }} />
                    </span>
                    <b className="usage-num">{spell(r.seconds)}</b>
                  </td>
                  <td>{r.days || '—'}</td>
                  <td>{r.taps || '—'}</td>
                  <td className="stat-sub">{seen(r.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {quiet > 0 && (
            <div className="stat-sub" style={{ padding: '8px 4px 2px' }}>
              {tx('{n} people did not open the board in this window.', { n: quiet })}
            </div>
          )}
        </div>

        <div className="card usage-buttons">
          <div className="section-head" style={{ marginTop: 0 }}>
            <h3>{who ? tx('What they press') : tx('What people press')}</h3>
            {who > 0 && (
              <button className="btn btn-sm" onClick={() => setWho(0)}>{tx('Everyone')}</button>
            )}
          </div>
          {mine.length === 0 && <div className="empty">{tx('Nothing pressed')}</div>}
          {mine.map((b) => (
            <div key={b.action} className="usage-act">
              <span className="usage-act-name">{b.action}</span>
              <span className="usage-bar"><i style={{ width: `${Math.round((b.n / topN) * 100)}%` }} /></span>
              <b className="usage-num">{b.n}</b>
            </div>
          ))}
          {!who && (data.pages || []).length > 0 && (
            <>
              <div className="section-head"><h3>{tx('Where they go')}</h3></div>
              {data.pages.map((b) => (
                <div key={b.action} className="usage-act">
                  <span className="usage-act-name">{b.action}</span>
                  <span className="usage-bar"><i style={{ width: `${Math.round((b.n / Math.max(1, data.pages[0].n)) * 100)}%` }} /></span>
                  <b className="usage-num">{b.n}</b>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <TrackReports />
    </>
  )
}

/* ==================== TASKS (everyone's to-dos, per channel) ============= */
/* Module-level on purpose: an inline component would remount every row on
   each state change (poll ticks, modals), losing hover and focus. */
function TaskRow({ item, ctx }) {
  const { statusesById, usersById, byKey, toggle, setOpenItem, togglePin, removeTask, openMenu } = ctx
  const isDone = !!item.done_at
  const status = statusesById[item.status_id]
  // Everyone it was handed to, not whoever happened to be first in the list.
  const held = (item.assignees?.length ? item.assignees : item.assignee_id ? [item.assignee_id] : [])
  const who = usersById[held[0]]
  return (
    <div className={'todo-row' + (item.pinned && !isDone ? ' pinned' : '')}
      onContextMenu={(e) => openMenu(e, [
        { label: 'Open', icon: Pencil, onClick: () => setOpenItem(item) },
        { label: isDone ? 'Mark as not done' : 'Mark as done', icon: Check, onClick: () => toggle(item) },
        !isDone && { label: item.pinned ? 'Unpin' : 'Pin to the top', icon: Pin, onClick: () => togglePin(item) },
        { sep: true },
        { label: 'Delete', icon: Trash2, danger: true, onClick: () => removeTask(item) },
      ])}>
      <button className={`todo-check${isDone ? ' on' : ''}`} onClick={() => toggle(item)} data-tip={isDone ? 'Mark as not done' : 'Mark as done'} aria-label={tx('Complete')}>
        {isDone && <Check size={15} strokeWidth={3.5} />}
      </button>
      <button className="todo-main" onClick={() => setOpenItem(item)} data-tip={tx('Open the task')}>
        <span className={`todo-title${isDone ? ' done-txt' : ''}`}>{item.title}</span>
        <span className="todo-meta">
          {!!item.pinned && !isDone && <span className="chip chip-pin"><Pin size={10} /> {tx('Pinned')}</span>}
          <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
          {item.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
          {status && !isDone && <StageDot status={status} />}
          {item.recording_date && <span className="chip chip-muted"><Clapperboard size={10} /> {dateLabel(item.recording_date)}</span>}
          {item.release_date && (
            <span className="chip chip-muted" data-late={!isDone && item.release_date < todayISO() ? '1' : undefined}
              data-tip={!isDone && item.release_date < todayISO() ? 'Past its release date' : undefined}>
              <Send size={10} /> {dateLabel(item.release_date)}
            </span>
          )}
          {/* One name and how many more, the way the board's cards do it — a
              task handed to two people used to name only the first. */}
          {who && (
            <span className="chip chip-muted">
              {who.name.split(' ')[0]}{held.length > 1 ? ` +${held.length - 1}` : ''}
            </span>
          )}
        </span>
      </button>
      <span className="todo-actions">
        {!isDone && (
          <button className={'icon-btn pin-btn' + (item.pinned ? ' on' : '')} onClick={() => togglePin(item)}
            data-tip={item.pinned ? 'Unpin' : 'Pin to the top for everyone'} data-tip-left="" aria-label={tx('Pin')}>
            <Pin size={14} />
          </button>
        )}
        <button className="icon-btn del-btn" onClick={() => removeTask(item)} data-tip={tx('Delete this task')} data-tip-left="" aria-label={tx('Delete task')}>
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
}

function TasksTab() {
  const { visible, byKey } = useChannels()
  const [items, setItems] = useState([])
  const [statuses, setStatuses] = useState([])
  const [users, setUsers] = useState([])
  const [chan, setChan] = useState('all')
  const [openItem, setOpenItem] = useState(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.get('/content'), api.get('/statuses'), api.get('/users')])
      .then(([ct, st, us]) => { setItems(ct); setStatuses(st); setUsers(us) })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])

  // Live sync: new tasks and completions from the team appear on their own.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem || creating) return
      api.poll('/content').then((fresh) => { if (fresh) setItems(fresh) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem, creating])

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])
  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const filtered = chan === 'all' ? items : items.filter((i) => i.channels.includes(chan))
  const open = filtered.filter((i) => !i.done_at).sort((a, b) => (b.pinned || 0) - (a.pinned || 0))
  const done = filtered.filter((i) => i.done_at)

  const toggle = (item) => markDone(item, updateContent, setOpenItem)
  const updateContent = async (item, payload) => {
    const c = await api.patch(`/content/${item.id}`, payload)
    rewardIfFinished(item, c)
    setItems((prev) => prev.map((x) => (x.id === item.id ? c : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setItems((prev) => prev.filter((x) => x.id !== item.id))
  }
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setItems((prev) => [c, ...prev])
    return c
  }

  const togglePin = async (item) => {
    try {
      const u = await api.patch(`/content/${item.id}`, { pinned: !item.pinned })
      setItems((prev) => prev.map((x) => (x.id === item.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  const removeTask = async (item) => {
    if (!confirm(`Delete “${item.title}”?`)) return
    try { await deleteContent(item) } catch (e) { alert(e.message) }
  }

  // A hook, so above the loading return: below it, React saw one hook more
  // once the list had loaded and warned on every Records page (N-04).
  const { openMenu } = useContextMenu()
  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const rowCtx = { statusesById, usersById, byKey, toggle, setOpenItem, togglePin, removeTask, openMenu }

  return (
    <>
      <div className="pill-group" style={{ marginBottom: 6, alignItems: 'center' }}>
        <button className={'pill' + (chan === 'all' ? ' active' : '')} onClick={() => setChan('all')}>{tx('All channels')}</button>
        {visible.map((c) => (
          <button key={c.key} className={'pill' + (chan === c.key ? ' active' : '')} onClick={() => setChan(c.key)}>{c.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={15} /> {tx('New task')}</button>
      </div>

      <div className="section-head"><h2>{tx('Open')}</h2><span className="count">· {open.length}</span></div>
      <div className="card" style={{ padding: '4px 14px' }}>
        {open.map((i) => <TaskRow key={i.id} item={i} ctx={rowCtx} />)}
        {open.length === 0 && <div className="empty">{tx('Nothing open')}</div>}
      </div>

      {done.length > 0 && (
        <>
          <div className="section-head"><h2>{tx('Completed')}</h2><span className="count">· {done.length}</span></div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {done.map((i) => <TaskRow key={i.id} item={i} ctx={rowCtx} />)}
          </div>
        </>
      )}

      {openItem && (
        <ContentModal key={openItem?.id || 'new'}
          item={openItem}
          statuses={statuses}
          onClose={(next) => setOpenItem(next?.id ? next : null)}
          onCreate={() => {}}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
      {creating && (
        <ContentModal key='new'
          item={null}
          statuses={statuses}
          defaults={chan !== 'all' ? { channels: [chan] } : {}}
          onClose={() => setCreating(false)}
          onCreate={createContent}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      )}
    </>
  )
}



/* ==================== LANGUAGE HELP ==================== */
/* Who translates the briefs, and whether it costs anything.
 *
 * "Is a key set" and "does it work from where this is deployed" are different
 * questions, and only the second one matters — a free endpoint that is fine
 * from a laptop can be blocked from a data centre. So Test them now really
 * calls each one with two words and reports what came back. */
// Who came, and when.
//
// Nobody is late by default. A day nobody has looked at says nothing, and the
// register only ever says what an admin said, which is why "on time" is a
// state somebody chooses rather than what an empty row means.

function AiTab() {
  const [st, setSt] = useState(null)
  const [probe, setProbe] = useState(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({})
  const load = () => api.get('/ai/status').then(setSt).catch(() => setSt(null))
  // Wrapped, not passed: load returns a Promise, and an effect that returns
  // one has React calling it as the cleanup when the tab is left.
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const runProbe = useCallback(async () => {
    setBusy(true)
    try { setProbe((await api.post('/ai/probe', {})).results) }
    catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }, [])
  // Reachability answers itself on arrival. It used to sit on a dash until
  // somebody found the button, which reads as "nothing works" rather than
  // "nobody has asked yet".
  useEffect(() => { runProbe() }, [runProbe])

  const saveKey = async (provider, key) => {
    setBusy(true)
    try {
      setSt(await api.put(`/ai/keys/${provider}`, { key }))
      setDraft((d) => ({ ...d, [provider]: '' }))
      toast(key ? tx('Key saved — testing it now') : tx('Key removed'))
      runProbe()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const clear = async () => {
    try { await api.del('/ai/cache'); toast(tx('Saved — synced')); load() }
    catch (e) { toast(e.message, 'err') }
  }
  if (!st) return <div className="app-loading"><span className="spinner" /></div>

  const rows = [
    ...(st.providers || []).map((p) => ({ ...p, kind: 'model' })),
    ...st.free.map((f) => ({ name: f, kind: 'free', set: true, source: 'built in' })),
  ]

  return (
    <>
      <div className="section-head">
        <h2>{tx('Translation & plain language')}</h2>
        <span className="count">· {tx('Who does the work, and what it costs')}</span>
        <span className="spacer" />
        <button className="btn btn-sm" disabled={busy} onClick={runProbe}>
          {busy ? <Loader2 size={14} className="txh-spin" /> : <Languages size={14} />} {tx('Test them now')}
        </button>
      </div>

      <div className="card card-pad ai-note">
        <b>{tx('The free two need no key and handle translation on their own.')}</b>
        <span className="stat-sub">
          {tx('A model key is what makes «Explain simply» reword a brief instead of just splitting its sentences. Paste one below and it is used straight away. One is enough; the rest are tried only if it fails.')}
        </span>
      </div>

      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr>
            <th>{tx('Provider')}</th><th>{tx('Kind')}</th><th>{tx('Key')}</th>
            <th>{tx('Reachable')}</th><th />
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const hit = (probe || []).find((x) => x.name === row.name)
              const typed = draft[row.name] ?? ''
              return (
                <tr key={row.name + row.kind}>
                  <td><b>{row.name}</b></td>
                  <td className="stat-sub">{row.kind === 'model' ? tx('model') : tx('free translation')}</td>
                  <td>
                    {row.kind === 'free'
                      ? <span className="stat-sub">{tx('none needed')}</span>
                      : row.set
                        ? <span className="ai-keyset">
                            <ShieldCheck size={13} /> {tx('set')}
                            <span className="stat-sub"> · {tx('from the {where}', { where: row.source })}</span>
                          </span>
                        : <span className="stat-sub">{tx('no key')}</span>}
                  </td>
                  <td>
                    {row.kind === 'model' && !row.set ? <span className="stat-sub">—</span>
                      : busy && !hit ? <span className="stat-sub">{tx('testing…')}</span>
                        : !hit ? <span className="stat-sub">—</span>
                          : hit.ok ? <span className="pay-good">{tx('reachable')} · {hit.ms}ms</span>
                            : <span className="pay-bad" data-tip={hit.why}>{tx('not reachable')}</span>}
                  </td>
                  <td className="ai-keycell">
                    {row.kind === 'model' && (
                      <span className="ai-keyform">
                        <input className="input" type="password" autoComplete="off"
                          placeholder={row.set ? tx('replace the key') : tx('paste the key')}
                          value={typed} onChange={(e) => setDraft({ ...draft, [row.name]: e.target.value })} />
                        <button className="btn btn-sm" disabled={busy || !typed.trim()}
                          onClick={() => saveKey(row.name, typed.trim())}>{tx('Save')}</button>
                        {row.set && row.source === 'typed in' && (
                          <button className="btn btn-sm btn-danger" disabled={busy}
                            onClick={() => saveKey(row.name, '')}>{tx('Remove')}</button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="card card-pad" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <b>{st.cached}</b><span className="stat-sub">{tx('saved translations')}</span>
        <span className="spacer" />
        <button className="btn" onClick={clear}>{tx('Clear the saved translations')}</button>
      </div>
    </>
  )
}

// The hats a format can take off the table, in the words the admin reads.
const CREW_WORDS = [['operator', 'an operator'], ['editor', 'an editor'], ['designer', 'a designer']]

function ChannelsTab({ onOpenReport }) {
  const { channels, reload } = useChannels()
  const [modal, setModal] = useState(null) // {id?, label, icon, head_id, format}
  const [team, setTeam] = useState([])
  const [err, setErr] = useState('')
  // The kinds of channel there are, and what each one needs — served from
  // /fields so the picker here and the form that obeys it read one table.
  const [formats, setFormats] = useState({})
  // The same numbers the Reports tab shows for "This month" — one source.
  const [monthReport, setMonthReport] = useState(null)
  const [content, setContent] = useState([])

  const t = todayISO()
  const monthStart = t.slice(0, 8) + '01'
  const loadStats = () => {
    api.get(`/reports?from=${monthStart}&to=${t}`).then(setMonthReport).catch(() => {})
    api.get('/content').then(setContent).catch(() => {})
  }
  useEffect(() => {
    api.get('/users').then(setTeam).catch(() => {})
    api.get('/fields').then((f) => setFormats(f?.channel_formats || {})).catch(() => {})
    loadStats()
    const id = setInterval(() => { if (!document.hidden) loadStats() }, 15000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statsFor = (key) => {
    const open = content.filter((c) => !c.done_at && c.channels.includes(key))
    const overdue = open.filter((c) => {
      const d = c.release_date || c.recording_date
      return d && d < t
    })
    return { done: monthReport?.byChannel?.[key]?.total || 0, open: open.length, overdue: overdue.length }
  }

  const save = async () => {
    if (!modal.label.trim()) return
    setErr('')
    try {
      const body = { label: modal.label.trim(), icon: modal.icon, head_id: modal.head_id ?? null, drive_url: (modal.drive_url ?? '').trim(), daily_ad_cap: Number(modal.daily_ad_cap) || 0, format: modal.format ?? 'social', video: !!modal.video }
      if (modal.id) await api.patch(`/channels/${modal.id}`, body)
      else await api.post('/channels', body)
      reload()
      setModal(null)
    } catch (e) { setErr(e.message) }
  }
  const del = async (c) => {
    if (!confirm(`Delete "${c.label}"? Its metrics and tasks will be removed too.`)) return
    try { await api.del(`/channels/${c.id}`); reload() } catch (e) { alert(e.message) }
  }
  const move = async (idx, dir) => {
    const ids = channels.map((c) => c.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    try { await api.post('/channels/reorder', { ids }); reload() } catch (e) { alert(e.message) }
  }

  return (
    <>
      <div className="section-head">
        <h2>{tx('Sidebar channels')}</h2>
        <span className="count">{tx('· shown top to bottom')}</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => { setModal({ label: '', icon: 'instagram', head_id: null, drive_url: '', daily_ad_cap: 0, format: 'social' }); setErr('') }}><Plus size={15} /> {tx('Add channel')}</button>
      </div>
      <div className="card" style={{ padding: '6px 14px' }}>
        {channels.map((c, i) => {
          const Icon = iconFor(c.icon)
          return (
            <div key={c.id} className="chan-row u-row">
              <span className="chan-icon"><Icon size={17} /></span>
              <span style={{ fontWeight: 600 }}>{c.label}</span>
              <span className="stat-sub" style={{ fontFamily: 'ui-monospace, monospace' }}>{c.key}</span>
              {/* Nothing until the table has arrived: a Telegram channel
                  labelled "Social feed" for half a second is worse than a
                  badge that turns up a moment late. */}
              {formats[c.format || 'social'] && (
                <span className="chan-kind" data-tip={tx(formats[c.format || 'social'].hint)}>
                  {tx(formats[c.format || 'social'].label)}
                </span>
              )}
              {c.head_id && c.head_name ? (
                <span className="chan-head" title={`Head: ${c.head_name}`}>
                  <Avatar name={c.head_name} color={c.head_color} src={c.head_avatar} size="sm" />
                  {c.head_name}
                </span>
              ) : (
                <span className="no-owner-badge" data-tip={tx('Nobody owns this channel — assign a head')}>{tx('no owner')}</span>
              )}
              {(() => {
                const st = statsFor(c.key)
                return (
                  <span className="chan-stats">
                    <Dots late={st.overdue} open={st.open} done={st.done} />
                    <button className="btn btn-ghost btn-sm" onClick={() => onOpenReport(c.key)} data-tip={tx("This channel's full report")}>
                      Report →
                    </button>
                  </span>
                )
              })()}
              <span className="spacer" style={{ flex: 1 }} />
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} data-tip={tx('Move up in the sidebar')} aria-label={tx('Up')}><ArrowUp size={15} /></button>
              <button className="icon-btn" disabled={i === channels.length - 1} onClick={() => move(i, 1)} data-tip={tx('Move down in the sidebar')} aria-label={tx('Down')}><ArrowDown size={15} /></button>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setModal({ id: c.id, label: c.label, icon: c.icon, head_id: c.head_id ?? null, drive_url: c.drive_url || '', daily_ad_cap: c.daily_ad_cap || 0, format: c.format || 'social', video: !!c.video }); setErr('') }} data-tip={tx('Edit this channel')} aria-label="Edit"><Pencil size={15} /></button>
              <button className="btn btn-danger btn-sm btn-icon u-onhover" onClick={() => del(c)} data-tip={tx('Delete channel & its data')} data-tip-left="" aria-label={tx('Delete')}><Trash2 size={15} /></button>
            </div>
          )
        })}
      </div>

      {modal && (
        <Modal
          title={modal.id ? 'Edit channel' : 'New channel'}
          onClose={() => setModal(null)}
          footer={<>
            <button className="btn" onClick={() => setModal(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={!modal.label.trim()}>{modal.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="field"><label>{tx('Name')}</label>
            <input className="input" autoFocus value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} placeholder={tx('e.g. Instagram Kids')} />
          </div>
          {/* WHAT KIND OF SURFACE THIS IS.
              It decides what a task going here is asked for, which is the
              difference between a Telegram announcement and an Instagram
              post — the same word, two completely different jobs. Before
              this, one set of rules covered every channel at once and the
              board asked a team writing an announcement for its artwork. */}
          <div className="field"><label>{tx('What kind of channel')}</label>
            <select className="select" value={modal.format ?? 'social'}
              onChange={(e) => setModal({ ...modal, format: e.target.value })}>
              {Object.entries(formats).map(([k, f]) => (
                <option key={k} value={k}>{tx(f.label)}</option>
              ))}
            </select>
            <div className="cm-hint">
              {tx(formats[modal.format ?? 'social']?.hint || '')}
              {(() => {
                const f = formats[modal.format ?? 'social']
                if (!f) return null
                const off = CREW_WORDS.filter(([h]) => !f.crew.includes(h)).map(([, w]) => tx(w))
                return off.length
                  ? <><br />{tx('Tasks here are never asked for {who}.', { who: off.join(', ') })}</>
                  : null
              })()}
            </div>
          </div>
          {/* Its finished videos go on to TikTok and Shorts (server/reposts.js):
              a video here gets the two ticks in the task window. */}
          <div className="field">
            <div className="checkbox-row">
              <label className={'checkbox-chip' + (modal.video ? ' on' : '')}>
                <input type="checkbox" checked={!!modal.video} onChange={(e) => setModal({ ...modal, video: e.target.checked })} />
                {tx('Its videos can also go to TikTok and Shorts')}
              </label>
            </div>
            <div className="cm-hint">{modal.video
              ? tx('A video here gets two ticks, TikTok and Shorts. Ticked, publishing it gives somebody a task to post it there too.')
              : tx('Off: a video here goes out on this channel only.')}</div>
          </div>
          <div className="field"><label>{tx('Head of department')} <span className="stat-sub">{tx('(shown on the channel page)')}</span></label>
            <select className="select" value={modal.head_id ?? ''} onChange={(e) => setModal({ ...modal, head_id: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{tx('— No head yet —')}</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? ' (admin)' : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>{tx('Shared Drive folder')} <span className="stat-sub">{tx('(optional)')}</span></label>
            <input className="input" value={modal.drive_url ?? ''}
              onChange={(e) => setModal({ ...modal, drive_url: e.target.value })}
              placeholder={'https://drive.google.com/drive/folders/…'} />
            <div className="cm-hint">
              {modal.drive_url
                ? 'Set. The crew now name the file — “1-3”, “reel 14” — instead of pasting this address on every task. Naming one is still required.'
                : 'With a folder here, the crew name the file instead of pasting a full link every time. Without one they paste the whole address, as now.'}
            </div>
          </div>
          {/* Ads are bought a month at a time and burn their audience if they
              land in a heap, so the ceiling belongs to the channel rather
              than to whoever happens to be making them. */}
          <div className="field"><label>{tx('Video ads a day')}</label>
            <input className="input" type="number" min="0" max="50" style={{ maxWidth: 120 }}
              value={modal.daily_ad_cap ?? 0}
              onChange={(e) => setModal({ ...modal, daily_ad_cap: e.target.value })} />
            <div className="cm-hint">
              {Number(modal.daily_ad_cap) > 0
                ? `At most ${Number(modal.daily_ad_cap)} Target ${Number(modal.daily_ad_cap) === 1 ? 'piece' : 'pieces'} going out on one day for this channel — a further one is refused while it can still be moved. Other kinds of video are not counted.`
                : 'No limit, which is what every channel was before this existed. Set a number and a day that is already full refuses the next ad instead of quietly running it.'}
            </div>
          </div>
          <div className="field"><label>{tx('Icon')}</label>
            <div className="icon-grid">
              {Object.entries(CHANNEL_ICONS).map(([name, Icon]) => (
                <button key={name} type="button" className={'icon-cell' + (modal.icon === name ? ' on' : '')} onClick={() => setModal({ ...modal, icon: name })} data-tip={name} aria-label={name}>
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ==================== PIPELINE (statuses) ==================== */
// Who moves work OUT of which stage — the natural chain by default (operator
// works until Shot, editor until Ready, the SMM everywhere), tunable per cell.
const STAGE_ACTORS = [
  { key: 'operator', label: tx('Operator') },
  { key: 'editor', label: tx('Editor') },
  { key: 'designer', label: tx('Designer') },
  { key: 'member', label: 'Member (SMM)' },
]

// The brief fields the admin can tune (ClickUp-style): each can be off,
// optional or required, per content type; Format and Rubrika carry option
// lists the dropdowns offer.
const TASK_FIELD_DEFS = [
  { key: 'format', label: 'Format', hint: 'talking head, split screen…' },
  { key: 'rubrika', label: 'Rubrika', hint: 'the recurring column it belongs to' },
  { key: 'script', label: 'Script', hint: 'the words and shots the crew films by' },
  { key: 'tz', label: 'ТЗ', hint: 'what the editor is asked to make of the footage' },
  { key: 'reference', label: 'Reference', hint: 'examples, mood, style — the brief' },
  { key: 'description', label: 'Description', hint: 'free notes on the task' },
]

// Every page an admin can switch off, in the order the sidebar draws them.
// My Day and the channel boards are not here on purpose: they are the work
// itself, and a board with no way into the work is not a tidier board.
const PAGE_DEFS = [
  // Named the way every door to it is named now. The key stays 'releases',
  // which is what the stored switches and audiences are filed under; only
  // the words changed, so an admin looking for the Master Calendar here finds
  // it rather than a page called something the sidebar no longer says.
  { key: 'releases', label: 'Master Calendar', hint: 'everything going out, every channel' },
  { key: 'recordings', label: 'Recordings', hint: 'what is being filmed, every channel' },
  { key: 'missed', label: 'Numbers', hint: 'the month, who is late, and the pay — one page with three tabs' },
  { key: 'design', label: 'Design', hint: 'the designer’s own board' },
  { key: 'docs', label: 'My pay', hint: 'what the month is worth to each person, with the KPI document, under their profile' },
  { key: 'sprints', label: 'Sprints (retiring)', hint: 'in no menu since 20 October; the page and its backlog stay by their address until 3 November' },
  { key: 'projects', label: 'Projects', hint: 'projects and the campaigns under them' },
  { key: 'team', label: 'Team', hint: 'the people, their workload and their access — one page with three tabs' },
]

// Who a page can be aimed at. The same four words the role picker uses when a
// person is hired — a member, or one of the three crew capabilities — so an
// admin aiming a page chooses from the vocabulary they already know rather
// than learning a second one. Admins are not on the list because admins always
// have every page: an admin who could aim a page away from themselves would be
// one click from losing the switch that undoes it.
const AUDIENCE_DEFS = [
  // r11: ticked alone, only admins get the page (see PAGE_AUDIENCES on the server).
  { key: 'admin', label: 'Only admins' },
  { key: 'member', label: 'Members' },
  { key: 'editor', label: 'Editors' },
  { key: 'operator', label: 'Operators' },
  { key: 'designer', label: 'Designers' },
]

// The one notice the board may put above everybody's work. One, on purpose:
// two banners stacked over the board is the density the team asked to lose.
// Posting replaces what stood before; clearing the words takes it down.
function NoticeEditor({ notice, onSaved }) {
  const [text, setText] = useState(notice?.text || '')
  const [at, setAt] = useState(notice?.at || '')
  // r10: the hour it lands, what changes (one line each), how early it shows.
  const [time, setTime] = useState(notice?.time || '')
  const [changes, setChanges] = useState((notice?.changes || []).join('\n'))
  const [lead, setLead] = useState(notice?.lead || 3)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setText(notice?.text || ''); setAt(notice?.at || ''); setTime(notice?.time || '')
    setChanges((notice?.changes || []).join('\n')); setLead(notice?.lead || 3)
  }, [notice?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = !!notice?.text
  const list = changes.split('\n').map((l) => l.trim()).filter(Boolean)
  const dirty = text.trim() !== (notice?.text || '') || (at || '') !== (notice?.at || '') || (time || '') !== (notice?.time || '')
    || list.join('\n') !== (notice?.changes || []).join('\n') || Number(lead) !== Number(notice?.lead || 3)
  const save = async (clear) => {
    setBusy(true)
    try {
      const eff = await api.post('/fields', { notice: clear ? { text: '' } : { text: text.trim(), at: at || null, time: time || null, changes: list, lead: Number(lead) } })
      onSaved(eff)
      toast(tx(clear ? 'Notice taken down' : 'Notice posted — everyone sees it on their next page'))
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <div className="notice-editor">
      <div className="stat-sub">{live ? tx('Posted — the team sees it until each person dismisses it') : tx('Nothing posted — the team sees no banner')}</div>
      <div className="notice-row">
        <input className="input" value={text} maxLength={240}
          placeholder={tx('e.g. Pay moves to Documents on Monday — nothing else changes')}
          onChange={(e) => setText(e.target.value)} />
        <input className="input notice-date" type="date" value={at} onChange={(e) => setAt(e.target.value)}
          aria-label={tx('From (optional)')} data-tip={tx('From (optional)')} />
        <input className="input notice-date" type="time" value={time} onChange={(e) => setTime(e.target.value)}
          aria-label={tx('At what time (optional)')} data-tip={tx('At what time (optional)')} />
      </div>
      <textarea className="input" rows={3} value={changes} onChange={(e) => setChanges(e.target.value)}
        placeholder={tx('What changes, one line each — e.g. Change asked → Needs changes')} aria-label={tx('What changes')} />
      <label className="notice-lead">
        <span>{tx('Show the banner')}</span>
        <select className="input" value={lead} onChange={(e) => setLead(Number(e.target.value))}>
          <option value={1}>{tx('1 day before')}</option>
          <option value={3}>{tx('3 days before')}</option>
          <option value={7}>{tx('1 week before')}</option>
        </select>
      </label>
      <div className="notice-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !text.trim() || !dirty} onClick={() => save(false)}>
          {live ? tx('Update it') : tx('Post it')}
        </button>
        {live && <button type="button" className="btn" disabled={busy} onClick={() => save(true)}>{tx('Take it down')}</button>}
      </div>
    </div>
  )
}

function SettingsTab({ only = null }) {
  // Which of its sections to draw: the Board group takes the notice and the
  // reminders first and the task form last, the Team group the pages (N-04).
  const show = (k) => !only || only.includes(k)
  const [fields, setFields] = useState(null)
  const [optDraft, setOptDraft] = useState({})
  const load = () => api.get('/fields').then(setFields).catch(() => {})
  useEffect(() => { load() }, [])

  // One change = one save; the server answers the effective config back.
  const patchField = (k, part) => {
    const next = { ...fields, [k]: { ...fields[k], ...part } }
    setFields(next)
    api.post('/fields', next).then((eff) => { setFields((prev) => ({ ...prev, ...eff })); toast(tx('Task form saved — synced')) })
      .catch((e) => { alert(e.message); load() })
  }
  const toggleFieldType = (k, t) => patchField(k, {
    types: fields[k].types.includes(t) ? fields[k].types.filter((x) => x !== t) : [...fields[k].types, t],
  })
  const addOption = (k) => {
    const v = (optDraft[k] || '').trim()
    if (!v) return
    setOptDraft({ ...optDraft, [k]: '' })
    patchField(k, { options: [...new Set([...(fields[k].options || []), v])] })
  }
  // The crew rules: which types DEMAND each hat — what the task itself counts
  // as a real gap, and what the stage walls refuse a move over.
  const patchCrew = (hat, type) => {
    const cur = fields.crew?.[hat] || []
    const next = {
      ...fields,
      crew: { ...fields.crew, [hat]: cur.includes(type) ? cur.filter((x) => x !== type) : [...cur, type] },
    }
    setFields(next)
    api.post('/fields', next).then((eff) => { setFields((prev) => ({ ...prev, ...eff })); toast(tx('Crew rules saved — synced')) })
      .catch((e) => { alert(e.message); load() })
  }

  // Which pages the team has. Switching one off takes it out of the sidebar,
  // the phone's More sheet and its own route, for everybody — the admin turns
  // it back on here.
  const togglePage = (key) => {
    const cur = fields.pages || {}
    const next = { ...fields, pages: { ...cur, [key]: !cur[key] } }
    setFields(next)
    api.post('/fields', next).then((eff) => { setFields((prev) => ({ ...prev, ...eff })); toast(tx('Pages saved — synced')) })
      .catch((e) => { alert(e.message); load() })
  }

  // And who each page is for. Clearing every chip is not "nobody" — a page
  // aimed at nobody would be a page with a door that opens for no one, which
  // is what the On/Off switch above is for. It means "everybody", the state
  // every page was in before this column existed.
  const toggleAudience = (key, who) => {
    const cur = (fields.page_audience || {})[key] || []
    const nextWho = cur.includes(who) ? cur.filter((x) => x !== who) : [...cur, who]
    const next = { ...fields, page_audience: { ...(fields.page_audience || {}), [key]: nextWho } }
    setFields(next)
    api.post('/fields', next).then((eff) => { setFields((prev) => ({ ...prev, ...eff })); toast(tx('Pages saved — synced')) })
      .catch((e) => { alert(e.message); load() })
  }

  if (!fields) return <div className="app-loading"><span className="spinner" /></div>
  return (
    <>
      {/* ---- the one notice the board may put above everybody's work ---- */}
      {show('notice') && (
        <>
          <div className="section-head">
            <h2>{tx('Planned update')}</h2>
            <span className="count">· {tx('a heads-up the whole team sees until they dismiss it')}</span>
          </div>
          <div className="card">
            <NoticeEditor notice={fields.notice} onSaved={(eff) => setFields((prev) => ({ ...prev, ...eff }))} />
          </div>
        </>
      )}

      {/* ---- r11: the editors' reminders and the Monday clearing of the overdue ---- */}
      {show('reminders') && (
        <>
          <div className="section-head" style={{ marginTop: 18 }}>
            <h2>{tx('Reminders and clearing')}</h2>
          </div>
          <div className="card card-pad"><HousekeepingSettings /></div>
        </>
      )}

      {/* ---- the pages this board shows ---- */}
      {show('pages') && (
        <>
      <div className="section-head">
        <h2>{tx('Pages')}</h2>
        <span className="count">· {tx('which of them the team has at all')}</span>
      </div>
      <div className="card table-wrap">
        <table className="tbl pages-tbl">
          <thead>
            <tr><th>{tx('Page')}</th><th>{tx('Shown to the team')}</th><th>{tx('Whose page it is')}</th></tr>
          </thead>
          <tbody>
            {PAGE_DEFS.map((pg) => {
              const on = (fields.pages || {})[pg.key] !== false
              const aimed = (fields.page_audience || {})[pg.key] || []
              return (
                <tr key={pg.key}>
                  <td>
                    <b>{tx(pg.label)}</b>
                    <div className="stat-sub">{tx(pg.hint)}</div>
                  </td>
                  <td>
                    <button type="button" className={'switch' + (on ? ' on' : '')} role="switch" aria-checked={on}
                      data-tip={on ? tx('Switch this page off for everyone') : tx('Bring this page back')}
                      onClick={() => togglePage(pg.key)}>
                      <i />
                      <span>{on ? tx('On') : tx('Off')}</span>
                    </button>
                  </td>
                  <td>
                    {/* A page switched off has no audience to argue about. */}
                    <div className={'aud-chips' + (on ? '' : ' is-moot')}>
                      {AUDIENCE_DEFS.map((a) => {
                        const picked = aimed.includes(a.key)
                        return (
                          <label key={a.key} className={'checkbox-chip' + (picked ? ' on' : '')}>
                            <input type="checkbox" checked={picked} disabled={!on}
                              onChange={() => toggleAudience(pg.key, a.key)} />
                            {tx(a.label)}
                          </label>
                        )
                      })}
                    </div>
                    <div className="stat-sub">
                      {aimed.length === 0 ? tx('Everyone') : aimed.length === 1 && aimed[0] === 'admin' ? tx('Only admins') : tx('Admins, and the people ticked')}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>
          {tx('This is tidying, not permission: a page switched off leaves the sidebar and its own address for everybody, but the work behind it is still on the board and still counted.')}
          {' '}
          {tx('Aiming a page works the same way — it decides whose sidebar carries the door, not who the board will answer. Tick nobody and the page is everyone’s; admins always keep every page.')}
        </div>
      </div>
        </>
      )}

      {/* ---- the task form: which brief fields exist, and which are demanded ---- */}
      {fields && show('taskform') && (
        <>
          <div className="section-head">
            <h2>{tx('The task form')}</h2>
            <span className="count">{tx('· which brief fields a task carries — and which are demanded')}</span>
          </div>
          <div className="card table-wrap">
            <table className="tbl fields-tbl">
              <thead>
                <tr><th>{tx('Field')}</th><th>{tx('Rule')}</th><th>{tx('Applies to')}</th><th>{tx('Options')}</th></tr>
              </thead>
              <tbody>
                {TASK_FIELD_DEFS.map((f) => {
                  const cfg = fields[f.key]
                  if (!cfg) return null
                  return (
                    <tr key={f.key}>
                      <td>
                        <b>{f.label}</b>
                        <div className="stat-sub">{f.hint}</div>
                      </td>
                      <td>
                        <div className="pill-group">
                          {['off', 'optional', 'required'].map((st) => (
                            <button key={st} type="button"
                              className={'pill' + (cfg.state === st ? ' active' : '') + (st === 'required' && cfg.state === st ? ' pill-req' : '')}
                              onClick={() => patchField(f.key, { state: st })}>
                              {st}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="pill-group">
                          {CONTENT_TYPES.map((t) => (
                            <button key={t.key} type="button"
                              className={'pill' + (cfg.types.includes(t.key) ? ' active' : '')}
                              data-tip={cfg.types.includes(t.key) ? `${t.label}s carry ${f.label}` : `${t.label}s don’t carry ${f.label}`}
                              onClick={() => toggleFieldType(f.key, t.key)}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        {cfg.options !== undefined ? (
                          <div className="opt-chips">
                            {cfg.options.map((o) => (
                              <span key={o} className="chip chip-muted opt-chip">
                                {o}
                                <button type="button" className="opt-chip-x" aria-label={`Remove ${o}`}
                                  onClick={() => patchField(f.key, { options: cfg.options.filter((x) => x !== o) })}>
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                            <span className="opt-add">
                              <input className="input pc-mini" placeholder={tx('Add…')} value={optDraft[f.key] || ''}
                                onChange={(e) => setOptDraft({ ...optDraft, [f.key]: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(f.key) } }} />
                              <button type="button" className="btn btn-sm" onClick={() => addOption(f.key)}>{tx('Add')}</button>
                            </span>
                          </div>
                        ) : <span className="stat-sub">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>
              A required field blocks saving a task of those types without it — and blocks clearing it later.
              Off hides the field from the task card entirely; the crew always see what’s filled in.
            </div>
          </div>

          {/* ---- who must be on a task: the hats the gap views count ---- */}
          {fields.crew && (
            <>
              <div className="section-head" style={{ marginTop: 18 }}>
                <h2>{tx('Who must be on a task')}</h2>
                <span className="count">{tx('· only these hats count as missing on a task')}</span>
              </div>
              <div className="card table-wrap">
                <table className="tbl crew-tbl">
                  <thead>
                    <tr><th>{tx('Hat')}</th><th>{tx('Demanded on')}</th></tr>
                  </thead>
                  <tbody>
                    {[
                      { key: 'operator', label: tx('Operator'), hint: 'who films it' },
                      { key: 'editor', label: tx('Editor'), hint: 'who edits it' },
                      { key: 'designer', label: tx('Designer'), hint: 'who draws the artwork' },
                    ].map((h) => (
                      <tr key={h.key}>
                        <td>
                          <b>{h.label}</b>
                          <div className="stat-sub">{h.hint}</div>
                        </td>
                        <td>
                          <div className="pill-group">
                            {CONTENT_TYPES.map((t) => (
                              <button key={t.key} type="button"
                                className={'pill' + ((fields.crew[h.key] || []).includes(t.key) ? ' active' : '')}
                                data-tip={(fields.crew[h.key] || []).includes(t.key)
                                  ? `A ${t.label.toLowerCase()} without ${h.label.toLowerCase()} says so on the task`
                                  : `${t.label}s never ask for ${h.label.toLowerCase()}`}
                                onClick={() => patchCrew(h.key, t.key)}>
                                {t.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>
                  Untick a type and its tasks stop asking for that hat — the “still missing” line on the task drops it at once, and no stage wall refuses a move over it.
                </div>
              </div>
            </>
          )}

          <LadderEditor
            title={tx('What a piece pays, by how much of it was watched')}
            note={tx('A band of skip rate, and what a piece in it pays. Lower skip is better. A piece nobody has measured is in no band and adds nothing — it is not the worst one.')}
            rows={fields.skip_tiers || []}
            cols={[
              { key: 'name', label: tx('Tier'), kind: 'text', hint: 'A' },
              { key: 'min', label: tx('Skip from'), kind: 'num', suffix: '%' },
              { key: 'max', label: tx('to'), kind: 'num', suffix: '%' },
              { key: 'per_film', label: tx('For filming'), kind: 'num' },
              { key: 'per_edit', label: tx('For the edit'), kind: 'num' },
            ]}
            blank={{ name: '', min: 0, max: 100, per_film: 0, per_edit: 0 }}
            onSave={(rows) => {
              const next = { ...fields, skip_tiers: rows }
              setFields(next)
              api.post('/fields', next).then((eff) => { setFields((prev) => ({ ...prev, ...eff })); toast(tx('Saved — synced')) })
                .catch((e) => { alert(e.message); load() })
            }}
          />

          <LadderEditor
            title={tx('How many pieces earns which grade')}
            note={tx('Everybody sees which rung they are on and what the next one costs. Nothing delivered is not a grade.')}
            rows={fields.maker_grades || []}
            cols={[
              { key: 'name', label: tx('Grade'), kind: 'text', hint: 'A+' },
              { key: 'pieces', label: tx('Pieces a month'), kind: 'num' },
            ]}
            blank={{ name: '', pieces: 0 }}
            onSave={(rows) => {
              const next = { ...fields, maker_grades: rows }
              setFields(next)
              api.post('/fields', next).then((eff) => { setFields((prev) => ({ ...prev, ...eff })); toast(tx('Saved — synced')) })
                .catch((e) => { alert(e.message); load() })
            }}
          />
        </>
      )}
    </>
  )
}

// A short list of rungs an admin edits as a whole — the pay tiers and the
// grade ladder are the same shape, so they are the same editor. Rows are
// added and removed here and saved together: a ladder with a rung missing
// while somebody types the next one is not a state worth storing.

function LadderEditor({ title, note, rows, cols, blank, onSave }) {
  const [draft, setDraft] = useState(rows)
  useEffect(() => { setDraft(rows) }, [rows])
  const dirty = JSON.stringify(draft) !== JSON.stringify(rows)
  const set = (i, k, v) => setDraft(draft.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>{title}</h2>
      </div>
      <div className="card table-wrap">
        <table className="tbl ladder-tbl">
          <thead>
            <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr>
          </thead>
          <tbody>
            {draft.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key}>
                    <span className="ladder-cell">
                      <input className="input pc-mini"
                        type={c.kind === 'num' ? 'number' : 'text'}
                        min={c.kind === 'num' ? 0 : undefined}
                        placeholder={c.hint || ''}
                        value={r[c.key] ?? ''}
                        onChange={(e) => set(i, c.key, c.kind === 'num' ? Number(e.target.value) : e.target.value)} />
                      {c.suffix && <b className="stat-sub">{c.suffix}</b>}
                    </span>
                  </td>
                ))}
                <td className="right">
                  <button className="btn btn-sm btn-danger" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {draft.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="empty">{tx('Not set')}</td></tr>
            )}
          </tbody>
        </table>
        <div className="ladder-foot">
          <button className="btn btn-sm" onClick={() => setDraft([...draft, { ...blank }])}>
            <Plus size={13} /> {tx('Add a row')}
          </button>
          <span className="spacer" />
          {dirty && <button className="btn btn-sm" onClick={() => setDraft(rows)}>{tx('Cancel')}</button>}
          <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => onSave(draft)}>{tx('Save')}</button>
        </div>
        <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>{note}</div>
      </div>
    </>
  )
}

function PipelineTab() {
  const [statuses, setStatuses] = useState([])
  const [modal, setModal] = useState(null)
  const [err, setErr] = useState('')
  const [rules, setRules] = useState(null)
  // The design board's columns, edited here beside the content ones. They are
  // a separate list on purpose — see server/routes/design-statuses.js — but
  // they are the same KIND of thing, and an admin looking for "the columns"
  // should not have to learn that the answer depends on which board.
  const [dStages, setDStages] = useState([])
  const [dModal, setDModal] = useState(null)
  const [dErr, setDErr] = useState('')

  const load = () => Promise.all([
    api.get('/statuses').then(setStatuses),
    api.get('/statuses/rules').then(setRules).catch(() => {}),
    api.get('/design-statuses').then(setDStages).catch(() => {}),
  ])
  useEffect(() => { load() }, [])

  const dSave = async () => {
    if (!dModal.label.trim()) return
    setDErr('')
    try {
      if (dModal.id) await api.patch(`/design-statuses/${dModal.id}`, { label: dModal.label.trim(), color: dModal.color })
      else await api.post('/design-statuses', { label: dModal.label.trim(), color: dModal.color })
      await load()
      setDModal(null)
    } catch (e) { setDErr(e.message) }
  }
  const dDel = async (s) => {
    if (!confirm(`Delete design stage "${s.label}"? Its artwork moves to the next stage along.`)) return
    try { await api.del(`/design-statuses/${s.id}`); load() } catch (e) { alert(e.message) }
  }
  const dMove = async (idx, dir) => {
    const ids = dStages.map((s) => s.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    try { await api.post('/design-statuses/reorder', { ids }); load() } catch (e) { alert(e.message) }
  }

  const toggleRule = async (actor, sid) => {
    const next = { ...rules, [actor]: { ...rules[actor], [sid]: !rules[actor]?.[sid] } }
    setRules(next)
    try { await api.post('/statuses/rules', next); toast(tx('Stage rules saved — synced')) }
    catch (e) { alert(e.message); load() }
  }

  const save = async () => {
    if (!modal.label.trim()) return
    setErr('')
    try {
      if (modal.id) await api.patch(`/statuses/${modal.id}`, { label: modal.label.trim(), color: modal.color })
      else await api.post('/statuses', { label: modal.label.trim(), color: modal.color })
      await load()
      setModal(null)
    } catch (e) { setErr(e.message) }
  }
  const del = async (s) => {
    if (!confirm(`Delete stage "${s.label}"? Its tasks move to the first stage.`)) return
    try { await api.del(`/statuses/${s.id}`); load() } catch (e) { alert(e.message) }
  }
  const move = async (idx, dir) => {
    const ids = statuses.map((s) => s.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    try { await api.post('/statuses/reorder', { ids }); load() } catch (e) { alert(e.message) }
  }
  const setFinal = async (s) => {
    try { await api.patch(`/statuses/${s.id}`, { is_final: true }); load() } catch (e) { alert(e.message) }
  }

  return (
    <>
      <div className="section-head">
        <h2>{tx('Content pipeline')}</h2>
        <span className="count">{tx('· stages every task moves through')}</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => { setModal({ label: '', color: STATUS_COLORS[0] }); setErr('') }}><Plus size={15} /> {tx('Add stage')}</button>
      </div>
      <div className="card" style={{ padding: '6px 14px' }}>
        {statuses.map((s, i) => (
          <div key={s.id} className="chan-row u-row">
            <span className="status-dot" style={{ background: s.color, width: 12, height: 12 }} />
            <span style={{ fontWeight: 600 }}>{s.label}</span>
            {s.is_final
              ? <span className="badge">{tx('Final — counts as published')}</span>
              : <button className="btn btn-ghost btn-sm" onClick={() => setFinal(s)} data-tip={tx('Tasks reaching this stage count as published')}>{tx('Make final')}</button>}
            <span className="spacer" style={{ flex: 1 }} />
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} data-tip={tx('Move stage earlier')} aria-label={tx('Up')}><ArrowUp size={15} /></button>
            <button className="icon-btn" disabled={i === statuses.length - 1} onClick={() => move(i, 1)} data-tip={tx('Move stage later')} aria-label={tx('Down')}><ArrowDown size={15} /></button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setModal({ id: s.id, label: s.label, color: s.color }); setErr('') }} data-tip={tx('Rename or recolor')} aria-label="Edit"><Pencil size={15} /></button>
            <button className="btn btn-danger btn-sm btn-icon u-onhover" onClick={() => del(s)} data-tip={tx('Delete this stage')} data-tip-left="" aria-label={tx('Delete')}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      {/* ---- the design board's columns ---- */}
      <div className="section-head" style={{ marginTop: 18 }}>
        <h2>{tx('Design board')}</h2>
        <span className="count">{tx('· columns on the Design page')}</span>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => { setDModal({ label: '', color: STATUS_COLORS[0] }); setDErr('') }}><Plus size={15} /> {tx('Add column')}</button>
      </div>
      <div className="card" style={{ padding: '6px 14px' }}>
        {dStages.map((s, i) => (
          <div key={s.id} className="chan-row u-row">
            <span className="status-dot" style={{ background: s.color, width: 12, height: 12 }} />
            <span style={{ fontWeight: 600 }}>{s.label}</span>
            {i === 0 && <span className="badge">{tx('Where new artwork lands')}</span>}
            <span className="spacer" style={{ flex: 1 }} />
            <button className="icon-btn" disabled={i === 0} onClick={() => dMove(i, -1)} data-tip={tx('Move column left')} aria-label={tx('Up')}><ArrowUp size={15} /></button>
            <button className="icon-btn" disabled={i === dStages.length - 1} onClick={() => dMove(i, 1)} data-tip={tx('Move column right')} aria-label={tx('Down')}><ArrowDown size={15} /></button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => { setDModal({ id: s.id, label: s.label, color: s.color }); setDErr('') }} data-tip={tx('Rename or recolor')} aria-label="Edit"><Pencil size={15} /></button>
            <button className="btn btn-danger btn-sm btn-icon u-onhover" onClick={() => dDel(s)} data-tip={tx('Delete this column')} data-tip-left="" aria-label={tx('Delete')}><Trash2 size={15} /></button>
          </div>
        ))}
        <div className="stat-sub" style={{ padding: '4px 0 10px' }}>
          Nothing is gated on these — unlike the content pipeline, a designer moves their own work freely and
          no column refuses it. Artwork that has never been filed stands in the first one.
        </div>
      </div>

      {dModal && (
        <Modal
          title={dModal.id ? 'Edit design column' : 'New design column'}
          onClose={() => setDModal(null)}
          footer={<>
            <button className="btn" onClick={() => setDModal(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={dSave} disabled={!dModal.label.trim()}>{dModal.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {dErr && <div className="form-error"><AlertCircle size={16} /> {dErr}</div>}
          <div className="field"><label>{tx('Name')}</label>
            <input className="input" autoFocus value={dModal.label} onChange={(e) => setDModal({ ...dModal, label: e.target.value })} placeholder={tx('e.g. Sent back')} />
          </div>
          <div className="field"><label>{tx('Color')}</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STATUS_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setDModal({ ...dModal, color: c })} aria-label={c}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: dModal.color === c ? '3px solid var(--ink)' : '2px solid var(--hairline)', cursor: 'pointer' }} />
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* ---- stage rules: who moves work out of each stage ---- */}
      {rules && statuses.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 18 }}>
            <h2>{tx('Stage rules')}</h2>
            <span className="count">{tx('· who may move a task out of each stage')}</span>
          </div>
          <div className="card table-wrap">
            <table className="tbl rules-tbl">
              <thead>
                <tr>
                  <th>{tx('Stage')}</th>
                  {STAGE_ACTORS.map((a) => <th key={a.key}>{a.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {statuses.filter((s) => !s.is_final).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="status-dot" style={{ background: s.color, marginRight: 7 }} />
                      <b>{s.label}</b> <span className="stat-sub">{tx('→ onward')}</span>
                    </td>
                    {STAGE_ACTORS.map((a) => {
                      const on = !!rules[a.key]?.[s.id]
                      return (
                        <td key={a.key}>
                          <button type="button" className={'perm-toggle rules-cell' + (on ? ' on' : '')}
                            onClick={() => toggleRule(a.key, s.id)}
                            data-tip={on ? `${a.label} may move work out of ${s.label}` : `${a.label} may NOT move work out of ${s.label}`}
                            aria-label={`${a.label} out of ${s.label}`}>
                            {on && <Check size={12} strokeWidth={3.5} />}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="stat-sub" style={{ padding: '4px 14px 12px' }}>
              Admins always move everything. Publishing (into the final stage) is governed by each member’s
              “Review &amp; publish” permission, not by this table. Rules narrow what a role could already do —
              the crew still work through their ticks.
            </div>
          </div>
        </>
      )}

      {modal && (
        <Modal
          title={modal.id ? 'Edit stage' : 'New stage'}
          onClose={() => setModal(null)}
          footer={<>
            <button className="btn" onClick={() => setModal(null)}>{tx('Cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={!modal.label.trim()}>{modal.id ? 'Save' : 'Add'}</button>
          </>}
        >
          {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
          <div className="field"><label>{tx('Name')}</label>
            <input className="input" autoFocus value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} placeholder={tx('e.g. On review')} />
          </div>
          <div className="field"><label>{tx('Color')}</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STATUS_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setModal({ ...modal, color: c })} aria-label={c}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: modal.color === c ? '3px solid var(--ink)' : '2px solid var(--hairline)', cursor: 'pointer' }} />
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

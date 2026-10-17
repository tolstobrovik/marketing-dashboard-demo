import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Send, Check, X, Clock, GraduationCap, FileText, Pencil, AlertCircle,
  Link as LinkIcon, Upload, Trash2, Eye, Wallet, KeyRound,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { useAuth } from '../lib/auth.jsx'
import Modal from '../components/Modal.jsx'
import Fold from '../components/Fold.jsx'
import { MiniCalendar, MyRates, BriefModal } from '../components/AmbassadorTasks.jsx'
import AmbassadorsCalendar from '../components/AmbassadorsCalendar.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// The ambassador programme.
//
// Two audiences, one page, and deliberately no third thing. An ambassador is
// a student who films on their own account: they get a page that says what is
// happening to each of their ideas in a sentence, and one button to send a new
// one. An admin gets the same address and a different render — the queue of
// what is waiting on an answer, one card open at a time.
//
// The words here are fixed and are not a style choice. A student reads
// "rejected" as "you are bad at this" and "verified" as a machine talking; the
// board says "Needs changes" and "Done". Nothing in this file prints a state
// name — every card says what is happening in a sentence.

const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')} so'm`

// How long something has been waiting on us, in the only unit anybody cares
// about when they are deciding what to open next.
function waitedFor(iso) {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return { text: tx('just now'), hours: 0 }
  const h = Math.floor(ms / 3600e3)
  if (h < 1) return { text: `${Math.max(1, Math.floor(ms / 60e3))}m`, hours: 0 }
  if (h < 48) return { text: `${h}h`, hours: h }
  return { text: `${Math.floor(h / 24)}d`, hours: h }
}

// ---- what a card says --------------------------------------------------------
// One place, so the sentence an ambassador reads and the sentence in a list can
// never drift apart.
function saysWhat(c) {
  if (c.state === 'can_film') return { tone: 'go', line: `${tx('You can film this')}. ${money(c.amount)}` }
  if (c.state === 'needs_changes') return { tone: 'stop', line: tx('Needs changes') }
  if (c.state === 'waiting') return { tone: 'idle', line: tx('Waiting for our answer') }
  // The three states that carry the video, before anything is public.
  if (c.state === 'review') return { tone: 'idle', line: tx('We are watching your video') }
  if (c.state === 'reshoot') return { tone: 'stop', line: tx('Your video needs changes') }
  if (c.state === 'to_post') {
    return c.who_posts === 'us'
      ? { tone: 'go', line: tx('Approved — we will post it') }
      : { tone: 'go', line: tx('Approved — you can post it now') }
  }
  if (c.state === 'posted') return { tone: 'idle', line: tx('Posted, we are checking') }
  // Done and paid are different facts and were saying the same sentence, so
  // "have I been paid for that one?" had no answer on this page at all.
  if (c.state === 'paid') return { tone: 'done', line: `${tx('Paid')}. ${money(c.amount)}` }
  return { tone: 'done', line: `${tx('Done — waiting to be paid')}. ${money(c.amount)}` }
}
// Whose turn it is. Anything needing the ambassador comes first — the green
// one they can act on now, then the red one asking them for something — and
// everything that is waiting on US sits underneath.
const TURN = {
  reshoot: 0, to_post: 1, can_film: 2, needs_changes: 3,   // theirs to act on
  review: 4, waiting: 5, posted: 6,                         // ours
  done: 7, paid: 8,
}

export default function Ambassadors() {
  const { user } = useAuth()
  return user.role === 'ambassador' ? <MyPage /> : <AdminPage />
}

// ---- the ambassador's page ---------------------------------------------------
function MyPage() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(null)
  const [posting, setPosting] = useState(null)
  const [filming, setFilming] = useState(null)

  const load = useCallback(() => api.get('/ambassadors/me')
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])

  // Ambassador 2.0: the tasks they were given (their days and briefs) and the
  // rate card they are on. Loaded beside the cards, and failing quietly — the
  // ideas they send are still the page if either of these is unreachable.
  const [tasks, setTasks] = useState([])
  const [rates, setRates] = useState(null)
  const [brief, setBrief] = useState(null)
  useEffect(() => {
    api.get('/ambassadors/me/tasks').then((t) => {
      const list = Array.isArray(t) ? t : []
      setTasks(list)
      // A link from a notification (/brief?task=7 lands here as ?task=7)
      // opens that task's brief straight away.
      const wanted = Number(new URLSearchParams(window.location.search).get('task'))
      const hit = wanted && list.find((x) => x.id === wanted)
      if (hit) setBrief(hit)
    }).catch(() => {})
    api.get('/ambassadors/me/rates').then(setRates).catch(() => {})
  }, [])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  const cards = [...data.cards].sort((a, b) => (TURN[a.state] ?? 9) - (TURN[b.state] ?? 9))

  return (
    <div className="amb-me">
      {/* Two numbers. Not four, not a chart — what they posted and what they
          earned, this month. */}
      <div className="amb-numbers">
        <div className="amb-num">
          <b>{data.posted_this_month}</b>
          <span className="stat-sub">{tx('Posted this month')}</span>
        </div>
        <div className="amb-num">
          <b>{money(data.earned_this_month)}</b>
          <span className="stat-sub">{tx('Earned this month')}</span>
        </div>
      </div>

      <MiniCalendar tasks={tasks} onOpen={setBrief} />
      <MyRates rates={rates} />

      <button className="btn btn-go amb-send" onClick={() => setSending(true)}>
        <Plus size={16} /> {tx('Send idea')}
      </button>

      <div className="amb-cards">
        {cards.map((c) => {
          const said = saysWhat(c)
          return (
            <div className={'card card-pad amb-card amb-' + said.tone} key={c.id}>
              <div className="amb-card-line">{said.line}</div>
              {/* What we asked for, wherever it was asked.
                  This used to be drawn ONLY for needs_changes, so a video sent
                  back — which lands on a different state — saved the comment
                  and showed it to nobody. The ambassador read "you can film
                  this" and had no idea anything had been refused. */}
              {c.feedback && ['needs_changes', 'reshoot', 'to_post'].includes(c.state) && (
                <div className="amb-feedback">{c.feedback}</div>
              )}
              {/* What was actually agreed, in words, when the three boxes
                  could not say it. It is the thing they have to do, so it is
                  on the card and not in a settings page. */}
              {c.state === 'can_film' && c.terms_other && (
                <div className="amb-term-note">{c.terms_other}</div>
              )}
              <div className="amb-card-idea stat-sub">{c.format} · {c.script}</div>
              <div className="amb-link-row">
                {c.video_url && (
                  <a className="amb-link" href={c.video_url} target="_blank" rel="noreferrer">
                    <LinkIcon size={12} /> {tx('Your video')}
                  </a>
                )}
                {c.main_video_url && (
                  <a className="amb-link" href={c.main_video_url} target="_blank" rel="noreferrer">
                    <LinkIcon size={12} /> {tx('The post')}
                  </a>
                )}
              </div>
              {c.state === 'needs_changes' && (
                <button className="btn btn-sm" onClick={() => setEditing(c)}>
                  <Pencil size={13} /> {tx('Edit and send again')}
                </button>
              )}
              {/* Send us the VIDEO — which is the whole change. The button here
                  used to say "I posted it", so the only way to tell us a video
                  existed was to claim it was already public. Nothing gets
                  posted until somebody has watched it. */}
              {['can_film', 'reshoot'].includes(c.state) && (
                <button className="btn btn-sm btn-primary" onClick={() => setFilming(c)}>
                  <Send size={13} /> {c.state === 'reshoot' ? tx('Send the new version') : tx('I filmed it')}
                </button>
              )}
              {c.state === 'to_post' && c.who_posts !== 'us' && (
                <button className="btn btn-sm btn-primary" onClick={() => setPosting(c)}>
                  <Send size={13} /> {tx('I posted it')}
                </button>
              )}
              {/* Every round, kept. "He says he sent it again" is a question
                  with an answer now. */}
              {(c.events || []).length > 0 && <CardTrail events={c.events} />}
            </div>
          )
        })}
        {cards.length === 0 && <div className="card card-pad empty">{tx('Nothing sent yet.')}</div>}
      </div>

      {brief && (
        <BriefModal task={brief} onClose={() => setBrief(null)}
          onHandedIn={(t) => { if (t) setTasks((cur) => cur.map((x) => (x.id === t.id ? t : x))) }} />
      )}
      {filming && (
        <IFilmedIt card={filming} onClose={() => setFilming(null)}
          onSent={() => { setFilming(null); load() }} />
      )}
      {posting && (
        <IPostedIt card={posting} onClose={() => setPosting(null)}
          onSent={() => { setPosting(null); load() }} />
      )}

      <Fold id="amb_details" title={tx('Your details')} icon={<GraduationCap size={15} />}>
        <div className="card card-pad amb-details">
          <div><span className="stat-sub">{tx('University')}</span><b>{data.person.university || '—'}</b></div>
          <div>
            <span className="stat-sub">{tx('Your contract')}</span>
            {data.person.has_contract
              ? <ContractLink id={data.person.id} name={data.person.contract_name} />
              : <b>—</b>}
          </div>
        </div>
      </Fold>

      {sending && <IdeaForm onClose={() => setSending(false)} onSent={() => { setSending(false); load() }} />}
      {editing && (
        <IdeaForm card={editing} onClose={() => setEditing(null)}
          onSent={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

// The contract opens in a new tab. It is stored beside the row rather than on
// a CDN, so it is fetched and handed to the browser as a blob.
function ContractLink({ id, name }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      const f = await api.get(`/ambassadors/${id}/contract`)
      const win = window.open('', '_blank')
      const res = await fetch(f.data)
      const url = URL.createObjectURL(await res.blob())
      if (win) win.location = url; else window.open(url, '_blank')
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <button className="btn btn-sm" disabled={busy} onClick={open}>
      <FileText size={13} /> {name || tx('Open')}
    </button>
  )
}

// Four fields. The same form sends a new idea and sends a changed one back,
// because they are the same act — the card does not start again, it goes round.
function IdeaForm({ card = null, onClose, onSent }) {
  const [form, setForm] = useState({
    format: card?.format || '',
    script: card?.script || '',
    reference_url: card?.reference_url || '',
    planned_date: card?.planned_date || '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async () => {
    setBusy(true); setErr('')
    try {
      if (card) await api.patch(`/ambassadors/me/cards/${card.id}`, form)
      else await api.post('/ambassadors/me/cards', form)
      onSent()
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal title={card ? tx('Edit and send again') : tx('Send idea')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" disabled={busy} onClick={send}>
        <Send size={14} /> {card ? tx('Send again') : tx('Send idea')}
      </button>
    </>}>
      {err && <div className="form-error">{err}</div>}
      {card?.feedback && <div className="amb-feedback">{card.feedback}</div>}
      <div className="field">
        <label>{tx('What kind of video')}</label>
        <input className="input" value={form.format} autoFocus
          placeholder={tx('Reel, vlog, interview…')}
          onChange={(e) => setForm({ ...form, format: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('What happens in it')}</label>
        <textarea className="input" rows={6} value={form.script}
          onChange={(e) => setForm({ ...form, script: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('Something like it')} <span className="stat-sub">{tx('optional')}</span></label>
        <input className="input" value={form.reference_url} placeholder="https://…"
          onChange={(e) => setForm({ ...form, reference_url: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('When you plan to film')} <span className="stat-sub">{tx('optional')}</span></label>
        <input className="input" type="date" value={form.planned_date || ''}
          onChange={(e) => setForm({ ...form, planned_date: e.target.value })} />
      </div>
    </Modal>
  )
}

// ---- the admin's render ------------------------------------------------------
// Two views of one programme: the calendar (which videos came in, and which
// still need an editor) first, and the table everything else is done from one
// tap away, unchanged.
function AdminPage() {
  const [view, setView] = useState('calendar')
  const toggle = (
    <span className="co-am-tog" role="group" aria-label={tx('How to show it')}>
      <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>{tx('Calendar')}</button>
      <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>{tx('Table')}</button>
    </span>
  )
  if (view === 'calendar') return <AmbassadorsCalendar toggle={toggle} />
  return (
    <>
      <header className="co-am-head"><h2>{tx('Ambassadors')}</h2>{toggle}</header>
      <AdminTable />
    </>
  )
}

function AdminTable() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [setup, setSetup] = useState(null)
  const [adding, setAdding] = useState(null)
  const [looking, setLooking] = useState(null)
  const [resetting, setResetting] = useState(null)
  const [removing, setRemoving] = useState(null)

  const load = useCallback(() => api.get('/ambassadors')
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  // Deciding one closes it and opens the next, so a queue is worked through
  // rather than clicked through.
  const decided = async (id) => {
    const at = data.inbox.findIndex((c) => c.id === id)
    const next = data.inbox[at + 1]
    await load()
    setOpenId(next ? next.id : null)
  }

  return (
    <div className="amb-admin">
      <Fold id="amb_inbox" title={tx('Waiting for our answer')} icon={<Clock size={15} />} count={data.inbox.length}>
        <div className="amb-inbox">
          {data.inbox.map((c) => (
            <InboxRow key={c.id} card={c} open={openId === c.id}
              onOpen={() => setOpenId(openId === c.id ? null : c.id)}
              onDecided={() => decided(c.id)} />
          ))}
          {data.inbox.length === 0 && (
            <div className="card card-pad empty">{tx('Nothing is waiting on us.')}</div>
          )}
        </div>
      </Fold>

      {/* What this costs, and what is still owed. The programme had a queue of
          work to check and no view of money to settle, so "what do I owe" was
          a question you answered by opening every person and adding it up. */}
      <div className="amb-numbers amb-money">
        <div className="amb-num">
          <b>{data.money?.done_this_month ?? 0}</b>
          <span className="stat-sub">{tx('Videos this month')}</span>
        </div>
        <div className="amb-num">
          <b>{money(data.money?.cost_this_month || 0)}</b>
          <span className="stat-sub">{tx('This month costs')}</span>
        </div>
        <div className={'amb-num' + ((data.money?.owed_total || 0) > 0 ? ' amb-num-owed' : '')}>
          <b>{money(data.money?.owed_total || 0)}</b>
          <span className="stat-sub">{tx('Still to pay')}</span>
        </div>
      </div>

      {(data.owed || []).length > 0 && (
        <Fold id="amb_owed" title={tx('Waiting to be paid')} icon={<Wallet size={15} />}
          count={data.owed.length}>
          <PayList rows={data.owed} onPaid={load} />
        </Fold>
      )}

      <Fold id="amb_people" title={tx('Ambassadors')} icon={<GraduationCap size={15} />}
        count={data.people.length}>
        {/* Signing a student up used to mean going to the Admin panel, making
            an account there, and coming back here to set their terms — and the
            Admin panel is not a door the person who runs this programme has.
            The whole job is on this page now: make the login, and their terms
            open straight after it. */}
        <div className="amb-add-row">
          <button className="btn btn-primary btn-sm" onClick={() => setAdding({ name: '', username: '', password: '' })}>
            <Plus size={14} /> {tx('Sign up an ambassador')}
          </button>
        </div>
        {data.unset.length > 0 && (
          <div className="card card-pad amb-unset">
            <AlertCircle size={15} />
            <span>{tx('These accounts are not set up yet')}:</span>
            {data.unset.map((u) => (
              <button key={u.user_id} className="btn btn-sm"
                onClick={() => setSetup({ user_id: u.user_id, name: u.name })}>
                {u.name}
              </button>
            ))}
          </div>
        )}
        <div className="card table-wrap">
          <table className="tbl amb-tbl">
            <thead>
              <tr>
                <th>{tx('Name')}</th>
                <th>{tx('University')}</th>
                <th>{tx('Sent')}</th>
                <th>{tx('Login')}</th>
                <th>{tx('Approved')}</th>
                <th>{tx('Owed')}</th>
                <th>{tx('Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b></td>
                  <td>{p.university || <span className="amb-missing">{tx('not set')}</span>}</td>
                  <td>{p.sent}</td>
                  {/* The username they type to sign in. It was never sent to
                      this page at all, which is what made "I have forgotten
                      what I gave them" an account nobody could get back into.
                      The password is NOT here and cannot be — it is a one-way
                      hash — so there is a button to set a new one instead. */}
                  <td className="amb-login">{p.username || <span className="amb-missing">—</span>}</td>
                  <td>{p.approved}</td>
                  <td>{p.owed > 0 ? <b className="amb-owed-cell">{money(p.owed)}</b> : <span className="stat-sub">—</span>}</td>
                  <td>{p.status === 'active' ? tx('Active') : p.status === 'paused' ? tx('Paused') : tx('Ended')}</td>
                  <td className="right">
                    {/* "Let me look at their account." Not by signing in as
                        them — a board that records who did what should not
                        have a way to be somebody else — but by opening every
                        row they have, which is what anybody actually means. */}
                    <button className="btn btn-sm" onClick={() => setLooking(p)}>
                      <Eye size={13} /> {tx('Their work')}
                    </button>
                    <button className="btn btn-sm" onClick={() => setSetup({ ...p, user_id: p.user_id })}>
                      <Pencil size={13} /> {tx('Details')}
                    </button>
                    <button className="btn btn-sm" onClick={() => setResetting(p)}>
                      <KeyRound size={13} /> {tx('New password')}
                    </button>
                    <button className="btn btn-sm del-btn" onClick={() => setRemoving(p)} aria-label={tx('Remove')}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {data.people.length === 0 && (
                <tr><td colSpan={7} className="empty">{tx('Nobody yet.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Fold>

      {resetting && (
        <NewPassword person={resetting} onClose={() => setResetting(null)}
          onDone={() => { setResetting(null); load() }} />
      )}
      {removing && (
        <RemovePerson person={removing} onClose={() => setRemoving(null)}
          onDone={() => { setRemoving(null); load() }} />
      )}
      {looking && (
        <TheirWork person={looking} onClose={() => setLooking(null)} onChanged={load} />
      )}
      {adding && (
        <NewAmbassador draft={adding} onClose={() => setAdding(null)}
          onMade={(u) => { setAdding(null); load(); setSetup({ user_id: u.id, name: u.name }) }} />
      )}
      {setup && (
        <DetailsForm person={setup} onClose={() => setSetup(null)}
          onSaved={() => { setSetup(null); load() }} />
      )}
    </div>
  )
}

// Every round of this card, oldest first: what was sent, what was asked for,
// and when. Folded away by default — it matters on the day somebody says "I
// already sent that" and not before.
function CardTrail({ events }) {
  const [open, setOpen] = useState(false)
  const rounds = events.length
  return (
    <div className="amb-trail">
      <button className="lnk amb-trail-toggle" onClick={() => setOpen(!open)}>
        {open ? tx('Hide history') : tx('History')} ({rounds})
      </button>
      {open && (
        <ol className="amb-trail-list">
          {events.map((e) => (
            <li key={e.id} className={'amb-trail-' + e.kind}>
              <span className="amb-trail-when">{new Date(e.at).toLocaleDateString()}</span>
              {e.kind === 'video' && <>{tx('Video sent')} · <a href={e.url} target="_blank" rel="noreferrer">{tx('open')}</a></>}
              {e.kind === 'post' && <>{tx('Post sent')} · <a href={e.url} target="_blank" rel="noreferrer">{tx('open')}</a></>}
              {e.kind === 'sent_back' && <>{tx('Sent back')}: {e.text}</>}
              {e.kind === 'approved' && <>{e.text}</>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// Sending us the VIDEO. Nothing is public at this point and nothing should be:
// this is the step that did not exist, and without it the only way to report a
// finished video was to publish it first and hope.
function IFilmedIt({ card, onClose, onSent }) {
  const [url, setUrl] = useState(card.video_url || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const again = card.state === 'reshoot'

  const send = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      await api.post(`/ambassadors/me/cards/${card.id}/filmed`, { video_url: url.trim() })
      toast(tx('Sent — we will watch it'))
      onSent()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={again ? tx('Send the new version') : tx('I filmed it')} onClose={onClose} footer={<>
      <span className="foot-gap" />
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" onClick={send} disabled={busy || !url.trim()}>
        {busy ? tx('Sending…') : tx('Send for checking')}
      </button>
    </>}>
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      {again && card.feedback && <div className="amb-feedback">{card.feedback}</div>}
      <div className="cm-row">
        <span className="cm-key">{tx('Link to the video')}</span>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus
          placeholder="https://drive.google.com/…" autoCapitalize="off" autoCorrect="off" />
      </div>
      <div className="cm-hint">{tx('Do not post it anywhere yet. We watch it first, and we may ask for changes.')}</div>
    </Modal>
  )
}

// Saying a video is live. One box that matters and one that does not.
//
// The link IS the work — it is what gets checked and what the money is for —
// so it is required, and a sentence in that box ("I sent it to you on
// Telegram") is refused here as well as by the server.
function IPostedIt({ card, onClose, onSent }) {
  const [main, setMain] = useState(card.main_video_url || '')
  const [story, setStory] = useState(card.story_clip_url || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      await api.post(`/ambassadors/me/cards/${card.id}/posted`, { main_video_url: main.trim(), story_clip_url: story.trim() })
      toast(tx('Sent — we will check it'))
      onSent()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={tx('I posted it')} onClose={onClose} footer={<>
      <span className="foot-gap" />
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" onClick={send} disabled={busy || !main.trim()}>
        {busy ? tx('Sending…') : tx('Send for checking')}
      </button>
    </>}>
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      <div className="cm-row">
        <span className="cm-key">{tx('Link to the post')}</span>
        <input className="input" value={main} onChange={(e) => setMain(e.target.value)} autoFocus
          placeholder="https://instagram.com/reel/…" autoCapitalize="off" autoCorrect="off" />
      </div>
      <div className="cm-row">
        <span className="cm-key">{tx('Story link')} <span className="crew-opt">{tx('optional')}</span></span>
        <input className="input" value={story} onChange={(e) => setStory(e.target.value)}
          placeholder="https://instagram.com/stories/…" autoCapitalize="off" autoCorrect="off" />
      </div>
      <div className="cm-hint">{tx('We open the link, check it, and then it counts for this month.')}</div>
    </Modal>
  )
}

// A NEW password, because the old one cannot be read back.
//
// The password is stored as a bcrypt hash and that is on purpose: it is
// one-way, so neither this board nor anybody who steals its database can turn
// it back into what was typed. "Show me the password I set" therefore has no
// answer. This is the answer to the question behind it — get them signed in
// again — and the new one is on screen to read out before it is gone too.
function NewPassword({ person, onClose, onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const suggest = () => setPw(Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 6))
  const save = async () => {
    setBusy(true); setErr('')
    try {
      await api.post(`/ambassadors/person/${person.user_id}/password`, { password: pw.trim() })
      setDone(true)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={tx('New password')} onClose={done ? onDone : onClose} footer={<>
      <span className="foot-gap" />
      {done
        ? <button className="btn btn-primary" onClick={onDone}>{tx('Done')}</button>
        : <>
            <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
            <button className="btn btn-primary" disabled={busy || pw.trim().length < 4} onClick={save}>
              {busy ? tx('Saving…') : tx('Set it')}
            </button>
          </>}
    </>}>
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      <div className="cm-row"><span className="cm-key">{tx('Their login')}</span><b>{person.username || '—'}</b></div>
      {done ? (
        <>
          <div className="cm-row"><span className="cm-key">{tx('New password')}</span><b className="amb-pw">{pw}</b></div>
          <div className="cm-hint">{tx('Send this to them now. It cannot be shown again.')}</div>
        </>
      ) : (
        <>
          <div className="cm-row">
            <span className="cm-key">{tx('New password')}</span>
            <input className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
              autoCapitalize="off" autoCorrect="off" />
          </div>
          <button className="btn btn-sm" onClick={suggest}>{tx('Suggest one')}</button>
          <div className="cm-hint">{tx('We cannot show the old password — it is stored one-way and even this board cannot read it.')}</div>
        </>
      )}
    </Modal>
  )
}

// Removing somebody. What goes and what stays is the whole of it, so it is
// said plainly before anything happens rather than in a one-line confirm.
function RemovePerson({ person, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try { await api.del(`/ambassadors/person/${person.user_id}`); onDone() }
    catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Modal title={tx('Remove this ambassador')} onClose={onClose} footer={<>
      <span className="foot-gap" />
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-danger" disabled={busy} onClick={go}>
        {busy ? tx('Removing…') : tx('Remove')}
      </button>
    </>}>
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      <p className="pc-desc"><b>{person.name}</b></p>
      <ul className="amb-remove-list">
        <li>{tx('Their login stops working and they leave this list.')}</li>
        <li>{tx('Work already finished or paid is KEPT, so your money record does not change.')}</li>
        <li>{tx('Anything still in progress — an unanswered idea, a video part-way through — goes with them.')}</li>
      </ul>
    </Modal>
  )
}

// One ambassador, whole: what they have done, what it earned, and every card
// they have ever sent with its state on it. This is the page they see, from
// this side — the counts on the list row say how many, and this says which.
//
// Paying is marked here because this is where you can see what you are paying
// for: the video, the amount and the month, in one row.
function TheirWork({ person, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(0)
  const load = useCallback(() => api.get(`/ambassadors/person/${person.user_id}/cards`)
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [person.user_id])
  useEffect(() => { load() }, [load])

  const markPaid = async (c) => {
    setBusy(c.id)
    try { await api.post(`/ambassadors/cards/${c.id}/paid`); await load(); onChanged?.() }
    catch (e) { toast(e.message, 'err') } finally { setBusy(0) }
  }

  return (
    <Modal title={person.name} onClose={onClose} wide footer={<>
      <span className="foot-gap" />
      <button className="btn" onClick={onClose}>{tx('Close')}</button>
    </>}>
      {err && <div className="form-error">{err}</div>}
      {!data ? <div className="app-loading"><span className="spinner" /></div> : (
        <>
          <div className="amb-numbers">
            <div className="amb-num">
              <b>{data.done_all_time}</b>
              <span className="stat-sub">{tx('Videos done, all time')}</span>
            </div>
            <div className="amb-num">
              <b>{money(data.earned_all_time)}</b>
              <span className="stat-sub">{tx('Earned, all time')}</span>
            </div>
            <div className="amb-num">
              <b>{data.posted_this_month}</b>
              <span className="stat-sub">{tx('This month')}</span>
            </div>
          </div>
          <div className="amb-history">
            {data.cards.map((c) => {
              const said = saysWhat(c)
              return (
                <div key={c.id} className={'amb-hist-row amb-' + said.tone}>
                  <span className="amb-hist-state">{said.line}</span>
                  <span className="amb-hist-what">{c.format} · {c.script.slice(0, 90)}</span>
                  <span className="spacer" />
                  {c.main_video_url && (
                    <a className="btn btn-sm" href={c.main_video_url} target="_blank" rel="noreferrer">
                      <LinkIcon size={12} /> {tx('The post')}
                    </a>
                  )}
                  {c.state === 'done' && (
                    <button className="btn btn-sm" disabled={busy === c.id} onClick={() => markPaid(c)}>
                      <Wallet size={12} /> {tx('Mark paid')}
                    </button>
                  )}
                </div>
              )
            })}
            {data.cards.length === 0 && (
              <div className="card card-pad empty">{tx('They have not sent anything yet.')}</div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

// Everything checked and not yet paid, in one list, with one press each and a
// total at the bottom. Paying is a sitting — you do all of them at once with
// the bank open — so it is a screen, not a button hidden inside each person.
function PayList({ rows, onPaid }) {
  const [busy, setBusy] = useState(0)
  const pay = async (c) => {
    setBusy(c.id)
    try { await api.post(`/ambassadors/cards/${c.id}/paid`); toast(tx('Marked paid')); onPaid() }
    catch (e) { toast(e.message, 'err') } finally { setBusy(0) }
  }
  const total = rows.reduce((n, c) => n + (Number(c.amount) || 0), 0)
  return (
    <div className="amb-history">
      {rows.map((c) => (
        <div key={c.id} className="amb-hist-row">
          <span className="amb-hist-state">{c.name}</span>
          <span className="amb-hist-what">{c.format} · {String(c.script || '').slice(0, 70)}</span>
          <span className="spacer" />
          <span className="amb-pay-amount">{money(c.amount)}</span>
          {c.main_video_url && (
            <a className="btn btn-sm" href={c.main_video_url} target="_blank" rel="noreferrer">
              <LinkIcon size={12} /> {tx('The post')}
            </a>
          )}
          <button className="btn btn-sm btn-primary" disabled={busy === c.id} onClick={() => pay(c)}>
            <Wallet size={12} /> {tx('Mark paid')}
          </button>
        </div>
      ))}
      <div className="amb-pay-total">
        <span className="spacer" />
        <span className="stat-sub">{tx('Altogether')}</span>
        <b>{money(total)}</b>
      </div>
    </div>
  )
}

// The contract, uploaded and taken off again. Read as a data URL in the
// browser, the way person_docs does it — this board has no file server, and a
// contract is small enough that it does not need one.
function ContractBox({ person, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [has, setHas] = useState(!!person.has_contract)
  const [name, setName] = useState(person.contract_name || '')

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setErr('')
    try {
      const data = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = () => rej(new Error(tx('That file could not be read')))
        r.readAsDataURL(file)
      })
      await api.put(`/ambassadors/person/${person.user_id}/contract`, { name: file.name, mime: file.type, data })
      setHas(true); setName(file.name)
      toast(tx('Contract saved'))
      onChanged?.()
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm(tx('Take the contract off this person?'))) return
    setBusy(true); setErr('')
    try {
      await api.del(`/ambassadors/person/${person.user_id}/contract`)
      setHas(false); setName('')
      onChanged?.()
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  return (
    <div className="amb-contract">
      {err && <div className="form-error">{err}</div>}
      {has ? (
        <>
          {/* The same opener the ambassador's own page uses — the route
              answers with the file as a data URL, not with the file. */}
          <ContractLink id={person.id} name={name || tx('Open it')} />
          <button className="btn btn-sm" disabled={busy} onClick={remove}>
            <Trash2 size={13} /> {tx('Remove')}
          </button>
        </>
      ) : (
        <span className="stat-sub">{tx('None yet')}</span>
      )}
      <label className="btn btn-sm">
        <Upload size={13} /> {busy ? tx('Saving…') : has ? tx('Replace') : tx('Upload')}
        <input type="file" hidden disabled={busy} onChange={pick}
          accept=".pdf,.doc,.docx,image/*,text/plain" />
      </label>
    </div>
  )
}

// A student's login, made from the page that runs the programme.
//
// It is an account and nothing else: no channels, no rights, no crew hat. The
// server enforces that as well (see the carve-out in routes/users.js) — this
// form simply never offers any of it, because there is nothing here to decide.
function NewAmbassador({ draft, onClose, onMade }) {
  const [form, setForm] = useState(draft)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const save = async () => {
    if (busy) return
    if (!form.name.trim() || !form.username.trim() || !form.password.trim()) {
      setErr(tx('A name, a username and a password — all three'))
      return
    }
    setBusy(true); setErr('')
    try {
      const u = await api.post('/users', {
        name: form.name.trim(), username: form.username.trim(),
        password: form.password, role: 'ambassador',
      })
      toast(tx('Account made — now their terms'))
      onMade(u)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={tx('Sign up an ambassador')} onClose={onClose} footer={<>
      <span className="foot-gap" />
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? tx('Saving…') : tx('Make the account')}
      </button>
    </>}>
      {err && <div className="form-error"><AlertCircle size={16} /> {err}</div>}
      <div className="cm-row">
        <span className="cm-key">{tx('Name')}</span>
        <input className="input" value={form.name} onChange={set('name')} autoFocus
          placeholder={tx('As it should read on the board')} />
      </div>
      <div className="cm-row">
        <span className="cm-key">{tx('Username')}</span>
        <input className="input" value={form.username} onChange={set('username')}
          autoCapitalize="off" autoCorrect="off" placeholder={tx('What they type to sign in')} />
      </div>
      <div className="cm-row">
        <span className="cm-key">{tx('Password')}</span>
        <input className="input" value={form.password} onChange={set('password')}
          placeholder={tx('Give it to them yourself — they can change it later')} />
      </div>
      <div className="cm-hint">
        {tx('An ambassador reaches one page and nothing else on this board.')}
      </div>
    </Modal>
  )
}

// One line while it is closed: who, what kind, and how long they have waited.
// Open, it is the whole decision.
function InboxRow({ card, open, onOpen, onDecided }) {
  const waited = waitedFor(card.waiting_since)
  return (
    <div className={'card amb-row' + (open ? ' open' : '')}>
      <button type="button" className="amb-row-head" onClick={onOpen}>
        <b>{card.name}</b>
        {/* THREE different things wait here and each wants a different answer:
            an idea wants a yes and an amount, a VIDEO wants watching before
            anybody publishes it, and a post wants somebody to confirm it is
            really live. The middle one is new — there was nowhere for a
            finished video to sit except "already public". */}
        <span className="stat-sub">
          {card.kind === 'posted' ? tx('Posted — check it is live')
            : card.kind === 'video' ? tx('Video to watch')
            : tx('New idea')}
        </span>
        <span className="spacer" />
        {card.version > 1 && card.kind === 'video' && (
          <span className="amb-cut" data-tip={tx('Which version this is')}>#{card.version}</span>
        )}
        <span className={'amb-wait' + (waited.hours >= 24 ? ' late' : '')}>{waited.text}</span>
      </button>
      {open && (card.kind === 'posted'
        ? <CheckPost card={card} onDecided={onDecided} />
        : card.kind === 'video'
        ? <CheckVideo card={card} onDecided={onDecided} />
        : <Decide card={card} onDecided={onDecided} />)}
    </div>
  )
}

// Watching the video, before the world does.
//
// Two answers and a fork. Send it back — as many times as it takes, which is
// the normal case and why the reason box sits open rather than behind a
// button. Or approve it, and say who posts it: some deals they post and tag
// us, some we post ourselves, and which one applies is a decision somebody
// makes once they have actually seen the thing. The card's agreed terms
// pre-select the answer; the person approving still chooses.
function CheckVideo({ card, onDecided }) {
  const [feedback, setFeedback] = useState('')
  const [who, setWho] = useState(card.posts_own === false ? 'us' : 'them')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async (path, body) => {
    setBusy(true); setErr('')
    try { await api.post(`/ambassadors/cards/${card.id}/${path}`, body); onDecided() }
    catch (e) { setErr(e.message); setBusy(false) }
  }
  const sentBack = (card.events || []).filter((e) => e.kind === 'sent_back').length
  return (
    <div className="amb-decide">
      {err && <div className="form-error">{err}</div>}
      <div className="amb-who stat-sub">{card.university || tx('not set')} · {money(card.amount)}</div>
      <div className="amb-script">{card.format} · {card.script}</div>
      {card.terms_other && <div className="amb-term-note">{card.terms_other}</div>}
      {sentBack > 0 && (
        <div className="stat-sub">{tx('Sent back before')}: {sentBack}</div>
      )}
      <div className="amb-links">
        <a className="btn btn-sm btn-primary" href={card.video_url} target="_blank" rel="noreferrer">
          <LinkIcon size={13} /> {tx('Watch the video')}
        </a>
      </div>
      {(card.events || []).length > 0 && <CardTrail events={card.events} />}
      <div className="field">
        <label>{tx('If it needs changes, say what')}</label>
        <textarea className="input" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)}
          placeholder={tx('e.g. trim the first five seconds, the logo is missing')} />
      </div>
      <div className="field">
        <label>{tx('If you approve it, who posts it?')}</label>
        <select className="select" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="them">{tx('They post it')}</option>
          <option value="us">{tx('We post it')}</option>
        </select>
      </div>
      <div className="amb-actions">
        <button className="btn btn-go" disabled={busy}
          onClick={() => send('video-ok', { who_posts: who })}>
          <Check size={14} /> {tx('Approve the video')}
        </button>
        <button className="btn" disabled={busy || !feedback.trim()}
          onClick={() => send('video-changes', { feedback: feedback.trim() })}>
          <X size={14} /> {tx('Send back for changes')}
        </button>
      </div>
    </div>
  )
}

// Checking a video somebody has actually posted. The whole panel is the link
// and two answers: it is there and it counts, or it is not right and here is
// why. Sending it back returns it to "you can film this" rather than to the
// beginning — they already have permission; what they need is to fix and
// re-post.
function CheckPost({ card, onDecided }) {
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const send = async (path, body) => {
    setBusy(true); setErr('')
    try { await api.post(`/ambassadors/cards/${card.id}/${path}`, body); onDecided() }
    catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <div className="amb-decide">
      {err && <div className="form-error">{err}</div>}
      <div className="amb-who stat-sub">{card.university || tx('not set')} · {money(card.amount)}</div>
      <div className="amb-script">{card.format} · {card.script}</div>
      {card.terms_other && <div className="amb-term-note">{card.terms_other}</div>}
      <div className="amb-links">
        <a className="btn btn-sm btn-primary" href={card.main_video_url} target="_blank" rel="noreferrer">
          <LinkIcon size={13} /> {tx('Open the post')}
        </a>
        {card.story_clip_url && (
          <a className="btn btn-sm" href={card.story_clip_url} target="_blank" rel="noreferrer">
            <LinkIcon size={13} /> {tx('The story')}
          </a>
        )}
      </div>
      <div className="field">
        <label>{tx('If it is not right, say why')}</label>
        <textarea className="input" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)}
          placeholder={tx('e.g. wrong account, or the tag is missing')} />
      </div>
      <div className="amb-actions">
        <button className="btn btn-go" disabled={busy} onClick={() => send('done')}>
          <Check size={14} /> {tx('It is up — counts this month')}
        </button>
        <button className="btn" disabled={busy || !feedback.trim()}
          onClick={() => send('repost', { feedback: feedback.trim() })}>
          <X size={14} /> {tx('Send it back')}
        </button>
      </div>
    </div>
  )
}

// The four sentences from the contract, one press each. A refusal somebody has
// to compose from scratch is a refusal that arrives late or not at all.
const QUICK = [
  'Filmed without a confirmed script',
  'Story clip missing',
  'Mention was in the caption only, not spoken',
  'Logo missing in the video',
]

function Decide({ card, onDecided }) {
  const [terms, setTerms] = useState({
    we_edit: card.defaults.we_edit,
    posts_own: card.defaults.posts_own,
    collaborator: card.defaults.collaborator,
  })
  // Three boxes cannot describe every arrangement anybody agrees to. This is
  // the one that says what was actually agreed, in words — it starts from
  // their usual terms and is edited per video.
  const [other, setOther] = useState(card.defaults.terms_other || '')
  const [amount, setAmount] = useState('')   // never pre-filled — a human types it
  const [feedback, setFeedback] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async (path, body) => {
    setBusy(true); setErr('')
    try { await api.post(`/ambassadors/cards/${card.id}/${path}`, body); onDecided() }
    catch (e) { setErr(e.message); setBusy(false); setAsking(false) }
  }

  const value = Number(String(amount).replace(/\s/g, ''))
  const canApprove = Number.isFinite(value) && value > 0

  return (
    <div className="amb-decide">
      {err && <div className="form-error">{err}</div>}
      <div className="amb-who stat-sub">{card.university || tx('not set')}</div>
      <div className="amb-script">{card.script}</div>
      {card.reference_url && (
        <a className="btn btn-sm" href={card.reference_url} target="_blank" rel="noreferrer">
          {tx('Something like it')}
        </a>
      )}

      <div className="amb-terms">
        {[['we_edit', 'We edit it'], ['posts_own', 'Posts on their own account'], ['collaborator', 'We are a collaborator']].map(([k, label]) => (
          <label key={k} className={'checkbox-chip' + (terms[k] ? ' on' : '')}>
            <input type="checkbox" checked={terms[k]}
              onChange={(e) => setTerms({ ...terms, [k]: e.target.checked })} />
            {tx(label)}
          </label>
        ))}
      </div>

      <div className="field amb-amount">
        <label>{tx('Amount for this video')}</label>
        <input className="input" inputMode="numeric" value={amount} placeholder="750000"
          onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ''))} />
        {card.recent_amounts.length > 0 && (
          <span className="stat-sub">
            {tx('Last time')}: {card.recent_amounts.map((a) => money(a)).join(', ')}
          </span>
        )}
      </div>

      <div className="field">
        <label>{tx('Anything else agreed')} <span className="crew-opt">{tx('optional')}</span></label>
        <input className="input" value={other} onChange={(e) => setOther(e.target.value)}
          placeholder={tx('e.g. tag us in the caption and keep it up 30 days')} />
      </div>

      <div className="field">
        <label>{tx('What needs changing')}</label>
        <div className="amb-quick">
          {QUICK.map((q) => (
            <button key={q} type="button" className="btn btn-sm" onClick={() => setFeedback(tx(q))}>
              {tx(q)}
            </button>
          ))}
        </div>
        <textarea className="input" rows={2} value={feedback}
          onChange={(e) => setFeedback(e.target.value)} />
      </div>

      <div className="amb-actions">
        <button className="btn btn-go" disabled={busy || !canApprove} onClick={() => setAsking(true)}>
          <Check size={14} /> {tx('Approve')}
        </button>
        <button className="btn" disabled={busy || !feedback.trim()}
          onClick={() => send('changes', { feedback: feedback.trim() })}>
          <X size={14} /> {tx('Needs changes')}
        </button>
      </div>

      {/* One line, so nobody approves a number they mistyped. */}
      {asking && (
        <Modal title={tx('Approve')} onClose={() => setAsking(false)} footer={<>
          <button className="btn" onClick={() => setAsking(false)}>{tx('Cancel')}</button>
          <button className="btn btn-primary" disabled={busy}
            onClick={() => send('approve', { amount: value, ...terms, terms_other: other.trim() })}>
            {tx('Yes')}
          </button>
        </>}>
          <p>{tx('Approve {name} at {amount}?', { name: card.name, amount: money(value) })}</p>
        </Modal>
      )}
    </div>
  )
}

// University, telegram, the usual terms and whether they are still active.
// The account itself is made in user management; this is the programme.
function DetailsForm({ person, onClose, onSaved }) {
  const [form, setForm] = useState({
    university: person.university || '',
    telegram: person.telegram || '',
    default_we_edit: !!person.default_we_edit,
    default_posts_own: person.default_posts_own === undefined ? true : !!person.default_posts_own,
    default_collaborator: !!person.default_collaborator,
    default_terms_other: person.default_terms_other || '',
    status: person.status || 'active',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true); setErr('')
    try { await api.put(`/ambassadors/person/${person.user_id}`, form); onSaved() }
    catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Modal title={person.name} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx('Cancel')}</button>
      <button className="btn btn-primary" disabled={busy} onClick={save}>{tx('Save')}</button>
    </>}>
      {err && <div className="form-error">{err}</div>}
      <div className="field">
        <label>{tx('University')}</label>
        <input className="input" value={form.university} autoFocus
          onChange={(e) => setForm({ ...form, university: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('Telegram')}</label>
        <input className="input" value={form.telegram} placeholder="@…"
          onChange={(e) => setForm({ ...form, telegram: e.target.value })} />
      </div>
      <div className="field">
        <label>{tx('Their usual terms')}</label>
        <div className="amb-terms">
          {[['default_we_edit', 'We edit it'], ['default_posts_own', 'Posts on their own account'], ['default_collaborator', 'We are a collaborator']].map(([k, label]) => (
            <label key={k} className={'checkbox-chip' + (form[k] ? ' on' : '')}>
              <input type="checkbox" checked={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
              {tx(label)}
            </label>
          ))}
        </div>
        <input className="input" value={form.default_terms_other}
          placeholder={tx('Anything else you usually agree — in words')}
          onChange={(e) => setForm({ ...form, default_terms_other: e.target.value })} />
        <span className="stat-sub">{tx('These only pre-tick the boxes when you approve. A card keeps whatever it was approved with.')}</span>
      </div>

      {/* The one piece of paper this programme has, and there was nowhere to
          put it. Stored beside the person the way a document is, opened by
          either side from their own page. */}
      <div className="field">
        <label>{tx('Contract')}</label>
        <ContractBox person={person} onChanged={onSaved} />
      </div>
      <div className="field">
        <label>{tx('Status')}</label>
        <select className="select" value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="active">{tx('Active')}</option>
          <option value="paused">{tx('Paused')}</option>
          <option value="ended">{tx('Ended')}</option>
        </select>
      </div>
    </Modal>
  )
}

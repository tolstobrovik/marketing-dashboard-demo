import { useEffect, useState } from 'react'
import { Clapperboard, Scissors, CalendarDays, Wallet, ExternalLink, Send, Check, FileText } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { todayISO, addDaysISO } from '../lib/constants.js'
import { useIsPhone } from '../lib/usePhone.js'
import Modal from './Modal.jsx'
import Zoom from './Zoom.jsx'

// Ambassador 2.0 — what an ambassador sees of the tasks they were given.
//
// Three things, and deliberately not the board: WHEN (the next two weeks —
// the day they film, and the day the editor's cut is due), WHAT IT PAYS (the
// rate card they are on), and WHAT TO FILM (the brief, read-only, with one box
// to say where the footage is). None of it is the staff task sheet: there is
// no stage to pick, no gate to argue with, and nothing here can change a brief.
//
// Everything is read from /ambassadors/me/… — the only part of the API an
// ambassador may reach.

const DAYS = 14
const dayWord = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(), { timeZone: 'UTC', ...opts })
const shortDay = (iso) => (iso ? dayWord(iso, { day: 'numeric', month: 'short' }) : '')

// A task's two days, as the tags the calendar draws. Filming first — when both
// fall on one day the shoot is the one they have to turn up for.
const tagsOn = (tasks, day) => [
  ...tasks.filter((t) => t.recording_date === day).map((t) => ({ kind: 'film', task: t })),
  ...tasks.filter((t) => t.edit_ready_date === day).map((t) => ({ kind: 'edit', task: t })),
]

function Tag({ kind, task, onOpen }) {
  const film = kind === 'film'
  const Icon = film ? Clapperboard : Scissors
  return (
    <button type="button" className={'ambt-tag ambt-' + kind} onClick={() => onOpen(task)}
      data-tip={`${film ? tx('Filming Due') : tx('Edit Due')} · ${task.title}`}>
      <Icon size={11} />
      <span className="ambt-tag-kind">{film ? tx('Filming Due') : tx('Edit Due')}</span>
      <span className="ambt-tag-title">{task.title}</span>
    </button>
  )
}

// The next two weeks. A 7×2 grid on a desk; on a phone the same days as one
// chronological list, because fourteen columns' worth of tags at 375px is a
// page that scrolls sideways.
export function MiniCalendar({ tasks, onOpen }) {
  const phone = useIsPhone()
  const today = todayISO()
  const days = Array.from({ length: DAYS }, (_, i) => addDaysISO(today, i))
  const busy = days.filter((d) => tagsOn(tasks, d).length > 0)
  return (
    <section className="ambt-sec">
      <h3 className="ambt-h"><CalendarDays size={15} /> {tx('Mini Calendar')}</h3>
      {phone ? (
        <div className="ambt-list">
          {busy.length === 0 && <div className="stat-sub">{tx('Nothing due in the next two weeks.')}</div>}
          {busy.map((d) => (
            <div className={'ambt-day-row' + (d === today ? ' today' : '')} key={d}>
              <b className="ambt-day-name">{dayWord(d, { weekday: 'short', day: 'numeric', month: 'short' })}</b>
              <div className="ambt-tags">
                {tagsOn(tasks, d).map((g) => <Tag key={g.kind + g.task.id} {...g} onOpen={onOpen} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ambt-grid">
          {days.map((d) => (
            <div className={'ambt-cell' + (d === today ? ' today' : '')} key={d}>
              <span className="ambt-cell-day">{dayWord(d, { weekday: 'short' })} <b>{dayWord(d, { day: 'numeric' })}</b></span>
              <div className="ambt-tags">
                {tagsOn(tasks, d).map((g) => <Tag key={g.kind + g.task.id} {...g} onOpen={onOpen} />)}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Every task they hold, dated or not — the calendar only shows two
          weeks, and a task with no editor yet has a cut day nobody can draw. */}
      <div className="ambt-tasks">
        {tasks.length === 0 && <div className="card card-pad empty">{tx('No tasks have been given to you yet.')}</div>}
        {tasks.map((t) => (
          <button type="button" className="card ambt-task" key={t.id} onClick={() => onOpen(t)}>
            <b className="ambt-task-title">{t.title}</b>
            <span className="ambt-task-days">
              <span><Clapperboard size={12} /> {tx('Filming Due')}: <b>{t.recording_date ? shortDay(t.recording_date) : '—'}</b></span>
              <span><Scissors size={12} /> {tx('Edit Due')}: <b>{t.edit_ready_date ? shortDay(t.edit_ready_date) : tx('TBD')}</b></span>
              {t.shot_link && <span className="ambt-in"><Check size={12} strokeWidth={3} /> {tx('Footage handed in')}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// What they are paid, read-only. The numbers are the rate card's own: a flat
// rate per kind of piece, the views a piece has to reach, and what a thousand
// views pays once it has. Nothing is worked out here.
const KIND_NAME = {
  post: () => tx('Posts'), reel: () => tx('Reels'), youtube: () => 'YouTube', target: () => tx('Ads'),
}
export function MyRates({ rates }) {
  if (!rates) return null
  const cur = rates.currency === 'UZS' ? 'soʻm' : rates.currency
  const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')} ${cur}`
  const views = (n) => Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ')
  const general = [
    rates.per_publish > 0 && [tx('Per published piece'), money(rates.per_publish)],
    rates.per_1k_views > 0 && [tx('Per 1,000 views'), money(rates.per_1k_views)],
    rates.views_target > 0 && rates.views_bonus > 0 && [tx('Bonus at {n} views in the month', { n: views(rates.views_target) }), money(rates.views_bonus)],
  ].filter(Boolean)
  const empty = rates.kinds.length === 0 && general.length === 0
  return (
    <section className="ambt-sec">
      <h3 className="ambt-h"><Wallet size={15} /> {tx('My Rates & Thresholds')}</h3>
      {empty ? (
        <div className="card card-pad empty">{tx('Your rates have not been set yet — ask your coordinator.')}</div>
      ) : (
        <div className="card ambt-rates">
          {rates.kinds.map((k) => (
            <div className="ambt-rate" key={k.kind}>
              <b className="ambt-rate-kind">{(KIND_NAME[k.kind] || (() => k.kind))()}</b>
              <span><span className="stat-sub">{tx('Fixed rate')}</span><b>{k.flat ? money(k.flat) : '—'}</b></span>
              <span><span className="stat-sub">{tx('View threshold')}</span><b>{k.gate ? views(k.gate) : '—'}</b></span>
              <span><span className="stat-sub">{tx('Per 1,000 views')}</span><b>{k.per_1k ? money(k.per_1k) : '—'}</b></span>
            </div>
          ))}
          {general.map(([label, value]) => (
            <div className="ambt-rate ambt-rate-line" key={label}>
              <span className="stat-sub">{label}</span><b>{value}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// The lightweight brief. Only what is written is drawn — an empty section is
// not a box with nothing in it — and the one thing that can be typed is where
// the footage is. A file name is as welcome as a link: the editor or the
// reviewer chases it if it is not enough.
export function BriefModal({ task, onClose, onHandedIn }) {
  const [brief, setBrief] = useState(null)
  const [err, setErr] = useState('')
  const [link, setLink] = useState(task.shot_link || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.get(`/ambassadors/me/tasks/${task.id}`)
      .then((b) => { setBrief(b); setLink(b.shot_link || '') })
      .catch((e) => setErr(e.message))
  }, [task.id])

  const send = async () => {
    if (busy || !link.trim()) return
    setBusy(true); setErr('')
    try {
      const out = await api.post(`/ambassadors/me/tasks/${task.id}/footage`, { link: link.trim() })
      toast(tx('Footage handed in — synced'))
      onHandedIn?.(out.task)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const b = brief
  const links = (b?.reference_links || []).filter(Boolean)
  const photos = (b?.reference_photos || []).filter((p) => p?.photo || p?.thumb)
  const hasRefs = !!(b && (b.reference_text || links.length || photos.length))
  const nothing = b && !b.tz && !b.script && !hasRefs
  return (
    <Modal title={task.title} onClose={onClose} bodyClass="ambt-brief-body">
      <div className="ambt-brief">
        <div className="ambt-brief-days">
          <span><Clapperboard size={13} /> {tx('Filming Due')}: <b>{(b || task).recording_date ? shortDay((b || task).recording_date) : '—'}{(b || task).recording_time ? ` · ${(b || task).recording_time}` : ''}</b></span>
          <span><Scissors size={13} /> {tx('Edit Due')}: <b>{(b || task).edit_ready_date ? shortDay((b || task).edit_ready_date) : tx('TBD')}</b>{(b || task).editor ? ` · ${(b || task).editor}` : ''}</span>
        </div>
        {!b && !err && <div className="app-loading"><span className="spinner" /></div>}
        {nothing && <div className="card card-pad empty">{tx('The brief has not been written yet.')}</div>}
        {b?.tz && (
          <section className="ambt-brief-sec">
            <h4><FileText size={13} /> {tx('Task Brief (TZ)')}</h4>
            <p>{b.tz}</p>
          </section>
        )}
        {b?.script && (
          <section className="ambt-brief-sec">
            <h4><FileText size={13} /> {tx('Script')}</h4>
            <p>{b.script}</p>
          </section>
        )}
        {hasRefs && (
          <section className="ambt-brief-sec">
            <h4><ExternalLink size={13} /> {tx('References')}</h4>
            {b.reference_text && <p>{b.reference_text}</p>}
            {links.length > 0 && (
              <div className="ambt-brief-links">
                {links.map((u) => (/^https?:\/\//i.test(u)
                  ? <a key={u} href={u} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {u.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60)}</a>
                  : <span key={u}>{u}</span>))}
              </div>
            )}
            {photos.length > 0 && (
              <div className="ambt-brief-photos">
                {photos.map((p, i) => <Zoom key={i} src={p.thumb || p.photo} full={p.photo || p.thumb} alt={tx('References')} />)}
              </div>
            )}
          </section>
        )}
        {b && (
          <section className="ambt-brief-sec ambt-hand">
            <h4><Send size={13} /> {tx('Submit footage link')}</h4>
            <div className="ambt-hand-row">
              <input className="input" value={link} placeholder={tx('Link to the footage, or the file name')}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }} />
              <button type="button" className="btn btn-primary" disabled={busy || !link.trim()} onClick={send}>
                <Send size={14} /> {b.shot_link ? tx('Update') : tx('Send')}
              </button>
            </div>
          </section>
        )}
        {err && <div className="form-error" role="alert">{err}</div>}
      </div>
    </Modal>
  )
}

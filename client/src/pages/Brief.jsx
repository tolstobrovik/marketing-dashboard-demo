import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, useLocation } from 'react-router-dom'
import {
  Sun, Clapperboard, Scissors, Send, CheckCircle2, Check, StickyNote, ListTodo, PenLine, Trash2, Palette,
  ChevronLeft, ChevronRight, RotateCcw, ExternalLink, Link2,
  CalendarClock, CalendarDays, Plus, AlertCircle,
} from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth, adminOn } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, dateLabel, typeInfo, isDeletedLabel, can, tashkentDay, PRAVKA_ROUNDS, longDayLabel } from '../lib/constants.js'
import { editDue, reviewDue } from '../lib/due.js'
import ContentModal from '../components/ContentModal.jsx'
import Modal from '../components/Modal.jsx'
import { isSentence } from '../lib/text.js'
import { rewardIfFinished } from '../lib/reward.js'
import CrewDay from '../components/CrewDay.jsx'
import CoachCrewDay from '../components/CoachCrewDay.jsx'
import CoachMakerDay from '../components/CoachMakerDay.jsx'
import CoachAdminDay from '../components/CoachAdminDay.jsx'
import CoachCalendar from '../components/CoachCalendar.jsx'
import { KindMark, ownOf, ownClass } from '../components/CoachParts.jsx'
import { NETWORKS } from '../components/CoachBits.jsx'
import { byNetwork, tailOf } from '../components/Sidebar.jsx'
import { crewEntries, crewDay, makerDay, makeDone } from '../lib/coach.js'
import { useNextStep } from '../lib/useNextStep.js'
import { useSimpleLook, setSimple } from '../lib/look.js'
import MyPay from '../components/MyPay.jsx'
import DayAgenda from '../components/DayAgenda.jsx'
import MyGrade from '../components/MyGrade.jsx'
import Streak from '../components/Streak.jsx'
import { deliveryHref, splitDelivery } from '../lib/text.js'
import { useContextMenu } from '../components/ContextMenu.jsx'
import { toast, loadFailed } from '../lib/toast.js'
import { usePages } from '../lib/pages.jsx'
import { markDone, moveTo } from '../lib/finish.js'
import { playDone } from '../lib/sound.js'
import { tr as tx, locale, useT } from '../lib/i18n.jsx'
import { StageDot } from '../components/Dot.jsx'

// My Day — the deadline-first landing page, in two shapes:
//   crew (operator / editor / both): what to shoot at which hour, the editing
//     desk with the edit-ready deadline, releases — the videographer's day.
//   everyone else: dead simple — what is missing, what to do today, then
//     tomorrow / 3 days / 7 days / any custom dates. Their own tasks only.

// What kind of work a row is — worn as the first chip so SHOOT vs EDIT vs
// DESIGN vs RELEASE is never a guess.
const WORK = {
  shoot: { label: 'Shoot', icon: Clapperboard, cls: 'wk-shoot' },
  edit: { label: 'Edit', icon: Scissors, cls: 'wk-edit' },
  design: { label: 'Design', icon: Palette, cls: 'wk-edit' },
  release: { label: 'Release', icon: Send, cls: 'wk-rel' },
}
// Which kind a date belongs to on this task — every maker has their own date.
const workOnDate = (t, d) =>
  t.recording_date === d ? 'shoot'
    : t.design_ready_date === d ? 'design'
      : editDue(t) === d ? 'edit' : 'release'

/* The crew's own month calendar: their shoots on the shoot day, their cuts on
   the edit-ready day, their artwork on the design-ready day. No release dates
   — the crew works to the maker deadlines, not the publishing schedule. */
// r11 (the owner): with `onMove`, a piece is dragged onto another day — it is
// the person's own day, so the server moves it on their word (one line of why).
// Round 14 (the owner's pick: Teamup, with the live board's cards): Shoot and
// Edit are two tiles on top, pressed to see only that; the channels are down
// the left, one press each; "Whole channel" adds everyone's shoots and edits
// there, drawn fainter with their initials, yours first. A day holds three
// cards and "+N more" (the day's list); what is late is counted on today.
const CAP_DAY = 3
function CrewCalendar({ tasks, all = tasks, team = [], channels = [], userId, today, byKey, statusesById, onOpen, onDay, onMove = null }) {
  const [overDay, setOverDay] = useState(null)
  const [month, setMonth] = useState(today.slice(0, 7)) // YYYY-MM
  const [only, setOnly] = useState(null)      // 'shoot' | 'edit': a tile pressed
  const [chan, setChan] = useState(null)      // one channel from the rail, or every one
  const [whole, setWhole] = useState(false)   // everyone's work on the channel, not only yours
  const move = (n) => {
    const d = new Date(`${month}-01T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + n)
    setMonth(d.toISOString().slice(0, 7))
  }
  const list = useMemo(() => {
    const out = []
    // Whose seat counts: yours, or with Whole channel on anybody's.
    const seat = (id) => (whole ? !!id : id === userId)
    const push = (date, kind, t, who) => { out.push({ date, kind, t, who, mine: who === userId, done: kind === 'shoot' && !!t.shot_at }) }
    // Handed in as My Day reads it (lib/coach.js): a piece put back on Editing is work again.
    const made = (t, seat) => makeDone(t, statusesById?.[t.status_id]?.label || '', seat)
    for (const t of whole ? all : tasks) {
      if (t.done_at) continue
      if (seat(t.operator_id) && t.recording_date) push(t.recording_date, 'shoot', t, t.operator_id)
      // editDue, not edit_ready_date: a deadline re-promised after a late
      // handover is the day this editor actually agreed to, and the day the
      // server counts them against. Drawing the original here put the work on
      // one square of their own calendar and judged it on another.
      if (seat(t.editor_id) && editDue(t) && !made(t, 'editor')) push(editDue(t), 'edit', t, t.editor_id)
      if (seat(t.designer_id) && t.design_ready_date && !made(t, 'designer')) push(t.design_ready_date, 'design', t, t.designer_id)
      // no maker date of their own → the release day is the implicit deadline,
      // shown as plain edit/design work (never as a release)
      if (seat(t.editor_id) && !editDue(t) && !made(t, 'editor') && reviewDue(t)) push(reviewDue(t), 'edit', t, t.editor_id)
      if (seat(t.designer_id) && !t.design_ready_date && !made(t, 'designer') && reviewDue(t)) push(reviewDue(t), 'design', t, t.designer_id)
    }
    // Yours first, then by the hour.
    return out.sort((a, b) => (b.mine - a.mine) || (a.t.recording_time || '99').localeCompare(b.t.recording_time || '99'))
  }, [tasks, all, whole, userId, statusesById])

  const late = (e) => !e.done && e.date < today
  const isShoot = (e) => e.kind === 'shoot'
  const inScope = list.filter((e) => !chan || (e.t.channels || []).includes(chan))
  const kinds = ['shoot', 'edit'].filter((k) => inScope.some((e) => isShoot(e) === (k === 'shoot')))
  const shown = inScope.filter((e) => !only || kinds.length < 2 || isShoot(e) === (only === 'shoot'))
  const inMonth = (e) => e.date.slice(0, 7) === month
  const lateN = shown.filter(late).length
  const byDay = {}
  for (const e of shown) (byDay[e.date] ||= []).push(e)

  // Monday-first month grid.
  const weeks = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`)
    const start = new Date(first)
    start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7))
    const out = []
    for (let w = 0; w < 6; w++) {
      const row = []
      for (let d = 0; d < 7; d++) {
        const day = new Date(start)
        day.setUTCDate(start.getUTCDate() + w * 7 + d)
        row.push(day.toISOString().slice(0, 10))
      }
      out.push(row)
      if (row[6] >= `${month}-28` && new Date(`${row[6]}T00:00:00Z`).getUTCMonth() !== first.getUTCMonth()) break
    }
    return out
  }, [month])

  // In the reader's language: this said "October 2026" and "Mon Tue Wed" to
  // somebody reading the rest of the page in Russian or Uzbek.
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  // 2024-01-01 was a Monday; the week here starts on one.
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' }))
  const KIND = { shoot: { word: 'Shoot' }, edit: { word: 'Edit due' }, design: { word: 'Design due' } }
  const initials = (id) => String(team.find((u) => u.id === id)?.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const nameOf = (id) => String(team.find((u) => u.id === id)?.name || '').split(' ')[0]
  const chName = (c) => byKey[c]?.label || c

  // The two tiles: what to film and what to edit, with how much of it is late.
  const tile = (k) => {
    const es = inScope.filter((e) => isShoot(e) === (k === 'shoot'))
    const n = es.filter((e) => inMonth(e) && !e.done).length, l = es.filter(late).length
    const body = (
      <>
        <span className={`cc14-km ${k}`} aria-hidden="true">{k === 'shoot' ? <Clapperboard size={18} /> : <Scissors size={18} />}</span>
        <span><b>{k === 'shoot' ? tx('Shoot') : tx('Editing')}</b><small>{l ? <span className="cc14-lt">{tx('{n} late', { n: l })}</span> : k === 'shoot' ? tx('to film') : tx('to edit')}</small></span>
        <em>{n}</em>
      </>
    )
    // One kind only: nothing to filter, so it is a count, not a button that does nothing.
    return kinds.length < 2 ? <div key={k} className={`cc14-kb ${k} one`}>{body}</div>
      : <button key={k} type="button" className={`cc14-kb ${k}`} aria-pressed={only === k} onClick={() => setOnly(only === k ? null : k)}>{body}</button>
  }
  // The rail: every channel, by network, with what is on it this month.
  const railCount = (c) => list.filter((e) => inMonth(e) && !e.done && (!c || (e.t.channels || []).includes(c)) && (!only || kinds.length < 2 || isShoot(e) === (only === 'shoot'))).length
  const rail = (
    <nav className="cc14-rail" aria-label={tx('Channels')}>
      <button type="button" className="cc14-cb all" aria-pressed={!chan} onClick={() => setChan(null)}><span>{tx('All channels')}</span><em>{railCount(null)}</em></button>
      {byNetwork(channels).map(({ net, channels: cs }) => (
        <div key={net} className={'cc14-net' + (NETWORKS[net] && cs.length > 1 ? '' : ' one')}>
          {NETWORKS[net] && cs.length > 1 && <p>{NETWORKS[net].name}</p>}
          {cs.map((c) => {
            const n = railCount(c.key)
            const short = NETWORKS[net] && cs.length > 1 ? tailOf(c, NETWORKS[net].name) : ''
            return (
              <button key={c.key} type="button" className={'cc14-cb' + (n ? '' : ' z')} aria-pressed={chan === c.key} onClick={() => setChan(chan === c.key ? null : c.key)}
                aria-label={`${c.label}, ${n}`}><span>{short || c.label}</span><em>{n}</em></button>
            )
          })}
        </div>
      ))}
    </nav>
  )
  const has = (k) => shown.some((e) => inMonth(e) && (k === 'shoot' ? isShoot(e) : !isShoot(e)))
  return (
    <div className="card card-pad cc14">
      <div className="cc14-top">
        <div className="cc14-kinds">{kinds.map(tile)}</div>
        {kinds.length > 1 && <p className="cc14-hint">{only ? tx('Press again for both.') : tx('Press Shoot or Edit to see only that.')}</p>}
        <button type="button" className="cc14-tog" role="switch" aria-checked={whole} onClick={() => setWhole(!whole)}>
          <i aria-hidden="true" />
          <span>{tx('Whole channel')}<small>{whole ? (chan ? tx('Everyone’s on {name}', { name: chName(chan) }) : tx('Everyone’s, every channel')) : tx('Off: only your work')}</small></span>
        </button>
      </div>
      <div className="cc14-body">
        {rail}
        <div className="cc14-main">
          <div className="cc-nav">
            <b className="cc14-month">{monthName}</b>
            <button className="icon-btn" onClick={() => move(-1)} aria-label={tx("Previous month")}><ChevronLeft size={16} /></button>
            <button className="icon-btn" onClick={() => move(1)} aria-label={tx("Next month")}><ChevronRight size={16} /></button>
            {month !== today.slice(0, 7) && <button className="btn btn-sm" onClick={() => setMonth(today.slice(0, 7))}>{tx('Today')}</button>}
            <span className="cc14-lgd">
              {has('shoot') && <span><i className="s" />{tx('Shoot, at its hour')}</span>}
              {has('edit') && <span><i className="e" />{tx('Edit, due that day')}</span>}
              {lateN > 0 && <span><i className="l" />{tx('Late')}</span>}
              {whole && shown.some((e) => !e.mine) && <span><i className="o" />{tx('Someone else’s, with their initials')}</span>}
            </span>
          </div>
          <div className="cc-grid cc-headrow">
            {weekdays.map((d) => <div key={d} className="cc-head">{d}</div>)}
          </div>
          {weeks.map((row, i) => (
            <div key={i} className="cc-grid">
              {row.map((iso) => {
                const other = iso.slice(0, 7) !== month
                const es = byDay[iso] || []
                const pile = iso === today && lateN > 0
                const cap = pile ? CAP_DAY - 1 : CAP_DAY
                return (
                  <div key={iso} className={'cc-day' + (other ? ' cc-other' : '') + (iso === today ? ' cc-today' : '') + (onDay ? ' cc-click' : '') + (overDay === iso ? ' cc-over' : '')} onClick={() => onDay?.(iso)}
                    onDragOver={onMove ? (e) => { e.preventDefault(); setOverDay(iso) } : undefined}
                    onDragLeave={onMove ? () => setOverDay((d) => (d === iso ? null : d)) : undefined}
                    onDrop={onMove ? (e) => { e.preventDefault(); setOverDay(null); try { const { id, kind } = JSON.parse(e.dataTransfer.getData('text/plain')); const t = tasks.find((x) => x.id === id); if (t) onMove(t, kind, iso) } catch { /* not ours */ } } : undefined}>
                    <span className="cc-num">{Number(iso.slice(8))}</span>
                    {pile && <span className="cc14-pile"><AlertCircle size={13} aria-hidden="true" />{tx('{n} late', { n: lateN })}</span>}
                    {es.slice(0, cap).map((x) => {
                      const { kind, t } = x
                      const K = KIND[kind]
                      // r11 (the editor's and operator's feedback): the colour says what of
                      // the piece is yours — green the shoot and the edit, a deep yellow
                      // only the shoot, a light yellow only the edit. No red; a piece with
                      // neither is not on this calendar at all. Somebody else's (Whole
                      // channel) wears its kind's colour, fainter, with their initials.
                      const own = x.mine ? ownOf(t, userId) : { shoot: kind === 'shoot', edit: kind !== 'shoot' }
                      return (
                        <button key={`${kind}${t.id}`} className={`cc-ev cc-own-${ownClass(own)}${x.mine ? '' : ' cc14-oth'}${late(x) ? ' cc14-late' : ''}`}
                          draggable={!!onMove && x.mine} onDragStart={onMove && x.mine ? (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ id: t.id, kind })); e.dataTransfer.effectAllowed = 'move' } : undefined}
                          onClick={(e) => { e.stopPropagation(); onOpen(t) }} title={x.mine ? t.title : `${t.title} · ${nameOf(x.who)}`}>
                          <b><KindMark shoot={own.shoot} edit={own.edit} size={20} /> {tx(K.word)}{kind === 'shoot' && t.recording_time ? ` · ${t.recording_time.slice(0, 5)}` : ''}</b>
                          <span>{t.title}</span>
                          <i>{t.channels.map((c) => byKey[c]?.label || c).join(' · ')}</i>
                          {!x.mine && <em className="cc14-ini" aria-label={nameOf(x.who)}>{initials(x.who)}</em>}
                        </button>
                      )
                    })}
                    {es.length > cap && <button type="button" className="cc14-more" onClick={(e) => { e.stopPropagation(); onDay?.(iso) }}>{tx('+{n} more', { n: es.length - cap })}</button>}
                    {/* The audit (12 Oct): on a phone seven columns of cards were
                        unreadable — there the day shows a dot per piece, in the same
                        colours, and a tap opens the day's list (onDay). */}
                    {es.length > 0 && (
                      <span className="cc-dots" aria-hidden="true">
                        {es.map((x) => <i key={`${x.kind}${x.t.id}`} className={`cc-own-${ownClass(x.mine ? ownOf(x.t, userId) : { shoot: x.kind === 'shoot', edit: x.kind !== 'shoot' })}`} />)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {!shown.some(inMonth) && (
            <div className="cc14-empty">
              <b>{whole ? tx('Nothing here this month.') : chan ? tx('Nothing of yours on {name} this month.', { name: chName(chan) }) : tx('Nothing of yours this month.')}</b>
              {!whole && <><span>{tx('Whole channel shows what everyone films and edits there.')}</span>
                <button type="button" className="btn btn-sm" onClick={() => setWhole(true)}>{tx('Show the whole channel')}</button></>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* Module-level row (poll ticks must not remount it). */
// One flat list, three tiers, in the order a day is actually worked: what
// you are already late on, what is due today, what is coming. The colour is
// the whole label — red, green, blue — and the word is on the dot for anyone
// who needs it.
const TIER_WORD = {
  late: () => tx('Overdue'),
  today: () => tx('Today'),
  soon: () => tx('Coming up'),
}
function BriefRow({ item, when, time, late = false, done = false, work = null, tier = null, byKey, statusesById, onOpen, onMenu }) {
  const status = statusesById[item.status_id]
  const wk = work && WORK[work]
  const WkIcon = wk?.icon
  return (
    <button className="ov-row" onClick={() => onOpen(item)}
      onContextMenu={onMenu ? (e) => onMenu(e, item) : undefined}>
      {tier && <i className={`dot dot-${tier}`} aria-label={TIER_WORD[tier]()} data-tip={TIER_WORD[tier]()} />}
      <span className={'brief-when' + (late ? ' late' : '')}>
        {time && <b>{time}</b>}
        {when && <span className="brief-when-sub">{when}</span>}
      </span>
      <span className="brief-main">
        <span className={'ov-title' + (done ? ' done-txt' : '')}>{item.title}</span>
        {item.description && !done && (
          <span className="brief-note" data-tip={tx("Notes for shooting / editing — open the task for the full text")}>
            <StickyNote size={11} /> {item.description}
          </span>
        )}
      </span>
      <span className="ov-chips">
        {wk && <span className={`chip wk-chip ${wk.cls}`}><WkIcon size={10} /> {wk.label}</span>}
        <span className={`chip ct-${item.type}`}>{typeInfo(item.type).label}</span>
        {item.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
        {status && !done && <StageDot status={status} />}
      </span>
    </button>
  )
}

/* One Pravki (revision) card in the crew's "changes to make" lane: the task,
   who sent it, the change note, the reference, the relevant delivery link and
   the fix deadline. One "Fixed" action drops the updated link and returns the
   task to Ready for the SMM. Module-level so poll ticks don't remount it. */
function PravkiCard({ rev, byKey, today, onOpen, onFixed }) {
  const relCol = rev.target === 'operator' ? 'shot_link' : rev.target === 'designer' ? 'design_link' : 'ready_link'
  // What the round sent back, as it recorded it when it opened.
  const was = rev.sent_link != null ? rev.sent_link : (rev[relCol] || '')
  // Deliberately EMPTY, not pre-filled with the file that was sent back.
  // Pre-filling it made "Fixed" one press away from re-delivering the same
  // cut — which is how a whole revision round used to evaporate.
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  // The task's other rounds — everything asked before this one.
  const prior = (rev.history || []).filter((h) => h.round !== rev.round)
  const deadline = rev.target === 'operator' ? rev.recording_date
    : rev.target === 'designer' ? (rev.design_ready_date || reviewDue(rev))
      : (editDue(rev) || reviewDue(rev))
  const fix = async () => { setBusy(true); try { await onFixed(rev, link.trim()) } finally { setBusy(false) } }
  return (
    <div className="pravki-card">
      <button className="pravki-open" onClick={() => onOpen(rev.content_id)}>
        <div className="pravki-top">
          <b className="pravki-title">{rev.title}</b>
          <span className="pravki-round">Pravki #{rev.round}</span>
        </div>
        <div className="pravki-meta">
          {rev.channels.map((c) => byKey[c]?.label || c).join(' · ')} · from {rev.requested_name || 'SMM'}
          {deadline && <> · <b className={deadline < today ? 'pravki-late' : ''}>due {dateLabel(deadline)}</b></>}
        </div>
        <div className="pravki-note">{rev.note}</div>
        {(rev.reference_text || (rev.reference_links || []).length > 0) && (
          <div className="pravki-ref">
            {rev.reference_text && <span className="pravki-ref-text">{rev.reference_text}</span>}
            {(rev.reference_links || []).map((u, i) => (/^https?:\/\//i.test(u)
              ? <a key={i} className="pravki-ref-link" href={u} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink size={10} /> ref {i + 1}</a>
              : null))}
          </div>
        )}
      </button>
      {/* The fixer's context, right on the card: the brief (ТЗ) the piece was
          made to, and the rounds that came before this one — no digging. */}
      {(rev.format || rev.rubrika || rev.script) && (
        <div className="pravki-brief">
          {rev.format && <span className="chip chip-muted">{rev.format}</span>}
          {rev.rubrika && <span className="chip chip-muted">#{rev.rubrika}</span>}
          {rev.script && (
            <details className="pravki-extra">
              <summary>{tx("The script / ТЗ")}</summary>
              <div className="crew-script">{rev.script}</div>
            </details>
          )}
        </div>
      )}
      {prior.length > 0 && (
        <details className="pravki-extra">
          <summary>Earlier rounds · {prior.length}</summary>
          <div className="pravki-prior">
            {prior.map((h) => (
              <div key={h.round} className="pravki-prior-row">
                <b>#{h.round}</b>{h.note}
                <span className="done-txt"> — {h.requested_name || 'SMM'}{h.resolved_at ? ' · fixed' : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="pravki-fix">
        <input className="input" placeholder={tx("Link to the NEW file…")} value={link} onChange={(e) => setLink(e.target.value)} />
        {deliveryHref(was) && (
          <a className="btn btn-sm" href={deliveryHref(was)} target="_blank" rel="noreferrer"
            data-tip={tx("Open the file that was sent back")} aria-label={tx("Open the file that was sent back")}><ExternalLink size={14} /></a>
        )}
        <button className="btn btn-sm btn-primary" disabled={busy || !link.trim() || link.trim() === was}
          data-tip={link.trim() && link.trim() === was ? 'That is the file that was sent back' : 'Deliver the fix'}
          onClick={fix}><Check size={14} />{' '}{tx("Fixed")}</button>
      </div>
      {link.trim() && link.trim() === was && (
        <div className="pravki-same">{tx("That is the same file that was sent back — upload the new one.")}</div>
      )}
    </div>
  )
}

// `calendar` is the maker's Calendar screen (/brief/calendar): the same page,
// the same data and the same task window as My Day, drawn as a month. One
// component for both addresses, so going from one to the other loads nothing.
export default function Brief({ calendar = false }) {
  const { user } = useAuth()
  const { byKey, channels: chanList } = useChannels()
  const { t } = useT()
  const isCrew = ['editor', 'operator', 'designer', 'crew'].includes(user.role)
  // The new look (lib/look.js) — the Coach look: a "Start here" card, a list
  // in the order to do it, and a task window that slides in from the side.
  const simple = useSimpleLook(user)
  // How the task window was asked to open: on which of a person's two jobs
  // (`prefer`), and with what already under the cursor (`focus`).
  const [openWith, setOpenWith] = useState({})
  // On a phone the answer tray shows the next two and folds the rest: twelve
  // bookings waiting on an answer were two full screens to scroll before the
  // day itself appeared. The desk has the room and keeps the whole list.
  const [asksOpen, setAsksOpen] = useState(false)
  const [dayOpen, setDayOpen] = useState(null) // a day of the crew calendar, opened whole
  const [moving, setMoving] = useState(null)   // r11: a piece dropped on another day: { t, kind, to, why }
  // The crew flips between the day list and their own month calendar.
  const [myView, setMyViewState] = useState(() => localStorage.getItem('satashkent_myday_view') || 'list')
  const setMyView = (v) => { setMyViewState(v); localStorage.setItem('satashkent_myday_view', v) }
  // The pay card's home is the Payment page, which opens on it. My Day draws
  // it only for an account that has no Payment page to open — switched off in
  // Settings, or aimed at another kind of account — so nobody is left without
  // a place to read what the month is worth.
  const payHere = !usePages().shows('docs')
  const [boot] = useState(() => cache.get(`brief:${user.id}`))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  // What each piece needs next, and from whom (the simple look's one button).
  const step = useNextStep(user, statuses, byKey)
  const [personal, setPersonal] = useState(boot?.personal || [])
  const [pravki, setPravki] = useState(boot?.pravki || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null)

  // A task link (…/brief?task=123) opens that task. The bell, Telegram and a
  // pasted link all land here now that the To-Do page is gone — and unlike
  // that page, a task that is not in MY list is fetched rather than refused,
  // because "somebody sent you this task" and "this task is yours" are
  // different things and the link should work either way.
  const location = useLocation()
  // Keyed on the NAVIGATION, not on the URL. It used to remember the last
  // `?task=` it had opened and refuse to open that one again — which is
  // exactly what the bell and the Overview hand-ups ask it to do: you open a
  // task from a notification, close it, press the same notification again,
  // and the address it navigates to is the one already in the bar. Nothing
  // changed, so nothing happened, and the task simply would not open any
  // more. `location.key` is a fresh value for every navigation even when the
  // URL is identical, so pressing the same link twice works the way pressing
  // a link is supposed to.
  const linkOpened = useRef('')
  useEffect(() => {
    if (loading) return
    const id = Number(new URLSearchParams(location.search).get('task'))
    if (!id || linkOpened.current === location.key) return
    linkOpened.current = location.key
    // Always from the server, never from the copy this browser happens to
    // hold: My Day boots from a cache so the page paints instantly, and a link
    // opened against that cache showed the task as it was last time — dates
    // somebody has since filled in still missing, a stage it has since left.
    const mine = content.find((x) => x.id === id)
    api.get(`/content/${id}`)
      .then((t) => setOpenItem(t))
      .catch(() => {
        if (mine) { setOpenItem(mine); return }
        toast(tx('That task isn’t on your channels — ask an admin to show it to you'), 'err')
      })
  }, [loading, content, location.key, location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([api.get('/content'), api.cached('/statuses'), api.get('/personal'), api.get('/content/revisions/mine')])
      .then(([ct, st, ps, pv]) => {
        setContent(ct); setStatuses(st); setPersonal(ps); setPravki(pv)
        cache.set(`brief:${user.id}`, {
          content: ct.map(({ photo_thumb: _t, ...rest }) => rest), statuses: st, personal: ps, pravki: pv,
        })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [user.id])

  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      // All three ride ETags: unchanged data is a 304 and the page doesn't
      // re-render at all — the every-10s tick costs nothing when it's quiet.
      api.poll('/content').then((f) => { if (f) setContent(f) }).catch(() => {})
      api.poll('/personal').then((f) => { if (f) setPersonal(f) }).catch(() => {})
      api.pollView('/content/revisions/mine').then((f) => { if (f) setPravki(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  // Today rolls over at midnight in Tashkent even on a page nobody touches.
  // The poll above re-renders only when the data changed, so a page left open
  // overnight went on drawing yesterday as "Your timeline today". Checked once
  // a minute; the page re-renders only when the day actually turns.
  const [today, setToday] = useState(todayISO)
  useEffect(() => {
    const id = setInterval(() => setToday((was) => { const now = todayISO(); return now === was ? was : now }), 60000)
    return () => clearInterval(id)
  }, [])

  // "Mine" = anything where I hold a role: any of the assignees, the
  // operator, the editor, or the designer.
  const mine = useMemo(
    () => content.filter((t) => (t.assignees?.length ? t.assignees.includes(user.id) : t.assignee_id === user.id) ||
      t.operator_id === user.id || t.editor_id === user.id || t.designer_id === user.id),
    [content, user.id])

  // Open = not done and not killed: a Deleted task has no upcoming work for
  // anyone, so it leaves the day lists and the crew calendar entirely.
  const open = useMemo(
    () => mine.filter((t) => !t.done_at && !isDeletedLabel(statusesById[t.status_id]?.label)),
    [mine, statusesById])
  // Everybody's open pieces, for the crew calendar's "Whole channel".
  const live = useMemo(
    () => content.filter((t) => !t.done_at && !isDeletedLabel(statusesById[t.status_id]?.label)),
    [content, statusesById])

  // ---- times somebody has booked and is waiting on you for ----
  // A booking answered late is a booking answered on the day, which is the
  // thing it was meant to replace. It waits at the top of the day, above the
  // work, because it is not work — it is one tap that lets somebody else
  // finish planning.
  const toAnswer = useMemo(() => {
    // Only days still ahead. "Can you make Tuesday?" is not a question about a
    // Tuesday three weeks gone — that day either happened or it did not, and
    // asking about it for ever teaches people to scroll past the tray.
    const out = []
    for (const t of open) {
      if (t.operator_id === user.id && t.recording_date >= today && !t.shoot_ack) out.push({ t, which: 'shoot' })
      // edit_ready_date: that is what the server books (BOOKINGS in content.js).
      if (t.editor_id === user.id && t.edit_ready_date && editDue(t) >= today && !t.edit_ack) out.push({ t, which: 'edit' })
    }
    const askDay = (e) => (e.which === 'shoot' ? e.t.recording_date : editDue(e.t)) || ''
    return out.sort((a, b) => askDay(a).localeCompare(askDay(b)))
  }, [open, user.id, today])

  // The task's live deadline: the release or an un-met edit-ready date —
  // whichever comes first. The shoot day only counts when it's the only date
  // (a past shoot with a future release is on schedule, not overdue).
  // Every clock still ticks — but the crew never SEES a release date. When a
  // cut has no edit-ready date of its own, the release day acts as the
  // implicit deadline and is presented as plain edit work ("due <date>").
  const deadlineOf = (t) =>
    [reviewDue(t), !t.ready_at ? editDue(t) : null, !t.ready_at ? t.design_ready_date : null]
      .filter(Boolean).sort()[0] || t.recording_date
  const overdue = useMemo(
    () => open.filter((t) => {
      const dd = deadlineOf(t)
      return dd && dd < today
    }).sort((a, b) => deadlineOf(a).localeCompare(deadlineOf(b))),
    [open, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const personalToday = useMemo(
    () => personal.filter((p) => !p.done_at && (p.pinned || !p.due_date || p.due_date <= today)),
    [personal, today])
  // The reviewer's queue: Ready work on your channels waits for your call —
  // publish it with one tap, or open it to send Pravki. The other half of
  // the crew's Pravki lane.
  const reviewQueue = useMemo(() => {
    if (isCrew || !(user.role === 'admin' || can(user, 'review_publish'))) return []
    const ready = new Set(statuses.filter((s) => /^ready$/i.test(s.label)).map((s) => s.id))
    return content
      .filter((t) => !t.done_at && ready.has(t.status_id) &&
        (adminOn(user, t.channels) || t.channels.some((c) => (user.departments || []).includes(c))))
      // The run-sheet order: release day, then the slot time — the way the
      // SMM actually works down the list.
      .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999') ||
        (a.release_time || '99').localeCompare(b.release_time || '99'))
  }, [content, statuses, user, isCrew])


  // The nearest upcoming date of a task — shoot, edit-ready or release.
  const nextOf = (t) => {
    const ds = [t.recording_date, editDue(t), t.design_ready_date, reviewDue(t)].filter((d) => d && d > today)
    return ds.sort()[0] || null
  }

  // Everything due today, whatever the clock — the simple view's main list.
  const dueToday = useMemo(
    // …artwork included, until it is handed in: a design due today fell
    // through to `nextOf`, which only looks past today, and was listed under
    // "coming up" on the day it was owed.
    () => open.filter((t) => t.recording_date === today || reviewDue(t) === today || editDue(t) === today
      || (!t.ready_at && t.design_ready_date === today))
      .sort((a, b) => (a.recording_time || a.release_time || '99').localeCompare(b.recording_time || b.release_time || '99')),
    [open, today])

  // THE DAY, FLAT. It used to be five headed sections — missing, to do
  // today, also on your list, coming up, done — each with its own count, plus
  // a panel for reordering and hiding them and a date-range picker inside the
  // last one. That is a filing system on top of a to-do list: to find what to
  // start on you read five headings and decided which one you believed.
  //
  // One list now, sorted the way the day is worked. A personal task carries
  // its own date and sorts in beside the rest of the work rather than living
  // in a section of its own; the line that adds one is still at the bottom,
  // because a list nobody can put anything on stops being a list.
  const priority = useMemo(() => {
    const rows = []
    const seen = new Set()
    for (const t of overdue) { rows.push({ k: `c${t.id}`, tier: 'late', when: deadlineOf(t), t }); seen.add(t.id) }
    for (const t of dueToday) { if (!seen.has(t.id)) { rows.push({ k: `c${t.id}`, tier: 'today', when: today, t }); seen.add(t.id) } }
    for (const t of open) {
      if (seen.has(t.id)) continue
      const d = nextOf(t)
      if (d) { rows.push({ k: `c${t.id}`, tier: 'soon', when: d, t }); seen.add(t.id) }
    }
    for (const pt of personal) {
      if (pt.done_at) continue
      const d = pt.due_date || null
      const tier = d ? (d < today ? 'late' : d === today ? 'today' : 'soon') : 'today'
      rows.push({ k: `p${pt.id}`, tier, when: d || today, p: pt })
    }
    const RANK = { late: 0, today: 1, soon: 2 }
    return rows.sort((a, b) => RANK[a.tier] - RANK[b.tier] ||
      String(a.when).localeCompare(String(b.when)) ||
      String(a.t?.title || a.p?.title || '').localeCompare(String(b.t?.title || b.p?.title || '')))
  }, [overdue, dueToday, open, personal, today]) // eslint-disable-line react-hooks/exhaustive-deps

  // What they have done — the finished work, freshest first.
  const doneRows = useMemo(
    () => mine.filter((t) => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 10),
    [mine])

  // Your own list, added to from your own page. The To-Do page carried the
  // only way to write one of these down, and when that page went the section
  // below it could still be read and ticked off but never added to — a list
  // nobody can put anything on stops being a list.
  const [pDraft, setPDraft] = useState('')
  const [pBusy, setPBusy] = useState(false)
  const addPersonal = async () => {
    const title = pDraft.trim()
    if (!title || pBusy) return
    setPBusy(true)
    try {
      const p = await api.post('/personal', { title })
      setPersonal((prev) => [p, ...prev])
      setPDraft('')
      toast(tx('Added — synced'))
    } catch (e) { alert(e.message) } finally { setPBusy(false) }
  }

  const togglePersonal = async (p) => {
    try {
      if (!p.done_at) playDone()
      const u = await api.patch(`/personal/${p.id}`, { done: !p.done_at })
      setPersonal((prev) => prev.map((x) => (x.id === p.id ? u : x)))
    } catch (e) { alert(e.message) }
  }
  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    rewardIfFinished(item, u)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }
  // "Fixed": deliver the updated link and send the task back to Ready.
  const markFixed = async (rev, link) => {
    try {
      const r = await api.post(`/content/revisions/${rev.id}/resolve`, link ? { link } : {})
      if (r.task) setContent((prev) => prev.map((x) => (x.id === r.task.id ? r.task : x)))
      setPravki((prev) => prev.filter((x) => x.id !== rev.id))
      toast(tx('Fixed — back to the SMM'))
    } catch (e) { alert(e.message) }
  }
  // A row that names a task must open it. This looked in the loaded list and,
  // finding nothing, did nothing at all — no modal, no message — which is how
  // a late task on a channel that is not in your own board, or one the poll
  // has not caught up with, became a row that could be clicked for ever with
  // no result. Same rule as a pasted link: fetch it, and say so if it really
  // is out of reach.
  const openByContentId = (cid) => {
    const t = content.find((x) => x.id === cid)
    if (t) { setOpenItem(t); return }
    api.get(`/content/${cid}`)
      .then(setOpenItem)
      .catch(() => toast(tx('That task isn’t on your channels — ask an admin to show it to you'), 'err'))
  }

  // ==== the Coach look's reading of the day ====================================
  // Which task is first, which band or group a piece is in and whose step it
  // is are read in lib/coach.js (qa/coach-suite.mjs pins the reading); the
  // page gathers what that reading needs and hands the result to the screens
  // and to the task window, so the list and the window can never disagree.
  const [team, setTeam] = useState([])
  useEffect(() => { api.cached('/users').then((u) => setTeam(Array.isArray(u) ? u : [])).catch(() => {}) }, [])
  const openTask = (t, opts = {}) => { setOpenWith(opts); setOpenItem(t) }
  // `next`: the task the window leaves for — a copy just made of it.
  const closeTask = (next) => { setOpenWith({}); setOpenItem(next?.id ? next : null) }
  // A press in the window or on a card landed: the list takes the row the
  // server sent back, and the changes waiting on this person are read again —
  // the poll that would do it is paused while a task is open.
  const changed = (u) => {
    if (u?.id) setContent((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...u } : x)))
    api.get('/content/revisions/mine').then((f) => { if (Array.isArray(f)) setPravki(f) }).catch(() => {})
  }

  const crewModel = useMemo(() => {
    if (!isCrew || !simple) return null
    // With the board's stages, so a job on a piece its maker is still planning
    // is read as not given yet (ideaEndOf in lib/coach.js).
    const entries = crewEntries(content, user.id, statusesById, step.pipe)
    return { entries, ...crewDay({ entries, today, asks: toAnswer, fixes: pravki }) }
  }, [isCrew, simple, content, user.id, statusesById, today, toAnswer, pravki, step.pipe])

  // A maker's pieces: what they run, what they hold a job on, and what is
  // waiting on their publish — the same three the list has always gathered.
  const makerPieces = useMemo(() => {
    if (isCrew) return []
    const queued = new Set(reviewQueue.map((t) => t.id))
    const own = new Set(mine.map((t) => t.id))
    return content.filter((t) => own.has(t.id) || queued.has(t.id))
  }, [isCrew, content, mine, reviewQueue])
  // How many pravka rounds a delivered piece has had. The third delivery is
  // approved as it stands (PRAVKA_ROUNDS), so past the limit there is nothing
  // to "check" — but the list's rows do not carry the count. It is asked for
  // the few pieces it decides: delivered, at Ready, not accepted. Once per
  // delivery — a new file asks again.
  const [rounds, setRounds] = useState({})   // { [id]: { link, n } }
  const roundsAsked = useRef(new Set())
  useEffect(() => {
    if (isCrew || !simple || step.pipe.review < 0) return
    for (const t of makerPieces) {
      const link = t.ready_link || t.design_link
      const at = step.pipe.live.findIndex((s) => s.id === t.status_id)
      if (!link || t.approved_at || t.done_at || at < step.pipe.review) continue
      const key = `${t.id}:${link}`
      if (roundsAsked.current.has(key)) continue
      roundsAsked.current.add(key)
      api.get(`/content/${t.id}/revisions`)
        .then((rs) => setRounds((old) => ({ ...old, [t.id]: { link, n: Array.isArray(rs) ? rs.length : 0 } })))
        .catch(() => roundsAsked.current.delete(key))
    }
  }, [isCrew, simple, makerPieces, step.pipe])
  const roundsOf = (t) => (rounds[t.id]?.link === (t.ready_link || t.design_link) ? rounds[t.id].n : 0)
  const makerModel = useMemo(() => (isCrew || !simple ? null : makerDay({
    pieces: makerPieces, today, userId: user.id, pipe: step.pipe, stepOf: step.stepOf, roundsOf, maxRounds: PRAVKA_ROUNDS,
    canReviewOf: (t) => step.reviewsOn(t).accept,
  })), [isCrew, simple, makerPieces, today, user.id, step.pipe, step.stepOf, step.reviewsOn, rounds]) // eslint-disable-line react-hooks/exhaustive-deps
  // What "Next: …" in the window opens once a step is done: the next thing
  // this person can act on that is not the task already open.
  const nextUp = !openItem?.id ? null
    : crewModel ? crewModel.rows.find((r) => r.n && r.t.id !== openItem.id)
      : makerModel ? makerModel.rows.find((r) => r.actionable && r.t.id !== openItem.id) : null
  // Every task opens in the one task window (ContentModal's door → CoachTask),
  // whose Edit button is the whole form.
  const taskWindow = openItem?.id ? (
    <ContentModal key={openItem.id} item={openItem} statuses={statuses} onUpdate={updateContent} onDelete={deleteContent}
      prefer={openWith.prefer || null} focus={openWith.focus || null}
      next={nextUp?.t || null} onNext={() => openTask(nextUp.t, { prefer: nextUp.kind })}
      onClose={closeTask} onChanged={changed} />
  ) : null

  // Right-click on any row: the quick verbs without opening the task.
  const { openMenu } = useContextMenu()
  const rowMenu = (e, item) => openMenu(e, [
    { label: 'Open', icon: PenLine, onClick: () => setOpenItem(item) },
    // The server's own two rules (content.js): done is the owner's or
    // move_tasks'; deleting is manage_content's.
    (can(user, 'move_tasks') || (item.assignees?.length ? item.assignees.includes(user.id) : item.assignee_id === user.id))
      && { label: item.done_at ? 'Mark as not done' : 'Mark as done', icon: Check, onClick: () => markDone(item, updateContent, setOpenItem) },
    can(user, 'manage_content') && { sep: true },
    can(user, 'manage_content') && { label: 'Delete', icon: Trash2, danger: true, onClick: () => { if (confirm(`Delete “${item.title}”?`)) deleteContent(item).catch((err) => alert(err.message)) } },
  ])

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  const niceDate = longDayLabel(today)
  const firstName = user.name.split(' ')[0]


  const publishNow = (t) => {
    const fin = statuses.find((s) => s.is_final)
    if (!fin) return
    playDone()
    return moveTo(t, updateContent, fin.id, setOpenItem, tx('Published — synced'))
  }

  const reviewBlock = reviewQueue.length > 0 && (
    <>
      <div className="section-head">
        <Send size={17} style={{ color: '#2a78d6' }} />
        <h2 style={{ color: '#2a78d6' }}>{tx("Waiting for your review")}</h2>
        <span className="count">· {reviewQueue.length}</span>
      </div>
      <div className="card card-pad brief-list">
        {reviewQueue.slice(0, 12).map((t) => (
          <div key={t.id} className="ov-row rq-row" role="button" tabIndex={0}
            onClick={() => setOpenItem(t)}
            onKeyDown={(e) => { if (e.key === 'Enter') setOpenItem(t) }}>
            <span className="brief-when">
              {t.release_date
                ? <span className="brief-when-sub">{dateLabel(t.release_date)}{t.release_time ? ` · ${t.release_time.slice(0, 5)}` : ''}</span>
                : <span className="brief-anytime">{tx("no date")}</span>}
            </span>
            <span className="brief-main"><span className="ov-title">{t.title}</span></span>
            <span className="ov-chips">
              <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
              {t.channels.map((c) => <span key={c} className="chip chip-muted">{byKey[c]?.label || c}</span>)}
              {(t.ready_link || t.design_link) && (
                <>
                  {deliveryHref(t.ready_link || t.design_link) && (
                    <a className="btn btn-sm rq-open" href={deliveryHref(t.ready_link || t.design_link)}
                      target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                      data-tip={tx("Watch the finished file before releasing it")}>
                      <ExternalLink size={13} /> {t.ready_link ? 'The edit' : 'Design'}
                      {splitDelivery(t.ready_link || t.design_link).note
                        ? ` · ${splitDelivery(t.ready_link || t.design_link).note}` : ''}
                    </a>
                  )}
                  <button className="icon-btn rq-copy"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigator.clipboard?.writeText(t.ready_link || t.design_link)
                        .then(() => toast(tx('Delivery link copied — paste it into the platform')))
                        .catch(() => {})
                    }}
                    data-tip={tx("Copy the finished file's link")} aria-label={tx("Copy delivery link")}>
                    <Link2 size={14} />
                  </button>
                </>
              )}
              <button className="btn btn-sm btn-primary rq-pub"
                onClick={(e) => { e.stopPropagation(); publishNow(t) }}
                data-tip={tx("Release it — Ready → Published")}>
                <Send size={13} /> Publish
              </button>
            </span>
          </div>
        ))}
        {reviewQueue.length > 12 && <div className="tt-none" style={{ padding: '4px 0 0' }}>+{reviewQueue.length - 12} more on the boards</div>}
      </div>
    </>
  )

  const pravkiBlock = pravki.length > 0 && (
    <>
      <div className="section-head">
        <RotateCcw size={17} style={{ color: 'var(--critical)' }} />
        <h2 style={{ color: 'var(--critical)' }}>{tx("Pravki — changes to make")}</h2>
        <span className="count">· {pravki.length}</span>
      </div>
      <div className="pravki-lane">
        {pravki.map((r) => (
          <PravkiCard key={r.id} rev={r} byKey={byKey} today={today} onOpen={openByContentId} onFixed={markFixed} />
        ))}
      </div>
    </>
  )

  const priorityBlock = (
    <>
      <div className="section-head">
        <ListTodo size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx('Your day')}</h2>
        <span className="count">· {priority.length}</span>
      </div>
      <div className="card card-pad brief-list day-flat">
        {priority.length === 0 && <div className="empty faint">{tx('No tasks')}</div>}
        {priority.map((r) => (r.p ? (
          <div key={r.k} className="ov-row" style={{ cursor: 'default' }}>
            <i className={`dot dot-${r.tier}`} aria-label={TIER_WORD[r.tier]()} data-tip={TIER_WORD[r.tier]()} />
            <button className="todo-check" onClick={() => togglePersonal(r.p)} data-tip={tx('Mark as done')} aria-label={tx('Complete')}>
              {r.p.done_at && <Check size={15} strokeWidth={3.5} />}
            </button>
            <span className="ov-title">{r.p.title}</span>
            <span className="ov-chips">
              {r.p.due_date && <span className="chip chip-muted">{dateLabel(r.p.due_date)}</span>}
            </span>
          </div>
        ) : (
          <BriefRow key={r.k} item={r.t} tier={r.tier}
            when={r.tier === 'today' ? null : dateLabel(r.when)} late={r.tier === 'late'}
            work={workOnDate(r.t, r.when)}
            time={((r.t.recording_date === r.when && r.t.recording_time) || (r.t.release_date === r.when && r.t.release_time) || '').slice(0, 5) || null}
            byKey={byKey} statusesById={statusesById} onOpen={setOpenItem} onMenu={rowMenu} />
        )))}
        {/* The one thing that was worth keeping out of "Also on your list". */}
        <form className="pers-add" onSubmit={(e) => { e.preventDefault(); addPersonal() }}>
          <input className="input" value={pDraft} onChange={(e) => setPDraft(e.target.value)}
            placeholder={tx('Something of your own — Enter adds it')} />
          <button className="btn btn-sm btn-primary" type="submit" disabled={!pDraft.trim() || pBusy}>
            <Plus size={14} />{' '}{tx('Add')}
          </button>
        </form>
      </div>
    </>
  )

  const personalBlock = (
    <>
      <div className="section-head">
        <CheckCircle2 size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx('Your own list')}</h2>
        <span className="count">· {personalToday.length}</span>
      </div>
      <div className="card card-pad brief-list">
        <form className="pers-add" onSubmit={(e) => { e.preventDefault(); addPersonal() }}>
          <input className="input" value={pDraft} onChange={(e) => setPDraft(e.target.value)}
            placeholder={tx('Something of your own — Enter adds it')} />
          <button className="btn btn-sm btn-primary" type="submit" disabled={!pDraft.trim() || pBusy}>
            <Plus size={14} />{' '}{tx('Add')}
          </button>
        </form>
        {personalToday.map((p) => (
          <div key={p.id} className="ov-row" style={{ cursor: 'default' }}>
            <button className="todo-check" onClick={() => togglePersonal(p)} data-tip={tx("Mark as done")} aria-label={tx("Complete")}>
              {p.done_at && <Check size={15} strokeWidth={3.5} />}
            </button>
            <span className="ov-title">{p.title}</span>
            <span className="ov-chips">
              {p.due_date && <span className="chip chip-muted" data-late={p.due_date < today ? '1' : undefined}>{dateLabel(p.due_date)}</span>}
            </span>
          </div>
        ))}
      </div>
    </>
  )

  // Nothing finished yet → no headline about it; the section earns its place.
  const doneBlock = doneRows.length > 0 && (
    <>
      <div className="section-head">
        <CheckCircle2 size={17} style={{ color: 'var(--good-ink, #0ca30c)' }} />
        <h2>{tx("What you’ve done")}</h2>
        <span className="count">· last {doneRows.length}</span>
      </div>
      {doneRows.length > 0 && (
        <div className="card card-pad brief-list">
          {doneRows.map((t) => (
            <BriefRow key={t.id} item={t} done
              when={dateLabel(tashkentDay(t.done_at))} time={null}
              byKey={byKey} statusesById={statusesById} onOpen={setOpenItem} onMenu={rowMenu} />
          ))}
        </div>
      )}
    </>
  )

  // ============ the simple view: admin & members ============
  if (!isCrew) {
    // A personal task counts. `dueToday` and `overdue` are content only, so a
    // day holding three things somebody wrote down for themselves reported
    // "all clear" with those three listed directly underneath it — a headline
    // arguing with the list it sits on top of.
    // Counted off the list itself, so the headline and the rows under it can
    // never disagree — which they did: `dueToday` and `overdue` are content
    // only, so a day holding three things somebody had written down for
    // themselves announced "all clear" directly above all three of them.
    const lateN = priority.filter((r) => r.tier === 'late').length
    const todayN = priority.filter((r) => r.tier === 'today').length
    const nothingToday = lateN === 0 && todayN === 0
    // A day with nothing on it is not news, and saying so is a line somebody
    // reads once and then reads past for ever. What is worth a headline on a
    // clear day is the thing that is coming — so the line names the next piece
    // of work and the day it lands, which is the question the empty page was
    // making people go and look up. Missed work still wins the headline
    // outright: nothing that is already late is ever displaced by what is next.
    const nextUp = nothingToday ? priority.find((r) => r.tier === 'soon') : null
    const nextTitle = nextUp?.t?.title || nextUp?.p?.title || ''
    // The Coach look (lib/look.js, lib/coach.js): My Day as five groups in
    // priority and a week, the Calendar beside it, and everything that is not
    // the day's work under More.
    if (simple) {
      // The person's own notes are not pieces, so they are in none of the five
      // groups: they keep their place under More, where the line that adds
      // one already was, and can be ticked off there.
      const notes = personal.filter((p) => !p.done_at)
      return (
        <>
          {/* My Day and the Calendar are two rows of the sidebar now (round 8), not tabs above the page. */}
          {/* One calendar (the owner, 13 Oct): a maker's /brief/calendar is the Calendar in the menu. */}
          {calendar ? (
            <Navigate to="/calendar" replace />
          ) : user.role === 'admin' ? (
            // An admin's day is the team's: deadlines first, then who is where.
            <CoachAdminDay user={user} team={team} byKey={byKey} today={today}
              onOpen={async (id) => {
                try { openTask(content.find((x) => x.id === id) || await api.get(`/content/${id}`)) } catch (e) { toast(e.message, 'err') }
              }} />
          ) : (
            <CoachMakerDay model={makerModel} pieces={makerPieces} user={user} today={today} byKey={byKey} pipe={step.pipe} team={team}
              roundsOf={roundsOf} reviewsOn={step.reviewsOn} making={step.makingFor}
              onOpen={openTask} onChanged={changed}
              onNew={can(user, 'manage_content') ? () => setOpenItem('new') : null}
              more={(
                <>
                  <Streak />
                  <MyGrade />
                  {doneBlock}
                  <details className="sd-fold" open={notes.length > 0}>
                    <summary><ListTodo size={15} /> {tx('Your own list')} <span className="count">· {notes.length}</span></summary>
                    {notes.map((p) => (
                      <div key={p.id} className="ov-row" style={{ cursor: 'default' }}>
                        <button className="todo-check" onClick={() => togglePersonal(p)} data-tip={tx('Mark as done')} aria-label={tx('Complete')} />
                        <span className="ov-title">{p.title}</span>
                        <span className="ov-chips">
                          {p.due_date && <span className="chip chip-muted" data-late={p.due_date < today ? '1' : undefined}>{dateLabel(p.due_date)}</span>}
                        </span>
                      </div>
                    ))}
                    <form className="pers-add" onSubmit={(e) => { e.preventDefault(); addPersonal() }}>
                      <input className="input" value={pDraft} onChange={(e) => setPDraft(e.target.value)}
                        placeholder={tx('Something of your own — Enter adds it')} />
                      <button className="btn btn-sm" type="submit" disabled={!pDraft.trim() || pBusy}>
                        <Plus size={14} />{' '}{tx('Add')}
                      </button>
                    </form>
                  </details>
                </>
              )} />
          )}
          {taskWindow}
        </>
      )
    }
    return (
      <>
        <div className="card card-pad brief-hero">
          <div className="brief-hello"><Sun size={18} /> {niceDate}</div>
          <h2 className="brief-title">
            {nothingToday && nextUp ? (
              <>{tx('{name}, next:', { name: firstName })}{' '}
                <span className="brief-next">{nextTitle}</span>
                {nextUp.when ? <span className="brief-next-when">{dateLabel(nextUp.when)}</span> : null}
              </>
            ) : (
              <>{tx('{name}, today:', { name: firstName })}{' '}
                {nothingToday ? tx('all clear') : (
                  [
                    lateN > 0 && tx('{n} missing', { n: lateN }),
                    todayN > 0 && tx('{n} to do', { n: todayN }),
                  ].filter(Boolean).join(' · ')
                )}
              </>
            )}
          </h2>
        </div>

        {/* What they have DONE, before what they owe. Every other line on
            this page is a deadline or a miss; this is the only one that says
            somebody has been getting on with it. */}
        <Streak />

        {/* What the month is worth so far. Silent until an admin has set
            rates — a card reading "0" says something about the person that
            it does not mean. */}
        {payHere && <MyPay />}
        <MyGrade />

        {/* Two things that are work but carry no day of their own, so they
            cannot sort into the list below: changes somebody has sent back to
            you, and work waiting on your sign-off. */}
        {pravkiBlock}
        {reviewBlock}

        {priorityBlock}
        {doneBlock}
        <button type="button" className="sd-classic" onClick={() => setSimple(user, true)}>{tx('Try the new, simpler look')}</button>

        {openItem && (
          <ContentModal key={openItem?.id || 'new'} item={openItem === 'new' ? null : openItem} statuses={statuses} onClose={(next) => setOpenItem(next?.id ? next : null)}
            onCreate={async (payload) => { const c = await api.post('/content', payload); setContent((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev])); return c }}
            onUpdate={updateContent} onDelete={deleteContent} />
        )}
      </>
    )
  }

  // ============ the crew view: the videographer's day ============
  // No release dates anywhere here: the crew cares about the shoot day and
  // the edit/design deadline, nothing else. Published work is DONE work.
  //
  // One headline, the changes somebody sent back, and one list of the work in
  // the order it is due — see CrewDay for why it stopped being a late banner,
  // a headline and a two-lane board each counting the same late work.
  const modal = taskWindow
  // The crew's own month: their shoots, cuts and artwork on the days they owe
  // them. Under More in the Coach look, behind the list's switch in the
  // previous one.
  const crewCalendar = (
    <div className="cd-cal">
      {/* Only the pieces whose shoot or edit (or artwork) is theirs — the crew's
          feedback: one with neither is not on their calendar, so not on its day either. */}
      {dayOpen && <DayAgenda date={dayOpen} items={content.filter((t) => [t.operator_id, t.editor_id, t.designer_id].includes(user.id))} statusesById={statusesById} canEdit={false} onOpen={(t) => { setDayOpen(null); setOpenItem(t) }} onBack={() => setDayOpen(null)} />}
      <CrewCalendar tasks={open} all={live} team={team} channels={chanList || []} userId={user.id} today={today} byKey={byKey} onOpen={setOpenItem} statusesById={statusesById} onDay={setDayOpen}
        onMove={simple ? (t, kind, to) => setMoving({ t, kind, to, why: '' }) : null} />
    </div>
  )
  // The Coach look (lib/look.js, lib/coach.js): the summary bar, "Start here"
  // and the numbered list — with the bookings waiting on an answer and the
  // changes sent back as rows of that one list rather than blocks above it.
  // r11: a piece dropped on another day — the person's own day, so it moves at
  // once; the server still asks one line of why, as it does in the task window.
  const DAY_FIELD = { shoot: 'recording_date', edit: 'edit_ready_date', design: 'design_ready_date' }
  const moveDay = async () => {
    if (!moving || !isSentence(moving.why)) return
    try {
      const out = await api.post(`/content/${moving.t.id}/date-requests`, { field: DAY_FIELD[moving.kind], to_date: moving.to, reason: moving.why.trim() })
      if (out?.task) { changed(out.task); toast(tx('Day moved — the others on it are told')) } else toast(tx('Asked — an admin will answer, and you will hear it'))
      setMoving(null)
    } catch (e) { toast(e.message, 'err') }
  }
  const movingBox = moving && (
    <Modal title={tx('Move it to {day}?', { day: longDayLabel(moving.to) })} onClose={() => setMoving(null)}
      footer={<>
        <button className="btn" onClick={() => setMoving(null)}>{tx('Cancel')}</button>
        <button className="btn btn-primary" disabled={!isSentence(moving.why)} onClick={moveDay}>{tx('Move it')}</button>
      </>}>
      <p className="stat-sub" style={{ marginTop: 0 }}><b>{moving.t.title}</b></p>
      <input className="input" autoFocus value={moving.why} placeholder={tx('Why, in one line — e.g. “the footage came in late”')}
        aria-label={tx('Why the day moves')} onChange={(e) => setMoving({ ...moving, why: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') moveDay() }} />
      <p className="stat-sub">{tx('It moves at once. Everyone else on the piece is told. No admin needed.')}</p>
    </Modal>
  )
  if (simple && calendar) {
    // r11: the crew's own calendar is a page, opened from the menu on the left.
    return (
      <>
        <div className="co">
          <header className="co-head"><h1 className="co-title">{tx('Calendar')}</h1></header>
          <p className="co-help cc-drag-help">{tx('Drag a piece to another day to move it.')}</p>
          {crewCalendar}
        </div>
        {movingBox}
        {modal}
      </>
    )
  }
  if (simple) {
    return (
      <>
        <CoachCrewDay model={crewModel} entries={crewModel.entries} user={user} today={today} byKey={byKey} pipe={step.pipe} team={team} making={step.makingFor}
          onOpen={openTask} onChanged={changed}
          calendar={crewCalendar} more={personalBlock} />
        {payHere && <MyPay />}
        {modal}
      </>
    )
  }
  return (
    <>
      <CrewDay content={content} statusesById={statusesById} user={user} today={today} byKey={byKey}
        pravki={pravki} view={myView} onView={setMyView}
        onOpen={setOpenItem} onOpenId={openByContentId} onFixed={markFixed}
        onUpdated={(u) => setContent((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
        calendar={crewCalendar}>
        {/* Somebody has put a time in your day and is waiting to hear whether
            it works. One tap each, from the page you already open. */}
        {toAnswer.length > 0 && (
          <div className={'card card-pad ask-tray' + (toAnswer.length > 2 && !asksOpen ? ' ask-tray-folded' : '')}>
            <div className="ask-tray-head">
              <CalendarClock size={16} />
              <b>{tx('Waiting on your answer')}</b>
              <span className="count">· {toAnswer.length}</span>
              {toAnswer.length > 2 && (
                <button type="button" className="ask-tray-more" onClick={() => setAsksOpen(!asksOpen)}>
                  {asksOpen ? tx('Show less') : tx('Show all')}
                </button>
              )}
            </div>
            {toAnswer.map(({ t, which }) => (
              <button key={`${t.id}-${which}`} type="button" className="ask-tray-row" onClick={() => openByContentId(t.id)}>
                <span className="ask-tray-what">
                  {which === 'shoot' ? <Clapperboard size={13} /> : <Scissors size={13} />}
                  <b>{t.title}</b>
                </span>
                <span className="ask-tray-when">
                  {which === 'shoot'
                    ? `${dateLabel(t.recording_date)}${t.recording_time ? ` · ${t.recording_time}${t.recording_end ? `–${t.recording_end}` : ''}` : ''}`
                    : dateLabel(editDue(t))}
                </span>
                <span className="ask-tray-go">{tx('Answer')}</span>
              </button>
            ))}
          </div>
        )}
      </CrewDay>

      {myView !== 'calendar' && personalBlock}
      <button type="button" className="sd-classic" onClick={() => setSimple(user, true)}>{tx('Try the new, simpler look')}</button>

      {/* What the month is worth so far — after the work, not in front of it.
          It is the thing people check once a week; the list is the thing they
          open the page for. */}
      {payHere && <MyPay />}

      {modal}
    </>
  )
}

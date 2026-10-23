import { useState } from 'react'
import { Clapperboard, Scissors, Palette, Lightbulb, Send, Check, Clock, Inbox, ChevronDown, Bell, Video } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { api } from '../lib/api.js'
import { iconFor, fixMonth, fmtDay, serverNow, longDayLabel, tashkentDay, isWritingChannel } from '../lib/constants.js'
import { addDays, wayOf } from '../lib/coach.js'
import { monthTone, monthShortOf, monthLongOf } from '../lib/planMonth.js'
import { hintOpen, closeHint, openHint } from '../lib/look.js'
import { toast } from '../lib/toast.js'
import { tr as tx, locale, lang, phraseIn } from '../lib/i18n.jsx'

// ---- the Coach look's small parts ------------------------------------------------
//
// The owner asked for a page the eye can sort without reading: a colour and an
// icon for the kind of work, the channel as a mark, the step as dots, a face
// for the person, and a badge for what is urgent. Each of those is one small
// piece here, drawn the same on the crew's day, the maker's day, the calendar
// and the task window (components/CoachCrewDay.jsx, CoachMakerDay.jsx,
// CoachCalendar.jsx, CoachTask.jsx) — so a cut is the same violet scissors
// wherever it turns up.
//
// The colours are tokens (the --kind-* block at the top of styles.css), each
// with a light and a dark value; nothing here names a colour.

// What a row is about. `shoot`, `edit` and `design` are the three kinds of
// crew work; the other three are a maker's states that are nobody's craft: an
// idea waiting for words, a finished piece waiting to go out, a piece that is
// out. The word is looked up where it is drawn, so a language switch moves it.
export const KIND = {
  shoot: { Icon: Clapperboard, cls: 'co-k-shoot', word: () => tx('Shoot') },
  edit: { Icon: Scissors, cls: 'co-k-cut', word: () => tx('Editing') },
  design: { Icon: Palette, cls: 'co-k-art', word: () => tx('Artwork') },
  idea: { Icon: Lightbulb, cls: 'co-k-idea', word: () => tx('Idea') },
  send: { Icon: Send, cls: 'co-k-good', word: () => tx('Ready to publish') },
  out: { Icon: Check, cls: 'co-k-good', word: () => tx('Published') },
}

export function KindTile({ kind, done = false, size = 18 }) {
  const K = KIND[kind] || KIND.idea
  const Icon = done ? Check : K.Icon
  return <span className={`co-kic ${done ? 'co-k-good' : K.cls}`} aria-hidden="true"><Icon size={size} /></span>
}

// A board stage as one of the same marks (round 17, 23 Oct 2026 — the owner:
// "too vague"; one vocabulary of marks, the same on every screen). The stage
// is matched by its label the way statusIcon in lib/constants.js matches it,
// so a renamed or custom stage still lands on a mark; a stage nothing matches
// is drawn as a thought.
export const stageKindOf = (label) => {
  const l = String(label || '').toLowerCase()
  if (/idea|g[ʻ'`]?oya|иде/.test(l)) return 'idea'
  if (/shoot|s[yj]omka|съ[её]м|suratga/.test(l)) return 'shoot'
  if (/edit|montaj|монтаж|writ/.test(l)) return 'edit'
  if (/design|art|dizayn|дизайн/.test(l)) return 'design'
  if (/ready|review|approv|tayyor|провер|tekshir/.test(l)) return 'send'
  if (/publish|post|done|live|chiq|опубл|вышл/.test(l)) return 'out'
  return 'idea'
}
export function StageMark({ status, size = 13, text = true, className = '' }) {
  if (!status) return null
  const K = KIND[stageKindOf(status.label)]
  const name = tx(status.label || '')
  return (
    <span className={`co-stage ${K.cls}${className ? ` ${className}` : ''}`} title={name}>
      <K.Icon size={size} aria-hidden="true" />{text && <span>{name}</span>}
    </span>
  )
}

// Whose shoot and whose edit, as one mark (r11, the editor's and operator's
// feedback): the camera for the shoot, the scissors for the edit (the owner's
// pick, over the film strip). A piece
// whose shoot AND edit are both this person's is one tile cut on the
// diagonal — the camera top left, the scissors on the right. The colours
// are the calendar's: green both, a deep yellow the shoot, a light yellow
// the edit (design reads as the making half, like the edit).
export function KindMark({ shoot = false, edit = false, size = 18 }) {
  const style = { '--km': `${size}px` }
  if (shoot && edit) {
    return (
      <span className="km km-both" style={style} aria-hidden="true">
        <i className="km-a"><Video size={Math.round(size * 0.5)} strokeWidth={2.4} /></i>
        <i className="km-b"><Scissors size={Math.round(size * 0.5)} strokeWidth={2.4} /></i>
      </span>
    )
  }
  const Icon = shoot ? Video : Scissors
  return <span className={`km ${shoot ? 'km-shoot' : 'km-edit'}`} style={style} aria-hidden="true"><Icon size={Math.round(size * 0.66)} /></span>
}
export const ownOf = (t, userId) => ({ shoot: t.operator_id === userId, edit: t.editor_id === userId || t.designer_id === userId })
export const ownClass = (o) => (o.shoot && o.edit ? 'both' : o.shoot ? 'shoot' : 'edit')

// The channels a piece goes to, as marks: the channel's own icon and name.
export function Chans({ keys = [], byKey }) {
  return keys.map((c) => {
    const Icon = iconFor(byKey[c]?.icon)
    return <span key={c} className="co-chan"><Icon size={13} aria-hidden="true" />{byKey[c]?.label || c}</span>
  })
}

// Where the piece is on the way from an idea to out: one dot a stage, the
// stage it is on named beside them. Read off the board's own stages.
//
// A written piece — every channel it goes to is written (Telegram, X, Threads,
// LinkedIn) and it carries no video or picture — has three stops, not five:
// planned, written, out. With `byKey` the dots are read off wayOf's written
// way, so an X post never says "Editing".
export function Dots({ t, pipe, byKey = null }) {
  const at = pipe.live.findIndex((s) => s.id === t.status_id)
  if (at < 0) return null
  const keys = t.channels || []
  const written = !!byKey && keys.length > 0 && keys.every((k) => isWritingChannel(byKey[k]))
    && !(t.with_media && keys.some((k) => byKey[k]?.format === 'short'))
  // …and a repost (TikTok, YouTube Shorts) has two: Ready, and out.
  const repost = !!byKey && keys.length > 0 && keys.every((k) => byKey[k]?.format === 'repost')
  const stops = written || repost
    ? wayOf(t, pipe, { written, repost }).map((s) => ({ id: s.id, label: s.label, cls: s.cls === 'done' ? 'f' : s.cls === 'on' ? 'c' : '' }))
    : pipe.live.map((s, i) => ({ id: s.id, label: s.label, cls: t.done_at || i < at ? 'f' : i === at ? 'c' : '' }))
  const on = stops.findIndex((s) => s.cls === 'c')
  const name = tx((on >= 0 ? stops[on].label : pipe.live[at].label) || '')
  return (
    <span className="co-dots" title={tx('Step {n} of {of}: {stage}', { n: (on >= 0 ? on : at) + 1, of: stops.length, stage: name })}>
      {stops.map((s) => <i key={s.id} className={s.cls} />)}
      <em>{name}</em>
    </span>
  )
}

// What is urgent about a row, in one or two words. Ruby is for late and for
// nothing else; amber says somebody is waiting; green says it is done.
export function Badge({ tone = '', icon = null, children }) {
  const Icon = icon === 'clock' ? Clock : icon === 'check' ? Check : null
  return <span className={'co-badge' + (tone ? ` co-b-${tone}` : '')}>{Icon && <Icon size={12} aria-hidden="true" />}{children}</span>
}

// A person, as a face: their photo, or their initials on their own colour.
export function Face({ person, size = 'xs' }) {
  if (!person) return null
  return <Avatar name={person.name || '?'} color={person.color || undefined} src={person.avatar || null} size={size} />
}
export const firstName = (person) => String(person?.name || '').split(' ')[0]

// ---- days, in the reader's language --------------------------------------------
// Chromium carries no Latin-Uzbek calendar names (it answers "M10" for October
// and English for the weekdays — see fixMonth in lib/constants.js), so the
// Uzbek weekday is the board's own word and the month goes through fixMonth.
const UZ_DAYS = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan']   // Sunday first, like getUTCDay()
const at = (iso) => new Date(`${iso}T12:00:00Z`)
export const weekdayShort = (iso) => (lang() === 'uz' ? UZ_DAYS[at(iso).getUTCDay()]
  : at(iso).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' }))
export const dayMonth = (iso) => fmtDay(iso, { weekday: false })
// "Fri 6 Nov", for a label (the one format of S-06); and the same day in the middle of a line.
export const dayShort = (iso) => fmtDay(iso)
export function dayInLine(iso, today) {
  if (iso === today) return tx('today')
  if (iso === addDays(today, 1)) return tx('tomorrow')
  if (iso === addDays(today, -1)) return tx('yesterday')
  return dayShort(iso)
}
export const hoursOf = (t) => (t.recording_time ? `${t.recording_time.slice(0, 5)}${t.recording_end ? `–${t.recording_end.slice(0, 5)}` : ''}` : '')
export const lateWords = (n) => (n === 1 ? tx('1 day late') : tx('{n} days late', { n }))

// The hour of the day in Tashkent picks the greeting — the team's clock, like
// every "today" on the board.
function greeting(name) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }).format(serverNow()))
  return h >= 5 && h < 12 ? tx('Good morning, {name}', { name })
    : h >= 12 && h < 18 ? tx('Good afternoon, {name}', { name }) : tx('Good evening, {name}', { name })
}

// ---- the first-days hint ---------------------------------------------------------
// Three short steps that say how the page works, shown until "Got it" and
// brought back by the "?" beside the counts. State for one page, by name.
export function useHint(user, name) {
  const [open, setOpen] = useState(() => hintOpen(user, name))
  return {
    open,
    close: () => { closeHint(user, name); setOpen(false) },
    reopen: () => { openHint(user, name); setOpen(true) },
  }
}
export function Hint({ hint, steps }) {
  if (!hint.open) return null
  return (
    <aside className="co-hint" aria-label={tx('How this page works')}>
      <b>{tx('How this page works')}</b>
      {steps.map((s, i) => <p key={i}><i>{i + 1}</i><span>{s}</span></p>)}
      <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={hint.close}>{tx('Got it')}</button>
    </aside>
  )
}

// ---- the summary bar ----------------------------------------------------------------
// The day in one line: who, the counts — each a button that shows only that
// part of the list, pressed again to show everything — and how far the day
// has got.
//
//   segs      [{ key, n, label, late? }]
//   progress  { text, done, total }
export function Summary({ today, name, segs, filter, onFilter, progress, hint, children = null }) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <section className="co-sum">
      <div className="co-hello">
        <div className="co-date">{longDayLabel(today)}</div>
        <h2>{greeting(name)}</h2>
      </div>
      <div className="co-segs" role="group" aria-label={tx('Show only')}>
        {segs.map((s) => (
          <button key={s.key} type="button" className={'co-seg' + (s.late && s.n > 0 ? ' co-seg-late' : '')}
            aria-pressed={filter === s.key} onClick={() => onFilter(filter === s.key ? 'all' : s.key)}>
            <b>{s.n}</b>{s.label}
          </button>
        ))}
        {hint && !hint.open && (
          <button type="button" className="co-q" onClick={hint.reopen} aria-label={tx('How this page works')} data-tip={tx('How this page works')} data-tip-left="">?</button>
        )}
        {children}
      </div>
      <div className="co-prog">
        <span>{progress.text}</span>
        <div className="co-prog-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}
          aria-label={progress.text}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
    </section>
  )
}

// ---- the big card: start here (D-02) ---------------------------------------------------
// One card for every role — a maker, an operator, an editor, a designer — with
// different words. White, a 4 px left rule in the kind's colour (ruby when the
// step is the maker's own), "Start here" in sentence case, the title, one
// plain sentence, the one button sized to its label, and "Open the task" as a
// quiet button beside it. Never a form: the drop box and the questions are
// the window's (the button opens it with the step in focus). Round 8 had a
// ruby-tinted card for the maker and a blue one for the crew, differing in
// colour, layout and content for the same job.
//
//   label    what this card is now ("Start here", "Now", "Filming now", "Picked")
//   line     what rides beside the label: hours, the kind, a badge, "Not now"
//   mark     a tile before the title (the crew's camera/scissors)
//   why      the one sentence
//   buttons  the step's button(s); "Open the task" is added here
//   extra    something the owner asked to keep on the card (the preview)
//   after    the quiet line under the buttons ("After the shoot: …")
export function StartHere({ kind, own = false, label = null, line = null, mark = null, title, onOpen, why, buttons, extra = null, after = null, id = 'co-here-t' }) {
  const K = KIND[kind] || KIND.idea
  return (
    <section className={`co-here ${K.cls}${own ? ' own' : ''}`} aria-labelledby={id}>
      <p className="co-here-l"><span className="co-here-w">{label ?? tx('Start here')}</span>{line}</p>
      <div className="co-here-t">
        {mark}
        <div>
          <h2 id={id}><button type="button" onClick={onOpen}>{title}</button></h2>
          {why && <p className="co-why">{why}</p>}
        </div>
      </div>
      {extra}
      <div className="co-btns">
        {buttons}
        <button type="button" className="co-btn co-btn-q" onClick={onOpen}>{tx('Open the task')}</button>
      </div>
      {after && <p className="co-here-ln">{after}</p>}
    </section>
  )
}

// ---- what is urgent about a row ---------------------------------------------------
// One definition for the list and for the window's head, so a task never says
// one thing in the list and another once it is opened.
export function CrewBadge({ row, today }) {
  if (row.state === 'done') return <Badge tone="good" icon="check">{tx('Done')}</Badge>
  if (row.state === 'ask') return <Badge tone="wait">{tx('Answer needed')}</Badge>
  if (row.state === 'fix') return <Badge tone="wait">{tx('Changes asked')}</Badge>
  // Before "late" too: they answered, and the next move is the maker's.
  if (row.state === 'declined') return <Badge tone="wait">{tx('You said you can’t')}</Badge>
  // Before "late": a piece that was never sent on is not this person's lateness.
  if (row.state === 'early') return <Badge tone="wait">{tx('Not sent to you yet')}</Badge>
  if (row.late) return <Badge tone="late">{lateWords(row.late)}</Badge>
  if (row.state === 'blocked') return <Badge tone="wait">{tx('Waiting for footage')}</Badge>
  const hours = row.kind === 'shoot' ? hoursOf(row.t) : ''
  if (row.due === today) return <Badge icon="clock">{hours || tx('Today')}</Badge>
  return <Badge icon="clock">{row.due ? `${dayShort(row.due)}${hours ? ` ${hours}` : ''}` : tx('No date')}</Badge>
}
export function MakerBadge({ row, today, nameOf }) {
  const { act, t } = row
  if (act.kind === 'out') return <Badge tone="good" icon="check">{tx('Out')}</Badge>
  if (row.group === 'film') {
    const name = nameOf(t.operator_id) || tx('Operator')
    if (row.state === 'unsent') return <Badge tone="wait">{tx('Not sent to the shoot yet')}</Badge>
    if (row.state === 'coming') return <Badge tone="good" icon="check">{tx('{name} is coming', { name })}</Badge>
    if (row.state === 'cant') return <Badge tone="late">{tx('{name} can’t come', { name })}</Badge>
    return <Badge tone="wait">{tx('No answer yet')}</Badge>
  }
  // Being fixed: who and until when are in the row's line of facts; the round
  // is here — each of the three said once, and the round ALWAYS, also on a
  // piece that is late (it used to give way to "N days late" and was then
  // said nowhere).
  if (act.kind === 'fixing') return <>{row.late > 0 && <Badge tone="late">{lateWords(row.late)}</Badge>}<Badge>{tx('round {n}', { n: act.round })}</Badge></>
  if (row.late) return <Badge tone="late">{lateWords(row.late)}</Badge>
  if (act.kind === 'check' || act.kind === 'ownfix' || act.kind === 'move') return <Badge tone="wait">{tx('Waits for you')}</Badge>
  const day = row.due || null
  return <Badge icon="clock">{!day ? tx('No date') : day === today ? tx('Today') : dayShort(day)}</Badge>
}

// ---- a reminder --------------------------------------------------------------------
// "Remind Eldor" is a line in the task's own thread that names him. Naming
// somebody in a thread already reaches them — the bell, and Telegram — by the
// server's own rule for comments (routes/content.js, mentionedIds), so a
// reminder needs no rule of its own and leaves a record everybody on the task
// can see.
//
// A comment rings the bell of everybody on the task; a reminder is sent with
// `remind: true`, which rings only the person it names (bell and Telegram).
// The line still stays in the thread, and the button says so before it is
// pressed (its tip, and the helper line in the window). It is kept to once a day
// per person per task by the THREAD, not by this browser: before writing, it
// reads the task and, if somebody already named this person there today, it
// writes nothing. The browser's own note only saves that read on a second
// look. The line is written in the language of the person being reminded
// (users.lang, the one they chose), not the presser's.
//
// "Already reminded today" is read off the thread as exactly that: a comment
// of today that IS the reminder line for this person, in any of the three
// languages. Not "their name appears" — a morning comment "@Eldor please use
// the new logo" is not a reminder, and must not swallow the one pressed at
// five; and not a substring, or "@Ali" would be found in "@Alisher".
export const remindHelp = () => tx('Remind writes a line in this task’s comments. Only the person you remind gets a bell.')
// Asked for by name here so the phrase books are checked to hold it
// (qa/round74-suite.mjs reads the tx() calls): tx('a reminder: this task is waiting for you.')
const REMIND_LINE = 'a reminder: this task is waiting for you.'
const REMINDED = (uid) => `satashkent_reminded_${uid}`
const sentToday = (user, today) => {
  try {
    const all = JSON.parse(localStorage.getItem(REMINDED(user?.id)) || '{}')
    return Object.fromEntries(Object.entries(all).filter(([, day]) => day === today))
  } catch { return {} }
}
export function RemindButton({ user, taskId, person, today, small = false, onSent = null }) {
  const key = `${taskId}:${person?.id}`
  const [sent, setSent] = useState(() => !!sentToday(user, today)[key])
  const [busy, setBusy] = useState(false)
  if (!person || person.id === user.id) return null
  const send = async (e) => {
    e.stopPropagation()
    if (busy || sent) return
    setBusy(true)
    try {
      const remember = () => { try { localStorage.setItem(REMINDED(user?.id), JSON.stringify({ ...sentToday(user, today), [key]: today })) } catch { /* the thread is asked again, which is fine */ } }
      const thread = (await api.get(`/content/${taskId}`)).comments || []
      const lines = ['en', 'ru', 'uz'].map((l) => `@${person.name} — ${phraseIn(l, REMIND_LINE)}`)
      if (thread.some((c) => c.created_at && tashkentDay(c.created_at) === today && lines.includes(String(c.text || '').trim()))) {
        remember(); setSent(true)
        toast(tx('{name} was already reminded today', { name: firstName(person) }))
        return
      }
      const c = await api.post(`/content/${taskId}/comments`, { text: `@${person.name} — ${phraseIn(person.lang, REMIND_LINE)}`, remind: true })
      remember(); setSent(true)
      toast(tx('{name} got a reminder', { name: firstName(person) }))
      onSent?.(c)
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }
  return (
    // r11 (the owner: "remind — it is big"): small everywhere; in a list it is
    // just "Remind", because the row already says whose it is.
    <button type="button" className={'co-btn co-btn-s co-btn-sm' + (small ? ' co-remind-sm' : '')} disabled={busy || sent} onClick={send}
      data-tip={sent ? undefined : remindHelp()} aria-label={tx('Remind {name}', { name: firstName(person) })}>
      {sent ? <Check size={14} aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />}
      {sent ? tx('Reminded') : small ? tx('Remind') : tx('Remind {name}', { name: firstName(person) })}
    </button>
  )
}

// An empty place says why it is empty and what will fill it.
export function Empty({ title, why, good = false, children = null }) {
  return (
    <div className="co-empty">
      <span className={`co-kic ${good ? 'co-k-good' : 'co-k-idea'}`} aria-hidden="true">{good ? <Check size={26} /> : <Inbox size={26} />}</span>
      <b>{title}</b>
      <p>{why}</p>
      {children}
    </div>
  )
}

// The month of the plan a piece belongs to (lib/planMonth.js), as a small tag
// in that month's colour. This month's pieces carry none — a row says one
// thing — so the tag is there only when it tells the piece apart: last
// month's in amber, older in grey, next month's in quiet blue.
export function MonthTag({ ym, today }) {
  const tone = monthTone(ym, today)
  if (tone === 'now' || !ym) return null
  return <span className={`co-month co-month-${tone}`} title={tx('Planned for {month}', { month: monthLongOf(ym) })}>{monthShortOf(ym)}</span>
}

// "All · October plan · September plan": the day split by the month a piece
// was planned for. Shown only where something was carried over.
export function MonthFilter({ value, onChange, today, from }) {
  const cur = String(today).slice(0, 7)
  const opts = [['all', tx('All')], ['now', tx('{month} plan', { month: monthLongOf(cur) })], ['carried', tx('Carried over from {month}', { month: monthLongOf(from) })]]
  return (
    <div className="co-segs co-monthf" role="group" aria-label={tx('Which month')}>
      {opts.map(([k, label]) => (
        <button key={k} type="button" className={'co-seg' + (k === 'carried' ? ' co-seg-old' : '')} aria-pressed={value === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

// Everything that is not the day itself, folded: what is hidden is one press
// away, not gone.
export function More({ children, note = '' }) {
  return (
    <details className="card sd-more">
      <summary>{tx('More')}{note && <span className="count">· {note}</span>} <ChevronDown size={14} className="cd-done-caret" /></summary>
      <div className="sd-more-body">{children}</div>
    </details>
  )
}

// ---- what changed, said once --------------------------------------------------------
// The team's own words in the survey: "updates too often" — and unannounced.
// So a release that changes how something is done says so in a few lines, the
// first time each person opens My Day after it, and never again once they
// press "Got it". One id a release; the lines are that release's.
const NEWS = {
  id: 'r19',
  lines: () => [
    tx('Every task is a line of stops — Idea, Shoot, Editing, Out — and the stop it is on is lit. The same line is on My Day, over the task window and in the new task form.'),
    tx('On My Day the small line in front of a title shows where the piece is; a ring in your colour is the stop that is yours.'),
    tx('In a new task, When and Who are one step, Plan: press a stop on the line to give it its day and its person.'),
    tx('Every stage is one mark now — the same icon and colour on the calendar, in the task window and on My Day: a clapperboard is the shoot, scissors the edit, a palette the artwork, a tick what is out.'),
    tx('In a new task the days are cells: Shoot, Edit, Out. Press a cell to pick its day; Out says “Today” until you change it.'),
    tx('The task window says in one line where the piece stands, whose turn it is and the day.'),
    tx('In the menu: “Post Production” is now “Crew”, “Payment” is “Pay”, “Monthly notes” is “Notes”, “Unmatched files” is “Lost files”.'),
    tx('One way to give a task: where, the idea, when, who, the brief — "Save for now" on every step. A task with no day lands on today; a job with no day is under "No day yet" on your day.'),
    tx('The calendar is one frame: Shooting and Releasing at the top, channels on the left, stages on the right. On Shooting a name means who films; on Releasing, who edits, designs or owns the piece.'),
    tx('The menu is one list: every page is on it, nothing is under More. Your channels are in the middle.'),
    tx('Settings is the gear beside your name at the foot of the menu. The tour is the question mark next to it.'),
    tx('The phone’s bar has the calendar and your board; the rest is under More, which opens the same list.'),
    tx('The big card’s button opens the task with your step ready; “Open the task” shows the whole piece.'),
    tx('In the task a button appears when it can be pressed. Until then the line under the box says what is missing.'),
    tx('A day is picked on a calendar card and reads the same everywhere: “Fri 6 Nov”.'),
    // The team is told, every release, that the board records where people struggle (r13; track-suite pins it).
    tx('To make the board easier, it now records which pages you open and what you press — never what you type.'),
  ],
}
export function WhatsNew() {
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem('satashkent_news') === NEWS.id } catch { return true } })
  if (seen) return null
  const close = () => {
    try { localStorage.setItem('satashkent_news', NEWS.id) } catch { /* private window */ }
    setSeen(true)
  }
  return (
    <section className="co-news" aria-label={tx('What changed')}>
      <b>{tx('What changed')}</b>
      <ul>{NEWS.lines().map((line) => <li key={line}>{line}</li>)}</ul>
      <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={close}>{tx('Got it')}</button>
    </section>
  )
}

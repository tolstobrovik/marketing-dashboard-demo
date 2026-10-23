import { useRef, useState } from 'react'
import {
  Lightbulb, Clapperboard, Scissors, PenLine, Palette, Eye, Undo2, Check, CheckCircle2, CalendarDays, CloudUpload, Star,
  Instagram, Send, Youtube, Target, Music2, Twitter, Linkedin, AtSign,
} from 'lucide-react'
import { Face, firstName, dayShort, lateWords } from './CoachParts.jsx'
import Timeline, { timelineOf } from './Timeline.jsx'
import { iconFor } from '../lib/constants.js'
import { wayOf, ownersOf, daysBetween } from '../lib/coach.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- round 8: the look's shared pieces ---------------------------------------------
//
// The owner chose a look from mockups (October 2026): a white page, ruby as the
// one strong colour, a soft tint and an icon for each stage. These are the
// pieces every screen of that look draws — the same capsule on My Day and in
// the task window, the same tile on a row and above a lane — so nobody writes
// a second one. Their styles are the "r8: base" section of styles.css, under
// html[data-look="coach"]; nothing here names a colour.
//
// Each piece draws a reading the app already makes (lib/coach.js wayOf,
// ownersOf; lib/nextStep.js pipelineOf, makingOf). None makes its own.
//
// WHAT IS HERE, AND ITS PROPS
//
//   <Capsule t pipe making userId person posted="" />
//       The stages line of a task, for the big card and the task window. The
//       stop it is on opens and names who has it ("You" for the viewer); done
//       stops fold to that person's face with a tick; later stops to the
//       stage's icon. A written piece has its three stops, a repost its two —
//       wayOf's answer. From 620px of room every stop also shows its word.
//         t        the task row
//         pipe     pipelineOf(statuses)
//         making   makingOf(t, crew, asked)
//         userId   the viewer's id
//         person   (id) => { name, color, avatar } | undefined
//         posted   words for the last stop when the piece is out ("Wed 7 Oct")
//       Draw it only when tracks(user, t) is true.
//
//   <StageTile stage label lane={false} />
//       The stage's icon in a tile of its soft colour, then its word.
//         stage    a wayOf stop, or a key: 'idea' | 'shoot' | 'edit' | 'write' |
//                  'draw' | 'ready' | 'pravka' | 'done' | 'completed' | 'late'
//         label    the word, already in the reader's language; with a stop it
//                  may be left out (the stop's own label is used)
//         lane     the larger tile of a lane heading
//
//   <StageRow stage label day today done={false} />
//       On a row: the tile and its word, then the day chip. `day` may be empty.
//
//   <LaneHead stage label count />
//       Above a lane: the larger tile, the name, the count beside it. Give the
//       lane itself className={`co-lane ${stageClass(stage)}`} for its
//       coloured top edge.
//
//   <DayChip day today done={false} />
//       The day ("Today", "Tomorrow", "Fri 9 Oct"): late on the ruby tint,
//       today on amber, later plain. `done` — a tick, never late.
//         day, today   ISO days ('2026-10-09')
//
//   <ChanMark channel size={18} alone={false} />
//       The network's mark with, in its corner, what tells three Instagram
//       marks apart: a ruby star (…_main), the Uzbek flag (…_uzb), the Kazakh
//       flag (…_kaz / …_kz). `alone` draws the star or flag by itself (the
//       sidebar's rows under a network); a channel with no variant is then its
//       network's mark.
//         channel  a channel row { key, label, icon }
//
//   networkOf(channel) → 'instagram' | 'telegram' | 'youtube' | 'target' |
//                        'tiktok' | 'x' | 'linkedin' | 'threads' | 'other'
//   variantOf(channel) → 'main' | 'uz' | 'kz' | null
//   NETWORKS           → { [network]: { Icon, name } }, for a group's heading
//
//   <Ring pct size={28} label user />
//       A circle that fills with green; a tick at 100. From 28px the number
//       stands inside. Draws nothing when pct is null, and nothing for a
//       person whose only job is designer (the owner: no percentages for
//       designers) — pass `user` so it can tell.
//   coverPct(t, making) → number | null
//       Only for a filmed piece that has a designer: the video is 80 and its
//       cover 20 (70 and 30 for type 'video') — 80 when it is out without
//       artwork, 100 with it. null for every other piece: draw no ring.
//   showsRing(user)    → false for a person whose only job is designer
//
//   tracks(user, t)    → who sees the stages line: an admin, an owner of the
//                        piece, a person with two or more crew jobs. Everybody
//                        else sees "Your turn" and their one button.
//
//   stageKey(stop)     → the tint key of a wayOf stop (see StageTile)
//   stageKeyOf(pipe, statusId) → the same for a board's status row
//   stageClass(stage)  → 'co-s-…', the class that carries a stage's colours
//
//   <Frame shape="tall" src video={false} label onFiles busy={false}>
//       A preview at its true shape: 'tall' (a reel, 9:16), 'wide' (a video,
//       16:9), 'square' (a post). With `src` it shows the picture or the
//       video's first frame; children are drawn over it (a play button, a
//       length). With `onFiles` and nothing to show it is the place to drop:
//       a file may be dropped on it or chosen with its button (the press way
//       and the keyboard way of the same thing).
//         onFiles  (File[]) => void
//         label    what to drop, in the reader's language ("Drop the edit here")
//
// BUTTONS are classes, not a component: .co-btn with .co-btn-p (the one filled
// ruby), .co-btn-t (tonal), .co-btn-s / .co-btn-o (outline), .co-btn-x (text),
// .co-btn-i (icon only — give it an aria-label), sizes .co-btn-sm / .co-btn-lg.
// A button that cannot be pressed yet takes aria-disabled="true" (or disabled):
// outlined ruby at full contrast, with its reason beside it — never grey text.
// Small things: .co-chip (a fact; a <button> one is outlined and pressable,
// .sel chosen), .co-tag, .co-stage + a stage class (the stage pill: icon and
// word on the stage's tint), .co-cnt (a number; .late in ruby). The page's one
// headline is .co-title (Nekst); a large number is .co-bignum.

// ---- stages --------------------------------------------------------------------------
const STAGE_ICON = {
  idea: Lightbulb, shoot: Clapperboard, edit: Scissors, write: PenLine, draw: Palette,
  ready: Eye, pravka: Undo2, done: CheckCircle2, completed: CheckCircle2, late: CalendarDays,
}
// Eight words, five colours: writing and drawing are the making stop, a
// designer's pravka is a check, completed is out.
const TINT = { write: 'edit', draw: 'edit', pravka: 'ready', completed: 'done' }
export function stageKey(stop) {
  if (typeof stop === 'string') return stop
  const role = stop?.role
  return role === 'final' ? 'done' : role === 'review' ? 'ready' : role === 'shoot' ? 'shoot'
    : role === 'edit' ? (stop.verb === 'write' ? 'write' : stop.verb === 'draw' ? 'draw' : 'edit') : 'idea'
}
// A board's lane is a status row, not a task: asked of the same reading, as a
// filmed piece standing on that row.
export const stageKeyOf = (pipe, statusId) => stageKey(wayOf({ status_id: statusId }, pipe, { filmed: true }).find((s) => s.id === statusId))
export const stageClass = (stage) => { const k = stageKey(stage); return `co-s-${TINT[k] || k}` }

export function StageTile({ stage, label = null, lane = false }) {
  const key = stageKey(stage)
  const Icon = STAGE_ICON[key] || Lightbulb
  const word = label ?? (typeof stage === 'object' && stage ? tx(stage.label || '') : '')
  return (
    <span className={`co-tile ${stageClass(key)}${lane ? ' co-tile-ln' : ''}`}>
      <i aria-hidden="true"><Icon size={lane ? 16 : 14} /></i>{word}
    </span>
  )
}

export function DayChip({ day, today, done = false }) {
  if (!day) return null
  const n = daysBetween(today, day)
  const late = !done && n < 0
  const Icon = done ? Check : CalendarDays
  return (
    <span className={'co-day' + (late ? ' late' : !done && n === 0 ? ' today' : '')} title={late ? `${dayShort(day)} — ${lateWords(-n)}` : dayShort(day)}>
      <Icon size={14} aria-hidden="true" />{n === 0 ? tx('Today') : n === 1 ? tx('Tomorrow') : dayShort(day)}
      {late && <span className="sr-only"> — {lateWords(-n)}</span>}
    </span>
  )
}

export function StageRow({ stage, label = null, day = null, today, done = false }) {
  return <span className="co-stagerow"><StageTile stage={stage} label={label} /><DayChip day={day} today={today} done={done} /></span>
}

export function LaneHead({ stage, label = null, count = null }) {
  return <><StageTile stage={stage} label={label} lane />{count != null && <span className="co-lane-n">{count}</span>}</>
}

// ---- the capsule ---------------------------------------------------------------------
// Round 18 (23 Oct 2026): the capsule is the timeline (components/Timeline.jsx)
// in its `top` size — every stop with its word, whose it is and its day, the
// stop the piece is on lit. Drawn for everybody now: position says whose
// turn it is, where the words used to.
export function Capsule({ t, pipe, making, userId, person, posted = '', today = '' }) {
  const stops = timelineOf(t, pipe, making, { person, userId, today })
  if (!stops.length) return null
  if (posted && t.done_at) stops[stops.length - 1].when = posted
  const on = stops.findIndex((s) => s.state === 'on')
  const said = on < 0 ? '' : tx('Step {n} of {of}: {stage}', { n: on + 1, of: stops.length, stage: stops[on].label })
  return (
    <nav className="co-capwrap" aria-label={said || tx('Stages')}>
      <Timeline size="top" stops={stops} youId={userId} />
    </nav>
  )
}

// ---- who sees what -------------------------------------------------------------------
const CREW_ROLES = ['editor', 'operator', 'designer', 'crew']
const jobsOf = (user) => (user?.crew_roles?.length ? user.crew_roles : CREW_ROLES.includes(user?.role) && user.role !== 'crew' ? [user.role] : [])
export const tracks = (user, t) => !!user && (user.role === 'admin' || (!!t && ownersOf(t).includes(user.id)) || jobsOf(user).length >= 2)
export const showsRing = (user) => !(CREW_ROLES.includes(user?.role) && jobsOf(user).length === 1 && jobsOf(user)[0] === 'designer')

// ---- the cover ring --------------------------------------------------------------------
export function coverPct(t, making) {
  if (!t || !making?.filmed || !t.designer_id) return null
  const cover = t.type === 'video' ? 30 : 20
  return (t.done_at ? 100 - cover : 0) + (t.design_link ? cover : 0)
}

export function Ring({ pct, size = 28, label = null, user = null }) {
  if (pct == null || (user && !showsRing(user))) return null
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  const full = p >= 100
  const w = size < 24 ? 5 : 3.6
  const fs = size >= 56 ? 15 : size >= 44 ? 13 : size >= 36 ? 12 : 10
  const said = label || tx('{n}% done', { n: p })
  return (
    <span className="co-ring" role="img" aria-label={said} title={said} style={{ '--sz': `${size}px` }}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="co-ring-track" cx="18" cy="18" r="15" strokeWidth={w} />
        {p > 0 && <circle className="co-ring-arc" cx="18" cy="18" r="15" strokeWidth={w} pathLength="100" strokeDasharray={`${p} 100`} transform="rotate(-90 18 18)" />}
        {full ? <path className="co-ring-tick" d="M11.5 18.6l4.3 4.2 8.7-9.5" strokeWidth="3.2" />
          : size >= 28 && <text x="18" y="18.4" textAnchor="middle" dominantBaseline="central" fontSize={(fs * 36 / size).toFixed(1)}>{p}</text>}
      </svg>
    </span>
  )
}

// ---- a channel with a face -------------------------------------------------------------
export const NETWORKS = {
  instagram: { Icon: Instagram, name: 'Instagram' },
  telegram: { Icon: Send, name: 'Telegram' },
  youtube: { Icon: Youtube, name: 'YouTube' },
  target: { Icon: Target, name: 'Target' },
  tiktok: { Icon: Music2, name: 'TikTok' },
  x: { Icon: Twitter, name: 'X' },
  linkedin: { Icon: Linkedin, name: 'LinkedIn' },
  threads: { Icon: AtSign, name: 'Threads' },
}
// The network is read off the channel's key first (the seeded channels are
// instagram_main, telegram_main, youtube, target…), then off the icon the
// admin picked for a channel they made themselves.
export function networkOf(channel) {
  const key = String(channel?.key ?? channel ?? '').toLowerCase()
  const hit = /^(instagram|telegram|youtube|target|tiktok|linkedin|threads)/.exec(key)
  if (hit) return hit[1]
  if (/^(x_?twitter|twitter|x)(_|$)/.test(key)) return 'x'
  return NETWORKS[channel?.icon] ? channel.icon : 'other'
}
export function variantOf(channel) {
  const key = String(channel?.key ?? channel ?? '').toLowerCase()
  return /_main$/.test(key) ? 'main' : /_uzb$/.test(key) ? 'uz' : /_(kaz|kz)$/.test(key) ? 'kz' : null
}
// The two flags, small enough to read at 12px. They keep their own colours —
// they are flags, not the brand's palette; the star is the brand's ruby.
const FLAG = {
  uz: (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect width="12" height="12" fill="#fff" /><rect width="12" height="4.1" fill="#0099B5" /><rect y="7.9" width="12" height="4.1" fill="#1EB53A" />
      <rect y="3.8" width="12" height=".7" fill="#CE1126" /><rect y="7.5" width="12" height=".7" fill="#CE1126" />
      <circle cx="2.9" cy="2" r="1.25" fill="#fff" /><circle cx="3.5" cy="2" r="1.05" fill="#0099B5" />
    </svg>
  ),
  kz: (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <rect width="12" height="12" fill="#00AFCA" /><rect x="1" y="1.2" width="1.1" height="9.6" fill="#FEC50C" /><circle cx="7" cy="5" r="2.2" fill="#FEC50C" />
      <path d="M3.9 8.6c1.9 1.2 4.3 1.2 6.2 0" fill="none" stroke="#FEC50C" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
  main: <Star aria-hidden="true" />,
}

export function ChanMark({ channel, size = 18, alone = false }) {
  const net = networkOf(channel)
  const variant = variantOf(channel)
  const Icon = NETWORKS[net]?.Icon || iconFor(channel?.icon)
  const name = channel?.label || NETWORKS[net]?.name || ''
  if (alone && variant) return <span className={`co-flag co-flag-${variant}`} role="img" aria-label={name} title={name} style={{ '--sz': `${size}px` }}>{FLAG[variant]}</span>
  const b = variant ? Math.max(12, Math.round(size * 0.6)) : 0
  return (
    <span className="co-mark" role="img" aria-label={name} title={name} style={{ '--sz': `${size}px`, '--b': `${b}px` }}>
      <Icon size={size} aria-hidden="true" />
      {variant && <i className={`co-flag co-flag-${variant}`}>{FLAG[variant]}</i>}
    </span>
  )
}

// ---- a preview at its true shape, with a place to drop -----------------------------------
const SHAPES = { tall: '9 / 16', wide: '16 / 9', square: '1 / 1' }
export function Frame({ shape = 'tall', src = null, video = false, label = null, onFiles = null, busy = false, children = null }) {
  const [over, setOver] = useState(false)
  const input = useRef(null)
  const drop = onFiles && !src
  const take = (files) => { const list = [...(files || [])]; if (list.length && !busy) onFiles(list) }
  return (
    <div
      className={`co-frame co-frame-${shape}${drop ? ' drop' : ''}${over ? ' over' : ''}`}
      style={{ '--ar': SHAPES[shape] || SHAPES.tall }}
      onDragOver={drop ? (e) => { e.preventDefault(); setOver(true) } : undefined}
      onDragLeave={drop ? () => setOver(false) : undefined}
      onDrop={drop ? (e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) } : undefined}
    >
      {src && (video ? <video src={src} preload="metadata" muted playsInline /> : <img src={src} alt="" loading="lazy" />)}
      {drop && (
        <>
          <CloudUpload size={28} aria-hidden="true" />
          <b>{label || tx('Drop a file here')}</b>
          <button type="button" className="co-btn co-btn-o co-btn-sm" disabled={busy} onClick={() => input.current?.click()}>{tx('Choose a file')}</button>
          <input ref={input} type="file" hidden onChange={(e) => { take(e.target.files); e.target.value = '' }} />
        </>
      )}
      {children}
    </div>
  )
}

import { tr as tx, locale, lang } from './i18n.jsx'
import {
  Instagram, Send, Youtube, Target, Camera, Clapperboard, Megaphone,
  Star, BarChart3, Globe, Music2, PenTool, Image as ImageIcon, Film, CirclePlay, Video, FileText,
  Lightbulb, Scissors, CheckCircle2, Trash2,
} from 'lucide-react'

// Icons the admin can pick when creating a sidebar channel.
export const CHANNEL_ICONS = {
  instagram: Instagram,
  telegram: Send,
  youtube: Youtube,
  target: Target,
  camera: Camera,
  video: Clapperboard,
  megaphone: Megaphone,
  chart: BarChart3,
  globe: Globe,
  music: Music2,
  pen: PenTool,
  star: Star,
}
export const iconFor = (name) => CHANNEL_ICONS[name] || Star

// Telegram-style member rights the admin can toggle per person.
export const PERMISSIONS = [
  { key: 'edit_metrics',    label: 'Update metric values',      desc: 'Use +/− and change current numbers' },
  { key: 'manage_metrics',  label: 'Add & edit metrics',        desc: 'Create, rename, retarget, delete metrics' },
  { key: 'manage_layout',   label: 'Change layout',             desc: 'Reorder metrics and pin them to the top' },
  { key: 'manage_content',  label: 'Create & edit content',     desc: 'Add tasks, edit details and dates' },
  { key: 'move_tasks',      label: 'Move tasks',                desc: 'Drag between stages and calendar days' },
  { key: 'review_publish',  label: 'Review & publish',          desc: 'Move Ready tasks to Published, on your channels' },
  { key: 'request_changes', label: 'Request changes (Pravki)',  desc: 'Send a Ready task back to the crew with notes' },
  { key: 'deliver_work',    label: 'Deliver / re-deliver work', desc: 'Update a stage’s delivery link and mark fixes done' },
  { key: 'manage_ambassadors', label: 'Run the ambassador programme',
    desc: 'Check students’ posts, set their terms, and sign new ones up' },
]

export const can = (user, perm) =>
  user?.role === 'admin' || !!(user?.permissions && user.permissions[perm])

// The Deleted stage: killed content that stays on the record. It counts for
// the planner/operator, never for the editor, and leaves every to-do view.
export const isDeletedLabel = (label) => /^deleted$/i.test(label || '')

// The Idea stage: a thought, not a commitment — no crew or dates expected yet,
// so planning views don't count its blanks as gaps.
export const isIdeaLabel = (label) => /idea/i.test(label || '')

// ---- channels where the work is WRITTEN rather than filmed ----------------
// A Telegram post is typed. Nobody books an operator for it, nobody hands over
// footage, and nobody waits on a cut — so the pipeline the rest of the board
// runs on (Idea → To shoot → Editing → Ready → Published) asks a Telegram
// channel four questions it does not have answers to, and gives it a Recording
// calendar that is permanently empty.
//
// Such a channel has three states and only three: not started, being written,
// out. Matched on the channel the way the platform lens already is — the icon
// an admin picks when they create it, or the key it got from its name — so a
// second Telegram channel is one without anybody wiring it up.
// A channel now SAYS what it is (Admin → Channels → What kind of channel), so
// this reads the answer instead of guessing at it from an icon. The guess is
// kept for one case only: a channel list cached by a browser from before
// formats existed, which has no format on it to read.
export const isWritingChannel = (ch) =>
  (ch && ch.format)
    ? isWrittenFormat(ch.format)
    : (ch?.icon === 'telegram' || /telegram/i.test(ch?.key || ''))
// The two written formats: 'text' (Telegram — it also carries the Telegram item
// type) and 'short' (X, Threads, LinkedIn — a post with a length limit). Both
// are typed and go out; nobody films or designs them.
export const isWrittenFormat = (f) => f === 'text' || f === 'short'

// The three stages such a channel runs on. Idea and the making stage are
// matched on the pipeline's own labels, the way the stage rules are; the last
// one is matched on is_final instead, because "the stage that means it is out"
// is a fact the pipeline records about itself and an admin is free to rename.
//
// "Writing" is the making stage under the name the work actually has here — the
// same column an Instagram reel calls Editing, because it IS the same column in
// the same pipeline. Nothing is renamed in the database and no task changes
// stage; only the word above the column does.
//
// It is the one word here the BOARD supplies rather than the admin, so it is
// the one that gets translated: the other two columns keep the label the admin
// typed, already in their own language. Read through a function so a language
// switch moves it, the way every other tx() string moves.
export const WRITING_STAGES = [
  { key: 'idea', is: (s) => /idea/i.test(s.label || ''), label: null },
  { key: 'writing', is: (s) => /editing|montaj/i.test(s.label || ''), label: () => tx('Writing'), into: true },
  { key: 'published', is: (s) => !!s.is_final, label: null },
]
// …and the two a repost channel runs on (TikTok, YouTube Shorts — format
// 'repost'): a repost arrives on Ready, made, and goes out. Anything standing
// on a stage before Ready is drawn in Ready, the way a written channel folds
// its extra stages into Writing.
export const REPOST_STAGES = [
  { key: 'ready', is: (s) => /^ready$|review|tayyor/i.test(s.label || ''), label: null, into: true },
  { key: 'published', is: (s) => !!s.is_final, label: null },
]

// The little glyph a pipeline stage wears on calendar pills and chips —
// matched by label so custom stages still land on something sensible.
export const statusIcon = (label) => {
  const l = (label || '').toLowerCase()
  if (/deleted/.test(l)) return Trash2
  if (/idea/.test(l)) return Lightbulb
  if (/\bshot\b|filmed/.test(l)) return Film
  if (/shoot/.test(l)) return Clapperboard
  if (/edit/.test(l)) return Scissors
  if (/ready|approv/.test(l)) return CheckCircle2
  if (/publish|post|done|got|live/.test(l)) return Send
  return null
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Working-schedule days, Mon-first for display but numbered like JS getDay()
// (0 = Sunday) — the same encoding users.work_days stores.
export const WORK_DAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
]

// "Mon–Fri · 09:00–18:00" from a user's schedule fields; null when unset.
export function scheduleLabel(u) {
  const days = Array.isArray(u?.work_days) && u.work_days.length ? u.work_days : null
  const hours = u?.work_start && u?.work_end ? `${u.work_start}–${u.work_end}` : null
  if (!days && !hours) return null
  let dayTxt = null
  if (days) {
    const ordered = WORK_DAYS.filter((d) => days.includes(d.n))
    // Contiguous run (in Mon-first order) reads as a range: Mon–Fri.
    const idx = ordered.map((d) => WORK_DAYS.findIndex((w) => w.n === d.n))
    const contiguous = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
    dayTxt = contiguous ? `${ordered[0].label}–${ordered[ordered.length - 1].label}` : ordered.map((d) => d.label).join(' ')
  }
  return [dayTxt, hours].filter(Boolean).join(' · ')
}
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const CADENCES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
]

// What a task is. Creating a Post raises the channel's Posts plan by one;
// completing it fills the plan (15/16 → 16/16).
export const CONTENT_TYPES = [
  { key: 'post',  label: 'Post',  plan: 'Posts',   icon: ImageIcon },
  { key: 'reel',  label: 'Reel',  plan: 'Reels',   icon: Film },
  { key: 'story', label: 'Story', plan: 'Stories', icon: CirclePlay },
  { key: 'video', label: 'Video', plan: 'Videos',  icon: Video },
  // Paid promotion: a creative made for an ad set rather than for the feed.
  { key: 'target', label: 'Target', plan: 'Target', icon: Target },
  // 'Other' is the one label that is a word rather than a name. It is kept as
  // the book's English key, like the five above, and looked up each time it is
  // READ — where it is drawn — rather than once when this module loads: a
  // translation made at import is a translated string, and a second tx() over
  // it can only fall back on it. The screens that print the label as it
  // stands still get the reader's word.
  { key: 'other', get label() { return tx('Other') }, plan: null, icon: FileText },
]
export const typeInfo = (key) => CONTENT_TYPES.find((t) => t.key === key) || CONTENT_TYPES[CONTENT_TYPES.length - 1]

// A type's name in the reader's language, for the pages that count by type
// (the Statistics pie, its spreadsheet). The five names are translated here,
// where they are drawn; 'Other' has already been looked up by its getter, and
// an unknown type is 'other' by typeInfo's own fallback.
export const typeLabel = (key) => {
  const t = typeInfo(key)
  return t.key === 'other' ? t.label : tx(t.label)
}

// ---- Date helpers (yyyy-mm-dd) ----
// "Today" is pinned to the team's clock (Asia/Tashkent, UTC+5): the calendars,
// to-do list and overdue checks roll to a new day at Tashkent midnight, no
// matter where or on which device the dashboard is opened.
export const TIMEZONE = 'Asia/Tashkent'
const tashkentFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }) // YYYY-MM-DD
export function localISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
// The server's clock, as far as this device can tell. Every answer that
// carries it (a person's day does: /users/:id/slots) corrects the difference,
// so "today" and "now" are the team's even on a phone set a few minutes out or
// to another zone — and the page and the strip on it agree about both. Until
// the first such answer it is this device's clock, as it always was.
let serverSkew = 0
export const noteServerClock = (atIso) => {
  const at = Date.parse(atIso)
  if (Number.isFinite(at)) serverSkew = at - Date.now()
}
export const serverNow = () => new Date(Date.now() + serverSkew)
export const todayISO = () => tashkentFmt.format(serverNow())

// Shoots are booked by the half-hour: the strip's cells, the week grid's
// starts, and a time typed into the sheet all land on the same grid. A start
// rounds down and an end rounds up, so snapping never shortens a shoot. The
// day ends at 23:59, not "24:00", which no time box can hold.
export function snapHalfHour(t, up = false) {
  if (!/^\d{2}:\d{2}/.test(String(t || ''))) return t
  const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const s = up ? Math.min(23 * 60 + 59, Math.ceil(m / 30) * 30) : Math.min(23 * 60 + 30, Math.floor(m / 30) * 30)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
// The Tashkent calendar day (YYYY-MM-DD) of a full ISO timestamp — so
// "published this week" counts by the team's clock, not the browser's.
export const tashkentDay = (iso) => (iso ? tashkentFmt.format(new Date(iso)) : null)
export function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localISO(d)
}
// The Monday of the week a day falls in — weeks here start on Monday.
export const mondayOfISO = (iso) => addDaysISO(iso, -((new Date(`${iso}T00:00:00`).getDay() + 6) % 7))
// Uzbek month names, because the browser has not got any.
//
// Chromium's ICU carries no month names for Latin Uzbek: every uz tag — uz,
// uz-UZ, uz-Latn, uz-Latn-UZ — answers "M09" for September, in BOTH 'short'
// and 'long'. (uz-Cyrl has them, but this board is written in Latin.) So a
// team reading the dashboard in Uzbek saw "M09 30" where a date should be,
// and a row of month buttons labelled M08, M09, M10.
//
// Only the projects month strip calls these so far. dateLabel() below still
// does not, and nor do the twenty places that format a month themselves —
// that sweep is its own change; these two helpers are what it will use.
//
// Only the broken token is replaced, never the whole string: the ORDER of day
// and month is the locale's business — en-GB writes "30 Sept", ru-RU writes
// "30 сент." — and rebuilding the label by hand would get that wrong for
// the two languages that were never broken. English and Russian pass through
// this untouched.
const UZ_MONTHS_LONG = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
]
const UZ_MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

// `text` is whatever Intl produced; monthIndex is 0-11. An "M09" anywhere in
// it is the ICU placeholder and gets the real name.
export function fixMonth(text, monthIndex, style = 'short') {
  const book = style === 'long' ? UZ_MONTHS_LONG : UZ_MONTHS_SHORT
  return String(text).replace(/\bM(\d{1,2})\b/, (m, n) => book[Number(n) - 1] ?? book[monthIndex] ?? m)
}

// A month on its own, named: "September", "Sentabr", "сентябрь".
// Capitalised because this is a label on a button, not a word in a sentence —
// Russian and Uzbek both write months lower case in running text.
export function monthName(year, month1to12, style = 'long') {
  const d = new Date(Date.UTC(year, month1to12 - 1, 1))
  const raw = fixMonth(d.toLocaleDateString(locale(), { month: style, timeZone: 'UTC' }), month1to12 - 1, style)
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

// A day said in full — "Friday 26 September". Chromium has no Latin-Uzbek
// calendar names at all (it answers «M09 26, Fri»), so the Uzbek one is put
// together from the board's own words; English and Russian are the browser's.
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function longDayLabel(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00Z`)
  if (lang() === 'uz') return `${tx(WEEKDAYS_EN[d.getUTCDay()])}, ${d.getUTCDate()}-${monthName(d.getUTCFullYear(), d.getUTCMonth() + 1).toLowerCase()}`
  return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

// The same day, for the middle of a line: "out today", not "out Today".
export function dayWord(iso) {
  const t = todayISO()
  if (iso === t) return tx('today')
  if (iso === addDaysISO(t, 1)) return tx('tomorrow')
  if (iso === addDaysISO(t, -1)) return tx('yesterday')
  return dateLabel(iso)
}

export function dateLabel(iso) {
  // The four words, at least, in the reader's language — they were English on
  // every Russian and Uzbek screen, beside a month that was not.
  if (!iso) return tx('No date')
  const t = todayISO()
  if (iso === t) return tx('Today')
  if (iso === addDaysISO(t, 1)) return tx('Tomorrow')
  if (iso === addDaysISO(t, -1)) return tx('Yesterday')
  // NOT routed through fixMonth() yet, deliberately. Doing that fixes the
  // Uzbek month here and in the eighteen other files that share this
  // formatter, which is a change that belongs in the sweep that also fixes
  // the twenty places formatting a month on their own — not in a pull
  // request about projects. Until then a date still reads "M09 30" in Uzbek.
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
}

// Distinct solid colors for departments — the admin overview and timeline
// paint each channel in its own color, in sidebar order.
export const DEPT_PALETTE = [
  '#A22036', '#2a78d6', '#0e8a6d', '#7c5cd6', '#f2a413',
  '#CB3351', '#00838f', '#5d4037', '#455a64', '#7cb342',
]
export const deptColor = (i) => DEPT_PALETTE[((i % DEPT_PALETTE.length) + DEPT_PALETTE.length) % DEPT_PALETTE.length]

// Readable text color on a solid colored chip: dark on light fills, white
// on dark fills — so stage colors stay distinctive without transparency.
export function onColor(hex = '') {
  const n = String(hex).replace('#', '')
  if (n.length < 6) return '#fff'
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 168 ? '#26222b' : '#fff'
}

export function initials(name = '') {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('')
}

// ---- what counts as an answer ----------------------------------------------
// The form asks these BEFORE the save so the message lands next to the field
// rather than arriving as a refusal. The rules themselves live in one place —
// lib/text.js, mirroring server/text.js — because "is this a link" and "is
// this a sentence" are two different questions and were being answered by the
// same blunt check. The server is still the one that decides.
export { readText, hasSubstance, hasLink, isSentence, isBareLink, MIN_SENTENCE_WORDS } from './text.js'

// Pravka 2.0: a piece is delivered at most three times — the first cut and
// one after each of at most two pravka rounds. The server holds the same
// number (PRAVKA_ROUNDS in routes/content.js) and refuses a third round.
export const PRAVKA_ROUNDS = 2

// What a piece on a WRITTEN (Telegram) channel is, for the copywriter's
// per-item rates. The server holds the same three keys (TELEGRAM_TYPES in
// routes/content.js) and stores nothing for a task on no written channel.
export const TELEGRAM_TYPES = [
  { key: 'just_post', label: 'Just a post' },
  { key: 'post_plus', label: 'Post plus' },
  { key: 'webinar', label: 'Webinar' },
]
export const telegramTypeLabel = (key) => TELEGRAM_TYPES.find((t) => t.key === key)?.label || ''

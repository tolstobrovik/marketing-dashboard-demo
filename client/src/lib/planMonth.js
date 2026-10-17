import { locale } from './i18n.jsx'
import { reviewDue } from './due.js'

// ---- the month of the plan a piece belongs to ------------------------------------
//
// "Add colours for the tasks so the videos from the previous month will not
// mix up with things that should be posted" (the October survey). A piece
// belongs to the month it was planned to go out in: its release day, and for
// an idea with no day yet, the month it was made in. A piece still open from
// an earlier month is "carried over" — it keeps its month's colour wherever
// it is drawn (My Day, the board, the calendar) and stands apart from this
// month's work instead of sitting among it.
//
// This is a reading for the eye, not a rule: nothing on the server changes,
// and a carried-over piece is moved or closed the usual way.

export const planMonthOf = (t) => String(reviewDue(t) || t.release_date || t.created_at || '').slice(0, 7)

const done = (t) => !!t.done_at

// Open, and planned for a month before this one.
export const isCarried = (t, today) => {
  const m = planMonthOf(t)
  return !done(t) && /^\d{4}-\d{2}$/.test(m) && m < String(today).slice(0, 7)
}

// 'now' this month, 'prev' last month, 'old' before that, 'next' after.
export const monthTone = (ym, today) => {
  const cur = String(today).slice(0, 7)
  if (!ym || ym === cur) return 'now'
  if (ym > cur) return 'next'
  const d = new Date(`${cur}-15T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return ym === d.toISOString().slice(0, 7) ? 'prev' : 'old'
}

// "Sep", "Oct" — in the reader's language.
export const monthShortOf = (ym) => {
  if (!/^\d{4}-\d{2}$/.test(String(ym))) return ''
  return new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' }).replace('.', '')
}
// "September", "October".
export const monthLongOf = (ym) => {
  if (!/^\d{4}-\d{2}$/.test(String(ym))) return ''
  return new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(locale(), { month: 'long', timeZone: 'UTC' })
}

// The earliest month among the carried-over pieces, for "Carried over from …".
export const carriedFrom = (list, today, pick = (x) => x) => {
  const ms = list.map((x) => planMonthOf(pick(x))).filter((m) => m && m < String(today).slice(0, 7)).sort()
  return ms[ms.length - 1] || ''
}

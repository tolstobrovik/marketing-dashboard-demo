import { locale } from './i18n.jsx'
import { monthName } from './constants.js'

// Months, in the one place that knows how to count them.
//
// Four pages were each carrying their own copy of "what is the month before
// this one", and a month is exactly the kind of arithmetic that looks obvious
// and is not: December minus one is not month zero, and a month's last day is
// 28, 29, 30 or 31 depending on a question nobody wants to ask twice.
export const monthOf = (iso) => String(iso).slice(0, 7)

export const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const monthEdges = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

export const monthWords = (ym, opts = { month: 'long', year: 'numeric' }) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale(), { ...opts, timeZone: 'UTC' })

// A month and its year, named from the board's own book: "September 2026",
// "Sentabr 2026", "Сентябрь 2026". monthWords() asks the browser for the whole
// thing, and Chromium has no Latin-Uzbek month names — it answers "2026 M09"
// (constants.js has the story) — so the Statistics page, which prints a month
// into a file somebody keeps, says it this way instead.
export const monthLabel = (ym) =>
  `${monthName(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))} ${ym.slice(0, 4)}`

// One row of the server's month-by-month series, named — and, for the first
// or last month of a custom window, the days of it the row counts. The server
// cuts those two months to the window so that their numbers and the tiles
// agree, and a row that counts the 15th to the 31st is not "August": the one
// in a month-mode report of August is a different row. The chart's tooltip,
// the month bars, the table and the spreadsheet all name a row this one way.
export const monthRowLabel = (m) => {
  const e = monthEdges(m.month)
  const whole = !m.from || (m.from === e.from && m.to === e.to)
  return whole ? monthLabel(m.month) : `${monthLabel(m.month)} · ${Number(m.from.slice(8))}–${Number(m.to.slice(8))}`
}

// Short enough to sit under a bar: "Sep", and the year only where it changes.
export const monthTick = (ym, prev) =>
  (prev && prev.slice(0, 4) === ym.slice(0, 4)
    ? monthWords(ym, { month: 'short' })
    : monthWords(ym, { month: 'short', year: '2-digit' }))

// Standalone ON PURPOSE: this module imports nothing.
//
// The type mix on the Statistics page — the pie, its legend and the rows of
// the spreadsheet — is counted here, once, so the three can never disagree,
// and so qa/statsviz-suite.mjs can check the arithmetic from plain Node.
// constants.js reaches the phrase book and the icon set, neither of which
// Node can load, so the words for the types are handed in (`nameOf`) rather
// than looked up here.

// One order for the pie, its legend and the spreadsheet, so the three can be
// read against each other line by line. It is the pie's order, and the pie is
// a circle, so the order is chosen for the colours: they are the type chips'
// own, and two pairs of those — reel's blue and video's violet, target's
// green and other's grey — are one colour to a reader who cannot tell red
// from green. Each pair sits on opposite sides of the circle, three slices
// apart, and every pair of neighbours was checked to stay distinct (see the
// --viz-* tokens in styles.css). A type with nothing in the window leaves the
// circle, so the pairs only meet if two types in a row are empty.
export const TYPE_ORDER = ['reel', 'post', 'target', 'video', 'story', 'other']

// Each share rounded on its own adds up to 99 or 101, and a slice of one piece
// in three hundred prints "0%" beside a slice that is plainly there. Largest
// remainder makes the column add up to 100; a share too small to reach 1%
// says so. Any type the board does not know is 'other' here as it is on the
// server, so no piece falls out of the total.
export function typeMix(byType, nameOf = (k) => k) {
  const counts = {}
  for (const [k, n] of Object.entries(byType || {})) {
    const key = TYPE_ORDER.includes(k) ? k : 'other'
    counts[key] = (counts[key] || 0) + (Number(n) || 0)
  }
  const rows = TYPE_ORDER.filter((k) => counts[k] > 0).map((key) => ({ key, name: nameOf(key), value: counts[key] }))
  const total = rows.reduce((n, r) => n + r.value, 0)
  const exact = rows.map((r) => (total ? (r.value / total) * 100 : 0))
  const share = exact.map((x) => Math.floor(x))
  let left = total ? 100 - share.reduce((a, b) => a + b, 0) : 0
  // The points still to hand out go to the largest remainders; a tie goes to
  // the bigger slice, so the same counts always print the same column.
  const byRemainder = exact.map((x, i) => i)
    .sort((a, b) => ((exact[b] % 1) - (exact[a] % 1)) || (rows[b].value - rows[a].value))
  for (const i of byRemainder) { if (left <= 0) break; share[i] += 1; left -= 1 }
  return {
    total,
    rows: rows.map((r, i) => ({ ...r, share: share[i], pct: share[i] > 0 ? `${share[i]}%` : '<1%' })),
  }
}

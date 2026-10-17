// ---- the time band: who is free, and when --------------------------------------------
//
// October 2026. The owner chose how a shoot's time is picked — "let them drag
// to choose the time and the range; make each element 15 minutes" — one line
// across for the day, the operators as rows under it (components/TimeBand.jsx).
// What the band SAYS while a person drags — who is busy until when, the
// nearest free time, the other operator who is free then — is a reading of the
// operators' days, and a wrong reading is advice that is wrong. So it lives
// here, in one plain module with no React and no phrase book in it, and
// qa/schedule-suite.mjs pins it on a worked day.
//
// It is advice and nothing more. The days come from /users/:id/slots — the
// same answer the week grid and the day strip read — and whether a booking
// clashes is still decided by the server when it is saved (shootProblems in
// server/routes/content.js). Nothing here is a rule.
//
// Times are minutes from midnight. `ctx` is { lo, hi, today, now }: the ends
// of the band, the team's day and the team's minute (Tashkent).

export const Q = 15   // the owner's "each element 15 minutes"
export const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5))
export const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const snap = (m) => Math.round(m / Q) * Q

// An hour typed by hand: "14", "930", "14.15", "14:15" — rounded to the
// quarter. Anything that is not an hour is null, and the field shows the
// chosen time again.
export function typed(s) {
  const m = /^\s*(\d{1,2})[:.\s]?(\d{2})?\s*$/.exec(String(s ?? ''))
  const v = m ? Number(m[1]) * 60 + Number(m[2] || 0) : -1
  return v >= 0 && v <= 24 * 60 ? snap(v) : null
}

// Every stretch of one operator's day that cannot be asked for, and why.
// `answer` is what /users/:id/slots said about them. A day it does not cover
// is a day nothing is known about: no stretches, and so no advice.
//   off    not their working day (`all`), or outside their hours — only when
//          hours are set on the account: the server warns about nothing else
//   past   gone by on the team's clock; the quarter under way counts as gone
//   study  their repeating week (lectures, a second job)
//   rec    a shoot they already hold — `r` is the server's busy item
export function taken(answer, day, { lo, hi, today, now }) {
  const cal = answer?.calendar?.find((c) => c.day === day)
  if (!cal) return []
  if (!cal.working) return [{ a: lo, b: hi, kind: 'off', all: true }]
  const out = []
  if (answer.hours) {
    const from = toMin(answer.hours.from), to = toMin(answer.hours.to)
    if (from > lo) out.push({ a: lo, b: from, kind: 'off' })
    if (to < hi) out.push({ a: to, b: hi, kind: 'off' })
  }
  if (day < today) out.push({ a: lo, b: hi, kind: 'past' })
  else if (day === today && now > lo) out.push({ a: lo, b: Math.min(hi, Math.ceil(now / Q) * Q), kind: 'past' })
  for (const s of cal.study || []) out.push({ a: toMin(s.from), b: toMin(s.to), kind: 'study' })
  for (const r of cal.busy || []) out.push({ a: toMin(r.from), b: toMin(r.to), kind: 'rec', r })
  return out
}

// What is in the way of a..b in one operator's day: one reason, the most
// final first. null — nothing known to be in the way.
export function clash(stretches, a, b) {
  const hit = (kind) => (stretches || []).find((x) => x.kind === kind && a < x.b && b > x.a)
  return hit('past') || hit('off') || hit('study') || hit('rec') || null
}

// The free start closest to the one asked for, that day; else the first free
// one on the days after — the same hours first, then from the morning.
// `days` is one operator's { [day]: stretches }.
export function nearest(days, day, a, len, { lo, hi }) {
  const free = (d, s) => s >= lo && s + len <= hi && !clash(days[d], s, s + len)
  if (!days?.[day]) return null
  for (let k = 1; k < (hi - lo) / Q; k++) for (const s of [a + k * Q, a - k * Q]) if (free(day, s)) return { day, a: s }
  for (const d of Object.keys(days).sort()) {
    if (d <= day) continue
    if (free(d, a)) return { day: d, a }
    for (let s = lo; s + len <= hi; s += Q) if (free(d, s)) return { day: d, a: s }
  }
  return null
}

// Who films: the operator the person pressed, or else the first one who is
// free then. `week` is { [operatorId]: { [day]: stretches } }.
export function whoFilms(ops, week, day, a, b, pressed = null) {
  if (a == null || pressed != null) return pressed
  return ops.find((o) => !clash(week[o.id]?.[day], a, b))?.id ?? null
}

// May it be asked for, and if not: what is in the way and what to offer.
//   { empty }             nothing chosen yet
//   { ok }                free — `ok` is who films (null when no operators are given)
//   { why, offers }       `who` is busy: why = [{ op, c }], offers = their
//                         nearest free time, and the other operator who is
//                         free at the time asked for (`same`)
//   { why, offers, off }  nobody is free: everybody's reason, the two nearest
//                         times; `off` — nobody films that day at all
export function verdict(ops, week, day, a, b, who, ctx) {
  if (a == null) return { empty: true }
  if (!ops.length) return { ok: null }
  const len = b - a
  const at = (id) => clash(week[id]?.[day], a, b)
  const near = (id) => { const f = nearest(week[id], day, a, len, ctx); return f && { ...f, op: id, len } }
  if (who != null) {
    const c = at(who)
    if (!c) return { ok: who }
    const other = ops.find((o) => o.id !== who && !at(o.id))
    return { why: [{ op: who, c }], offers: [near(who), other && { op: other.id, day, a, len, same: true }].filter(Boolean) }
  }
  const offers = ops.map((o) => near(o.id)).filter(Boolean)
    .sort((x, y) => x.day.localeCompare(y.day) || Math.abs(x.a - a) - Math.abs(y.a - a)).slice(0, 2)
  return { why: ops.map((o) => ({ op: o.id, c: at(o.id) })), offers, off: ops.every((o) => week[o.id]?.[day]?.[0]?.all) }
}

// The client and the server must agree about when a deadline is.
//
// A handover that lands late re-promises the next stage's day. The original
// stays on the task, the agreed day is written beside it, and from then on the
// agreed day IS the deadline. The server always read the pair that way —
// deadlines.js, `const due = revised || promised` — and decides lateness, the
// warnings, the missed list and the pay run from it.
//
// The client read only the first of the pair. Not one file under client/src
// mentioned edit_due_revised or review_due_revised. So an editor handed work
// late and given a new day they had agreed to still saw the OLD day on their
// desk — My Day, Post Production, Missed, the task's own Logistics tab — and
// was drawn as late against it, while the server was quietly working to the
// new one. Two halves of one app disagreeing about the same deadline, with
// the crew reading the wrong half.
//
// So this suite does not describe what the client should say. It asks both
// halves the same question and requires the same answer, which is the only
// thing that stops them drifting apart again the next time either is edited.
//
// Pure Node: imports both modules directly, no server, no browser, no data
// directory. Runs in milliseconds, anywhere — which is also why it can sit in
// the checks job without costing it anything.
import { pathToFileURL } from 'node:url'

// DASHB_ROOT when set (CI, which runs the suites from a
// scratch copy where a relative path would point at nothing); otherwise the
// checkout this file lives in. A file URL either way, because a bare Windows
// path is not something import() accepts.
const ROOT = process.env.DASHB_ROOT
  ? pathToFileURL(process.env.DASHB_ROOT.replace(/[\\/]?$/, '/'))
  : new URL('../', import.meta.url)
const from = (p) => new URL(p, ROOT).href

const { phaseState } = await import(from('server/deadlines.js'))
const { editDue, reviewDue, nextDue, dueKind } = await import(from('client/src/lib/due.js'))

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const TODAY = '2026-09-15'
const d = (n) => { const t = new Date(`${TODAY}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }

// ===================== both halves, one answer =====================
// Every shape a pair of days can take, including the ones that look like they
// should not happen — a revised day with no original, a revision EARLIER than
// the promise. Whatever the server makes of them, the client must make the same.
const shapes = [
  ['no days at all', {}],
  ['only the promise', { edit_ready_date: d(2), release_date: d(6) }],
  ['only a revision', { edit_due_revised: d(3), review_due_revised: d(7) }],
  ['a revision later than the promise', { edit_ready_date: d(-2), edit_due_revised: d(3), release_date: d(4), review_due_revised: d(8) }],
  ['a revision earlier than the promise', { edit_ready_date: d(5), edit_due_revised: d(1), release_date: d(9), review_due_revised: d(6) }],
  ['a revision on the same day', { edit_ready_date: d(2), edit_due_revised: d(2), release_date: d(5), review_due_revised: d(5) }],
]
for (const [name, t] of shapes) {
  const srvEdit = phaseState(t, 'edit', TODAY).due ?? null
  const srvReview = phaseState(t, 'review', TODAY).due ?? null
  ok(`the cut's deadline agrees — ${name}`, editDue(t) === srvEdit, `client ${editDue(t)} · server ${srvEdit}`)
  ok(`the review's deadline agrees — ${name}`, reviewDue(t) === srvReview, `client ${reviewDue(t)} · server ${srvReview}`)
}

// ===================== the case from the desk =====================
// Filmed, then handed to the editor two days after their deadline. They agreed
// to a new day, three days out. This is the task that was drawn as late.
const handedLate = {
  recording_date: d(-6), shot_at: `${d(-4)}T09:00:00Z`,
  edit_ready_date: d(-2), edit_due_revised: d(3),
  release_date: d(7),
}
ok('the original is NOT the day the server counts — which is why reading it was wrong',
  phaseState(handedLate, 'edit', TODAY).due !== handedLate.edit_ready_date,
  `server ${phaseState(handedLate, 'edit', TODAY).due} · original ${handedLate.edit_ready_date}`)
ok('the editor\'s desk now waits on the agreed day',
  nextDue(handedLate, TODAY) === d(3), `${nextDue(handedLate, TODAY)} — agreed ${d(3)}, original ${d(-2)}`)
ok('…so it is not drawn as late', nextDue(handedLate, TODAY) >= TODAY, `${nextDue(handedLate, TODAY)} vs ${TODAY}`)
ok('…and the server does not call it late either — the two halves say the same thing',
  phaseState(handedLate, 'edit', TODAY).state !== 'late', String(phaseState(handedLate, 'edit', TODAY).state))
ok('…and the board still knows it is the CUT that is due', dueKind(handedLate, nextDue(handedLate, TODAY)) === 'edit',
  String(dueKind(handedLate, nextDue(handedLate, TODAY))))

// A re-promise that has itself been missed is late, and late against the
// re-promise — not a day earlier, when the original went by.
const missedAgain = { ...handedLate, edit_due_revised: d(-1) }
ok('a missed re-promise is still late', nextDue(missedAgain, TODAY) < TODAY, String(nextDue(missedAgain, TODAY)))
ok('…late against the day that was agreed, not the one before it',
  nextDue(missedAgain, TODAY) === d(-1), `${nextDue(missedAgain, TODAY)} — agreed ${d(-1)}, original ${d(-2)}`)

// The review re-promise reaches the fallback too: a task whose cut is in,
// waiting on a review that was handed over late.
const reviewLate = { shot_at: 'x', ready_at: 'y', release_date: d(-1), review_due_revised: d(2) }
ok('a re-promised review is the day a finished cut waits on', nextDue(reviewLate, TODAY) === d(2), String(nextDue(reviewLate, TODAY)))

// ===================== nothing that already worked has moved =====================
// The contract qa/duedate-suite.mjs pins, re-asked here because that suite
// drives a browser and does not run in the checks job. None of these carry a
// revision, so every one of them must read exactly as it did before.
const booked = { recording_date: d(2), edit_ready_date: d(4), release_date: d(7) }
ok('a booked shoot still waits on its SHOOT day', nextDue(booked, TODAY) === d(2), String(nextDue(booked, TODAY)))
ok('…a shot one on its cut', nextDue({ ...booked, shot_at: 'x' }, TODAY) === d(4), String(nextDue({ ...booked, shot_at: 'x' }, TODAY)))
ok('…a cut one on its release', nextDue({ ...booked, shot_at: 'x', ready_at: 'y' }, TODAY) === d(7))
ok('a missed shoot is still what a task is late against',
  nextDue({ recording_date: d(-3), edit_ready_date: d(-1), release_date: d(7) }, TODAY) === d(-3))
ok('no days is still no deadline', nextDue({}, TODAY) === null)
ok('no task is still no deadline, and no throw', nextDue(null, TODAY) === null && editDue(null) === null && reviewDue(undefined) === null)

console.log(fails === 0 ? '\n✔ duesync suite passed' : `\n✘ duesync suite: ${fails} failed`)
process.exit(fails ? 1 : 0)

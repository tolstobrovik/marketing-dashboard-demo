import { editDue, reviewDue, nextDue } from './due.js'

// ---- the Coach look: what to do first, and whose step it is --------------------
//
// October 2026. The first simple look was one list and one button a row, and
// the owner's verdict on it was that it was "too simple and not even guiding":
// a flat list tells a new person WHAT is theirs and nothing about where to
// start, what happens when they press, or who is waiting. The Coach look
// answers those on the page itself:
//
//   one big card — Start here — with the task to do first and why it is first
//   the list under it numbered in the order to do it
//   a maker's pieces in five groups, most pressing first
//   a window that opens on "what to do, step by step" and "your step now"
//
// Every one of those is a READING of the day: which task is first, which group
// a piece belongs to, whose step it is. A wrong reading is guidance that is
// wrong — a big card pointing at a cut whose footage has not arrived — so the
// reading lives here, in one plain module with no React and no phrase book in
// it, and qa/coach-suite.mjs pins it on a worked day.
//
// Nothing here decides what the server decides. "Late", "handed in" and "may
// publish" are read the way the rest of the board reads them (lib/due.js,
// lib/nextStep.js, and the crew's page as it has always counted its work);
// whether a move is allowed is still asked of the server by the button
// (components/NextStep.jsx, components/HandIn.jsx).

// Read the way lib/constants.js reads it. Kept here rather than imported so
// this file loads under plain Node, like lib/nextStep.js and lib/due.js.
const isDeletedLabel = (label) => /^deleted$/i.test(label || '')
const tashkentFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
// The team's calendar day of a stamp — "done today" is Tashkent's today.
export const dayOf = (iso) => (iso ? tashkentFmt.format(new Date(iso)) : null)
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5)
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The three jobs a person can hold on a piece: the seat on the task, the word
// the server uses for it (a pravka's `target`, a row's `open_for`), the kind of
// work it is on these pages, and the box its delivery goes in.
export const HATS = [
  { seat: 'operator_id', name: 'operator', kind: 'shoot', link: 'shot_link' },
  { seat: 'editor_id', name: 'editor', kind: 'edit', link: 'ready_link' },
  { seat: 'designer_id', name: 'designer', kind: 'design', link: 'design_link' },
]
const KIND_OF = { operator: 'shoot', editor: 'edit', designer: 'design' }

// Is the job behind them? The test the crew's page has always used: a shoot is
// done once the piece has moved past filming, a cut or artwork once it reached
// Ready or went out. Read off the stage's own label, because stages are the
// admin's data.
const shootDone = (t, label) => !!t.done_at || !!t.ready_at || !!t.shot_at || /shot|edit|ready|publish|post|got/i.test(label)
// `ready_at` is the clock of the FIRST delivery: the server stamps it once and
// keeps it when the card moves back (server/routes/content.js, "the handover
// clocks"). So on the making stage it says "handed in" only while a change
// round is open — that is the server sending the piece back for one seat, and
// the other seat's work is still done. With no round open the piece was simply
// put back (dragged, re-shot, given a new editor) and is work to do again; read
// as done it left its editor's day for good (13 October 2026).
const MAKING = /editing|montaj/i   // the making stage, as GATE.edit names it in lib/nextStep.js
export const putBack = (t, label) => !!t.ready_at && !t.done_at && !t.open_round && MAKING.test(label)
// The stage a piece is put back on is the edit's where somebody edits it: the
// artwork of a reel is asked again through a change round, not by moving the
// card. Reopened for both, a designer who had been asked nothing got "Start
// here" and could send the piece on unchanged (the review, 13 October 2026).
// A piece nobody edits is the designer's to do again.
//
// A reel's cover is its own job beside the edit: done when it is handed in (its
// link), not when the cut put the reel on Ready — read off the stage, a cover
// nobody had drawn left the designer's list the moment the edit came in (the
// bug hunt, 14 Oct 2026).
export const makeDone = (t, label, seat = 'editor') => (seat === 'designer' && t.editor_id
  ? !!t.done_at || !!t.design_link
  : !!t.done_at || /ready|publish|post|approv|got/i.test(label) || (!!t.ready_at && !putBack(t, label)))
// Whose piece it is: the people who run it (one, or the two an admin named).
export const ownersOf = (t) => (t.assignees?.length ? t.assignees : [t.assignee_id]).filter(Boolean)

// Where the idea ends: the first stage at which somebody other than the piece's
// owner has work to do. Before it the piece is still being planned — the maker
// has not pressed "Send to the shoot" or "Send to the designer" — and a job on
// it has NOT BEEN GIVEN yet, whatever seat is already filled in. (The first
// Coach draft numbered such a piece on the designer's list, and could make it
// "Start here", while the maker's page said of the same piece that the crew
// could not start until the maker's words were in. Two pages, two opposite
// instructions. One reading now, used by both and by wayOf below.)
export const ideaEndOf = (pipe) => (pipe.shoot >= 0 ? pipe.shoot : pipe.edit >= 0 ? pipe.edit : 1)
const givenAt = (t, pipe) => {
  if (!pipe) return true
  const at = pipe.live.findIndex((s) => s.id === t.status_id)
  return at < 0 || at >= ideaEndOf(pipe)
}
// A yes to "can you make it?" does not change that (the owner's call, Oct
// 2026): the board asks the moment a seat and a day are set, whatever stage
// the piece is on, but the job is the crew's only once its maker has pressed
// "Send". Until then both pages say the same thing — "Not sent to you yet"
// here, "Not sent to the shoot yet" on the maker's.
// A booking the person said NO to and still holds the seat
// of (a no that hands the seat back empties it, and the piece leaves their
// list). They told the maker they cannot make it; until the maker moves the
// day or names somebody else, it is the maker's step, at ANY stage — the
// commonest case is a piece already sent to the shoot. (Before this the no was
// read nowhere on the crew's side: the shoot a man had just declined stayed a
// numbered task with its hour, "Shoot is done" awake, and could be "Start
// here" — while the maker's page said of the same piece "Otabek can’t come".)
const saidNo = (t, kind) => (kind === 'shoot' ? t.shoot_ack === 'no' : kind === 'edit' ? t.edit_ack === 'no' : false)
// Until when a change that was sent back is being fixed. The server keeps no
// deadline for a fix, so this is the next day the piece is still promised for:
// the seat's own day while that is ahead, else the day it goes out — and
// nothing once both are behind. NEVER a day already gone: a change is asked
// after the delivery, so the seat's day has usually passed by then, and
// "until Wed 30 Sep" read on 3 Oct tells nobody anything. One reading for the
// crew's row, the maker's row and the window, so the three name the same day.
export const fixUntil = (t, seat, today) => [
  seat === 'designer' ? t.design_ready_date : seat === 'operator' ? t.recording_date : editDue(t),
  reviewDue(t),
].find((d) => d && d >= today) || null

// ---- the crew's day ----------------------------------------------------------------
//
// One entry per job a person holds — somebody who films and cuts the same reel
// has two, and can be late on one and not the other. A killed piece leaves the
// list. `doneDay` is the day the job was handed over, where a stamp says so.
// `given` is whether the piece has left the idea (see ideaEndOf) — it needs the
// board's stages (`pipe`); without them every job counts as given, which is how
// the previous look, which makes no such promise, reads it.
export function crewEntries(content, userId, statusesById, pipe = null) {
  const out = []
  for (const t of content) {
    const label = statusesById[t.status_id]?.label || ''
    if (isDeletedLabel(label)) continue
    const past = givenAt(t, pipe)
    if (t.operator_id === userId) {
      out.push({ t, kind: 'shoot', due: t.recording_date || null, done: shootDone(t, label), filmed: true, given: past, declined: saidNo(t, 'shoot'), doneDay: dayOf(t.shot_at) })
    }
    if (t.editor_id === userId) {
      out.push({
        t, kind: 'edit', due: editDue(t) || reviewDue(t) || null, done: makeDone(t, label), again: putBack(t, label),
        // Can the cut start? Either the footage link is there, or the piece has
        // visibly left the shoot — footage on a hard drive is still footage.
        filmed: !!t.shot_link || shootDone(t, label), given: past, declined: saidNo(t, 'edit'),
        doneDay: dayOf(t.edited_at || t.ready_at),
      })
    }
    if (t.designer_id === userId) {
      out.push({ t, kind: 'design', due: t.design_ready_date || reviewDue(t) || null, done: makeDone(t, label, 'designer'), again: putBack(t, label) && !t.editor_id, filmed: true, given: past, doneDay: dayOf(t.ready_at || t.edited_at) })
    }
  }
  return out
}

// The day, in the order to do it.
//
//   entries  crewEntries()
//   asks     bookings waiting on this person's yes or no: [{ t, which }]
//   fixes    changes sent back to them (GET /content/revisions/mine)
//
// → rows   one per job, each with its band (late · today · soon · done), its
//          state, and `n`: its number in the order to do it, or null when it
//          cannot be done yet
//   first  the row numbered 1 — the big card
//   held   what is late and cannot be started: { n, why: 'blocked' | 'early' |
//          'mixed' }, or null. The big card's "why this one first" needs it —
//          "nothing is late" is false when the late row is waiting for footage.
//
// The order is the page's whole argument, so it is one rule: the bands top to
// bottom; inside a band a change somebody sent back, then an answer somebody
// is waiting for (each is one person kept waiting), then the work by its day
// and, for a shoot, its hour. What cannot be started yet — a piece its maker
// is still planning ('early'), a cut with no footage ('blocked'), a shoot on a
// day still ahead ('wait'), a booking they said no to ('declined' — the maker
// answers that) — keeps its place in the list and gets no number,
// so "Start here" is never a task that cannot be started. A booking question
// and a change sent back are answered whatever stage the piece is on: each is
// somebody waiting, and the server takes the answer.
//
// A change sent back is NOT late by the job's own day. That day is the day of
// the delivery the change follows — usually already met, and usually already
// past when the change is asked. Counting from it called a cut handed in on
// time "3 days late" the moment its maker asked for a change, while the task
// window (rightly) showed no lateness. A fix is for today, first in its band,
// and its day is fixUntil: the next day the piece is still promised for.
export function crewDay({ entries, today, asks = [], fixes = [] }) {
  const askOf = new Map(asks.map((a) => [`${a.t.id}:${a.which}`, a]))
  const fixOf = new Map(fixes.map((r) => [`${r.content_id}:${KIND_OF[r.target] || 'edit'}`, r]))
  const open = (e, key, ask, fix) => {
    if (fix) return { key, t: e.t, kind: e.kind, due: fixUntil(e.t, fix.target || 'editor', today), band: 'today', state: 'fix', ask: null, fix, late: 0, n: null }
    // A piece put back with no round (`again`) is read the way a fix is: not
    // late by the day of the delivery it already met, its day the next one
    // still promised — today when none is — and first in its band.
    const due = e.again ? (fixUntil(e.t, e.kind === 'design' ? 'designer' : 'editor', today) || today) : e.due
    const g = !due ? 'none' : due < today ? 'late' : due === today ? 'today' : 'later'
    // What is needed today — an answer, a fix — is under Today, whatever day
    // the work itself is due. A job with no day at all is its own band, "No
    // day yet" (the owner, 23 Oct 2026: an editor named on a piece nobody
    // gave a day to found it nowhere on his screen) — never hidden under
    // "Coming up" as if it had a day.
    const band = g === 'late' ? 'late' : g === 'today' || ask ? 'today' : g === 'none' ? 'none' : 'soon'
    const can = e.kind === 'shoot' ? (!!e.due && e.due <= today) : e.filmed
    const state = ask ? 'ask' : e.declined ? 'declined' : e.given === false ? 'early' : can ? 'go' : e.kind === 'shoot' ? 'wait' : 'blocked'
    return { key, t: e.t, kind: e.kind, due, band, state, ask, fix, late: g === 'late' ? daysBetween(due, today) : 0, again: !!e.again, n: null }
  }
  const rows = []
  const seen = new Set()
  for (const e of entries) {
    const key = `${e.t.id}:${e.kind}`
    const fix = fixOf.get(key) || null
    seen.add(key)
    // A piece with changes asked of you is yours again, though by its stamps
    // the job was handed in.
    if (e.done && !fix) {
      if (e.doneDay === today) rows.push({ key, t: e.t, kind: e.kind, due: e.due, band: 'done', state: 'done', ask: null, fix: null, late: 0, n: null })
      continue
    }
    rows.push(open(e, key, askOf.get(key) || null, fix))
  }
  // A change on a piece that is not in this person's list at all (the seat was
  // handed on, the list has not caught up) still needs them: a row of its own.
  for (const [key, r] of fixOf) {
    if (seen.has(key)) continue
    rows.push(open({ t: { id: r.content_id, title: r.title, channels: r.channels || [], type: r.type, recording_date: r.recording_date, edit_ready_date: r.edit_ready_date, design_ready_date: r.design_ready_date, release_date: r.release_date, edit_due_revised: r.edit_due_revised, review_due_revised: r.review_due_revised }, kind: KIND_OF[r.target] || 'edit', due: null, filmed: true }, key, null, r))
  }
  const BAND = { late: 0, today: 1, soon: 2, none: 3, done: 4 }
  const WEIGHT = { fix: 0, ask: 1 }
  const acts = (r) => r.state === 'fix' || r.state === 'ask' || r.state === 'go'
  const hour = (r) => (r.kind === 'shoot' && r.t.recording_time) || '99'
  rows.sort((a, b) => BAND[a.band] - BAND[b.band]
    || (WEIGHT[a.state] ?? (a.again ? 0 : 2)) - (WEIGHT[b.state] ?? (b.again ? 0 : 2))
    || (a.due || '9999').localeCompare(b.due || '9999')
    || hour(a).localeCompare(hour(b))
    || Number(acts(b)) - Number(acts(a))
    || String(a.t.title || '').localeCompare(String(b.t.title || '')))
  let n = 0
  for (const r of rows) if (acts(r)) r.n = ++n
  const count = (band) => rows.filter((r) => r.band === band).length
  const counts = { late: count('late'), today: count('today'), soon: count('soon'), none: count('none'), done: count('done') }
  const stuck = rows.filter((r) => r.band === 'late' && !r.n)
  const held = stuck.length ? { n: stuck.length, why: stuck.every((r) => r.state === stuck[0].state) ? stuck[0].state : 'mixed' } : null
  return { rows, first: rows.find((r) => r.n === 1) || null, held, counts, total: counts.late + counts.today + counts.done }
}

// ---- your step now ------------------------------------------------------------------
//
// What the task window offers THIS person on THIS piece. One answer, in the
// order a person would ask it: is one of the jobs on it mine and still open?
// Then that job. Otherwise, as whoever runs the piece: is there a delivery to
// answer, is it being fixed, is the next step mine, or whose is it.
//
//   step       the piece's next step for this person (lib/nextStep.js)
//   rounds     how many pravka rounds the piece has had
//   maxRounds  the limit the server holds (PRAVKA_ROUNDS)
//   canReview  whether this person may accept a delivery on this piece
//   prefer     the job the row they pressed was about, for a person with two
//
// → { kind: 'fix' | 'ask' | 'declined' | 'handin' | 'notyet' | 'blocked' | 'early', hat }   a job of theirs
//   ('early': the piece is still an idea — its owner has not sent it on yet;
//    'declined': they said they cannot make it, and its owner has not answered)
//   { kind: 'check', what, maker }       a cut or artwork came in: accept, or ask for changes
//   { kind: 'fixing', holder, round }    changes were asked; somebody is fixing them
//   { kind: 'ownfix', round }            changes were asked of the piece's owner — them
//   { kind: 'move' | 'publish', to, verb }   their step: the button
//   { kind: 'waiting', wait, holder }    somebody else's step
//   { kind: 'out' } · { kind: 'none' }   it went out · nothing to press
//
// `didMine` rides along when they held a job on it that is done: "you did your
// part" is worth saying before "it is with Jasmina now".
export function actOf(t, { userId, pipe, step = null, today, rounds = 0, maxRounds = 2, canReview = false, prefer = null }) {
  const at = pipe.live.findIndex((s) => s.id === t.status_id)
  // Killed, or on a stage the board no longer has: nothing to press.
  if (at < 0) return { kind: 'none' }
  if (t.done_at) return { kind: 'out' }
  const label = pipe.live[at].label || ''

  const mine = HATS.filter((h) => t[h.seat] === userId)
  const fixing = (h) => !!t.open_round && t.open_for === h.name
  const isOpen = (h) => fixing(h) || !(h.kind === 'shoot' ? shootDone(t, label) : makeDone(t, label, h.name))
  const open = mine.find((h) => h.kind === prefer && isOpen(h)) || mine.find(isOpen) || null
  // Still an idea: the job has not been given. For the person who can send
  // the piece on, that — not the job — is their step, so the seat is passed
  // over and the reading below offers the move.
  const early = at < ideaEndOf(pipe)
  const hat = open && early && !fixing(open) && step?.to ? null : open
  if (hat) {
    if (fixing(hat)) return { kind: 'fix', hat, round: t.open_round }
    // A booking that is still a question, asked of them — only for days still
    // ahead, and for an edit only where the server books one (edit_ready_date).
    if (hat.kind === 'shoot' && !t.shoot_ack && t.recording_date && t.recording_date >= today) return { kind: 'ask', which: 'shoot', hat }
    if (hat.kind === 'edit' && !t.edit_ack && t.edit_ready_date && (editDue(t) || '') >= today) return { kind: 'ask', which: 'edit', hat }
    if (saidNo(t, hat.kind)) return { kind: 'declined', which: hat.kind, hat, holder: ownersOf(t)[0] || null }
    if (early) return { kind: 'early', hat, holder: ownersOf(t)[0] || null }
    const due = hat.kind === 'shoot' ? t.recording_date : null
    const footage = !!t.shot_link || shootDone(t, label)
    if (hat.kind === 'shoot') return { kind: due && due <= today ? 'handin' : 'notyet', hat }
    return { kind: hat.kind === 'edit' && !footage ? 'blocked' : 'handin', hat }
  }
  // A job of theirs that is behind them — not one passed over just above.
  const didMine = mine.length > 0 && !open

  // A delivery waiting for an answer. The third delivery is approved as it
  // stands (Pravka 2.0), so past the limit there is nothing left to ask.
  const atReview = pipe.review >= 0 && at >= pipe.review
  const what = t.ready_link ? 'cut' : t.design_link ? 'artwork' : null
  // A delivery nobody else made — the owner's own fix of a written post — is not
  // hers to check: it goes on to publishing (the bug hunt, 14 Oct 2026).
  const maker = (what === 'cut' ? t.editor_id : t.designer_id) || null
  if (atReview && what && !t.approved_at && rounds < maxRounds && canReview && (maker || !ownersOf(t).includes(userId))) {
    return { kind: 'check', what, maker, didMine }
  }
  // Changes asked for and not yet handed in. A seat nobody holds — every
  // written post — falls to the piece's owners, as the server files it.
  if (t.open_round) {
    const owners = ownersOf(t)
    const holder = t[`${t.open_for}_id`] || (owners.includes(userId) ? userId : owners[0]) || null
    return holder === userId ? { kind: 'ownfix', seat: t.open_for, round: t.open_round }
      : { kind: 'fixing', seat: t.open_for, holder, round: t.open_round, didMine }
  }
  if (step?.to) return { kind: step.verb === 'Publish' ? 'publish' : 'move', to: step.to, verb: step.verb, didMine }
  // An idea is its owner's; a finished piece with no reviewer named is checked
  // by whoever runs it — the same reading wayOf gives the stop.
  if (step?.wait) {
    // The making is whoever's seat is filled. nextStepOf waits for "artwork" on
    // every piece that is not filmed and looks only at the designer's seat; a
    // story or a text card cut by an editor then read "nobody is named to draw
    // it yet" with the editor's name on the task and the piece on his list.
    const wait = step.wait === 'artwork' && !t.designer_id && t.editor_id ? 'cut'
      : step.wait === 'cut' && !t.editor_id && t.designer_id ? 'artwork' : step.wait
    const who = wait === 'cut' ? t.editor_id : wait === 'artwork' ? t.designer_id : step.who
    return { kind: 'waiting', wait, holder: who || (wait === 'idea' || wait === 'review' ? ownersOf(t)[0] : null) || null, didMine }
  }
  return { kind: 'none', didMine }
}

// The kind of work an answer is about — for the icon and the colour a row and
// the window wear (KIND in components/CoachParts.jsx). A job of theirs is its
// own kind; a delivery is the kind that was delivered; a wait is the kind
// being waited for; an idea, a piece ready to go and a piece that is out are
// kinds of their own.
const WAIT_KIND = { shoot: 'shoot', cut: 'edit', artwork: 'design', review: 'send', idea: 'idea' }
export const kindOfAct = (act) => (act.hat ? act.hat.kind
  : act.kind === 'check' ? (act.what === 'cut' ? 'edit' : 'design')
    : act.kind === 'fixing' || act.kind === 'ownfix' ? (KIND_OF[act.seat] || 'edit')
      : act.kind === 'waiting' ? (WAIT_KIND[act.wait] || 'idea')
        : act.kind === 'publish' ? 'send' : act.kind === 'out' ? 'out' : 'idea')

// ---- the maker's day ---------------------------------------------------------------
//
// The owner's order, top to bottom, and a piece is in the FIRST group it fits:
//
//   film    being shot today — it happens at a set hour
//   check   pravka: a cut or artwork came in and waits for the maker's answer
//   fix     pravka: changes were asked for, and the crew is fixing them
//   late    past its day
//   move    needs something from the maker before it can go on
//   ready   finished: post it
//   plan    on time and in somebody else's hands — in the week and the calendar, in none of the five
//   nodate  the same, with no day at all: it would be on no week and no
//           calendar, so it is a group of its own on the page (23 Oct 2026)
//   out     went out
//
// → rows   each piece once, with its group, what the window would offer on it
//          (`act`), who has it (`holder`), the days it is late, and whether
//          the maker has something to press on it now (`actionable`)
//   first  the first piece they can act on, in that order — the big card
//   month  how many of this month's pieces are out
const GROUPS = ['film', 'check', 'fix', 'late', 'move', 'ready', 'nodate', 'plan', 'out']
const THEIRS = ['check', 'move', 'publish', 'ownfix', 'handin', 'ask', 'fix']
export function makerDay({ pieces, today, userId, pipe, stepOf, roundsOf = () => 0, maxRounds = 2, canReviewOf = () => false }) {
  const rows = []
  for (const t of pieces) {
    const at = pipe.live.findIndex((s) => s.id === t.status_id)
    if (at < 0) continue
    if (t.done_at) { rows.push({ t, group: 'out', act: { kind: 'out' }, holder: null, late: 0, state: '', actionable: false, due: dayOf(t.done_at) }); continue }
    const label = pipe.live[at].label || ''
    const act = actOf(t, { userId, pipe, step: stepOf(t), today, rounds: roundsOf(t), maxRounds, canReview: canReviewOf(t) })
    // The day it is waiting on. A piece past the shoot with no stamp has been
    // filmed, stamp or no stamp (the server reads it so) — without this a card
    // created in Editing was late against a shoot day that had long been met.
    const due = nextDue(shootDone(t, label) && !t.shot_at ? { ...t, shot_at: t.created_at || today } : t, today)
    // Being fixed: its day is the fix's (fixUntil), and it is late only when
    // no promised day is left — the day it was to go out has passed.
    const until = act.kind === 'fixing' ? fixUntil(t, act.seat, today) : null
    const late = act.kind === 'fixing' ? (!until && reviewDue(t) && reviewDue(t) < today ? daysBetween(reviewDue(t), today) : 0)
      : due && due < today ? daysBetween(due, today) : 0
    const filming = t.recording_date === today && !shootDone(t, label)
    const group = filming ? 'film'
      : act.kind === 'check' ? 'check'
        : act.kind === 'fixing' ? 'fix'
          : late ? 'late'
            : ['move', 'ownfix', 'handin', 'ask', 'fix'].includes(act.kind) ? 'move'
              : act.kind === 'publish' ? 'ready' : due ? 'plan' : 'nodate'
    // What the operator said, for a shoot today. On a piece still at Idea the
    // shoot is planned and not sent: that one is the maker's to send.
    // That holds whatever the operator answered: a yes on an unsent piece is
    // not a shoot on their page yet.
    const state = !filming ? '' : pipe.shoot >= 0 && at < pipe.shoot ? 'unsent'
      : t.shoot_ack === 'yes' ? 'coming' : t.shoot_ack === 'no' ? 'cant' : 'noanswer'
    rows.push({ t, group, act, holder: act.holder || act.maker || null, late, state, actionable: THEIRS.includes(act.kind), due, until })
  }
  const key = (r) => (r.group === 'film' ? (r.t.recording_time || '99')
    : r.group === 'late' || r.group === 'move' || r.group === 'plan' || r.group === 'nodate' ? (r.due || '9999')
      : r.group === 'fix' ? (r.until || '9999')
      : r.group === 'out' ? '' : (reviewDue(r.t) || '9999'))
  rows.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)
    || (a.group === 'out' ? String(b.t.done_at).localeCompare(String(a.t.done_at)) : key(a).localeCompare(key(b)))
    || String(a.t.title || '').localeCompare(String(b.t.title || '')))
  const ym = today.slice(0, 7)
  const inMonth = rows.filter((r) => String(r.t.done_at ? dayOf(r.t.done_at) : reviewDue(r.t) || '').startsWith(ym))
  return {
    rows,
    first: rows.find((r) => r.actionable) || null,
    month: { out: inMonth.filter((r) => r.group === 'out').length, total: inMonth.length },
  }
}

// ---- a day's shoots and releases -----------------------------------------------------
//
// What the week strip and the calendar draw on a day: a piece's shoot on its
// shoot day, and its release on the day it goes out — or went out, or was
// meant to and did not ('miss'). Shoots by the clock first.
export function dayEvents(pieces, day, today, pipe) {
  const out = []
  for (const t of pieces) {
    const at = pipe.live.findIndex((s) => s.id === t.status_id)
    if (at < 0) continue
    if (t.recording_date === day) out.push({ t, k: 'shoot', time: t.recording_time || '', filmed: shootDone(t, pipe.live[at].label || '') })
    const goes = t.done_at ? dayOf(t.done_at) : reviewDue(t)
    if (goes === day) out.push({ t, k: t.done_at ? 'out' : day < today ? 'miss' : 'rel', time: t.done_at ? '' : (t.release_time || '') })
  }
  return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
}

// A month as whole weeks, Monday first; a week around a day.
export function monthCells(month) {
  const first = new Date(`${month}-01T00:00:00Z`)
  const start = addDays(`${month}-01`, -((first.getUTCDay() + 6) % 7))
  const cells = []
  for (let i = 0; i < 42; i++) {
    const iso = addDays(start, i)
    if (i >= 28 && i % 7 === 0 && iso.slice(0, 7) !== month) break
    cells.push(iso)
  }
  return cells
}
export function weekCells(day) {
  const d = new Date(`${day}T00:00:00Z`)
  const start = addDays(day, -((d.getUTCDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

// The seat a move must fill: the stop the piece LANDS on, when nobody holds it.
// "Send to the shoot" with no operator, "Start the work" with no editor — the
// server takes both (its gates advise, they do not refuse), and the piece then
// sits on a stage with nobody to make it, on no crew member's list. So the
// move's form asks for that one name and the button waits for it
// (components/NextStep.jsx, `seat`). Only the landing stop: a stop the piece
// merely passes — the shoot, for a poster — is offered, not demanded. Which
// seat a stop is is wayOf's reading, so the form and "the way of this task"
// cannot disagree; where the piece is neither filmed nor designed by the
// admin's rules it is the editor's, which is what the server's handover asks.
// → 'operator_id' | 'editor_id' | 'designer_id' | null (somebody holds it, or
//   the stop is the owner's own: an idea, a written piece, the check, out)
export function seatAt(t, pipe, making, to) {
  const stop = wayOf(t, pipe, making).find((s) => s.id === to?.id)
  if (!stop || stop.who || stop.cls === 'skip') return null
  return stop.role === 'shoot' ? 'operator_id'
    : stop.role === 'edit' ? (making.designed && !making.filmed ? 'designer_id' : 'editor_id') : null
}

// ---- what is still to add --------------------------------------------------------------
//
// Footage can carry a filmed piece into editing before its maker has said what
// the edit is held against or when it goes out: the server holds a hand-in
// only for the ТЗ and the editor, and asks for the reference and the day to
// post of a person making that move (server/routes/content.js, `editGaps`).
// So a piece in editing can still be short of those two. This names them, by
// the fields the server's own wall names — so a screen asks the same question
// — for a quiet "2 to add". Never a block: the server takes them whenever
// they are given. Nothing before editing (the move will ask), nothing once it
// is out, nothing for a piece that is not filmed.
//
// `pipe` is the board's stages (pipelineOf): where editing starts is the
// admin's data. Without it there is no saying, and the answer is [].
// → [] | ['reference_text'] | ['release_date'] | ['reference_text', 'release_date']
export function addLater(t, making, pipe) {
  if (!making?.filmed || t.done_at || !pipe || pipe.edit < 0) return []
  if (pipe.live.findIndex((s) => s.id === t.status_id) < pipe.edit) return []
  const reference = String(t.reference_text || '').trim() || t.reference_links?.length || t.has_photo || t.media_count || t.media?.length
  return [!reference && 'reference_text', !t.release_date && 'release_date'].filter(Boolean)
}

// ---- the way of a task ----------------------------------------------------------------
//
// The stops between an idea and out, and who does each — so the window can
// say "Eldor edits the video" instead of naming a column. Read off the board's
// own stages (`pipe`), so a renamed or removed stage moves this with it; a
// stage this file cannot place is drawn with its name and nothing else.
//
// → [{ id, label, role, cls: 'done' | 'on' | 'skip' | '', who, verb }]
export function wayOf(t, pipe, making) {
  const at = pipe.live.findIndex((s) => s.id === t.status_id)
  const owner = ownersOf(t)[0] || null
  const ideaEnd = ideaEndOf(pipe)
  const stops = pipe.live.map((s, i) => {
    const role = i === pipe.final ? 'final' : i === pipe.shoot ? 'shoot' : i === pipe.edit ? 'edit' : i === pipe.review ? 'review' : i < ideaEnd ? 'idea' : 'other'
    // Nothing is filmed for a post or a written piece: the stop is on the
    // board, and this piece passes it by.
    const skip = role === 'shoot' && !making.filmed
    const cls = skip ? 'skip' : t.done_at || i < at ? 'done' : i === at ? 'on' : ''
    // A filmed piece still standing on the shoot with its footage in is held
    // for its ТЗ or its editor (lib/nextStep.js): the operator is done, and
    // whoever runs the piece has it.
    const who = role === 'idea' ? owner
      : role === 'shoot' ? (i === at && making.filmed && t.shot_at && !t.open_round ? owner : t.operator_id)
        : role === 'edit' ? (making.written ? owner : making.filmed ? t.editor_id : making.designed ? t.designer_id : t.editor_id || t.designer_id)
          : role === 'review' ? (t.reviewer_id || owner) : null
    const verb = role === 'idea' ? 'plan' : role === 'shoot' ? 'film'
      : role === 'edit' ? (making.written ? 'write' : making.filmed ? 'cut' : making.designed ? 'draw' : 'make')
        : role === 'review' ? 'check' : role === 'final' ? 'out' : ''
    return { id: s.id, label: s.label, role, cls, who: who || null, verb }
  })
  // A repost — TikTok, YouTube Shorts — arrives made, on Ready: its way is the
  // last look and out (format 'repost'), and the stops before Ready were the
  // source's, not its own.
  if (making.repost) return stops.filter((s) => s.role === 'review' || s.role === 'final')
  if (!making.written) return stops
  // A written piece — Telegram, X, Threads, LinkedIn — is planned, written and
  // out: three stops, the ones its channel page draws (WRITING_STAGES). The
  // shoot and the check are not stops it passes, so they are not drawn at all;
  // the making stop is called Writing, and a piece left standing on Ready is
  // still being written, as the channel page reads it.
  const onCheck = stops.some((s) => s.role === 'review' && s.cls === 'on')
  return stops.filter((s) => s.role !== 'shoot' && s.role !== 'review')
    .map((s) => (s.role === 'edit' ? { ...s, label: 'Writing', cls: onCheck ? 'on' : s.cls } : s))
}

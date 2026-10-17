// The Coach look: My Day for the crew and for content makers, the task window
// that slides in, and the maker's calendar.
//
// The look makes three promises a wrong reading would break in front of a new
// person on their first morning:
//
//   START HERE is the right task. The big card and the numbers under it are an
//   instruction — do this, then this. A card that names a cut whose footage
//   has not come in, or a list numbered in an order nobody would work in, is
//   worse than no guidance at all.
//
//   A PIECE SITS IN ONE GROUP. A maker's five groups are a priority order
//   (filming today, pravka, late, your move, ready to publish). A piece shown
//   twice is counted twice; a piece shown nowhere is lost.
//
//   THE BUTTON IS THE PERSON'S OWN STEP. What the window offers — hand in,
//   answer, accept, publish, or "not your step now" — is read off the same
//   stages the server reads, for the person looking.
//
// So the reading lives in one plain module (client/src/lib/coach.js), and this
// pins it on one worked day: Saturday 3 October 2026, one maker, an operator,
// an editor and a designer, thirteen pieces. The second half reads the pages
// from the source, the way crewday-suite does, for the promises a browser
// suite on CI does not exist to keep.
//
// Pure Node, no server and no data directory.
//
//   node qa/coach-suite.mjs
import { pathToFileURL } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.env.DASHB_ROOT || new URL('../', import.meta.url)
const ROOT = typeof DIR === 'string' ? pathToFileURL(DIR.replace(/[\\/]?$/, '/')) : DIR
const from = (p) => new URL(p, ROOT).href
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8')
const has = (p) => existsSync(new URL(p, ROOT))
const { pipelineOf, nextStepOf } = await import(from('client/src/lib/nextStep.js'))
const {
  crewEntries, crewDay, makerDay, actOf, dayEvents, wayOf, monthCells, weekCells, dayOf, fixUntil, seatAt,
} = await import(from('client/src/lib/coach.js'))

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

// ===================== one worked day =====================
const TODAY = '2026-10-03'
const STAGES = [
  { id: 1, label: 'Idea', sort: 1 }, { id: 2, label: 'To shoot', sort: 2 }, { id: 3, label: 'Editing', sort: 3 },
  { id: 4, label: 'Ready', sort: 4 }, { id: 5, label: 'Published', sort: 5, is_final: 1 }, { id: 6, label: 'Deleted', sort: 6 },
]
const byId = Object.fromEntries(STAGES.map((s) => [s.id, s]))
const pipe = pipelineOf(STAGES)
const JAS = 2, EDI = 5, OPA = 6, DES = 7
const piece = (id, title, more) => ({ id, title, channels: ['instagram_main'], type: 'reel', assignee_id: JAS, assignees: [JAS], ...more })
const P = [
  // Filmed today, and the operator said yes.
  piece(1, 'Open day teaser', { status_id: 2, operator_id: OPA, editor_id: EDI, recording_date: TODAY, recording_time: '11:00', recording_end: '11:40', shoot_ack: 'yes', edit_ready_date: '2026-10-05', release_date: '2026-10-07' }),
  // Filmed today, and nobody has answered yet.
  piece(2, 'Games and challenges', { status_id: 2, operator_id: OPA, editor_id: EDI, recording_date: TODAY, recording_time: '14:00', release_date: '2026-10-06' }),
  // A cut a week late: the footage is in, the editor has it.
  piece(3, 'Why I said no to Yonsei', { type: 'video', status_id: 3, operator_id: OPA, editor_id: EDI, shot_at: '2026-09-25T06:00:00.000Z', shot_link: 'https://drive.google.com/a', recording_date: '2026-09-25', edit_ready_date: '2026-09-26', release_date: '2026-10-01' }),
  // A cut handed in this morning, waiting for the maker's answer.
  piece(4, 'Student story: Aziza', { status_id: 4, editor_id: EDI, shot_at: '2026-09-30T06:00:00.000Z', ready_link: 'https://drive.google.com/b', ready_at: '2026-10-03T04:40:00.000Z', edited_at: '2026-10-03T04:40:00.000Z', edit_ready_date: '2026-10-03', release_date: '2026-10-08' }),
  // Artwork sent back: round 2, the designer is fixing it.
  piece(5, 'Five mistakes in the SAT essay', { type: 'post', status_id: 3, designer_id: DES, design_link: 'https://drive.google.com/c', ready_at: '2026-10-01T06:00:00.000Z', open_round: 2, open_for: 'designer', design_ready_date: '2026-10-05', release_date: '2026-10-07' }),
  // An idea the designer cannot start: the maker's words are missing.
  piece(6, 'Scholarship checklist', { type: 'post', status_id: 1, designer_id: DES, release_date: '2026-10-09' }),
  // Accepted yesterday: it only needs posting.
  piece(7, 'Campus tour: Webster', { status_id: 4, editor_id: EDI, shot_at: '2026-09-29T06:00:00.000Z', ready_link: 'https://drive.google.com/d', ready_at: '2026-10-02T06:00:00.000Z', approved_at: '2026-10-02T09:00:00.000Z', release_date: TODAY }),
  // A shoot next week.
  piece(8, 'A day in the life', { status_id: 2, operator_id: OPA, editor_id: EDI, recording_date: '2026-10-06', recording_time: '15:00', shoot_ack: 'yes', release_date: '2026-10-12' }),
  // Out on Thursday.
  piece(9, 'Scholarship deadline', { type: 'post', status_id: 5, done_at: '2026-10-01T07:00:00.000Z', ready_at: '2026-09-30T07:00:00.000Z', release_date: '2026-10-01' }),
  // Somebody else films it today; the editor's cut is due today too.
  piece(10, 'Open day teaser, part two', { status_id: 2, operator_id: 99, editor_id: EDI, recording_date: TODAY, recording_time: '12:00', edit_ready_date: TODAY, edit_ack: 'yes', release_date: '2026-10-05' }),
  // Killed. It is nobody's work any more.
  piece(11, 'Killed after the shoot was booked', { status_id: 6, operator_id: OPA, editor_id: EDI, recording_date: TODAY, release_date: '2026-10-07' }),
  // A shoot five days late.
  piece(12, 'AP interview', { status_id: 2, operator_id: OPA, recording_date: '2026-09-28', recording_time: '10:00', shoot_ack: 'yes' }),
  // A cut due today, footage in.
  piece(13, 'SAT math trick', { status_id: 3, editor_id: EDI, shot_at: '2026-10-02T06:00:00.000Z', shot_link: 'https://drive.google.com/e', edit_ready_date: TODAY, edit_ack: 'yes', release_date: '2026-10-04' }),
]
const get = (id) => P.find((t) => t.id === id)
const ids = (rows) => rows.map((r) => r.t.id)

// ---- the crew: an operator's day ------------------------------------------------
// The bookings waiting on a yes or no are the page's (Brief.jsx works them out
// for both looks); here they are given.
const day = (userId, asks = [], fixes = []) => crewDay({ entries: crewEntries(P, userId, byId, pipe), today: TODAY, asks, fixes })
let d = day(OPA, [{ t: get(2), which: 'shoot' }])
ok('an operator’s list: the late shoot, today’s two, then next week’s', ids(d.rows).join() === '12,2,1,8', ids(d.rows).join())
ok('…in bands: late, today, coming up', d.rows.map((r) => r.band).join() === 'late,today,today,soon', d.rows.map((r) => r.band).join())
ok('the oldest late task is Start here, and number 1', d.first?.t.id === 12 && d.first.n === 1 && d.first.late === 5, JSON.stringify({ id: d.first?.t.id, n: d.first?.n, late: d.first?.late }))
ok('an answer somebody is waiting for comes before the day’s own work', d.rows[1].state === 'ask' && d.rows[1].n === 2 && d.rows[2].state === 'go' && d.rows[2].n === 3)
ok('a shoot that is days away is listed, and not numbered — it cannot be done yet', d.rows[3].state === 'wait' && d.rows[3].n === null)
ok('a killed piece is on nobody’s list', !ids(d.rows).includes(11))
ok('a shoot filmed last week is not “done today”', !ids(d.rows).includes(3))
ok('the three numbers on the bar are the three bands', d.counts.late === 1 && d.counts.today === 2 && d.counts.done === 0 && d.total === 3, JSON.stringify(d.counts))

// ---- the crew: an editor's day ---------------------------------------------------
d = day(EDI)
ok('an editor’s list: the late cut, today’s cut, then the one waiting for footage', ids(d.rows).slice(0, 3).join() === '3,13,10', ids(d.rows).join())
ok('a cut whose footage is not in is in Today, says it is waiting, and has no number',
  d.rows[2].band === 'today' && d.rows[2].state === 'blocked' && d.rows[2].n === null)
ok('Start here is never a task that cannot be started', d.first?.t.id === 3 && d.rows.filter((r) => r.n).every((r) => ['go', 'ask', 'fix'].includes(r.state)))
ok('the numbers run 1, 2, 3… down the page with no gaps', d.rows.filter((r) => r.n).map((r) => r.n).join() === '1,2', d.rows.map((r) => r.n).join())
ok('a cut handed in this morning is under Done today', d.rows.some((r) => r.t.id === 4 && r.band === 'done') && d.counts.done === 1)
ok('…and one handed in yesterday is not', !d.rows.some((r) => r.t.id === 7))
ok('progress is done out of what the day held: late, today and done', d.total === 4 && d.counts.done === 1, `${d.counts.done} of ${d.total}`)

// ---- the crew: changes sent back ---------------------------------------------------
// The artwork was handed in on Thursday, so by its stamps the job is done; the
// open round is what puts it back on the designer's desk.
const round = { id: 31, content_id: 5, round: 2, target: 'designer', title: get(5).title, channels: get(5).channels, note: 'Slide 3: the title is too small.' }
d = day(DES, [], [round])
ok('a change sent back is on the designer’s list again, under Today', d.rows[0].t.id === 5 && d.rows[0].state === 'fix' && d.rows[0].band === 'today')
ok('…as Start here: somebody is waiting for it', d.first?.t.id === 5)
ok('…with the piece’s own facts, not a stub', d.rows[0].t.design_ready_date === '2026-10-05')
// "Scholarship checklist" is still at Idea: the maker has not written the
// words or pressed "Send to the designer" — on the maker's page it is "Your
// move". The first draft numbered it 2 on the designer's list, and with no
// round open it would have been Start here. A job on an idea is not given.
ok('artwork on a piece still at Idea is listed, not numbered: it is not sent to the designer yet',
  d.rows[1]?.t.id === 6 && d.rows[1].state === 'early' && d.rows[1].n === null, JSON.stringify({ id: d.rows[1]?.t.id, state: d.rows[1]?.state, n: d.rows[1]?.n }))
d = day(DES)
ok('…and with nothing else on the desk it is still not Start here', d.rows.length === 1 && d.rows[0].state === 'early' && d.first === null)
{
  const IDEAS = [
    piece(40, 'Idea with a shoot today', { status_id: 1, operator_id: OPA, recording_date: TODAY, recording_time: '09:00', shoot_ack: 'yes' }),
    piece(41, 'Idea with a late design day', { type: 'post', status_id: 1, designer_id: DES, design_ready_date: '2026-09-30' }),
    piece(42, 'Idea with a question', { status_id: 1, operator_id: OPA, recording_date: '2026-10-05' }),
    piece(43, 'Sent to the designer', { type: 'post', status_id: 3, designer_id: DES, design_ready_date: '2026-10-06' }),
    piece(45, 'Idea with a shoot today, said no', { status_id: 1, operator_id: OPA, recording_date: TODAY, recording_time: '16:00', shoot_ack: 'no' }),
  ]
  const on = (uid, asks = []) => crewDay({ entries: crewEntries(IDEAS, uid, byId, pipe), today: TODAY, asks })
  let e = on(OPA, [{ t: IDEAS[2], which: 'shoot' }])
  // The operator said yes, but the maker never pressed "Send": it is not his
  // task yet (the owner's call) — listed with a clock, never numbered.
  ok('a shoot today the operator said YES to is still not a task to do while the piece is at Idea',
    e.rows.find((r) => r.t.id === 40).state === 'early' && e.rows.find((r) => r.t.id === 40).n === null, JSON.stringify(e.rows.map((r) => [r.t.id, r.state, r.n])))
  ok('…and its window says “not sent to you yet”, not the hand-in',
    actOf(IDEAS[0], { userId: OPA, pipe, step: null, today: TODAY }).kind === 'early')
  // A NO is the maker's step, at any stage. The operator answered; until the
  // maker moves the day or names somebody else there is nothing for him to
  // start — least of all at the hour he said he cannot come. (It used to stay
  // a numbered shoot with "Shoot is done" awake once the piece had been sent
  // to the shoot, while the maker's page said "Otabek can’t come".)
  ok('a shoot the operator said NO to is not a task to start — on a piece still at Idea',
    e.rows.find((r) => r.t.id === 45).state === 'declined' && e.rows.find((r) => r.t.id === 45).n === null
    && actOf(IDEAS[4], { userId: OPA, pipe, step: null, today: TODAY }).kind === 'declined')
  {
    const yes = piece(46, 'Sent to the shoot, said yes', { status_id: 2, operator_id: OPA, recording_date: TODAY, recording_time: '12:00', shoot_ack: 'yes' })
    const no = piece(47, 'Sent to the shoot, said no', { status_id: 2, operator_id: OPA, recording_date: TODAY, recording_time: '15:00', shoot_ack: 'no', shoot_ack_note: 'at the dentist' })
    const d = crewDay({ entries: crewEntries([yes, no], OPA, byId, pipe), today: TODAY })
    const row = d.rows.find((r) => r.t.id === 47)
    ok('…nor on a piece already sent to the shoot: no number, never “Start here”, and the window offers no hand-in',
      row.state === 'declined' && row.n === null && d.first.t.id === 46 && d.rows.find((r) => r.t.id === 46).n === 1
      && actOf(no, { userId: OPA, pipe, step: null, today: TODAY }).kind === 'declined', JSON.stringify(d.rows.map((r) => [r.t.id, r.state, r.n])))
    const alone = crewDay({ entries: crewEntries([no], OPA, byId, pipe), today: TODAY })
    ok('…and alone on the list it is not the big card', alone.first === null)
    const mm = makerDay({ pieces: [no], today: TODAY, userId: JAS, pipe, stepOf: (t) => nextStepOf(t, pipe, { written: false, filmed: true, designed: false }, { move: true, publish: true }), canReviewOf: () => true })
    ok('…and the maker’s page says the same of it: he can’t come', mm.rows[0].state === 'cant', mm.rows[0].state)
    const cut = piece(48, 'A cut the editor said no to', { status_id: 3, editor_id: EDI, shot_link: 'https://x', edit_ready_date: '2026-10-05', edit_ack: 'no' })
    ok('…and a cut the editor said no to reads the same way', crewDay({ entries: crewEntries([cut], EDI, byId, pipe), today: TODAY }).rows[0].state === 'declined'
      && actOf(cut, { userId: EDI, pipe, step: null, today: TODAY }).kind === 'declined')
  }
  {
    const PLAIN = { written: false, filmed: false, designed: false }
    const story = piece(50, 'A story an editor cuts', { type: 'story', status_id: 3, editor_id: EDI })
    const a = actOf(story, { userId: JAS, pipe, step: nextStepOf(story, pipe, PLAIN, { move: true, publish: true }), today: TODAY })
    ok('a piece that is not filmed and has an editor is waited for from the editor, by name', a.kind === 'waiting' && a.wait === 'cut' && a.holder === EDI, JSON.stringify(a))
  }
  // The seat a move must fill: the stop it lands on, and only that one.
  {
    const FILM = { written: false, filmed: true, designed: false }, DRAW = { written: false, filmed: false, designed: true }
    const PLAIN = { written: false, filmed: false, designed: false }, TEXT = { written: true, filmed: false, designed: false }
    const idea = (more) => piece(49, 'An idea', { status_id: 1, ...more })
    ok('a move must name whoever holds the stage it lands on: the operator for the shoot',
      seatAt(idea({}), pipe, FILM, STAGES[1]) === 'operator_id' && seatAt(idea({ operator_id: OPA }), pipe, FILM, STAGES[1]) === null)
    ok('…the editor for a piece that starts in Editing with nobody to make it',
      seatAt(idea({ type: 'story' }), pipe, PLAIN, STAGES[2]) === 'editor_id' && seatAt(idea({ type: 'story', editor_id: EDI }), pipe, PLAIN, STAGES[2]) === null)
    ok('…the designer for a poster — and never its shoot, which it only passes',
      seatAt(idea({ type: 'post' }), pipe, DRAW, STAGES[2]) === 'designer_id' && seatAt(idea({ type: 'post', designer_id: DES }), pipe, DRAW, STAGES[2]) === null)
    ok('…and nobody for a written piece, the check or the way out: those are its owner’s',
      seatAt(idea({}), pipe, TEXT, STAGES[2]) === null && seatAt(idea({}), pipe, FILM, STAGES[3]) === null && seatAt(idea({}), pipe, FILM, STAGES[4]) === null)
  }
  {
    const mm = makerDay({ pieces: [IDEAS[0]], today: TODAY, userId: JAS, pipe, stepOf: (t) => nextStepOf(t, pipe, { written: false, filmed: true, designed: false }, { move: true, publish: true }), canReviewOf: () => true })
    ok('…and the maker’s page says the same: not sent to the shoot yet, and the piece is theirs to send',
      mm.rows[0].group === 'film' && mm.rows[0].state === 'unsent' && mm.rows[0].actionable, JSON.stringify([mm.rows[0].group, mm.rows[0].state, mm.rows[0].actionable]))
  }
  ok('…but a booking question on an idea is still answered: somebody is waiting', e.rows.find((r) => r.t.id === 42).state === 'ask' && e.first?.t.id === 42)
  e = on(DES)
  ok('late artwork never sent on is listed under Overdue with no number; the piece that WAS sent is Start here',
    e.rows[0].t.id === 41 && e.rows[0].band === 'late' && e.rows[0].n === null && e.first?.t.id === 43 && e.first.n === 1, JSON.stringify(e.rows.map((r) => [r.t.id, r.state, r.n])))
  ok('no numbered task is ever one that is not given, blocked or still ahead',
    [on(OPA), on(DES), day(OPA), day(EDI), day(DES)].every((x) => x.rows.filter((r) => r.n).every((r) => ['go', 'ask', 'fix'].includes(r.state))))
  ok('without the board’s stages (the previous look) the reading is as it was', crewDay({ entries: crewEntries(IDEAS, DES, byId), today: TODAY }).first?.t.id === 41)
}
{
  // The ordinary pravka: a cut due 30 Sep, handed in on time, changes asked
  // on 3 Oct (the server puts the piece back in Editing). Its own day is behind it by then — and that is nobody's lateness.
  const cut = (release) => piece(50, 'Cut sent back', { status_id: 3, editor_id: EDI, shot_at: '2026-09-28T06:00:00.000Z', ready_link: 'https://drive.google.com/f',
    ready_at: '2026-09-30T06:00:00.000Z', edited_at: '2026-09-30T06:00:00.000Z', edit_ready_date: '2026-09-30', release_date: release, open_round: 1, open_for: 'editor' })
  const fx = { id: 40, content_id: 50, round: 1, target: 'editor', title: 'Cut sent back', channels: ['instagram_main'] }
  const crew = (t) => crewDay({ entries: crewEntries([t], EDI, byId, pipe), today: TODAY, fixes: [fx] })
  const maker = (t) => makerDay({ pieces: [t], today: TODAY, userId: JAS, pipe, stepOf: (x) => nextStepOf(x, pipe, { written: false, filmed: true, designed: false }, { move: true, publish: true }), roundsOf: () => 1, canReviewOf: () => true }).rows[0]
  let c = crew(cut('2026-10-07'))
  ok('a change sent back after an on-time delivery is for today, not “3 days late”',
    c.rows[0].state === 'fix' && c.rows[0].band === 'today' && c.rows[0].late === 0 && c.counts.late === 0 && c.first?.t.id === 50, JSON.stringify([c.rows[0].band, c.rows[0].late, c.counts]))
  ok('…its day is the next one the piece is promised for — never a day already gone', c.rows[0].due === '2026-10-07' && fixUntil(cut('2026-10-07'), 'editor', TODAY) === '2026-10-07')
  let r = maker(cut('2026-10-07'))
  ok('…and the maker’s “Being fixed” row names the same day, with the round', r.group === 'fix' && r.until === '2026-10-07' && r.late === 0 && r.act.round === 1, JSON.stringify([r.group, r.until, r.late]))
  c = crew(cut('2026-10-01'))
  r = maker(cut('2026-10-01'))
  ok('with no promised day left there is no “until”: the crew’s row has no day, the maker’s is late by the release day — and keeps its round',
    c.rows[0].due === null && c.rows[0].late === 0 && r.group === 'fix' && r.until === null && r.late === 2 && r.act.round === 1, JSON.stringify([c.rows[0].due, r.until, r.late]))
  ok('a seat’s own day that is still ahead is the “until”', fixUntil(get(5), 'designer', TODAY) === '2026-10-05' && fixUntil({}, 'editor', TODAY) === null)
}
{
  // What is late and cannot be started. The bar counts it as overdue, so the
  // big card may not say "nothing is late".
  const LATE = [
    piece(60, 'Late, no footage', { status_id: 2, operator_id: 99, editor_id: EDI, recording_date: '2026-09-30', edit_ready_date: '2026-10-01', edit_ack: 'yes' }),
    piece(61, 'Today cut', { status_id: 3, editor_id: EDI, shot_at: '2026-10-02T06:00:00.000Z', shot_link: 'https://drive.google.com/g', edit_ready_date: TODAY, edit_ack: 'yes' }),
    piece(62, 'Late idea', { type: 'post', status_id: 1, designer_id: DES, design_ready_date: '2026-09-30' }),
    piece(63, 'Artwork for today', { type: 'post', status_id: 3, designer_id: DES, design_ready_date: TODAY }),
  ]
  const on = (uid) => crewDay({ entries: crewEntries(LATE, uid, byId, pipe), today: TODAY })
  let h = on(EDI)
  ok('a late cut with no footage is counted overdue, has no number — and the day says what is held, and why',
    h.counts.late === 1 && h.rows[0].n === null && h.first?.t.id === 61 && h.held?.n === 1 && h.held.why === 'blocked', JSON.stringify([h.counts, h.held]))
  h = on(DES)
  ok('…the same for late work never sent on', h.first?.t.id === 63 && h.held?.n === 1 && h.held.why === 'early', JSON.stringify(h.held))
  ok('…and nothing is “held” on a day whose late work can be started', day(OPA, [{ t: get(2), which: 'shoot' }]).held === null && day(EDI).held === null)
}
{
  // A piece put back on the making stage. The server stamps ready_at the first
  // time a piece reaches Ready and keeps it for good — it is the clock of the
  // first delivery. Read as "handed in", that stamp took a card dragged back to
  // Editing (or re-shot, or given a new editor) off its editor's day for good:
  // the owner's "Mr Asadbek 1", 13 October 2026 — on Editing, an editor named,
  // on no list of his, and "not done yet".
  const FILM = { written: false, filmed: true, designed: false }
  const win = (t, uid) => actOf(t, { userId: uid, pipe, step: nextStepOf(t, pipe, FILM, { move: false, publish: false }), today: TODAY }).kind
  const crew = (t, uid) => crewDay({ entries: crewEntries([t], uid, byId, pipe), today: TODAY })
  const back = piece(70, 'Back on Editing', { status_id: 3, operator_id: OPA, editor_id: EDI, ready_at: '2026-10-01T06:00:00.000Z', edited_at: '2026-10-01T06:00:00.000Z', release_date: '2026-10-07' })
  const b = crew(back, EDI)
  ok('a piece put back on Editing is its editor’s to do again, whatever stamp an earlier move to Ready left',
    b.rows.length === 1 && b.rows[0].state === 'go' && b.rows[0].band === 'soon' && b.first?.t.id === 70 && win(back, EDI) === 'handin',
    `${JSON.stringify(b.rows.map((r) => [r.band, r.state]))} window=${win(back, EDI)}`)
  ok('…in the previous look too, which reads without the board’s stages', crewDay({ entries: crewEntries([back], EDI, byId), today: TODAY }).rows[0]?.state === 'go')
  ok('…and the same for artwork', crew(piece(71, 'Post back on Editing', { type: 'post', status_id: 3, designer_id: DES, ready_at: '2026-10-01T06:00:00.000Z', release_date: '2026-10-07' }), DES).rows[0]?.state === 'go')
  // What stays as it was.
  const theirs = { ...back, id: 72, designer_id: DES, open_round: 1, open_for: 'designer' }
  ok('a change asked of the designer does not reopen the editor’s cut', crew(theirs, EDI).rows.length === 0 && win(theirs, EDI) !== 'handin', win(theirs, EDI))
  ok('a cut handed in and standing on Ready is still off the list', crew({ ...back, id: 73, status_id: 4 }, EDI).rows.length === 0 && win({ ...back, id: 73, status_id: 4 }, EDI) === 'waiting')
  ok('a finished piece is finished on any stage', crew({ ...back, id: 74, done_at: '2026-10-02T06:00:00.000Z' }, EDI).rows.length === 0)
  // The review of that fix, the same day.
  const reel = { ...back, id: 75, designer_id: DES, ready_link: 'https://drive.google.com/cut', design_link: 'https://drive.google.com/art' }
  ok('on a reel put back only the edit is open again — a designer who was asked nothing keeps their hand-in',
    crew(reel, EDI).rows[0]?.state === 'go' && crew(reel, DES).rows.length === 0 && win(reel, DES) === 'waiting',
    `${JSON.stringify(crew(reel, DES).rows.map((r) => r.state))} window=${win(reel, DES)}`)
  const met = { ...back, id: 76, edit_ready_date: '2026-09-28' }   // its edit day was met, days ago
  const o = crew(met, EDI).rows[0]
  ok('a piece put back is not late by the day of the delivery it already met — its day is the next one still promised',
    o?.band === 'soon' && o.late === 0 && o.due === '2026-10-07', JSON.stringify([o?.band, o?.late, o?.due]))
  const none = crew({ ...met, id: 77, release_date: '2026-10-01' }, EDI).rows[0]
  ok('…and with no day still ahead it is for today, not “days late”', none?.band === 'today' && none.due === TODAY && none.late === 0 && none.state === 'go', JSON.stringify([none?.band, none?.due, none?.late, none?.state]))
  const two = crewDay({ entries: crewEntries([piece(78, 'Aardvark edit', { status_id: 3, editor_id: EDI, shot_link: 'https://drive.google.com/a', release_date: '2026-10-05' }), back], EDI, byId, pipe), today: TODAY })
  ok('…and it comes first in its band, as a change sent back does', ids(two.rows).join() === '70,78', ids(two.rows).join())
  // The stage half of the reading: only the making stage, by any of its names.
  ok('a card dragged back to To shoot is its maker’s to send on, not the editor’s to start', crew({ ...back, id: 79, status_id: 2 }, EDI).rows.length === 0)
  const BOARD = [{ id: 1, label: 'Idea', sort: 1 }, { id: 2, label: 'Syomka', sort: 2 }, { id: 3, label: 'Montajda', sort: 3 },
    { id: 4, label: 'Ready', sort: 4 }, { id: 7, label: 'Scheduled', sort: 5 }, { id: 5, label: 'Published', sort: 6, is_final: 1 }]
  const crew2 = (t) => crewDay({ entries: crewEntries([t], EDI, Object.fromEntries(BOARD.map((s) => [s.id, s])), pipelineOf(BOARD)), today: TODAY })
  ok('a making stage named in Uzbek reopens it too', crew2({ ...back, id: 80 }).rows[0]?.state === 'go')
  ok('a cut handed in and standing on a later stage of the admin’s own is still handed in', crew2({ ...back, id: 81, status_id: 7 }).rows.length === 0)
}
d = crewDay({ entries: [], today: TODAY, fixes: [{ id: 32, content_id: 77, round: 1, target: 'editor', title: 'Gone from the list', channels: ['youtube'] }] })
ok('a change on a piece that is not in the list at all still gets a row', d.rows.length === 1 && d.rows[0].t.title === 'Gone from the list' && d.rows[0].kind === 'edit')
d = day(404)
ok('somebody with no work has an empty day, not a crash', d.rows.length === 0 && d.first === null && d.total === 0)

// ---- the maker: five groups, one piece in each -------------------------------------
const making = (t) => ({ written: false, filmed: ['reel', 'video'].includes(t.type), designed: t.type === 'post' })
const ALL = { move: true, publish: true }
const stepOf = (t) => nextStepOf(t, pipe, making(t), ALL)
const mk = (over = {}) => makerDay({ pieces: P, today: TODAY, userId: JAS, pipe, stepOf, roundsOf: () => 0, maxRounds: 2, canReviewOf: () => true, ...over })
let m = mk()
const inGroup = (g) => m.rows.filter((r) => r.group === g).map((r) => r.t.id).join()
ok('Filming today: by the clock', inGroup('film') === '1,10,2', inGroup('film'))
ok('…with the operator’s answer on each', m.rows.filter((r) => r.group === 'film').map((r) => r.state).join() === 'coming,noanswer,noanswer')
ok('Pravka · Check it: the cut that came in', inGroup('check') === '4', inGroup('check'))
ok('Pravka · Being fixed: the artwork sent back, with who has it and which round',
  inGroup('fix') === '5' && m.rows.find((r) => r.t.id === 5).holder === DES && m.rows.find((r) => r.t.id === 5).act.round === 2)
ok('Late: oldest first', inGroup('late') === '3,12', inGroup('late'))
ok('…each with the days it is late and who has it',
  m.rows.find((r) => r.t.id === 3).late === 7 && m.rows.find((r) => r.t.id === 3).holder === EDI
  && m.rows.find((r) => r.t.id === 12).late === 5 && m.rows.find((r) => r.t.id === 12).holder === OPA)
ok('Your move: the idea that needs the maker’s words', inGroup('move') === '6', inGroup('move'))
ok('Ready to publish: the accepted cut', inGroup('ready') === '7', inGroup('ready'))
ok('on time and in somebody else’s hands is in none of the five', inGroup('plan') === '13,8', inGroup('plan'))
ok('what went out is counted, not listed', inGroup('out') === '9' && m.month.out === 1, JSON.stringify(m.month))
ok('the month’s bar counts pieces with a day in this month', m.month.total === 11, String(m.month.total))
ok('a killed piece is in no group', !m.rows.some((r) => r.t.id === 11))
ok('every piece is in exactly one group', m.rows.length === new Set(ids(m.rows)).size && m.rows.length === P.length - 1)
ok('the groups come in the owner’s order',
  [...new Set(m.rows.map((r) => r.group))].join() === 'film,check,fix,late,move,ready,plan,out', [...new Set(m.rows.map((r) => r.group))].join())
ok('Start here is the first piece the maker can act on: the cut to check', m.first?.t.id === 4)
ok('…never one that is in somebody else’s hands', m.rows.filter((r) => r.actionable).map((r) => r.t.id).join() === '4,6,7', m.rows.filter((r) => r.actionable).map((r) => r.t.id).join())

// The third delivery is approved as it stands (Pravka 2.0): it is not asked about again.
m = mk({ roundsOf: (t) => (t.id === 4 ? 2 : 0) })
ok('after the last round a delivered cut is Ready to publish, not “Check it”', inGroup('check') === '' && inGroup('ready') === '7,4', `${inGroup('check')} | ${inGroup('ready')}`)
// Somebody who may not review is not asked to.
m = mk({ canReviewOf: () => false })
ok('a cut is only “Check it” for whoever may accept it', inGroup('check') === '')
// A shoot day on an idea: planned, and not sent.
m = mk({ pieces: [piece(20, 'Pencilled in', { status_id: 1, operator_id: OPA, recording_date: TODAY, recording_time: '09:00' })] })
ok('a shoot planned for today on a piece still at Idea is under Filming today, and is the maker’s to send',
  m.rows[0].group === 'film' && m.rows[0].state === 'unsent' && m.rows[0].actionable && m.first?.t.id === 20)
// A piece late AND the maker's own step: under Late, with their button.
m = mk({ pieces: [piece(21, 'Late and ready', { status_id: 4, ready_link: 'x', approved_at: 'y', ready_at: '2026-09-28T06:00:00.000Z', release_date: '2026-09-30' })] })
ok('a piece past its day that waits on the maker is under Late — and is Start here', m.rows[0].group === 'late' && m.rows[0].actionable && m.rows[0].act.kind === 'publish' && m.first?.t.id === 21)
// A change asked on a written post: nobody holds a seat, so the fix is the maker's own.
m = mk({ pieces: [piece(22, 'Rewrite the first line', { type: 'post', status_id: 3, open_round: 1, open_for: 'editor', release_date: '2026-10-09' })] })
ok('a change nobody else holds is the maker’s own move', m.rows[0].group === 'move' && m.rows[0].act.kind === 'ownfix')

// ---- the window: your step now -------------------------------------------------------
const act = (t, userId, more = {}) => actOf(t, { userId, pipe, step: userId === JAS ? stepOf(t) : nextStepOf(t, pipe, making(t), { move: false, publish: false }), today: TODAY, rounds: 0, maxRounds: 2, canReview: userId === JAS, ...more })
ok('the operator, on the day: hand in the shoot', act(get(1), OPA).kind === 'handin' && act(get(1), OPA).hat.kind === 'shoot')
ok('…asked about a time and not answered yet: answer first', act(get(2), OPA).kind === 'ask' && act(get(2), OPA).which === 'shoot')
ok('…days before the shoot: not yet', act(get(8), OPA).kind === 'notyet')
ok('the editor with footage in: hand in the cut', act(get(3), EDI).kind === 'handin' && act(get(3), EDI).hat.kind === 'edit')
ok('…with no footage: cannot start yet', act(get(10), EDI).kind === 'blocked')
ok('…after handing in: their part is done, and it says who has it', act(get(4), EDI).kind === 'waiting' && act(get(4), EDI).didMine === true && act(get(4), EDI).holder === JAS)
ok('the designer with a round open: fix it', act(get(5), DES).kind === 'fix' && act(get(5), DES).hat.kind === 'design')
ok('the maker on a delivered cut: accept, or ask for changes', act(get(4), JAS).kind === 'check' && act(get(4), JAS).what === 'cut' && act(get(4), JAS).maker === EDI)
ok('…on a piece being fixed: not their step', act(get(5), JAS).kind === 'fixing' && act(get(5), JAS).holder === DES)
ok('…on a piece being filmed: not their step', act(get(1), JAS).kind === 'waiting' && act(get(1), JAS).holder === OPA && act(get(1), JAS).wait === 'shoot')
ok('…on their idea: the move', act(get(6), JAS).kind === 'move' && act(get(6), JAS).verb === 'Send to the designer')
// The same piece, from the designer's chair: the two pages agree.
ok('the designer on that idea: not sent to them yet, and it names who has it', act(get(6), DES).kind === 'early' && act(get(6), DES).holder === JAS)
{
  // A maker who also holds the camera on their own idea: sending it on is the step, not filming it.
  const own = piece(44, 'My own shoot', { status_id: 1, operator_id: JAS, recording_date: TODAY, shoot_ack: 'yes' })
  ok('whoever can send an idea on is offered that, not the job on it', act(own, JAS).kind === 'move' && !act(own, JAS).didMine)
}
ok('…on an accepted cut: publish', act(get(7), JAS).kind === 'publish')
ok('a piece that is out has nothing left to press', act(get(9), JAS).kind === 'out')
ok('a killed piece has nothing to press either', act(get(11), OPA).kind === 'none')
// One person, two hats: the window opens on the job the row was about.
const two = piece(30, 'Films and cuts it', { status_id: 2, operator_id: 8, editor_id: 8, recording_date: TODAY, shoot_ack: 'yes', edit_ready_date: '2026-10-05', edit_ack: 'yes' })
ok('somebody who films and cuts a piece gets the shoot first', act(two, 8).hat.kind === 'shoot')
ok('…and the cut when that is the row they pressed', act(two, 8, { prefer: 'edit' }).hat.kind === 'edit' && act(two, 8, { prefer: 'edit' }).kind === 'blocked')

// ---- the week strip and the calendar ---------------------------------------------------
let ev = dayEvents(P, TODAY, TODAY, pipe)
ok('today: three shoots by the clock, then the release', ev.map((e) => `${e.k}${e.t.id}`).join() === 'shoot1,shoot10,shoot2,rel7', ev.map((e) => `${e.k}${e.t.id}`).join())
ev = dayEvents(P, '2026-10-01', TODAY, pipe)
ok('a release day that passed without the piece going out is “missed”; one that went out is “out”',
  ev.map((e) => `${e.k}${e.t.id}`).sort().join() === 'miss3,out9', ev.map((e) => `${e.k}${e.t.id}`).join())
ok('a killed piece is on no day', !dayEvents(P, TODAY, TODAY, pipe).some((e) => e.t.id === 11))
ok('a filmed shoot stays on its day, marked as filmed', dayEvents(P, '2026-09-25', TODAY, pipe)[0]?.filmed === true)
const cells = monthCells('2026-10')
ok('the month grid starts on a Monday and holds whole weeks', cells[0] === '2026-09-28' && cells.length === 35 && cells[34] === '2026-11-01', `${cells[0]} ${cells.length}`)
ok('…six rows when the month needs them', monthCells('2026-08').length === 42 && monthCells('2026-08')[0] === '2026-07-27')
ok('a week is Monday to Sunday around the chosen day', weekCells(TODAY).join() === '2026-09-28,2026-09-29,2026-09-30,2026-10-01,2026-10-02,2026-10-03,2026-10-04')
ok('a stamp is read as the Tashkent day', dayOf('2026-10-02T20:30:00.000Z') === '2026-10-03')

// ---- the way of a task -------------------------------------------------------------------
let w = wayOf(get(3), pipe, making(get(3)))
ok('the way of a video: five stops, who does each, and where it is now',
  w.map((s) => `${s.role}:${s.cls}:${s.who ?? '-'}:${s.verb}`).join(' ') === `idea:done:${JAS}:plan shoot:done:${OPA}:film edit:on:${EDI}:cut review::${JAS}:check final::-:out`,
  w.map((s) => `${s.role}:${s.cls}:${s.who ?? '-'}:${s.verb}`).join(' '))
w = wayOf(get(6), pipe, making(get(6)))
ok('a post skips the shoot, and the designer draws it', w[1].cls === 'skip' && w[2].who === DES && w[2].verb === 'draw' && w[0].cls === 'on')
w = wayOf(get(9), pipe, making(get(9)))
ok('once it is out, every stop is behind it', w.filter((s) => s.cls !== 'skip').every((s) => s.cls === 'done'))
ok('the Deleted stage is not a stop on the way', w.length === 5)
// A written piece — Telegram, and X, Threads and LinkedIn (format 'short') —
// is planned, written and out: its channel page draws those three columns
// (WRITING_STAGES), and the window draws the same three stops.
{
  const { makingOf } = await import(from('client/src/lib/nextStep.js'))
  const asked = (formats) => ({ formats, crew: (hat) => formats.some((f) => ({ social: ['operator', 'editor', 'designer'] }[f] || []).includes(hat)) })
  const CREW = { operator: ['reel', 'video'], editor: ['reel', 'video'], designer: ['post'] }
  const xPost = makingOf({ type: 'post' }, CREW, asked(['short']))
  const xReel = makingOf({ type: 'reel' }, CREW, asked(['short']))
  ok('a post or a reel on X is written: nobody films or designs it', xPost.written && xReel.written && !xReel.filmed && !xPost.designed)
  // with_media arrives as 'social' (channelFormat.js askedOf): the type rules are back.
  const xVideo = makingOf({ type: 'reel' }, CREW, asked(['social']))
  ok('…until it carries a video: then it is filmed and cut, as on Instagram', !xVideo.written && xVideo.filmed)
  const tw = (status_id) => wayOf(piece(60, 'A post for X', { channels: ['x_twitter'], type: 'post', status_id }), pipe, xPost)
  w = tw(3)
  ok('the way of a written piece: plan, write, out — no shoot, no edit, no check',
    w.map((s) => `${s.role}:${s.verb}`).join(' ') === 'idea:plan edit:write final:out', w.map((s) => `${s.role}:${s.verb}`).join(' '))
  ok('…the making stop is called Writing, and its owner writes it', w[1].label === 'Writing' && w[1].who === JAS && w[1].cls === 'on')
  ok('…and a written piece left on Ready is still being written', tw(4)[1].cls === 'on' && tw(4).every((s) => s.role !== 'review'))
  ok('…nobody is a seat to fill on the way to Writing', seatAt(piece(61, 'x', { type: 'post', status_id: 1 }), pipe, xPost, STAGES[2]) === null)
}
// A repost — TikTok, YouTube Shorts (format 'repost') — is a finished video
// posted again: it arrives on Ready, made, and its one step is out.
{
  const { makingOf } = await import(from('client/src/lib/nextStep.js'))
  const asked = (formats) => ({ formats, crew: (hat) => formats.some((f) => ({ social: ['operator', 'editor', 'designer'] }[f] || []).includes(hat)) })
  const CREW = { operator: ['reel', 'video'], editor: ['reel', 'video'], designer: ['post'] }
  const tik = makingOf({ type: 'reel' }, CREW, asked(['repost']))
  ok('a reel on TikTok is a repost: nobody films, cuts or designs it', tik.repost && !tik.filmed && !tik.designed && !tik.written)
  const rep = piece(62, 'Admissions reel (from Main)', { channels: ['tiktok'], status_id: 4 })
  w = wayOf(rep, pipe, tik)
  ok('the way of a repost: the last look, then out — nothing before Ready',
    w.map((s) => `${s.role}:${s.verb}`).join(' ') === 'review:check final:out' && w[0].cls === 'on' && w[0].who === JAS,
    w.map((s) => `${s.role}:${s.verb}:${s.cls}`).join(' '))
  const st = nextStepOf(rep, pipe, tik, { move: true, publish: true })
  ok('…and its one step is Publish, for whoever posts it', st?.verb === 'Publish' && st.to.id === 5, JSON.stringify(st))
  // The server makes it with the source's cut ACCEPTED (server/reposts.js), so
  // the window offers the post, never "accept the cut" on a video already out.
  const act = actOf({ ...rep, ready_link: 'https://drive.google.com/x', approved_at: '2026-10-03T08:00:00Z' },
    { userId: JAS, pipe, step: st, today: TODAY, rounds: 0, maxRounds: 2, canReview: true })
  ok('…the window offers the post, not a check of the cut', act.kind === 'publish', act.kind)
  const reposts = src('client/src/components/Reposts.jsx')
  ok('the window draws the server’s answer about reposts and keeps no rule of its own',
    /<Reposts taskId=\{t\.id\} info=\{t\.reposts\}/.test(src('client/src/components/CoachTask.jsx'))
    && !/<Reposts/.test(src('client/src/components/ContentModal.jsx'))
    && /api\.put\(`\/content\/\$\{taskId\}\/reposts`/.test(reposts) && !/instagram_main|tiktok|youtube_shorts/.test(reposts))
  ok('…and says what happens after the tick, and why an empty place is empty',
    /tx\('When it is published: \{name\} gets a task/.test(reposts) && /tx\('Not ticked: it goes out on this channel only\.'\)/.test(reposts)
    && /tx\('It went out on this channel only — nothing was ticked before it was published\.'\)/.test(reposts))
}

// ===================== the pages, from the source =====================
const css = src('client/src/styles.css')
const i18n = src('client/src/lib/i18n.jsx')
const brief = src('client/src/pages/Brief.jsx')
const dept = src('client/src/pages/Department.jsx')
const win = src('client/src/components/CoachTask.jsx')
const crewPage = src('client/src/components/CoachCrewDay.jsx')
const makerPage = src('client/src/components/CoachMakerDay.jsx')
const calPage = src('client/src/components/CoachCalendar.jsx')

// Two looks, not three.
ok('the pages the Coach look replaced are gone', !has('client/src/components/CrewTask.jsx') && !has('client/src/components/MakerTask.jsx') && !has('client/src/components/MakerDay.jsx'))
// 13 October 2026, the owner: the previous look goes with the one task window.
ok('…and nobody can switch back to the previous look', /export const isSimple = \(\) => true/.test(src('client/src/lib/look.js'))
  && !/setSimple\(user, false\)|onClassic=/.test(brief) && !/tx\('Bring back the previous look'\)/.test(src('client/src/components/Sidebar.jsx')))

// One window, for everybody, from both pages that open tasks.
// 13 October 2026, the owner: "make one universal task view". Every page goes
// through ContentModal's door, which opens a task that exists in the task window.
const sheet = src('client/src/components/ContentModal.jsx')
ok('every page opens a task through one door, and the door opens the task window',
  /<ContentModal\b/.test(brief) && /<ContentModal\b/.test(dept) && !/<CoachTask\b/.test(brief + dept)
  && /return <TaskWindow \{\.\.\.props\} \/>/.test(sheet) && /<CoachTask key=\{item\.id\}/.test(sheet))
ok('…whose Edit button turns the window into the form, built on the piece as the server has it',
  /const canEditIt = !!edit && loaded && !!mayEdit\?\.\(t\)/.test(win) && /\{editing \? edit\(t, \{/.test(win) && /tx\('Edit'\)/.test(win))
ok('…and the form has no tabs: the days, the reference, the files, then the brief, as the window reads',
  !/className="cm-pages"|const SECTIONS|cm-page-tab|crewViewer|asCrew/.test(sheet)
  && ['{daysBlock}', '{refRow}', '{filesRow}', '{tzRow}'].every((k, i, a) => i === 0 || sheet.indexOf(k, sheet.indexOf('const body = (')) > sheet.indexOf(a[i - 1], sheet.indexOf('const body = ('))))
ok('a pen in the window only for whoever may write to the piece (the server’s canTouch)',
  /const reach = reachOf\(user, t\)/.test(win) && /plans=\{reach && can\(user, 'manage_content'\)\}/.test(win) && /const reach = creating \|\| reachOf\(user, item\)/.test(sheet))
ok('the window is a dialog that closes on Esc and on a click outside',
  /role="dialog"/.test(win) && /aria-modal="true"/.test(win) && /e\.key === 'Escape'/.test(win) && /className="co-scrim"[^>]*onMouseDown=\{\(\) => close\(\)\}/.test(win))
// ---- what the first draft told people wrongly ----
ok('closing over words typed and not sent asks first', /const unsent = \(\) =>/.test(win) && /sure !== true && unsent\(\)/.test(win) && /tx\('Keep writing'\)/.test(win) && /tx\('Close anyway'\)/.test(win))
ok('…and so does every other way out of the window: Edit and “Next”',
  /onClick=\{\(\) => goOut\('edit'\)\}/.test(win) && /onClick=\{\(\) => goOut\('next'\)\}/.test(win) && !/onClick=\{onOpenFull\}/.test(win) && !/onClick=\{onNext\}/.test(win)
  && /const goOut = \(how\) => \{ if \(unsent\(\)\) setLeaving\(how\)/.test(win))
ok('a press that moved the piece can be taken back: the server’s own undo, offered for less than its ten seconds',
  /api\.post\(`\/content\/\$\{t\.id\}\/undo`\)/.test(win) && /u\.status_id !== t\.status_id\) setUndo/.test(win) && /const UNDO_MS = 9000/.test(win) && /tx\('Undo'\)/.test(win)
  && /const UNDO_SECONDS = 10/.test(src('server/routes/content.js')))
ok('“paste the link” ticks when a link is in the box, not when the button is awake', /onReady=\{\(ok, has\)/.test(win) && /pasted && awake/.test(win) && /onReady\?\.\(ready, filled\)/.test(src('client/src/components/HandIn.jsx')))
ok('…and for a shoot the step says the link may be skipped, as the box does', /if you have one'\)[^\n]*opt: true/.test(win) && /!s\.opt && !ticked/.test(win))
// Round 8: the owner's task view draws no numbered steps ("too much guidance") —
// the person's one step is the first thing in the words column.
ok('round 8: no numbered steps in the window; “Your step now” leads its column', /\{actBox\(\)\}/.test(win) && !/listOf\(/.test(win) && !/tx\('The way of this task'\)/.test(win))
ok('an owner’s own fix has its steps too', /act\.kind === 'fix' \|\| act\.kind === 'ownfix' \? \[/.test(win))
ok('a job not sent yet says so, and can still be handed in', /case 'early'/.test(win) && /tx\('Already made it\? Hand it in'\)/.test(win))
ok('“Being fixed” rows say until when — a day ahead, or that the planned day has passed', /r\.until \? tx\('until \{day\}', \{ day: dayInLine\(r\.until, today\) \}\) : release\(t\)/.test(src('client/src/components/CoachMakerDay.jsx')))
ok('…and the round is on the row whether or not the piece is late',
  (() => { const p = src('client/src/components/CoachParts.jsx'); const mb = p.slice(p.indexOf('export function MakerBadge')); return mb.indexOf("if (act.kind === 'fixing') return") > 0 && mb.indexOf("if (act.kind === 'fixing') return") < mb.indexOf('if (row.late) return') })())
{
  const parts = src('client/src/components/CoachParts.jsx')
  ok('a reminder is in the reader’s language, once a day by the thread, and says who sees it',
/phraseIn\(person\.lang/.test(parts) && /tashkentDay\(c\.created_at\) === today && lines\.includes\(String\(c\.text \|\| ''\)\.trim\(\)\)/.test(parts) && !/includes\(`@\$\{person\.name\}`\)/.test(parts) && /data-tip=\{sent \? undefined : remindHelp\(\)\}/.test(parts))
// (The window no longer repeats it under the button — the owner, 13 Oct, "a lot of unnecessary things": the button's own tip says it.)
}
const rule = (sel) => (css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`)) || [''])[0]
ok('…slides in from the right, on the drawer curve', /right: 0/.test(rule('.co-panel')) && /animation: co-slide [0-9.]+s var\(--ease-drawer\)/.test(rule('.co-panel')) && /@keyframes co-slide \{ from \{ transform: translateX\(100%\)/.test(css))
ok('…a panel on a desk, the whole screen on a phone', /width: min\(1180px, 100vw\)/.test(rule('.co-panel')))
ok('…and fades instead for people who asked for less motion', /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.co-panel[^}]*animation-name: co-fade/.test(css))
ok('the window asks the server what a move is missing — no rule of its own', /<NextStep inline/.test(win) && /<HandIn inline/.test(win) && !/needs_link|\.missing\b|e\.data\b/.test(win))
ok('…the stages line is drawn only for whoever follows the piece across stages',
  /tx\('Your step now'\)/.test(win) && /tracks\(user, t\) \? \(\s*<Capsule /.test(win))
ok('every button says what happens after it', (win.match(/tx\('After you press:'\)/g) || []).length >= 1 && /co-after/.test(win))

// The crew's day.
// Round 9 ("too complex"): the rows carry no numbers any more; the order is still the reading's, top to bottom.
ok('the crew’s list is the reading’s own order, drawn band by band', /crewDay\(/.test(brief) && /const \{ rows, first, held \} = model/.test(crewPage) && /rows\.filter\(\(r\) => r\.band === b\.key/.test(crewPage) && !/\{r\.n \|\|/.test(crewPage))
{
  // "Why this one first" is true in every state: somebody waiting is said
  // before lateness, and "nothing is late" only when nothing late is held.
  const why = crewPage.slice(crewPage.indexOf('const why ='), crewPage.indexOf('const button ='))
  const at = (x) => why.indexOf(x)
  ok('the big card never says “nothing is late” over a late row that cannot be started',
    at("r.state === 'fix'") >= 0 && at("r.state === 'fix'") < at("r.state === 'ask'") && at("r.state === 'ask'") < at('r.late ?') && at('r.late ?') < at('held ?') && at('held ?') < at("tx('Nothing is late."),
    why.slice(0, 80))
}
ok('…with the summary bar: three counts that filter, and the day’s progress', /role="progressbar"/.test(src('client/src/components/CoachParts.jsx')) && /aria-pressed/.test(src('client/src/components/CoachParts.jsx')))
ok('the first-days hint can be closed, and “?” brings it back', /closeHint\(/.test(src('client/src/components/CoachParts.jsx')) && /openHint\(/.test(src('client/src/components/CoachParts.jsx')))
// r11 (the owner, 12 Oct 2026: "remove More" on the crew's page): nothing is taken
// away — the calendar is a page in the menu on the left. Round 14 (the owner's
// Jobber pick, 15 Oct): the strip of hours is the square beside Now — today's
// shoots in order for whoever films, today's edits for an editor.
ok('nothing is taken away: today is the square beside Now, the calendar is in the menu',
  /className=\{'co-sq'/.test(crewPage) && /tx\('Today’s shoots'\)/.test(crewPage) && /tx\('Today’s edits'\)/.test(crewPage) && /crewSeat/.test(src('client/src/components/Sidebar.jsx')) && /to: '\/brief\/calendar'/.test(src('client/src/components/Sidebar.jsx'))
  && !/tx\('Bring back the previous look'\)/.test(src('client/src/components/Sidebar.jsx')))

// 13 October 2026, the owner: "the task is not shown on the platform list". A
// task fourth in its band was behind "Show all", and an editor with only
// waiting work saw one shut line. Round 14 (the owner's Planner pick, 15 Oct:
// "3 rows per band") cuts every band at three again, with its count on the
// band and the rest one press away.
ok('the crew’s bands show three and “N more”, each with its count, and “Waiting for others” starts open',
  /const CUT = 3\b/.test(crewPage) && /b\.rows\.slice\(0, cut\)/.test(crewPage) && /<span>\{b\.rows\.length\}<\/span>/.test(crewPage) && /tx\('\{n\} more', \{ n: b\.rows\.length - CUT \}\)/.test(crewPage)
  && /<details open className="co-card sd-fold co-parked">/.test(crewPage))
ok('…with every waiting row in it, and no second cut anywhere on the page',
  /\{parked\.map\(row\)\}/.test(crewPage) && !/parked\.slice\(|rows\.slice\(0, \d|\.map\(row\)\.slice\(|CUT\.\w+ =/.test(crewPage))
ok('the crew’s calendar reads “handed in” the way My Day does, seat by seat',
  /const made = \(t, seat\) => makeDone\(/.test(brief) && (brief.match(/!made\(t, '(?:editor|designer)'\)/g) || []).length === 4 && !/!t\.ready_at\)? (?:&& reviewDue\(t\)\) )?push/.test(brief))
ok('a piece put back opens with an empty hand-in box and no lateness of its first delivery in the window',
  /fixing \|\| \(kind !== 'shoot' && item\.ready_at\) \? ''/.test(src('client/src/components/HandIn.jsx'))
  && /again \? \(fixUntil\(t, hat\.name, today\) \|\| today\)/.test(src('client/src/components/CoachTask.jsx')))

// The maker's day and calendar.
ok('the maker’s five groups, in the owner’s order, each with why it comes there',
  ["'film'", "'pravka'", "'late'", "'move'", "'ready'"].every((k, i, a) => i === 0 || makerPage.indexOf(`key: ${k}`) > makerPage.indexOf(`key: ${a[i - 1]}`)) && /makerDay\(/.test(brief))
ok('…Pravka in two: “Check it” and “Being fixed”', /tx\('Check it'\)/.test(makerPage) && /tx\('Being fixed'\)/.test(makerPage))
// The strip of hours leaves a maker's My Day (round 11; their week is the Calendar's,
// read the same way). Whoever films has today's shoots in the square beside Now (round 14).
ok('…a maker’s My Day has no strip; the week and the other days are the calendar’s',
  !/CoachDayLine|eventsOn\(/.test(makerPage) && /dayEvents\(pieces, day, today, pipe\)/.test(calPage))
ok('the calendar is a screen of its own, with Month and Week', /path="\/brief\/calendar"/.test(src('client/src/App.jsx')) && /tx\('Month'\)/.test(calPage) && /tx\('Week'\)/.test(calPage) && /monthCells\(/.test(calPage) && /weekCells\(/.test(calPage))

// A colour is a token, with a value for the light and for the dark theme.
const light = css.slice(css.indexOf(':root {'), css.indexOf('[data-theme="dark"] {'))
const dark = css.slice(css.indexOf('[data-theme="dark"] {'), css.indexOf('* { box-sizing: border-box; }'))
const hex = (block, name) => (new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block) || [])[1]
const KINDS = ['kind-shoot', 'kind-cut', 'kind-art']
ok('the colours for a kind of work are tokens, in both themes', KINDS.every((k) => hex(light, k) && hex(dark, k)), KINDS.map((k) => `${hex(light, k)}/${hex(dark, k)}`).join(' '))
// Read as text on its own tint (13% over the card), like the icon tile and the calendar pill.
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p)))
const onTint = (fg, card) => contrast(rgb(fg), mix(rgb(fg), rgb(card), 0.13))
const worst = Math.min(...KINDS.flatMap((k) => [onTint(hex(light, k), '#FFFFFF'), onTint(hex(dark, k), '#262626')]))
ok('…each readable on its own tint, light and dark (4.5:1)', worst >= 4.5, worst.toFixed(2))
const coach = css.slice(css.indexOf('The Coach look'))
ok('no colour is written into a Coach rule', coach.length > 500 && !/#[0-9A-Fa-f]{3,8}\b/.test(coach.replace(/\/\*[\s\S]*?\*\//g, '')))
ok('…and nothing in it is heavier than Bold', !/font-weight:\s*(800|900)/.test(coach))

// What the last review found, kept found.
const ns = src('client/src/components/NextStep.jsx')
ok('the move’s form demands the landing seat whatever the dry run says, and both callers pass it',
  /if \(seat\) demanded\.add\(seat\)/.test(ns) && /if \(seat\) add\(\{ field: seat \}\)/.test(ns)
  && /seat=\{seatAt\(t, pipe, makingFor\(t\), act\.to\)\}/.test(win)
  && /seat=\{seatAt\(stepping\.item, step\.pipe, step\.makingFor\(stepping\.item\), stepping\.to\)\}/.test(src('client/src/pages/Department.jsx')))
ok('a second round of changes is a new checklist: the round is in the key the ticks are kept under',
  /const ticksKey = `\$\{t\.id\}:\$\{act\.kind\}:\$\{hat\?\.kind \|\| ''\}:\$\{act\.round \|\| ''\}`/.test(win))
ok('a booking they said no to shows the answer and a way to change it, and no hand-in', /case 'declined':/.test(win)
  && /case 'declined': \{[\s\S]{0,900}<Booking item=\{t\}/.test(win) && !/case 'declined': \{[\s\S]{0,900}<HandIn/.test(win))
const topRule = (sel) => (css.match(new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`)) || [])[1] || ''
ok('the summary bar wraps by its own width — the greeting keeps 280px and never breaks inside a word',
  /display: flex/.test(topRule('.co-sum')) && /flex-wrap: wrap/.test(topRule('.co-sum')) && /min-width: min\(280px, 100%\)/.test(topRule('.co-hello'))
  && !/overflow-wrap: anywhere/.test(topRule('.co-hello h2')) && !/grid-template-columns/.test(topRule('.co-sum')))
ok('…and so does the first-days hint: a step keeps 200px or goes under the others',
  /flex-wrap: wrap/.test(topRule('.co-hint')) && /flex: 1 1 200px/.test(topRule('.co-hint p')))

// Three languages, in plain words.
const said = (en, ru, uz) => i18n.includes(`"${en}": "${ru}"`) && i18n.includes(`"${en}": "${uz}"`)
ok('the Coach’s words, in all three languages',
  said('Start here', 'Начните отсюда', 'Shu yerdan boshlang')
  && said('Your step now', 'Ваш шаг сейчас', 'Hozir sizning qadamingiz')
  && said('After you press:', 'После нажатия:', 'Bosganingizdan keyin:')
  && said('Filming today', 'Снимаем сегодня', 'Bugun suratga olinadi')
  && said('Ready to publish', 'Готово к публикации', 'Nashrga tayyor')
  && said('You said you can’t', 'Вы отказались', 'Siz rad etdingiz'))

// The description of the look is kept true.
const guide = src('CLAUDE.md')
ok('CLAUDE.md describes the Coach look and names its parts', /## The Coach look/.test(guide) && /lib\/coach\.js/.test(guide) && /CoachTask/.test(guide) && /qa\/coach-suite\.mjs/.test(guide))
ok('the deploy gate runs this suite', /run coach-suite/.test(src('qa/ci.sh')))

console.log(fails ? `\n${fails} FAILED` : '\nThe Coach look holds.')
process.exit(fails ? 1 : 0)

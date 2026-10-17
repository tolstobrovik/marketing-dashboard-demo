// Scheduling and slots: a shoot is booked by the half-hour on the person's own
// day, a double booking is said out loud and only a channel admin can push
// through it, and a shoot booked in full is not left sitting at Idea.
//
// THE DAY. The strip the builder, the task sheet and the crew's own page draw
// is /users/:id/slots for one day in 30-minute steps — the same answer the
// week grid reads — so a shoot booked here is busy there, and leaving the task
// out (`exclude`) frees its own time while it is being moved.
//
// TWO BOOKINGS AT ONCE. The server answers 409 with the shoot in the way and
// whether this person may override; an SMM may not, an admin may with
// `force: true`.
//
// IDEA OR TO SHOOT. A filmed task the builder sends with its operator, day,
// hour, all three dates and a brief is created on the shooting stage. One line
// short of that it stays an idea — and nothing is refused that used to go
// through. A stage somebody chose (the full sheet, an API client) is theirs.
//
// THE PAGES. Read from the source: the strip snaps to 30 minutes on Tashkent
// time, the crew's page opens with "Your timeline today", the sheet has "View
// schedule availability", the hand-in says the slot is ticked off, the builder
// picks its day on a card of weeks and asks the brief as a template, and a
// shoot day on an idea is drawn pencilled in.
//
// WHAT THE DAY MAY NOT GET WRONG. A killed shoot keeps no hour; a booking an
// admin forced does not stop everybody else saving the sheet; a shoot with no
// end is one hour long on the strip and on the server alike; a time typed off
// the grid lands on it; a shoot with a day and no hour is said, not hidden;
// "now" and "today" are the server's, in Tashkent; an editor's day lists the
// cuts they owe; and the warning is a window, in the reader's language.
//
//   node qa/schedule-suite.mjs           (expects a server on :4090)
import { readFileSync } from 'fs'
import { join } from 'path'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))
const statuses = (await req('/statuses')).data
const idea = statuses.find((s) => /^idea$/i.test(s.label)) || statuses[0]
const toShoot = statuses.find((s) => /to\s*shoot/i.test(s.label))
const CH = 'instagram_main'

const sfx = Date.now().toString(36).slice(-5)
const smm = (await req('/users', 'POST', {
  name: 'Sevara Smm', username: 'ss' + sfx, password: 'pw123456', role: 'member',
  departments: [CH], permissions: { manage_content: true, move_tasks: true },
})).data
const op = (await req('/users', 'POST', { name: 'Oybek Films', username: 'so' + sfx, password: 'pw123456', role: 'operator' })).data
const ST = await login('ss' + sfx, 'pw123456')
ok('(an SMM and an operator to book)', !!smm.id && !!op.id && !!ST)

const D = day(3)
const SCRIPT = 'The host asks three students what surprised them on the exam, then shows the score board.'
// What TaskBuilder.payloadOf() builds for a reel with a slot picked on the strip.
const reel = (over = {}) => ({
  title: 'Schedule: slot reel', channels: [CH], type: 'reel', status_id: idea?.id ?? null, auto_stage: true,
  operator_id: op.id, recording_date: D, recording_time: '10:00', recording_end: '12:00',
  // After every shoot this suite books (days 3 to 16): a piece does not go out before it is filmed.
  release_date: day(20), edit_ready_date: null, description: '', reference_text: null, reference_links: [],
  script: null, tz: null, ...over,
})

// ===================== the day, in half-hours =====================
const a = await req('/content', 'POST', reel(), ST)
ok('a slot picked on the strip is saved with its hour and its end', a.status === 201
  && a.data.recording_time === '10:00' && a.data.recording_end === '12:00', `${a.status} ${a.data?.error || ''}`)
ok('…and, one line short of a booking, it is still an idea', a.data.status_id === idea?.id, String(a.data.status_id))
const slots = (await req(`/users/${op.id}/slots?from=${D}&days=1&mins=30`, 'GET', null, ST)).data
const busy = slots?.calendar?.[0]?.busy || []
ok('the operator\'s day shows the shoot as taken', busy.some((b) => b.id === a.data.id && b.from === '10:00' && b.to === '12:00'),
  JSON.stringify(busy))
const freed = (await req(`/users/${op.id}/slots?from=${D}&days=1&mins=30&exclude=${a.data.id}`, 'GET', null, ST)).data
ok('…and leaving the task out frees its own time while it is being moved',
  !(freed?.calendar?.[0]?.busy || []).some((b) => b.id === a.data.id))

// ===================== two bookings at once =====================
const clash = await req('/content', 'POST', reel({ title: 'Schedule: clash', recording_time: '11:00', recording_end: '12:30' }), ST)
ok('booking the same operator over it is warned, not saved', clash.status === 409, String(clash.status))
ok('…naming the shoot in the way', (clash.data.conflicts || []).some((c) => c.id === a.data.id && c.from === '10:00'),
  JSON.stringify(clash.data.conflicts))
ok('…and an SMM is told they cannot push through', clash.data.can_force === false)
const forcedBySmm = await req('/content', 'POST', reel({ title: 'Schedule: clash', recording_time: '11:00', recording_end: '12:30', force: true }), ST)
ok('…and "force" from an SMM changes nothing', forcedBySmm.status === 409, String(forcedBySmm.status))
const adminAsk = await req('/content', 'POST', reel({ title: 'Schedule: admin clash', recording_time: '11:00', recording_end: '12:30' }))
ok('an admin is warned too — and told they may override', adminAsk.status === 409 && adminAsk.data.can_force === true,
  `${adminAsk.status} ${adminAsk.data.can_force}`)
const forced = await req('/content', 'POST', reel({ title: 'Schedule: admin clash', recording_time: '11:00', recording_end: '12:30', force: true }))
ok('…and "Book anyway" books it', forced.status === 201, `${forced.status} ${forced.data?.error || ''}`)
const moved = await req('/content', 'POST', reel({ title: 'Schedule: after it', recording_time: '12:30', recording_end: '13:00' }), ST)
ok('the half-hour straight after is free', moved.status === 201, `${moved.status} ${moved.data?.error || ''}`)

// ===================== idea or to shoot =====================
const booked = await req('/content', 'POST', reel({
  title: 'Schedule: booked in full', recording_date: day(4), recording_time: '14:00', recording_end: '15:00',
  edit_ready_date: day(5), script: SCRIPT, reference_text: 'Like this one',
  reference_links: ['https://www.instagram.com/reel/schedule1'], tz: 'Under a minute, captions on, cut on every answer.',
}), ST)
ok('a shoot booked in full is created on "To shoot", not left at Idea',
  booked.status === 201 && !!toShoot && booked.data.status_id === toShoot.id, `${booked.status} ${booked.data?.status_id} ${booked.data?.error || ''}`)
ok('…with the brief lines where the full sheet reads them',
  booked.data.script === SCRIPT && booked.data.tz && booked.data.reference_text === 'Like this one')
const sheetIdea = await req('/content', 'POST', reel({
  title: 'Schedule: chosen idea', auto_stage: undefined, recording_date: day(4), recording_time: '12:00', recording_end: '13:00',
  edit_ready_date: day(5), script: 'A student walks the campus and names three things nobody told her before she arrived.',
  reference_links: ['https://www.instagram.com/reel/schedule2'],
}), ST)
ok('…but Idea picked on the full sheet stays Idea, however booked', sheetIdea.status === 201 && sheetIdea.data.status_id === idea?.id,
  `${sheetIdea.status} ${sheetIdea.data?.status_id} ${sheetIdea.data?.error || ''}`)
const noScript = await req('/content', 'POST', reel({
  title: 'Schedule: no script', recording_date: day(4), recording_time: '16:00', recording_end: '17:00', edit_ready_date: day(5),
}), ST)
ok('without a script it stays an idea — and is not refused', noScript.status === 201 && noScript.data.status_id === idea?.id,
  `${noScript.status} ${noScript.data?.status_id}`)
const wordsOnly = await req('/content', 'POST', reel({
  title: 'Schedule: words-only reference', recording_date: day(4), recording_time: '17:00', recording_end: '18:00',
  edit_ready_date: day(5), script: 'Two students compare the SAT and the ACT and say which one they chose and why.',
  reference_text: 'like the clip Dilnoza sent',
}), ST)
// A reference is a link OR words (the owner, 13 Oct): words alone are a real
// reference, so a booked shoot with one is born on To shoot like any other.
ok('a reference of words alone is a real reference: the booked shoot is born on To shoot',
  wordsOnly.status === 201 && !!toShoot && wordsOnly.data.status_id === toShoot.id, `${wordsOnly.status} ${wordsOnly.data?.status_id} ${wordsOnly.data?.error || ''}`)
const post = await req('/content', 'POST', reel({
  title: 'Schedule: a post', type: 'post', recording_date: day(4), recording_time: '09:00', recording_end: '09:30',
  edit_ready_date: day(5), script: 'A carousel of five reading tips, each with a worked example from a past paper.',
}), ST)
ok('work that is not filmed is never moved on by it', post.status === 201 && post.data.status_id === idea?.id,
  `${post.status} ${post.data?.status_id}`)
const chosen = await req('/content', 'POST', reel({
  title: 'Schedule: already editing', status_id: statuses.find((s) => /editing/i.test(s.label))?.id,
  recording_date: day(-2), recording_time: '10:00', recording_end: '11:00', edit_ready_date: day(1), script: 'Footage already shot on a phone last week, a full walk through the campus library.',
}))
ok('a stage somebody chose themselves is left alone', chosen.status === 201
  && chosen.data.status_id === statuses.find((s) => /editing/i.test(s.label))?.id, `${chosen.status} ${chosen.data?.status_id}`)

// ===================== the pages =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const tl = src('client/src/components/DayTimeline.jsx')
ok('the strip snaps to the half hour', /const STEP = 30\b/.test(tl) && /mins=\$\{STEP\}/.test(tl))
ok('…on Tashkent time, with the hours gone by greyed', /Asia\/Tashkent/.test(tl) && /past/.test(tl))
ok('…and on a phone it opens on the part that matters', /scrollLeft/.test(tl))
const crew = src('client/src/components/CrewDay.jsx')
ok('the crew\'s page opens with "Your timeline today"', /tx\('Your timeline today'\)/.test(crew) && /<DayTimeline readOnly/.test(crew))
ok('…with today\'s shoots that have no hour under it', /tx\('Unscheduled today'\)/.test(crew))
const modal = src('client/src/components/ContentModal.jsx')
ok('the task sheet has "View schedule availability" beside the crew', /tx\('View schedule availability'\)/.test(modal) && /<DayTimeline /.test(modal))
const hand = src('client/src/components/HandIn.jsx')
ok('the hand-in says the slot is ticked off — and is still one link, one button', /hi-slot/.test(hand))
const when = src('client/src/components/builder/StepWhen.jsx')
const shoot = src('client/src/components/builder/StepShoot.jsx')
ok('the builder books the filmer\'s half-hour on their day, on the shoot\'s own step', /<DayTimeline userId=\{operatorId\}/.test(shoot))
const cal = src('client/src/components/builder/MiniCalendar.jsx')
ok('its day is a card of weeks starting Monday, not the browser\'s picker', /WEEKS = 5/.test(cal) && /\['Mo', 'Tu'/.test(cal) && !/type="date"/.test(when))
const more = src('client/src/components/builder/StepMore.jsx')
const builder = src('client/src/components/builder/TaskBuilder.jsx')
const titleStep = src('client/src/components/builder/StepTitle.jsx')
ok('"Anything else?" asks the brief as a template — Reference, Script, ТЗ — and the description is asked with the name',
  /tx\('Reference'\)/.test(more) && /tx\('Script'\)/.test(more) && /'ТЗ'/.test(more) && /tx\('Description'\)/.test(titleStep))
ok('…and the lines are the task\'s own fields', /script: d\.script\.trim\(\) \|\| null/.test(builder) && /tz: d\.tz\.trim\(\) \|\| null/.test(builder)
  && /reference_text:/.test(builder))
ok('the builder, which asks no stage, lets the board choose it', /auto_stage: true/.test(builder))
const agenda = src('client/src/components/DayAgenda.jsx')
ok('a shoot day on an idea is drawn pencilled in', /pencil/.test(agenda) && /stageRankOf/.test(agenda))
const i18n = src('client/src/lib/i18n.jsx')
ok('the spec\'s words, in all three languages',
  i18n.includes('"View schedule availability": "Смотреть расписание"') && i18n.includes('"View schedule availability": "Jadvalni koʻrish"')
  && i18n.includes('"Your timeline today": "Твой график на сегодня"') && i18n.includes('"Your timeline today": "Bugungi jadvalingiz"'))

// ===================== what the day may not get wrong =====================
// Each of these was a way the day on the strip and the server's answer
// disagreed, or a warning nobody could see.
const deleted = statuses.find((s) => /^deleted$/i.test(s.label))
const G = day(8)
const extra = []
const killed = (await req('/content', 'POST', reel({ title: 'Schedule: killed', recording_date: G, recording_time: '14:00', recording_end: '15:00' }))).data
extra.push(killed)
await req(`/content/${killed.id}`, 'PATCH', { status_id: deleted?.id })
const afterKill = (await req(`/users/${op.id}/slots?from=${G}&days=1&mins=30`, 'GET', null, ST)).data
ok('a shoot moved to Deleted gives its hour back on the strip', !!deleted
  && !(afterKill?.calendar?.[0]?.busy || []).some((b) => b.id === killed.id), JSON.stringify(afterKill?.calendar?.[0]?.busy))
const overKilled = await req('/content', 'POST', reel({ title: 'Schedule: over the killed one', recording_date: G, recording_time: '14:00', recording_end: '15:00' }), ST)
extra.push(overKilled.data)
ok('…and booking that hour again is not a double booking', overKilled.status === 201, `${overKilled.status} ${overKilled.data?.error || ''}`)

// A booking an admin forced stays savable by everybody else.
const H = day(9)
const base = (await req('/content', 'POST', reel({ title: 'Schedule: first', recording_date: H, recording_time: '10:00', recording_end: '12:00' }))).data
const over = (await req('/content', 'POST', reel({ title: 'Schedule: forced over it', recording_date: H, recording_time: '11:00', recording_end: '12:00', force: true }))).data
extra.push(base, over)
const typo = await req(`/content/${over.id}`, 'PATCH', {
  description: 'fixing a typo', operator_id: over.operator_id, recording_date: over.recording_date,
  recording_time: over.recording_time, recording_end: over.recording_end,
}, ST)
ok('after an admin books over a shoot, an SMM saving the same sheet is not stopped', typo.status === 200, `${typo.status} ${typo.data?.error || ''}`)
const nudge = await req(`/content/${over.id}`, 'PATCH', { recording_time: '11:30', recording_end: '12:00' }, ST)
ok('…but actually moving it within the clash is still a double booking', nudge.status === 409, String(nudge.status))

// One length for a shoot with a start and no end, on both sides.
const J = day(10)
const noEnd = (await req('/content', 'POST', reel({ title: 'Schedule: no end', recording_date: J, recording_time: '10:00', recording_end: null }))).data
extra.push(noEnd)
const noEndDay = (await req(`/users/${op.id}/slots?from=${J}&days=1&mins=30`, 'GET', null, ST)).data
const drawn = (noEndDay?.calendar?.[0]?.busy || []).find((b) => b.id === noEnd.id)
ok('a shoot with no end is drawn one hour long — the hour the guard assumes', drawn?.to === '11:00', JSON.stringify(drawn))
const at11 = await req('/content', 'POST', reel({ title: 'Schedule: at eleven', recording_date: J, recording_time: '11:00', recording_end: '12:00' }), ST)
extra.push(at11.data)
ok('…so the hour after it is free on the strip and on the server alike', at11.status === 201, `${at11.status} ${at11.data?.error || ''}`)

// Quarter hours, whoever sent the time (round 8: "make each element 15 minutes"; it was half hours).
const K = day(11)
const typed = await req('/content', 'POST', reel({ title: 'Schedule: typed by hand', recording_date: K, recording_time: '10:10', recording_end: '10:40' }), ST)
extra.push(typed.data)
ok('a time typed off the grid is stored on it — start down, end up',
  typed.data?.recording_time === '10:00' && typed.data?.recording_end === '10:45', `${typed.data?.recording_time}–${typed.data?.recording_end}`)

// A day with no hour on it is still somebody's day.
const untimedTask = (await req('/content', 'POST', reel({ title: 'Schedule: day, no hour', recording_date: K, recording_time: null, recording_end: null }))).data
extra.push(untimedTask)
const kDay = (await req(`/users/${op.id}/slots?from=${K}&days=1&mins=30`, 'GET', null, ST)).data?.calendar?.[0]
ok('a shoot with a day and no hour is said under the strip, not drawn as taken',
  (kDay?.untimed || []).some((b) => b.id === untimedTask.id) && !(kDay?.busy || []).some((b) => b.id === untimedTask.id), JSON.stringify(kDay?.untimed))

// The server's clock, and Tashkent's day.
const plain = (await req(`/users/${op.id}/slots?days=1&mins=30`, 'GET', null, ST)).data
ok('the day strip carries the server\'s clock', !!plain?.now?.at && /^\d{2}:\d{2}$/.test(plain?.now?.time || ''), JSON.stringify(plain?.now))
ok('…and with no day asked for, starts on Tashkent\'s today', plain?.calendar?.[0]?.day === day(0) && plain?.now?.day === day(0),
  `${plain?.calendar?.[0]?.day} vs ${day(0)}`)
ok('…and offers nothing today that has already gone by',
  (plain?.calendar?.[0]?.slots || []).every((s) => s.from >= plain.now.time.slice(0, 3) + (Number(plain.now.time.slice(3)) >= 30 ? '30' : '00')))

// Working hours that start at a quarter past still offer half-hours.
const quarter = (await req('/users', 'POST', { name: 'Quarter Past', username: 'sq' + sfx, password: 'pw123456', role: 'operator', work_start: '09:15', work_end: '18:00' })).data
const qDay = (await req(`/users/${quarter.id}/slots?from=${day(12)}&days=1&mins=30`, 'GET', null, ST)).data?.calendar?.[0]
ok('hours set as 09:15 offer 09:30 first, not 09:15', qDay?.slots?.[0]?.from === '09:30', JSON.stringify(qDay?.slots?.slice(0, 2)))

// Outside their hours, said in parts so it can be said in any language.
const late = await req('/content', 'POST', reel({ title: 'Schedule: after hours', operator_id: quarter.id, recording_date: day(12), recording_time: '19:00', recording_end: '20:00' }), ST)
ok('a shoot outside their hours names why, in parts the page can translate',
  late.status === 409 && late.data?.schedule_why?.kind === 'hours' && late.data?.schedule_why?.from === '09:15', JSON.stringify(late.data?.schedule_why))

// An editor's day: the cuts they owe that day.
const ed = (await req('/users', 'POST', { name: 'Diyor Cuts', username: 'sd' + sfx, password: 'pw123456', role: 'editor' })).data
const L = day(13)
const cutTask = (await req('/content', 'POST', reel({ title: 'Schedule: a cut owed', editor_id: ed.id, recording_date: day(12), recording_time: '09:00', recording_end: '10:00', edit_ready_date: L }))).data
extra.push(cutTask)
const lDay = (await req(`/users/${ed.id}/slots?from=${L}&days=1&mins=30`, 'GET', null, ST)).data?.calendar?.[0]
ok('an editor\'s day lists the cuts they owe on it', (lDay?.due || []).some((c) => c.id === cutTask.id), JSON.stringify(lDay?.due))
ok('…without taking a free half-hour away', (lDay?.busy || []).length === 0 && (lDay?.slots || []).length > 0)
const lExcl = (await req(`/users/${ed.id}/slots?from=${L}&days=1&mins=30&exclude=${cutTask.id}`, 'GET', null, ST)).data?.calendar?.[0]
ok('…and leaves out the task being edited', !(lExcl?.due || []).some((c) => c.id === cutTask.id))

// Coming back into the plan. A killed shoot brought back over a booking made
// since is a double booking; one whose day is behind it books nobody.
const Q = day(16)
const gone = (await req('/content', 'POST', reel({ title: 'Schedule: killed, then back', recording_date: Q, recording_time: '15:00', recording_end: '16:00' }))).data
await req(`/content/${gone.id}`, 'PATCH', { status_id: deleted?.id })
const took = (await req('/content', 'POST', reel({ title: 'Schedule: took its hour', recording_date: Q, recording_time: '15:00', recording_end: '16:00' }), ST)).data
extra.push(gone, took)
const revive = await req(`/content/${gone.id}`, 'PATCH', { status_id: idea?.id })
ok('bringing a killed shoot back over a booking made since is warned', revive.status === 409
  && (revive.data?.conflicts || []).some((c) => c.id === took.id), `${revive.status} ${revive.data?.error || ''}`)
const oldA = (await req('/content', 'POST', reel({ title: 'Schedule: last month A', recording_date: day(-20), recording_time: '15:00', recording_end: '16:00' }))).data
const oldB = (await req('/content', 'POST', reel({ title: 'Schedule: last month B', recording_date: day(-20), recording_time: '15:00', recording_end: '16:00', force: true }))).data
extra.push(oldA, oldB)
await req(`/content/${oldB.id}`, 'PATCH', { status_id: deleted?.id })
const oldBack = await req(`/content/${oldB.id}`, 'PATCH', { status_id: idea?.id })
ok('…but a piece whose shoot is behind it comes back without a fuss', oldBack.status === 200, `${oldBack.status} ${oldBack.data?.error || ''}`)

// Saying yes to "can it be another day?" is booking the operator on that day.
const M = day(14), N = day(15)
const there = (await req('/content', 'POST', reel({ title: 'Schedule: already there', recording_date: M, recording_time: '10:00', recording_end: '11:00' }))).data
const moving = (await req('/content', 'POST', reel({ title: 'Schedule: asks to move', recording_date: N, recording_time: '10:00', recording_end: '11:00' }))).data
extra.push(there, moving)
const ask = (await req(`/content/${moving.id}/date-requests`, 'POST', { field: 'recording_date', to_date: M, reason: 'The student we are filming is only free on the earlier day.' }, ST)).data
const yes = await req(`/content/date-requests/${ask.id}/decide`, 'POST', { approve: true })
ok('approving a new shoot day that lands on another shoot is warned first', yes.status === 409
  && (yes.data?.conflicts || []).some((c) => c.id === there.id) && yes.data?.can_force === true, `${yes.status} ${JSON.stringify(yes.data)}`)
const yesAnyway = await req(`/content/date-requests/${ask.id}/decide`, 'POST', { approve: true, force: true })
ok('…and the admin can say yes anyway', yesAnyway.status === 200 && yesAnyway.data?.task?.recording_date === M,
  `${yesAnyway.status} ${yesAnyway.data?.error || ''}`)

// The pages.
const clashBox = src('client/src/components/ClashDialog.jsx')
ok('a double booking is answered in a window — role alertdialog, over the sheet', /role="alertdialog"/.test(clashBox) && /aria-modal="true"/.test(clashBox) && /createPortal/.test(clashBox))
ok('…whose Escape is "Pick another time" and does not reach the sheet under it', /addEventListener\('keydown', onKey, true\)/.test(clashBox) && /stopPropagation/.test(clashBox))
ok('…used by the builder and the task sheet both', /<ClashDialog /.test(builder) && /<ClashDialog /.test(modal))
ok('…and by every other place a shoot is moved: the calendars, the crew board, the handover gate, an approved day',
  ['client/src/pages/Schedule.jsx', 'client/src/pages/Department.jsx', 'client/src/pages/Crew.jsx', 'client/src/components/StageGate.jsx']
    .every((p) => /useClash\(\)/.test(src(p)) && /askClash\(/.test(src(p)))
  && /<ClashDialog /.test(src('client/src/pages/Overview.jsx')) && /<ClashDialog /.test(src('client/src/components/TaskMore.jsx')))
ok('…and nothing in it is left in English', !/>\s*Schedule anyway\s*</.test(modal) && /tx\('Book anyway'\)/.test(clashBox))
ok('the crew\'s timeline is shown to all of the crew, editors included', /showTimeline = caps\.length > 0/.test(crew)
  && /e\.kind !== 'shoot' && e\.due === today/.test(crew))
ok('…and follows the board as it changes', /stamp=\{todaysShoots/.test(crew) && /excludeId, stamp\]/.test(tl))
ok('the strip greys by the server\'s clock, and keeps greying while it is open', /d\.now\.at/.test(tl) && /setInterval\(/.test(tl))
ok('…and a taken half-hour can still be pressed while booking', /\.dt:not\(\.dt-ro\) \.dt-busy/.test(src('client/src/styles.css')))
ok('on a phone the strip swipes inside the sheet rather than the sheet swiping', /\.crew-row \{[^}]*min-width: 0/.test(src('client/src/styles.css')))
ok('the lengths are words in the reader\'s language', /tx\('\{n\}m'/.test(tl) && /tx\('\{n\}h'/.test(tl))

// ===================== tidy up =====================
for (const r of [a, forced, moved, booked, sheetIdea, noScript, wordsOnly, post, chosen]) {
  if (r.data?.id) await req(`/content/${r.data.id}`, 'DELETE')
}
for (const r of extra) if (r?.id) await req(`/content/${r.id}`, 'DELETE')

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

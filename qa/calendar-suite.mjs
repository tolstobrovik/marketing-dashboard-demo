// The Master Calendar and its Bulk Actions (Content Makers 2.0).
//
// THE DRY RUN. A bulk move asks the server about every task before moving
// any: `PATCH /content/:id?dry=1` runs every check a real save makes and
// writes nothing. Its refusals name the field they want — the booking wall,
// the brief the admin demands, the editor, the published link — so the bulk
// window can put the right box beside the right task, and a task still short
// of something stays where it is. And it names EVERY one at once (`missing`),
// so the row carries a box for each from the start; a real save still answers
// with the first alone, as the board's own window has always read it. A bad
// answer typed into a box — a script that is only a Docs link, a note, a twin
// of another task's — comes back on that same box, while the admin, who is
// not made to fill in a form, is told yes. The row says such an answer is
// wrong in the server's words and keeps "Needs «X»" for a field with nothing
// in it: the list marks what a task holds but is refused for (`wrong`). What
// the server only advises (the reviewer and the cut on the way to Ready) the
// window asks for itself, from the same handover the board's window reads,
// and a handover it cannot read holds the row rather than letting it go.
//
// THE DAYS. A release dragged earlier than the cut or artwork it waits on
// brings those days back with it, keeping their gap where it can and due today
// (or on the shoot day, for a cut) where it cannot. It is refused only when no
// day would do. Work already handed in stays where it was met, each phase on
// its own hand-in.
//
// THE MOVE. What the calendar's drag rests on, asked of the server: an admin
// moves a promised day, a planner moves an idea's, and a planner refused a
// promised one is handed the ask for the day she dragged.
//
// THE PAGE. Read from the source: /calendar is the Master Calendar in every
// language, /releases still lands there, several channels show at once and
// say whose each card is, dragging is move_tasks' alone on work that is theirs
// and a phone (on its side too) only looks, shift-click or Space picks, a
// campaign link keeps its lens, and the bulk window asks the dry run. A member
// with one channel finds it in the top bar on a desk, the '?' explains it, and
// Admin → Pages calls it by the same name.
//
//   node qa/calendar-suite.mjs           (expects a server on :4090)
import { readFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const A = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = A) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))
const statuses = (await req('/statuses')).data
const S = (re) => statuses.find((s) => re.test(s.label))
const idea = S(/^idea$/i), toShoot = S(/to\s*shoot/i), editing = S(/^editing$/i), ready = S(/^ready$/i), published = statuses.find((s) => s.is_final)
const CH = 'instagram_main'
const sfx = Date.now().toString(36).slice(-5)
const mk = async (b) => (await req('/users', 'POST', { password: 'pw123456', ...b })).data
const smm = await mk({ name: 'Madina Plans', username: 'cm' + sfx, role: 'member', departments: [CH], permissions: { manage_content: true, move_tasks: true } })
const op = await mk({ name: 'Otabek Films', username: 'co' + sfx, role: 'operator' })
const ed = await mk({ name: 'Eldor Cuts', username: 'ce' + sfx, role: 'editor' })
const ST = await login('cm' + sfx, 'pw123456')
ok('(a planner who is not an admin, with move_tasks)', !!smm.id && !!ST && !!idea && !!toShoot && !!editing && !!ready)
const made = []
const task = async (b) => { const r = await req('/content', 'POST', { channels: [CH], type: 'reel', status_id: idea.id, ...b }, ST); if (r.data?.id) made.push(r.data.id); return r.data }
const dry = (id, b) => req(`/content/${id}?dry=1`, 'PATCH', b, ST)
const stageOf = async (id) => (await req(`/content/${id}`, 'GET', null, ST)).data.status_id

// ===================== the dry run =====================
// A script is refused as the twin of any other task's, so this run's are its
// own: a run that stopped before tidying up would otherwise leave its scripts
// behind and fail the next run on words it wrote itself.
const SCRIPT = `Three students from group ${sfx} say in one sentence each what they wish they had known before the SAT.`
const t1 = await task({ title: 'Calendar: bulk idea' })
// Round 8 (October 2026): a shoot is booked with who films, the day, the hours
// and the script. The edit day and the day to post are asked later, on the
// way to editing (qa/r8-rules-suite.mjs pins the rule itself).
const steps = [
  ['operator_id', op.id], ['recording_date', day(3)], ['recording_time', '14:00'], ['script', SCRIPT],
]
// Every gap at once, not the first: the bulk window puts a box beside each,
// and a booking short of six things used to be six trips to find that out.
const fieldsOf = (d) => (Array.isArray(d?.missing) ? d.missing.map((m) => m.field) : null)
const bare = await dry(t1.id, { status_id: toShoot.id })
ok(`a dry run to «${toShoot.label}» lists every gap at once, in the order they are asked, each with its sentence`,
  bare.status === 400 && JSON.stringify(fieldsOf(bare.data)) === JSON.stringify(steps.map(([f]) => f)) && bare.data.missing.every((m) => m.error),
  `${bare.status} ${fieldsOf(bare.data)?.join(', ')}`)
let given = {}
for (const [i, [field, value]] of steps.entries()) {
  const r = await dry(t1.id, { status_id: toShoot.id, ...given })
  ok(`…names what is missing next: ${field}, and lists only what is left`, r.status === 400 && r.data.field === field
    && JSON.stringify(fieldsOf(r.data)) === JSON.stringify(steps.slice(i).map(([f]) => f)), `${r.status} ${r.data.field} [${fieldsOf(r.data)?.join(', ')}] ${r.data.error || ''}`)
  given = { ...given, [field]: value }
}
// The list rides on the dry run alone. The board's handover window reads a
// key of that name on a real refusal as the ONE field to reopen on, and a
// list there would turn a step it can go back to into a dead end.
const realNo = await req(`/content/${t1.id}`, 'PATCH', { status_id: toShoot.id }, ST)
ok('a real save is refused as it always was: the first wall, no list', realNo.status === 400 && realNo.data.field === 'operator_id'
  && realNo.data.missing === undefined && (await stageOf(t1.id)) === idea.id, `${realNo.status} ${JSON.stringify(realNo.data).slice(0, 140)}`)
const clear = await dry(t1.id, { status_id: toShoot.id, ...given })
ok('…and once everything is given, it says yes', clear.status === 200 && clear.data.dry === true, `${clear.status} ${clear.data.error || ''}`)
ok('…having written nothing', (await stageOf(t1.id)) === idea.id)
ok('…not even the ten-second undo a real move leaves behind', (await req(`/content/${t1.id}/undo`, 'POST', {}, ST)).status === 404)
const real = await req(`/content/${t1.id}`, 'PATCH', { status_id: toShoot.id, ...given }, ST)
ok('the real move with the same answers goes through', real.status === 200 && real.data.status_id === toShoot.id, `${real.status} ${real.data.error || ''}`)
ok('…carrying what was filled in', real.data.operator_id === op.id && real.data.recording_time === '14:00' && real.data.script === SCRIPT)

// …and editing asks what the editor works from: the reference, the ТЗ, who
  // edits, the day to post.
const EDIT = { reference_text: 'https://www.instagram.com/reel/cal-ref/', tz: 'Under a minute, captions on, a new shot on every answer, upbeat music.', editor_id: ed.id, release_date: day(7) }
const toEdit = await dry(t1.id, { status_id: editing.id, shot_link: 'https://drive.google.com/footage' })
ok('moving filmed work on to editing names what the editor works from, and the editor', toEdit.status === 400
  && JSON.stringify(fieldsOf(toEdit.data)) === JSON.stringify(Object.keys(EDIT)), `${toEdit.status} ${fieldsOf(toEdit.data)?.join(', ')}`)
ok('…and names nothing else wrong once they are given', (await dry(t1.id, { status_id: editing.id, shot_link: 'https://drive.google.com/footage', ...EDIT })).status === 200)
if (published) {
  const pub = await dry(t1.id, { status_id: published.id })
  ok('publishing with no link asks for the link', pub.status === 400 && (pub.data.needs === 'post_link' || pub.data.field === 'post_link'), `${pub.status} ${JSON.stringify(pub.data).slice(0, 120)}`)
}

// The handover's questions. On the way to Ready the server only ADVISES a
// reviewer and the cut (content.js, `shortfalls`), so its dry run says yes to
// a cut nobody attached; the board's window asks for both on every single
// move, and the bulk window asks the same handover. Read here from the server
// as the member sees it, and answered by the bulk window's own rule — lifted
// out of BulkMove.jsx, since a .jsx file cannot be imported from Node.
const cutDone = await req(`/content/${t1.id}`, 'PATCH', { status_id: editing.id, shot_link: 'https://drive.google.com/footage', ...EDIT }, ST)
ok(`(filmed, and on «${editing.label}»)`, cutDone.status === 200 && cutDone.data.status_id === editing.id, `${cutDone.status} ${cutDone.data.error || ''}`)
const gates = (await req(`/content/${t1.id}/handover?to=${ready.id}`, 'GET', null, ST)).data.gates || []
const review = gates.find((g) => g.key === 'review')
ok(`the handover to «${ready.label}» asks the member for a reviewer and the link to the cut`, !!review && review.owner_field === 'reviewer_id'
  && review.link_field === 'ready_link' && review.link_ok === false && !review.current?.length, JSON.stringify(review || gates).slice(0, 200))
ok('…while the admin is asked nothing', (await req(`/content/${t1.id}/handover?to=${ready.id}`)).data.gates?.length === 0)
ok('…and the dry run alone would have let it through', (await dry(t1.id, { status_id: ready.id })).status === 200)
const bulkSrc = readFileSync(join(ROOT, 'client/src/components/BulkMove.jsx'), 'utf8')
const gapSrc = /\nconst handoverGap = ([\s\S]*?\n\})\n/.exec(bulkSrc)?.[1]
const handoverGap = gapSrc ? new Function(`return ${gapSrc}`)() : () => null
ok('so the bulk window asks for both itself', JSON.stringify(handoverGap(gates, {})) === JSON.stringify(['reviewer_ids', 'ready_link']), JSON.stringify(handoverGap(gates, {})))
ok('…keeps asking for a cut that is not a link', JSON.stringify(handoverGap(gates, { reviewer_ids: [smm.id], ready_link: 'the cut is on my laptop' })) === JSON.stringify(['ready_link']))
ok('…and lets it go once both are given', handoverGap(gates, { reviewer_ids: [smm.id], ready_link: 'https://drive.google.com/cut' })?.length === 0)

// the brief the admin demands from the working stages on
const before = (await req('/fields')).data
const keep = {}
for (const k of ['format', 'rubrika', 'script', 'tz', 'reference', 'description']) if (before[k]) keep[k] = { state: before[k].state, types: before[k].types, ...(before[k].options ? { options: before[k].options } : {}) }
await req('/fields', 'POST', { ...keep, tz: { state: 'required', types: ['reel'] }, script: { state: 'required', types: ['reel'] } })
const t2 = await task({ title: 'Calendar: no ТЗ', operator_id: op.id, recording_date: day(4), recording_time: '15:00', recording_end: '16:00', edit_ready_date: day(6), release_date: day(8), script: SCRIPT + ' Second take.', reference_links: ['https://www.instagram.com/reel/cal1/'] })
const noTz = await dry(t2.id, { status_id: toShoot.id })
ok('a brief field the admin demands is named by its key', noTz.status === 400 && noTz.data.field === 'tz', `${noTz.status} ${noTz.data.field} ${noTz.data.error || ''}`)
ok('…and filling it clears the way', (await dry(t2.id, { status_id: toShoot.id, tz: 'Under a minute, captions on, cut on every answer, upbeat music.' })).status === 200)

// The brief and the booking, listed together: a reel with nothing on it yet
// is short of a script, a ТЗ, a shooter, the day and the hour —
// and the script, which the admin demands AND a booked shoot needs, is one box.
const t3 = await task({ title: 'Calendar: nothing written yet' })
const whole = await dry(t3.id, { status_id: toShoot.id })
const wants = fieldsOf(whole.data) || []
ok('a dry run lists the brief the admin demands beside the booking, every field once',
  whole.status === 400 && wants.length === 5 && new Set(wants).size === 5
  && ['script', 'tz', 'operator_id', 'recording_date', 'recording_time'].every((f) => wants.includes(f)), wants.join(', '))
ok('…and answers with the first of them, word for word', whole.data.field === wants[0] && whole.data.error === whole.data.missing?.[0]?.error)

// A bad answer comes back on its own box. The script is where it happens
// most: a Docs link pasted in place of the words, a two-word note, the
// script of another task. Each used to come back naming no field at all, and
// the bulk row lost its box and the answer typed into it.
const DOC = 'https://docs.google.com/document/d/1-calendar-suite/edit'
const asLink = await dry(t3.id, { status_id: toShoot.id, script: DOC })
ok('a script that is only a Docs link is refused on the script, and told it is a link', asLink.status === 400 && asLink.data.field === 'script'
  && /not just the link/.test(asLink.data.error || ''), `${asLink.status} ${asLink.data.field} ${asLink.data.error || ''}`)
const asNote = await dry(t3.id, { status_id: toShoot.id, script: 'Two words' })
ok('…a note of two words, on the script too', asNote.status === 400 && asNote.data.field === 'script', `${asNote.status} ${asNote.data.field} ${asNote.data.error || ''}`)
const asTwin = await dry(t3.id, { status_id: toShoot.id, script: t2.script })
ok('…and a script already on another task, on the script', asTwin.status === 400 && asTwin.data.field === 'script'
  && /already on/.test(asTwin.data.error || ''), `${asTwin.status} ${asTwin.data.field} ${asTwin.data.error || ''}`)
// …and what the row SAYS about it. "Needs «Script»" is for a field with
// nothing in it; beside a script somebody has just typed it is the one thing
// on the row that is not true, and it hid the reason — the twin, the link —
// in a hover tip no tablet ever shows. Asked of the bulk window's own reading
// of a refusal, lifted out of BulkMove.jsx like handoverGap above, and fed
// the server's real answers.
const fieldOfSrc = /\nconst fieldOf = (.*)\n/.exec(bulkSrc)?.[1]
const needsSrc = /\nconst needsOf = ([\s\S]*?\n\})\n/.exec(bulkSrc)?.[1]
const needsOf = fieldOfSrc && needsSrc ? new Function(`const fieldOf = ${fieldOfSrc}; return ${needsSrc}`)() : () => []
const hows = (list) => list.map((n) => `${n.field}:${n.how}`).join(' ')
ok('the bulk row asks for an empty field as empty', needsOf(whole.data, whole.data.error, {}).every((n) => n.how === 'fill'), hows(needsOf(whole.data, whole.data.error, {})))
ok('…but a script it was just sent and refused is told in the server\'s words: the twin',
  hows(needsOf(asTwin.data, asTwin.data.error, { script: t2.script })) === 'script:clash', hows(needsOf(asTwin.data, asTwin.data.error, { script: t2.script })))
ok('…the Docs link', hows(needsOf(asLink.data, asLink.data.error, { script: DOC })) === 'script:clash')
ok('…and a listed field it was sent, beside one still empty',
  hows(needsOf({ missing: [{ field: 'script', error: 'x' }, { field: 'tz', error: 'y' }] }, 'x', { script: 'Two words' })) === 'script:clash tz:fill')
// A field the task already HOLDS, refused for what it holds, is marked so by
// the dry run itself (`wrong`), whether or not this Check sent it.
const heldLink = await task({ title: 'Calendar: a script that is only a link', script: `${DOC}?${sfx}` })
const held = await dry(heldLink.id, { status_id: toShoot.id })
const heldScript = held.data.missing?.find((m) => m.field === 'script')
const heldTz = held.data.missing?.find((m) => m.field === 'tz')
ok('a dry run marks a field the task holds but is refused for as `wrong`, and an empty one not',
  held.status === 400 && heldScript?.wrong === true && /not just the link/.test(heldScript?.error || '') && !!heldTz && heldTz.wrong === undefined,
  JSON.stringify(held.data.missing || held.data).slice(0, 200))
ok('…nothing on a task with nothing written is marked wrong', whole.data.missing.every((m) => m.wrong === undefined))
const heldRow = needsOf(held.data, held.data.error, {})
ok('…so the row tells the stored link in the server\'s words, and asks for the ТЗ as empty',
  heldRow.filter((n) => n.how === 'clash').map((n) => n.field).join() === 'script' && heldRow.find((n) => n.field === 'tz')?.how === 'fill', hows(heldRow))
const heldReal = await req(`/content/${heldLink.id}`, 'PATCH', { status_id: toShoot.id }, ST)
ok('…and a real save answers exactly as before: the first wall, and nothing added to it',
  heldReal.status === 400 && Object.keys(heldReal.data).sort().join() === 'error,field' && heldReal.data.field === 'script', JSON.stringify(heldReal.data).slice(0, 160))
// The admin is not made to fill in a form (`unfettered`, content.js): the
// same answers, the same dry run, and yes to each — nothing asked, nothing
// written.
const byAdminDry = []
for (const script of [DOC, 'Two words', t2.script]) byAdminDry.push((await req(`/content/${t3.id}?dry=1`, 'PATCH', { status_id: toShoot.id, script })).status)
ok('the admin\'s dry run with the same answers says yes to each', byAdminDry.every((s) => s === 200), byAdminDry.join(' '))
ok('…having written nothing', (await stageOf(t3.id)) === idea.id && !(await req(`/content/${t3.id}`)).data.script)

await req('/fields', 'POST', keep)
const after = (await req('/fields')).data
ok('(the admin\'s rules are put back as they were)', after.tz?.state === before.tz?.state && after.script?.state === before.script?.state)

const stay = await dry(t2.id, { status_id: idea.id })
ok('a "move" to where it already is is answered, not refused', stay.status === 200)

// ===================== the days =====================
const { pullBackDates, cascadeDates } = await import(pathToFileURL(join(ROOT, 'client/src/lib/formState.js')).href)
const T0 = '2026-09-25'
const plan = { recording_date: '2026-10-01', edit_ready_date: '2026-10-04', design_ready_date: '2026-10-02', release_date: '2026-10-06' }
let r = pullBackDates(plan, '2026-10-03', T0)
ok('a release pulled before its cut brings the cut back, keeping the gap', r.moved.some((m) => m.key === 'edit_ready_date' && m.to === '2026-10-01'), JSON.stringify(r))
ok('…while an artwork day still before the new release stays put', !r.moved.some((m) => m.key === 'design_ready_date'), JSON.stringify(r.moved))
r = pullBackDates({ design_ready_date: '2026-10-02', release_date: '2026-10-06' }, '2026-10-01', T0)
ok('an artwork day left after the new release comes back too, keeping its gap', r.moved.some((m) => m.key === 'design_ready_date' && m.to === '2026-09-27'), JSON.stringify(r))
r = pullBackDates(plan, '2026-10-02', T0)
ok('a cut whose gap would land before its shoot is due on the shoot day instead', !r.problem && r.moved.some((m) => m.key === 'edit_ready_date' && m.to === '2026-10-01'), JSON.stringify(r))
r = pullBackDates(plan, '2026-09-30', T0)
ok('…and a release pulled before the shoot its cut waits on is refused, not written', r.problem?.why === 'shoot' && r.moved.length === 0, JSON.stringify(r))
r = pullBackDates({ ...plan, recording_date: null }, '2026-09-27', T0)
ok('a day whose gap would land in the past is due today instead, not refused',
  !r.problem && r.moved.find((m) => m.key === 'edit_ready_date')?.to === T0 && r.moved.find((m) => m.key === 'design_ready_date')?.to === T0, JSON.stringify(r))
r = pullBackDates({ ...plan, recording_date: null }, '2026-09-24', T0)
ok('…and a release pulled into the past with work still owed is refused', r.problem?.why === 'past' && r.moved.length === 0, JSON.stringify(r))
const cutIn = { edited_at: '2026-09-24T09:00:00Z' }
r = pullBackDates({ recording_date: '2026-10-01', edit_ready_date: '2026-10-04', release_date: '2026-10-06', ...cutIn }, '2026-09-26', T0)
ok('a cut already handed in neither moves nor stands in the way', !r.problem && r.moved.length === 0, JSON.stringify(r))
r = pullBackDates({ ...plan, ...cutIn }, '2026-09-26', T0)
ok('…while an artwork still being drawn comes back all the same', !r.problem && r.moved.length === 1
  && r.moved[0].key === 'design_ready_date' && r.moved[0].to === T0, JSON.stringify(r))
r = pullBackDates({ ...plan, ...cutIn, ready_at: '2026-09-24T12:00:00Z' }, '2026-09-26', T0)
ok('…and a piece that is ready moves nothing but itself', !r.problem && r.moved.length === 0, JSON.stringify(r))
r = pullBackDates({ recording_date: '2026-10-01', release_date: '2026-10-06' }, '2026-09-29', T0)
ok('an idea pulled out before its own shoot, with no cut to catch it, is refused', r.problem?.why === 'release', JSON.stringify(r))
ok('…but not once it is filmed', !pullBackDates({ recording_date: '2026-10-01', release_date: '2026-10-06', shot_at: '2026-09-24T10:00:00Z' }, '2026-09-29', T0).problem)
ok('a release moved LATER moves nothing back', pullBackDates(plan, '2026-10-09', T0).moved.length === 0)
ok('a release still after its cut leaves the cut alone', pullBackDates(plan, '2026-10-05', T0).moved.length === 0)
r = pullBackDates({ ...plan, edit_due_revised: '2026-10-05' }, '2026-10-04', T0)
ok('the revised cut day, when there is one, is the one that moves', r.moved.some((m) => m.field === 'edit_due_revised' && m.to === '2026-10-03'), JSON.stringify(r))
ok('(the forward chain still pushes the release after a later cut)', cascadeDates(plan, 'edit_ready_date', '2026-10-08').moved.some((m) => m.key === 'release_date'))

// ===================== the move =====================
// What the calendar's drag rests on. Its lift asks the same question the
// server does, and a refusal it cannot avoid is turned into the ask.
const books = readFileSync(join(ROOT, 'client/src/lib/i18n.jsx'), 'utf8')
const i18nHas = (en) => !!en && books.split(`${JSON.stringify(en)}:`).length === 3 // the RU book and the UZ one
const promised = await task({ title: 'Calendar: promised day', release_date: day(12) })
await req(`/content/${promised.id}`, 'PATCH', { status_id: toShoot.id, operator_id: op.id, recording_date: day(9), recording_time: '11:00',
  edit_ready_date: day(10), script: SCRIPT + ' Third take.' })
ok('(a task past the idea, with its release day promised)', (await stageOf(promised.id)) === toShoot.id)
const asked = await req(`/content/${promised.id}`, 'PATCH', { release_date: day(13) }, ST)
ok('a planner dragging a promised release is refused with the ask for that day', asked.status === 403 && asked.data.ask_to_move?.field === 'release_date'
  && asked.data.ask_to_move?.to === day(13), `${asked.status} ${JSON.stringify(asked.data).slice(0, 160)}`)
ok('…in words the phrase books carry', i18nHas(asked.data.error))
const byAdmin = await req(`/content/${promised.id}`, 'PATCH', { release_date: day(13) })
ok('an admin moves the same day', byAdmin.status === 200 && (await req(`/content/${promised.id}`)).data.release_date === day(13), `${byAdmin.status} ${byAdmin.data.error || ''}`)
// …and the other refusal, on a piece that is past the making and waits to go
// out: its day is promised rather than frozen, and said in different words.
const waiting = await task({ title: 'Calendar: ready and waiting', release_date: day(17) })
await req(`/content/${waiting.id}`, 'PATCH', { status_id: ready.id })
ok(`(a task on «${ready.label}», its release day promised)`, (await stageOf(waiting.id)) === ready.id)
const askedToo = await req(`/content/${waiting.id}`, 'PATCH', { release_date: day(18) }, ST)
ok('a planner dragging it is refused as well, with the ask for the day she dragged to', askedToo.status === 403
  && askedToo.data.ask_to_move?.field === 'release_date' && askedToo.data.ask_to_move?.from === day(17) && askedToo.data.ask_to_move?.to === day(18),
  `${askedToo.status} ${JSON.stringify(askedToo.data).slice(0, 160)}`)
ok('…in words the phrase books carry', i18nHas(askedToo.data.error), askedToo.data.error)
ok('…and it stays where it was', (await req(`/content/${waiting.id}`, 'GET', null, ST)).data.release_date === day(17))
const byAdminToo = await req(`/content/${waiting.id}`, 'PATCH', { release_date: day(18) })
ok('an admin moves it, and it stays moved', byAdminToo.status === 200 && (await req(`/content/${waiting.id}`)).data.release_date === day(18),
  `${byAdminToo.status} ${byAdminToo.data.error || ''}`)
const thought = await task({ title: 'Calendar: an idea\'s day', release_date: day(14) })
const movedIdea = await req(`/content/${thought.id}`, 'PATCH', { release_date: day(15) }, ST)
ok('a planner moves an idea\'s day, and it stays moved', movedIdea.status === 200 && (await req(`/content/${thought.id}`, 'GET', null, ST)).data.release_date === day(15),
  `${movedIdea.status} ${movedIdea.data.error || ''}`)
const elsewhere = (await req('/content', 'POST', { channels: ['youtube'], type: 'reel', status_id: idea.id, title: 'Calendar: not her channel', release_date: day(14) })).data
if (elsewhere?.id) made.push(elsewhere.id)
ok('…but not a day on a channel she is not on', (await req(`/content/${elsewhere.id}`, 'PATCH', { release_date: day(16) }, ST)).status === 403)

// ===================== the page =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const app = src('client/src/App.jsx')
ok('the Master Calendar lives at /calendar', /path="\/calendar" element=\{<Protected page="releases"><Schedule mode="release" \/>/.test(app))
ok('…and /releases still lands there, channel and all', /path="\/releases" element=\{<ToCalendar \/>\}/.test(app) && /\/calendar\$\{search\}/.test(app))
const i18n = src('client/src/lib/i18n.jsx')
// One calendar (the owner, 13 Oct): it is simply "Calendar" now, in all three.
ok('it is called Calendar in all three languages',
  i18n.includes("'nav.releases': 'Calendar'") && i18n.includes("'nav.releases': 'Календарь'") && i18n.includes("'nav.releases': 'Taqvim'"))
ok('"Bulk Actions" in all three', i18n.includes('"Bulk Actions": "Массовые действия"') && i18n.includes('"Bulk Actions": "Ommaviy harakatlar"'))
ok('the navigation links it', /to: '\/calendar', label: t\('nav\.releases'\)/.test(src('client/src/components/Sidebar.jsx')))
// …and so does the bar a member with ONE channel works in on a desk, which
// lists its doors by hand: the head of one channel is who the page is for,
// and on the screen it was planned for they had no door to it. Read from the
// bar itself, the way projects-access-suite reads its Projects door.
const layout = src('client/src/components/Layout.jsx')
const soloBar = layout.slice(layout.indexOf('if (solo) {'), layout.indexOf('<MobileTabs tabs={soloTabs}'))
ok('…and so does the one-channel top bar on a desk, asked of the page switch like its neighbours',
  /\{shows\('releases'\) && \(\s*<NavLink to="\/calendar"/.test(soloBar) && soloBar.includes("t('nav.releases')"))
ok('…where a designer-only account is crew, and its phone bar leads with the design board',
  /\['editor', 'operator', 'designer', 'crew'\]\.includes\(user\.role\)/.test(layout))
ok('Admin → Pages calls it the Master Calendar, in words both books carry',
  /\{ key: 'releases', label: 'Master Calendar', hint: 'everything going out, every channel' \}/.test(src('client/src/pages/Admin.jsx'))
  && i18nHas('Master Calendar') && i18nHas('everything going out, every channel'))
ok('every other door to it asks the same switch: Quick Find, the campaign and the project',
  /shows\('releases'\) && \{ label: tx\('Calendar'\), to: '\/calendar' \}/.test(src('client/src/components/QuickFind.jsx'))
  && /\{shows\('releases'\) && \(\s*<button className="btn btn-sm" onClick=\{\(\) => navigate\(`\/calendar\?campaign=/.test(src('client/src/pages/CampaignDetail.jsx'))
  && /p\.campaigns\.length > 0 && shows\('releases'\) && \(/.test(src('client/src/pages/ProjectDetail.jsx')))
const sched = src('client/src/pages/Schedule.jsx')
// The '?' on the page. The Master Calendar outgrew the Releases guide (which
// named it Releases and told everybody an idea's day is theirs to move), so
// it has its own; Recordings keeps the old one, which is still true there.
const { PAGE_GUIDES } = await import(pathToFileURL(join(ROOT, 'client/src/lib/pageGuides.js')).href)
const guide = PAGE_GUIDES.calendar || {}
const said = (l) => (guide[l] || []).flatMap((x) => [x.h, ...x.p]).join('\n')
ok('the page has its own guide, and Recordings keeps the old one', /<PageGuide page=\{M\.master \? 'calendar' : 'schedule'\}/.test(sched) && !!PAGE_GUIDES.schedule)
ok('…in all three languages, section for section and line for line', ['en', 'ru', 'uz'].every((l) => Array.isArray(guide[l]) && guide[l].length === guide.en.length
  && guide[l].every((x, i) => x.p.length === guide.en[i].p.length)), ['en', 'ru', 'uz'].map((l) => (guide[l] || []).map((x) => x.p.length).join('')).join(' / '))
ok('…naming the page the way the navigation does', said('en').includes('Master Calendar') && said('ru').includes('Общий календарь') && said('uz').includes('Umumiy taqvim'))
ok('…saying who moves a day, what to do about a promised one, how to pick several, and that a phone only looks',
  /move tasks/.test(said('en')) && /Ask to move/.test(said('en')) && /Shift/.test(said('en')) && /Space/.test(said('en')) && /Bulk Actions/.test(said('en')) && /phone/.test(said('en')))
ok('…with no dashes, the house rule for guides', !/[—–]| - /.test(said('en') + said('ru') + said('uz')))
ok('…and its Uzbek written with ʻ and ʼ, never a plain quote: vaʼda too', !/['‘’`]/.test(said('uz')) && said('uz').includes('ʻ') && /vaʼda/i.test(said('uz')))
ok('…as is the Recordings guide it was split from', !/\bva'?da\b/i.test(PAGE_GUIDES.schedule.uz.flatMap((x) => [x.h, ...x.p]).join('\n')))
ok('several channels show at once, kept in the address', /next\.set\('channels', list\.join\(','\)\)/.test(sched) && /chosen\.includes\(c\)/.test(sched))
ok('on the Master Calendar a day moves for move_tasks alone, on work that is theirs to touch',
  /M\.master \? canMove && mine\(t\) : canMove \|\| ideaIds\.has/.test(sched) && /const mine = useCallback/.test(sched))
ok('…a refused promised day offers the ask, for the day that was dragged', /e\.status === 403 && e\.data\?\.ask_to_move/.test(sched)
  && /setAskFor\(\{ id: t\.id, field, to: iso/.test(sched) && /askFor=\{askFor/.test(sched))
ok('…and the refusal is said in the reader\'s language', /toast\(tx\(e\.message\), 'err', ask\)/.test(sched))
ok('…and on a phone it only looks', /max-width: 640px/.test(sched) && /const viewOnly = !!M\.master && narrow/.test(sched))
ok('…a phone on its side too, asked once and kept up with, old Safari included',
  /const LOOK_ONLY_Q = '\(max-width: 640px\), \(pointer: coarse\) and \(max-height: 500px\)'/.test(sched)
  && /window\.matchMedia\(LOOK_ONLY_Q\)\.matches/.test(sched) && /const mq = window\.matchMedia\(LOOK_ONLY_Q\)/.test(sched) && /mq\.addListener\(on\)/.test(sched))
ok('…where it neither reschedules late work nor adds a day\'s task', /\(M\.master \? mayMoveDay\(t\) : canMove\) && !viewOnly && \(/.test(sched)
  && /manageContent && channel && !viewOnly/.test(sched))
ok('a campaign or project link keeps its lens over the channels remembered from last time',
  /\['channel', 'channels', 'campaign', 'project'\]\.some\(\(k\) => params\.get\(k\)\)\) return/.test(sched)
  && /next\.set\('channels', list\.map\(String\)\.join\(','\)\)/.test(sched) && /if \(lensKey \|\| !handPicked\.current\) return/.test(sched))
ok('…opens on its own weeks, and a card added under it joins the campaign', /start=\{lens && lensStart/.test(sched)
  && /const addAt = manageContent && channel && !viewOnly[\s\S]{0,160}setNewDefaults\(\{ channels: \[channel\], \[M\.dateField\]: iso, \.\.\.\(campaignId \? \{ campaign_id: campaignId \} : \{\}\) \}\)/.test(sched))
ok('the grid stays when a view is empty, and counts what has no release day', /!alive\.some\(\(t\) => t\[M\.dateField\]\)/.test(sched)
  && /tx\('Still without a release day: \{n\}'/.test(sched))
ok('the day sheet is the day\'s releases, named by channel', /only=\{M\.master \? 'release' : null\}/.test(sched) && /channelsOf=\{namesChannels\}/.test(sched))
ok('picks are let go where they cannot be shown, and Escape leaves them to an open window',
  /if \(mayBulk\) return\s+setPicked/.test(sched) && /!bulkStage && !openItem && !selectedDate/.test(sched))
ok('…the bar holds only the living, and says its count out loud', /alive\.filter\(\(t\) => picked\.has\(t\.id\)\)/.test(sched)
  && /mayBulk && pickedItems\.length > 0 && \(/.test(sched) && /role="status" aria-live="polite"/.test(sched))
ok('…and Bulk Actions are move_tasks\'', /const mayBulk = !!M\.master && !viewOnly && canMove\n/.test(sched))
ok('a release pulled early brings its cut and artwork back', /pullBackDates\(t, iso, today\)/.test(sched))
const cal = src('client/src/components/ContentCalendar.jsx')
ok('shift-, ctrl- or ⌘-click picks a card instead of opening it', /e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey/.test(cal) && /onToggleSelect\(it\)/.test(cal))
ok('…and never starts a drag there, while the channel boards drag with a key held as they always did',
  /if \(ctx\.current\.picks && \(e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey\)\) return \/\/ picking, not dragging/.test(cal) && /picks: !!onToggleSelect/.test(cal))
ok('a keyboard opens a card with Enter and picks it with Space, where cards can be picked — and nowhere else',
  /const keyed = \(it, iso\) => \(onToggleSelect\s*\? \{ role: 'button', tabIndex: 0, onKeyDown: \(e\) => cardKey\(e, it, iso\) \}\s*: \{\}\)/.test(cal)
  && (cal.match(/\{\.\.\.keyed\(it, iso\)\}/g) || []).length === 2 && !/tabIndex=\{0\}/.test(cal) && /onToggleSelect=\{mayBulk \?/.test(sched))
ok('a month card says its channel when several are on screen', /channelsOf && <i className="ev-sub ev-ch">\{channelsOf\(it\)\}/.test(cal))
ok('the month, the week and the weekdays are said in the reader\'s language on the Master Calendar alone',
  /monthName\(cursor\.y, cursor\.m \+ 1\)/.test(cal) && /localized && lang\(\) !== 'en'/.test(cal) && /localized=\{!!M\.master\}/.test(sched))
ok('a campaign or a whole project can be looked at through it', /params\.get\('campaign'\)/.test(sched) && /params\.get\('project'\)/.test(sched) && /lens\.ids\.has\(t\.campaign_id\)/.test(sched))
ok('the campaign page opens its cards on the Master Calendar', /navigate\(`\/calendar\?campaign=\$\{c\.id\}`\)/.test(src('client/src/pages/CampaignDetail.jsx')))
ok('…and the project page every campaign\'s', /navigate\(`\/calendar\?project=\$\{p\.id\}`\)/.test(src('client/src/pages/ProjectDetail.jsx')))
const bulk = src('client/src/components/BulkMove.jsx')
ok('the bulk window asks the dry run, then moves only what passed', /\?dry=1/.test(bulk) && /state === 'ok'/.test(bulk) && /'blocked'/.test(bulk))
ok('…puts a box beside every field the dry run lists', /Array\.isArray\(d\.missing\) && d\.missing\.length/.test(bulk) && /d\.missing\.map\(\(m\) =>/.test(bulk))
ok('…asks the handover beside it, once per task, and a yes from the dry run alone is not a yes',
  /api\.get\(`\/content\/\$\{t\.id\}\/handover\?to=\$\{stage\.id\}`\)/.test(bulk) && /gatesRef\.current\[t\.id\] \?\?=/.test(bulk)
  && /const asked = handoverGap\(gates, extra\)/.test(bulk) && /if \(!refused && !asked\.length\)/.test(bulk))
ok('…with a box for the footage, the cut and the reviewer, and none for an owner only an admin may name',
  /\bshot_link: \{ kind: 'text'/.test(bulk) && /\bready_link: \{ kind: 'text'/.test(bulk) && /\breviewer_ids: \{ kind: 'person'/.test(bulk)
  && /field === 'reviewer_ids' \? \[Number\(v\)\]/.test(bulk) && !/\bassignee_ids: \{/.test(bulk))
ok('…keeps what was typed per box, and checks every filled box on the row with one press',
  /`\$\{t\.id\}:\$\{field\}`/.test(bulk) && /for \(const n of boxes\(rows\[t\.id\]\)\)/.test(bulk))
ok('…closes itself once every row has moved, over any number of presses', /movedRef\.current\.add\(t\.id\)/.test(bulk)
  && /items\.every\(\(t\) => t\.status_id === stage\.id \|\| movedRef\.current\.has\(t\.id\)\)/.test(bulk))
ok('…and says what an empty box needs in the reader\'s language, in words both books carry',
  /tx\('Needs «\{what\}» before it can move'/.test(bulk) && ['Needs «{what}» before it can move', 'Footage link', 'Link to the edit', 'Who reviews it',
    'Who is shooting this?', 'Who is editing this?', 'Who is reviewing this?', 'Where is the footage? Paste the link — the editor starts from it',
    'Where is the edit? Paste the link — the reviewer signs off from it'].every(i18nHas))
ok('…and says an answer it was given is wrong in the server\'s words, not as if the box were empty',
  /const told = refused \? needsOf\(refused\.data, refused\.message, extra\) : \[\]/.test(bulk)
  && /const why = \(n\) => \(n\.how === 'fill' \? tx\('Needs/.test(bulk))
// A handover that cannot be read is not "no questions": the board's own
// window stops (StageGate), and a green row here would have moved the task
// past a reviewer and a cut nobody was asked for.
ok('a handover that cannot be read holds the row, and can be asked again',
  /\(\) => \{ delete gatesRef\.current\[t\.id\]; return null \}/.test(bulk)
  && /if \(gates == null && !refused\) \{\s+const said = tx\('The handover could not be checked, so this one stays where it is'\)\s+set\(t\.id, \{ state: 'blocked'/.test(bulk)
  && /onClick=\{\(\) => ask\(t, fixes\[t\.id\] \|\| \{\}\)\}>\{tx\('Try again'\)\}/.test(bulk)
  && ['The handover could not be checked, so this one stays where it is', 'Try again'].every(i18nHas))
// The ТЗ box is named in its own words. The bare «ТЗ» is the task sheet's,
// on every channel board, and stays what it was on main in both books.
ok('the ТЗ box has its own name, and the task sheet\'s «ТЗ» is left as it was',
  /\btz: \{ kind: 'long', label: 'The brief \(ТЗ\)' \}/.test(bulk) && i18nHas('The brief (ТЗ)') && books.includes('"The brief (ТЗ)": "TZ"')
  && books.split('"\\u0422\\u0417": "\\u0422\\u0417",').length === 3 && !books.includes('"\\u0422\\u0417": "TZ"'))
// A card a keyboard lands on is not a picked card. The focus ring was the
// pick's own ruby, so every card Tab reached looked picked, and a picked one
// that took focus showed nothing at all.
const css = src('client/src/styles.css')
const pickRing = css.indexOf('[data-theme="dark"] .rel-ev.sel, [data-theme="dark"] .wk-card.sel {')
const focusRing = css.indexOf('.cal-picks .rel-ev:focus-visible, .cal-picks .wk-card:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }')
ok('a card with the keyboard\'s focus wears ink, not the pick\'s ruby, and wins over the pick ring',
  pickRing > 0 && focusRing > pickRing && /\.cal-picks \.rel-ev\.sel:focus-visible, \.cal-picks \.wk-card\.sel:focus-visible \{ box-shadow: 0 0 0 2px var\(--brand-500\); \}/.test(css))

// ===================== tidy up =====================
for (const id of made) await req(`/content/${id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

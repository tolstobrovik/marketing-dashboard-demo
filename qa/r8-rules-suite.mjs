// Round 8: how a filmed piece moves between stages — the owner's rules, held
// by the server.
//
// A reel, a video or a target ad is filmed and then edited, and until now the
// board asked for the whole plan before the first shoot: three dates, the
// edit's day and the release among them, on a piece nobody had filmed yet. The
// owner settled what each move asks instead, and this pins it.
//
//   1  THE WALLS. Landing on To shoot asks who films, the day, the hours (from
//      and to) and the script — and nothing else. Landing on the stage after it
//      asks the reference, the TZ, who edits and the day to post. Idea straight
//      to Editing asks both. A brief field the admin switched off is never
//      asked; an admin on the channel is asked nothing; a post and a written
//      piece are asked what they always were.
//   2  FOOTAGE HANDED IN. With the TZ and the editor there it goes on to
//      Editing by itself. Without them it waits on To shoot — stamped, the
//      footage kept, the answer saying what it waits for (`held`), its owners
//      told once — and sending it on is its owner's step (lib/nextStep.js).
//   3  QUARTER HOURS. A shoot's hours sit on a 15-minute grid, the day strip
//      answers in 15-minute steps, and a booked hour says whether its operator
//      said yes.
//   4  THE SIDEBAR'S COUNTS. /content/counts: late and in editing, a channel,
//      for the channels the caller may see.
//   5  THE COVER. A note on the task; a filmed piece's artwork handed in does
//      not move the video, a change asked of it does not send the video back,
//      and nothing about it stops a move.
//   6  CREATING. An idea is a name. A complete booking is born on To shoot.
//
//   node qa/r8-rules-suite.mjs           (expects a server on :4090)
import { join } from 'path'
import { pathToFileURL } from 'url'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

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
const chanList = await req('/channels')
const channels = chanList.data.channels || chanList.data
const CH = 'instagram_main'
const written = channels.find((c) => c.format === 'text')?.key
const sfx = Date.now().toString(36).slice(-5)
const mk = async (b) => (await req('/users', 'POST', { password: 'pw123456', ...b })).data
const maker = await mk({ name: 'Dilnoza Plans', username: 'rm' + sfx, role: 'member', departments: [CH], permissions: { manage_content: true, move_tasks: true } })
const other = await mk({ name: 'Malika Also', username: 'ro' + sfx, role: 'member', departments: [CH, written].filter(Boolean), permissions: { manage_content: true, move_tasks: true } })
const op = await mk({ name: 'Jasur Films', username: 'rf' + sfx, role: 'operator' })
const ed = await mk({ name: 'Timur Edits', username: 're' + sfx, role: 'editor' })
const des = await mk({ name: 'Kamila Draws', username: 'rd' + sfx, role: 'designer' })
const MT = await login('rm' + sfx, 'pw123456'), XT = await login('ro' + sfx, 'pw123456')
const OT = await login('rf' + sfx, 'pw123456'), ET = await login('re' + sfx, 'pw123456'), DT = await login('rd' + sfx, 'pw123456')
ok('(a content maker, a second one, an operator, an editor and a designer — and the shipped stages)',
  !!maker.id && !!other.id && !!op.id && !!ed.id && !!des.id && !!MT && !!idea && !!toShoot && !!editing && !!ready && !!published)

const made = []
const keep = (r) => { if (r.data?.id) made.push(r.data.id); return r }
// Hers, at Idea — what "New idea" on a channel's page posts.
const task = async (b = {}, t = MT) => (await keep(await req('/content', 'POST', { channels: [CH], type: 'reel', status_id: idea.id, ...b }, t))).data
// The board caught up by an admin, who is asked nothing: a piece wherever the check needs it.
const placed = async (b = {}) => (await keep(await req('/content', 'POST', { channels: [CH], type: 'reel', assignee_ids: [maker.id], ...b }))).data
const dry = (id, b, t = MT) => req(`/content/${id}?dry=1`, 'PATCH', b, t)
const save = (id, b, t = MT) => req(`/content/${id}`, 'PATCH', b, t)
const row = async (id) => (await req(`/content/${id}`)).data
const fieldsOf = (d) => (Array.isArray(d?.missing) ? d.missing.map((m) => m.field) : null)
// A script is refused as the twin of another task's, and every shoot holds its
// operator's hour: each piece here gets words and a day of its own.
let nth = 0
const SCRIPT = () => `Take ${++nth} with group ${sfx}: three students say in one sentence each what they wish they had known before the SAT.`
const slot = () => ({ recording_date: day(20 + (++nth)), recording_time: '10:00', recording_end: '10:45' })
const TZ = 'Under a minute, captions on, a new shot on every answer, upbeat music.'
const REF = `https://www.instagram.com/reel/r8-${sfx}/`
const FOOTAGE = `https://drive.google.com/r8-footage-${sfx}`

// The admin's brief rules as they ship, so a board another suite left tuned
// reads the same here; put back at the end.
const before = (await req('/fields')).data
const rulesNow = {}
for (const k of ['format', 'rubrika', 'script', 'tz', 'reference', 'description']) if (before[k]) rulesNow[k] = { state: before[k].state, types: before[k].types, ...(before[k].options ? { options: before[k].options } : {}) }
const FILMED = ['reel', 'video']
const shipped = { ...rulesNow, script: { state: 'optional', types: FILMED }, tz: { state: 'optional', types: FILMED }, reference: { ...rulesNow.reference, state: 'optional', types: ['post', 'reel', 'story', 'video', 'target', 'other'] },
  format: { ...rulesNow.format, state: 'optional' }, description: { ...rulesNow.description, state: 'optional' } }
await req('/fields', 'POST', shipped)

// ===================== 1. the walls of a filmed piece =====================
const SHOOT = ['operator_id', 'recording_date', 'recording_time', 'script']
const EDIT = ['reference_text', 'tz', 'editor_id', 'release_date']
const t1 = await task({ title: 'R8: an idea for a reel' })
const bare = await dry(t1.id, { status_id: toShoot.id })
ok(`landing on «${toShoot.label}» asks who films, the day, the hours — from and to — and the script, in that order`,
  bare.status === 400 && same(fieldsOf(bare.data), SHOOT) && bare.data.missing.every((m) => m.error), `${bare.status} ${fieldsOf(bare.data)?.join(', ')}`)
ok('…and no longer the day the edit is due or the day to post', !(fieldsOf(bare.data) || ['edit_ready_date']).some((f) => f === 'edit_ready_date' || f === 'release_date'))
const firstNo = await save(t1.id, { status_id: toShoot.id })
ok('a real save is refused as it always was: the first of them, no list', firstNo.status === 400 && firstNo.data.field === 'operator_id' && firstNo.data.missing === undefined,
  `${firstNo.status} ${JSON.stringify(firstNo.data).slice(0, 120)}`)
const booking = { operator_id: op.id, ...slot() }
const noScript = await dry(t1.id, { status_id: toShoot.id, ...booking, reference_links: [REF] })
ok('a reference does not stand in for the script', noScript.status === 400 && same(fieldsOf(noScript.data), ['script']), `${noScript.status} ${fieldsOf(noScript.data)?.join(', ')}`)
const thin = await dry(t1.id, { status_id: toShoot.id, ...booking, script: 'Two words' })
ok('…and a script of two words is not one: refused on the script, for what it holds', thin.status === 400 && thin.data.field === 'script' && thin.data.missing?.[0]?.wrong === true,
  `${thin.status} ${thin.data.field} ${thin.data.error || ''}`)
const noEnd = await dry(t1.id, { status_id: toShoot.id, ...booking, recording_end: null, script: SCRIPT() })
// The end is not a wall: the time band always sends one, and an older form
// that asks only a start is still taken (the hour is drawn an hour long).
ok('a start with no end is not refused', noEnd.status === 200 && noEnd.data.dry === true, `${noEnd.status} ${fieldsOf(noEnd.data)?.join(', ') || ''}`)
const sent = await save(t1.id, { status_id: toShoot.id, ...booking, script: SCRIPT() })
ok('with those it goes — no edit day, no day to post', sent.status === 200 && sent.data.status_id === toShoot.id && !sent.data.edit_ready_date && !sent.data.release_date,
  `${sent.status} ${sent.data.error || ''}`)

const toEdit = await dry(t1.id, { status_id: editing.id })
ok(`landing on «${editing.label}» asks the reference, the TZ, who edits and the day to post, in that order`,
  toEdit.status === 400 && same(fieldsOf(toEdit.data), EDIT) && toEdit.data.missing.every((m) => m.error), `${toEdit.status} ${fieldsOf(toEdit.data)?.join(', ')}`)
const editNo = await save(t1.id, { status_id: editing.id })
ok('…a real save answering with the first alone, and the piece staying where it was', editNo.status === 400 && editNo.data.field === 'reference_text' && editNo.data.missing === undefined
  && (await row(t1.id)).status_id === toShoot.id, `${editNo.status} ${JSON.stringify(editNo.data).slice(0, 120)}`)
let given = {}
for (const [i, [field, value]] of [['reference_links', [REF]], ['tz', TZ], ['editor_id', ed.id], ['release_date', day(40)]].entries()) {
  const r = await dry(t1.id, { status_id: editing.id, ...given })
  ok(`…lists only what is left: ${EDIT.slice(i).join(', ')}`, r.status === 400 && same(fieldsOf(r.data), EDIT.slice(i)), `${r.status} ${fieldsOf(r.data)?.join(', ')}`)
  given = { ...given, [field]: value }
}
const thinTz = await dry(t1.id, { status_id: editing.id, ...given, tz: 'Make nice' })
ok('a TZ of two words is not one', thinTz.status === 400 && thinTz.data.field === 'tz', `${thinTz.status} ${thinTz.data.field} ${thinTz.data.error || ''}`)
const edited = await save(t1.id, { status_id: editing.id, ...given })
ok('with those it goes — and the day to post is taken with the move, from its maker, on a piece already being made',
  edited.status === 200 && edited.data.status_id === editing.id && edited.data.release_date === day(40) && edited.data.editor_id === ed.id, `${edited.status} ${edited.data.error || ''}`)

// The reference, however it was given: words, a link, a picture or a video.
const t2 = await task({ title: 'R8: a reference that is a video' })
await save(t2.id, { status_id: toShoot.id, operator_id: op.id, ...slot(), script: SCRIPT() })
const t2ask = await dry(t2.id, { status_id: editing.id, tz: TZ, editor_id: ed.id, release_date: day(41) })
ok('(a piece short of its reference alone)', t2ask.status === 400 && same(fieldsOf(t2ask.data), ['reference_text']), `${t2ask.status} ${fieldsOf(t2ask.data)?.join(', ')}`)
const clip = await req(`/content/${t2.id}/media`, 'POST', { kind: 'video', name: 'pace.mp4', link: `https://drive.google.com/file/d/r8-${sfx}/view` }, MT)
ok('a reference video is a reference', clip.status === 201 && (await dry(t2.id, { status_id: editing.id, tz: TZ, editor_id: ed.id, release_date: day(41) })).status === 200, `${clip.status}`)

// Both sets at once, and neither for a record of work done elsewhere.
const t3 = await task({ title: 'R8: straight to editing' })
const both = await dry(t3.id, { status_id: editing.id })
ok('an idea sent straight to editing is asked both sets, each field once', both.status === 400 && same(fieldsOf(both.data), [...SHOOT, ...EDIT]), `${both.status} ${fieldsOf(both.data)?.join(', ')}`)
const past = await dry(t3.id, { status_id: ready.id })
ok(`…and one put on «${ready.label}» — work that happened elsewhere — is asked neither, as before`,
  !(fieldsOf(past.data) || []).some((f) => [...SHOOT, ...EDIT].includes(f)), `${past.status} ${fieldsOf(past.data)?.join(', ') || ''}`)
ok('an admin on the channel is asked nothing', (await req(`/content/${t3.id}?dry=1`, 'PATCH', { status_id: editing.id })).status === 200)

// A brief field the admin switched off for the type is never asked.
await req('/fields', 'POST', { ...shipped, script: { state: 'off', types: FILMED }, tz: { state: 'off', types: FILMED }, reference: { ...shipped.reference, state: 'off' } })
const off = await dry(t3.id, { status_id: editing.id })
ok('a brief field switched off is never asked: no script, no TZ, no reference',
  off.status === 400 && same(fieldsOf(off.data), ['operator_id', 'recording_date', 'recording_time', 'editor_id', 'release_date']), `${off.status} ${fieldsOf(off.data)?.join(', ')}`)
await req('/fields', 'POST', { ...shipped, tz: { state: 'optional', types: ['video'] } })
const notReels = await dry(t3.id, { status_id: editing.id })
ok('…nor one that is on, but not for this type', notReels.status === 400 && !fieldsOf(notReels.data)?.includes('tz') && fieldsOf(notReels.data)?.includes('reference_text'), fieldsOf(notReels.data)?.join(', '))
await req('/fields', 'POST', { ...shipped, format: { ...shipped.format, state: 'required', types: FILMED } })
const demanded = await dry(t3.id, { status_id: toShoot.id })
ok('what the admin demands is still asked on the way out of Idea, before the booking', demanded.status === 400 && same(fieldsOf(demanded.data), ['format', ...SHOOT]), fieldsOf(demanded.data)?.join(', '))
await req('/fields', 'POST', shipped)

// Not filmed: asked what it always was.
const poster = await task({ title: 'R8: a poster', type: 'post' })
const posterAsk = await dry(poster.id, { status_id: editing.id })
ok('a post is asked none of it — only the TZ it always owed', !(fieldsOf(posterAsk.data) || []).some((f) => f !== 'tz') && posterAsk.status === 400, `${posterAsk.status} ${fieldsOf(posterAsk.data)?.join(', ')}`)
if (written) {
  const note = await task({ channels: [written], type: 'post', title: 'R8: a written piece' }, XT)
  const noteAsk = await dry(note.id, { status_id: editing.id }, XT)
  ok('…and a written piece none of it either — only what kind of piece it is', noteAsk.status === 400 && same(fieldsOf(noteAsk.data), ['telegram_type']), `${noteAsk.status} ${fieldsOf(noteAsk.data)?.join(', ') || noteAsk.data.error || ''}`)
}

// The day to post is asked after the shoot is booked, so it has to be givable
// then: an EMPTY one on a filmed piece being made. Every other frozen day,
// and every set one, is as it was (qa/stages-suite.mjs).
const t4 = await task({ title: 'R8: the day to post, later' })
await save(t4.id, { status_id: toShoot.id, operator_id: op.id, ...slot(), script: SCRIPT() })
const later = await save(t4.id, { release_date: day(42) })
ok('the maker gives a filmed piece its day to post while it is being made', later.status === 200 && later.data.release_date === day(42), `${later.status} ${later.data.error || ''}`)
const again = await save(t4.id, { release_date: day(43) })
ok('…but a day already promised still moves by asking an admin', again.status === 403 && again.data.ask_to_move?.field === 'release_date', `${again.status} ${JSON.stringify(again.data).slice(0, 120)}`)
const editDay = await save(t4.id, { edit_ready_date: day(30) })
ok('…and no other day is bolted onto work in progress', editDay.status === 403 && /being made/i.test(editDay.data.error || ''), `${editDay.status} ${editDay.data.error || ''}`)
const posterMade = await placed({ title: 'R8: a poster being made', type: 'post', status_id: editing.id, assignee_ids: [maker.id] })
const posterDay = await save(posterMade.id, { release_date: day(42) })
ok('…nor a post’s day to post, which was never asked late', posterDay.status === 403 && /being made/i.test(posterDay.data.error || ''), `${posterDay.status} ${posterDay.data.error || ''}`)

// ===================== 2. footage handed in =====================
const booked = async (title, more = {}) => {
  const t = await task({ title })
  const r = await save(t.id, { status_id: toShoot.id, operator_id: op.id, ...slot(), script: SCRIPT(), ...more })
  return r.data
}
const bell = async (t, re) => ((await req('/notifications', 'GET', null, t)).data?.events || []).filter((n) => re.test(n.text || ''))
const f1 = await booked('R8: footage, all there', { tz: TZ, editor_id: ed.id })
const went = await save(f1.id, { milestone: 'shot', shot_link: FOOTAGE + '-1' }, OT)
ok('footage handed in with the TZ and the editor there goes on to editing by itself, as before',
  went.status === 200 && went.data.status_id === editing.id && !!went.data.shot_at && went.data.held === undefined, `${went.status} ${went.data.status_id} ${JSON.stringify(went.data.held)}`)

const f2 = await booked('R8: footage, nothing else')
const waits = await save(f2.id, { milestone: 'shot', shot_link: FOOTAGE + '-2' }, OT)
ok(`without them it stays on «${toShoot.label}», and the answer says what it waits for`,
  waits.status === 200 && waits.data.status_id === toShoot.id && same(waits.data.held, ['tz', 'editor_id']), `${waits.status} ${waits.data.status_id} ${JSON.stringify(waits.data.held)}`)
ok('…stamped as filmed, the footage kept', !!waits.data.shot_at && waits.data.shot_link === FOOTAGE + '-2', `${waits.data.shot_at} ${waits.data.shot_link}`)
const told = await bell(MT, new RegExp(`Footage is in.*${f2.title}|${f2.title}.*Footage is in`))
ok('…and its owner is told: footage is in, add the TZ and who edits', told.length === 1 && /TZ/.test(told[0].text) && /who edits/.test(told[0].text), told.map((n) => n.text).join(' | '))
const twice = await save(f2.id, { milestone: 'shot', shot_link: FOOTAGE + '-2b' }, OT)
ok('handed in again it still waits, keeps its first stamp, and tells nobody twice',
  twice.status === 200 && twice.data.status_id === toShoot.id && twice.data.shot_at === waits.data.shot_at && twice.data.shot_link === FOOTAGE + '-2b'
  && (await bell(MT, new RegExp(`Footage is in.*${f2.title}|${f2.title}.*Footage is in`))).length === 1, `${twice.status} ${twice.data.shot_at}`)
const f3 = await booked('R8: footage, editor only', { editor_id: ed.id })
const f4 = await booked('R8: footage, TZ only', { tz: TZ })
const noTz = await save(f3.id, { milestone: 'shot', shot_link: FOOTAGE + '-3' }, OT)
const noEd = await save(f4.id, { milestone: 'shot', shot_link: FOOTAGE + '-4' }, OT)
ok('`held` names what is missing of the two: the TZ, or who edits', same(noTz.data.held, ['tz']) && same(noEd.data.held, ['editor_id']) && noTz.data.status_id === toShoot.id && noEd.data.status_id === toShoot.id,
  `${JSON.stringify(noTz.data.held)} ${JSON.stringify(noEd.data.held)}`)

// The press can be taken back like any hand-in.
const f5 = await booked('R8: footage, taken back')
await save(f5.id, { milestone: 'shot', shot_link: FOOTAGE + '-5' }, OT)
const undone = await req(`/content/${f5.id}/undo`, 'POST', {}, OT)
ok('a hand-in that was held can be undone by whoever pressed it', undone.status === 200 && !undone.data.shot_at && !undone.data.shot_link && undone.data.status_id === toShoot.id,
  `${undone.status} ${undone.data.error || ''}`)

// Sending it on is its owner's step: the move asks what the stage asks.
const ask2 = await dry(f2.id, { status_id: editing.id })
ok('the maker’s move is asked what editing asks', ask2.status === 400 && same(fieldsOf(ask2.data), EDIT), `${ask2.status} ${fieldsOf(ask2.data)?.join(', ')}`)
const sentOn = await save(f2.id, { status_id: editing.id, reference_links: [REF], tz: TZ, editor_id: ed.id, release_date: day(44) })
ok('…and with those it goes, the footage’s own stamp unchanged', sentOn.status === 200 && sentOn.data.status_id === editing.id && sentOn.data.shot_at === waits.data.shot_at,
  `${sentOn.status} ${sentOn.data.error || ''} ${sentOn.data.shot_at}`)
// Whoever may move tasks on the channel may send it: the operator let go of it
// when the footage came in. Until then it is his, as it always was.
const notHers = await dry(f4.id, { status_id: editing.id, reference_links: [REF], editor_id: ed.id, release_date: day(45) }, XT)
ok('a piece whose footage is in is no longer “with” its operator: another planner on the channel may send it', notHers.status === 200, `${notHers.status} ${notHers.data.error || ''}`)
const f6 = await booked('R8: not filmed yet', { tz: TZ, editor_id: ed.id })
const stillHis = await dry(f6.id, { status_id: editing.id, reference_links: [REF], release_date: day(46) }, XT)
ok('…while one not filmed yet is still his to hand on', stillHis.status === 403 && Array.isArray(stillHis.data.held_by), `${stillHis.status} ${stillHis.data.error || ''}`)
// The admin catching the board up, and a piece that is not filmed: as before.
const f7 = await placed({ title: 'R8: an admin’s tick', status_id: toShoot.id, operator_id: op.id, ...slot() })
const byAdmin = await req(`/content/${f7.id}`, 'PATCH', { milestone: 'shot' })
ok('an admin’s tick is not held: they are catching the board up', byAdmin.status === 200 && byAdmin.data.status_id === editing.id && byAdmin.data.held === undefined, `${byAdmin.status} ${byAdmin.data.status_id}`)
const f8 = await placed({ title: 'R8: photos for a post', type: 'post', status_id: toShoot.id, operator_id: op.id, ...slot() })
const postShot = await save(f8.id, { milestone: 'shot', shot_link: FOOTAGE + '-8' }, OT)
ok('a piece that is not filmed moves on with its photos as it always did', postShot.status === 200 && postShot.data.status_id === editing.id && postShot.data.held === undefined, `${postShot.status} ${postShot.data.status_id}`)

// …and the readings the pages draw (client/src/lib): whose step a held piece is.
const lib = (p) => import(pathToFileURL(join(ROOT, 'client/src/lib', p)).href)
const { pipelineOf, nextStepOf } = await lib('nextStep.js')
const coach = await lib('coach.js')
const pipe = pipelineOf(statuses)
const FILM = { written: false, repost: false, filmed: true, designed: false }, DRAW = { written: false, repost: false, filmed: false, designed: true }
const MAY = { move: true, publish: true }, MAYNOT = { move: false, publish: false }
const heldRow = { ...noEd.data }          // on To shoot, footage in, nobody to edit it
let s = nextStepOf(heldRow, pipe, FILM, MAY)
ok('a piece standing on the shoot stage with its footage in is its owner’s step: Send to editing', s?.to?.id === editing.id && s.verb === 'Send to editing', JSON.stringify(s))
s = nextStepOf(heldRow, pipe, FILM, MAYNOT)
ok('…and for somebody who may not move it, it is waiting for the edit — not for a shoot that is done', !s?.to && s?.wait === 'cut', JSON.stringify(s))
s = nextStepOf({ ...heldRow, shot_at: null }, pipe, FILM, MAY)
ok('not filmed yet it is still the operator’s, with no button', !s?.to && s?.wait === 'shoot' && s.who === op.id, JSON.stringify(s))
s = nextStepOf({ ...heldRow, open_round: 1, open_for: 'operator' }, pipe, FILM, MAY)
ok('…and so is one sent back to be filmed again', !s?.to && s?.wait === 'shoot', JSON.stringify(s))
s = nextStepOf({ ...heldRow, type: 'post' }, pipe, DRAW, MAY)
ok('…and a piece that is not filmed reads as it did', !s?.to && s?.wait === 'shoot', JSON.stringify(s))
const TODAY = day(0)
const stepOf = (t) => nextStepOf(t, pipe, FILM, MAY)
const md = coach.makerDay({ pieces: [heldRow], today: TODAY, userId: maker.id, pipe, stepOf, canReviewOf: () => true })
ok('the maker’s day files it under “your move”, as something she can press', md.rows[0]?.group === 'move' && md.rows[0].act.kind === 'move' && md.rows[0].act.verb === 'Send to editing' && md.rows[0].actionable,
  JSON.stringify([md.rows[0]?.group, md.rows[0]?.act]))
const cd = coach.crewEntries([heldRow], op.id, Object.fromEntries(statuses.map((x) => [x.id, x])), pipe)
ok('…and the operator’s job on it reads done', cd.length === 1 && cd[0].kind === 'shoot' && cd[0].done === true)
const stop = coach.wayOf(heldRow, pipe, FILM).find((x) => x.cls === 'on')
ok('…and the stop it stands on names its owner, who has it now', stop?.role === 'shoot' && stop.who === maker.id, JSON.stringify(stop))
ok('…while one still to be filmed names the operator', coach.wayOf({ ...heldRow, shot_at: null }, pipe, FILM).find((x) => x.cls === 'on')?.who === op.id)
// What is still to add once it is in editing: the reference and the day to post.
const onEdit = { ...went.data }
ok('addLater: a filmed piece in editing with neither says both, by the server’s own field names',
  typeof coach.addLater === 'function' && same(coach.addLater(onEdit, FILM, pipe), ['reference_text', 'release_date']), JSON.stringify(coach.addLater?.(onEdit, FILM, pipe)))
ok('…only what is missing', same(coach.addLater?.({ ...onEdit, reference_links: [REF] }, FILM, pipe), ['release_date'])
  && same(coach.addLater?.({ ...onEdit, reference_text: 'Calm, close up.', release_date: day(9) }, FILM, pipe), [])
  && same(coach.addLater?.({ ...onEdit, has_photo: 1 }, FILM, pipe), ['release_date']) && same(coach.addLater?.({ ...onEdit, media_count: 1 }, FILM, pipe), ['release_date']))
ok('…and nothing before editing, once it is out, or on a piece that is not filmed',
  same(coach.addLater?.(heldRow, FILM, pipe), []) && same(coach.addLater?.({ ...onEdit, done_at: new Date().toISOString() }, FILM, pipe), [])
  && same(coach.addLater?.(onEdit, DRAW, pipe), []))
ok('the list row says a reference video is there', (await req(`/content/${t2.id}`, 'PATCH', { title: 'R8: a reference that is a video.' }, MT)).data.media_count === 1)

// ===================== 3. quarter hours =====================
const cam = await mk({ name: 'Bobur Films', username: 'rq' + sfx, role: 'operator' })
const CT = await login('rq' + sfx, 'pw123456')
const Q = day(60)
const q1 = await task({ title: 'R8: typed off the grid', operator_id: cam.id, recording_date: Q, recording_time: '10:10', recording_end: '10:40' })
ok('a shoot’s hours land on the quarter hour — the start down, the end up', q1.recording_time === '10:00' && q1.recording_end === '10:45', `${q1.recording_time}–${q1.recording_end}`)
const q2 = await task({ title: 'R8: on the quarter', operator_id: cam.id, recording_date: Q, recording_time: '11:15', recording_end: '11:45' })
ok('…and a quarter past is kept as it was typed', q2.recording_time === '11:15' && q2.recording_end === '11:45', `${q2.recording_time}–${q2.recording_end}`)
const q2b = await save(q2.id, { recording_time: '12:05', recording_end: '12:50' })
ok('…the same when the hours are changed', q2b.status === 200 && q2b.data.recording_time === '12:00' && q2b.data.recording_end === '13:00', `${q2b.data.recording_time}–${q2b.data.recording_end}`)
const q3 = await task({ title: 'R8: the last quarter', operator_id: cam.id, recording_date: day(61), recording_time: '23:50', recording_end: '23:55' })
ok('…and the day still ends at 23:59', q3.recording_time === '23:45' && q3.recording_end === '23:59', `${q3.recording_time}–${q3.recording_end}`)
const strip = (await req(`/users/${cam.id}/slots?from=${Q}&days=1&mins=15`, 'GET', null, MT)).data
const cal = strip?.calendar?.[0]
ok('the day strip answers in quarter hours when asked', strip?.mins === 15 && same(cal?.slots?.slice(0, 2), [{ from: '09:00', to: '09:15' }, { from: '09:15', to: '09:30' }]), JSON.stringify(cal?.slots?.slice(0, 2)))
ok('…a booked quarter is taken and the next one is free', !cal?.slots?.some((x) => x.from === '10:30') && cal?.slots?.some((x) => x.from === '10:45'), JSON.stringify(cal?.busy))
ok('…and still in half hours when asked for half hours', (await req(`/users/${cam.id}/slots?from=${day(62)}&days=1&mins=30`, 'GET', null, MT)).data?.calendar?.[0]?.slots?.[1]?.from === '09:30')
ok('each booked hour says what its operator answered: nothing yet', cal?.busy?.length === 2 && cal.busy.every((b) => b.ack === ''), JSON.stringify(cal?.busy))
await req(`/content/${q1.id}/confirm`, 'POST', { which: 'shoot', ok: true }, CT)
await req(`/content/${q2.id}/confirm`, 'POST', { which: 'shoot', ok: false, note: 'At the dentist until two' }, CT)
const acks = (await req(`/users/${cam.id}/slots?from=${Q}&days=1&mins=15`, 'GET', null, MT)).data?.calendar?.[0]?.busy || []
ok('…then yes, or no', acks.find((b) => b.id === q1.id)?.ack === 'yes' && acks.find((b) => b.id === q2.id)?.ack === 'no', JSON.stringify(acks))

// ===================== 4. the sidebar's counts =====================
const counts = async (t = A) => (await req('/content/counts', 'GET', null, t)).data?.channels
const all0 = await counts()
ok('counts: every channel the caller may see, each with what is late and what is in editing',
  !!all0 && channels.every((c) => Number.isInteger(all0[c.key]?.late) && Number.isInteger(all0[c.key]?.editing)) && Object.keys(all0).length === channels.length, JSON.stringify(all0 ?? null).slice(0, 160))
const hers = await counts(MT)
ok('…a member sees her own channels and no others', !!hers && same(Object.keys(hers), [CH]), JSON.stringify(hers))
ok('…and somebody on no channel sees none', same(await counts(OT), {}))
const c1 = await placed({ title: 'R8: counted in editing', status_id: editing.id, editor_id: ed.id })
const c2 = await placed({ title: 'R8: counted late', status_id: toShoot.id, operator_id: op.id, recording_date: day(-2), recording_time: '09:00', recording_end: '09:30', release_date: day(-1) })
const all1 = await counts()
ok('a piece standing on the edit stage is one more in editing', all1?.[CH]?.editing === all0?.[CH]?.editing + 1, `${all0?.[CH]?.editing} → ${all1?.[CH]?.editing}`)
ok('a piece past its shoot day and its day to post is one more late — a piece, not a step', all1?.[CH]?.late === all0?.[CH]?.late + 1, `${all0?.[CH]?.late} → ${all1?.[CH]?.late}`)
const team = (await req('/content/day/team')).data
const lateThere = new Set((team?.overdue || []).filter((o) => (o.channels || []).includes(CH)).map((o) => o.content_id)).size
ok('…by the same reading as the admin’s overdue list', all1?.[CH]?.late === lateThere, `${all1?.[CH]?.late} vs ${lateThere}`)
await req(`/content/${c1.id}`, 'PATCH', { status_id: ready.id })
await req(`/content/${c2.id}`, 'PATCH', { status_id: S(/^deleted$/i)?.id })
const all2 = await counts()
ok('…and both leave the count when the piece moves on or is killed', all2?.[CH]?.editing === all0?.[CH]?.editing && all2?.[CH]?.late === all0?.[CH]?.late, JSON.stringify(all2?.[CH]))
const small = JSON.stringify((await req('/content/counts')).data)
ok('it is cheap to poll: two numbers a channel, no task rows', small.length < 60 * channels.length + 40 && !/title/.test(small), `${small.length} characters`)


// ===================== 6. creating =====================
const name = await req('/content', 'POST', { channels: [CH], type: 'reel', title: 'R8: only a name' }, MT)
keep(name)
ok('an idea needs a name and nothing else', name.status === 201 && name.data.status_id === idea.id, `${name.status} ${name.data.error || ''}`)
ok('…and it does need the name', (await req('/content', 'POST', { channels: [CH], type: 'reel', title: ' ' }, MT)).status === 400)
await req('/fields', 'POST', { ...shipped, description: { ...shipped.description, state: 'required', types: ['reel'] } })
const noIdea = await req('/content', 'POST', { channels: [CH], type: 'reel', title: 'R8: a name, no idea' }, MT)
const withIdea = await keep(await req('/content', 'POST', { channels: [CH], type: 'reel', title: 'R8: a name and the idea', description: 'Three fears about the essay, and an answer to each.' }, MT))
ok('…unless the admin made the description required: then the name and the idea', noIdea.status === 400 && /Description/.test(noIdea.data.error || '') && withIdea.status === 201,
  `${noIdea.status} ${noIdea.data.error || ''} / ${withIdea.status}`)
await req('/fields', 'POST', shipped)
const whole = { channels: [CH], type: 'reel', status_id: idea.id, auto_stage: true, operator_id: op.id, ...slot(), script: SCRIPT() }
const born = await keep(await req('/content', 'POST', { ...whole, title: 'R8: booked on the way in' }, MT))
ok(`a complete booking — who films, the day, the hours, the script — is born on «${toShoot.label}»`, born.status === 201 && born.data.status_id === toShoot.id, `${born.status} ${born.data.status_id} ${born.data.error || ''}`)
const short = await keep(await req('/content', 'POST', { ...whole, ...slot(), script: SCRIPT(), recording_time: null, recording_end: null, title: 'R8: booked, no hour' }, MT))
ok('…and with no hour it stays an idea, and is not refused', short.status === 201 && short.data.status_id === idea.id, `${short.status} ${short.data.status_id}`)
const straight = await req('/content', 'POST', { ...whole, ...slot(), script: SCRIPT(), auto_stage: undefined, status_id: toShoot.id, recording_time: null, recording_end: null, title: 'R8: put on To shoot by hand' }, MT)
keep(straight)
ok(`a piece put on «${toShoot.label}» by hand is held to the same wall`, straight.status === 400, `${straight.status} ${straight.data.error || ''}`)

// ===================== tidy up =====================
await req('/fields', 'POST', rulesNow)
const after = (await req('/fields')).data
ok('(the admin’s rules are put back as they were)', ['script', 'tz', 'reference', 'format', 'description'].every((k) => after[k]?.state === before[k]?.state && same(after[k]?.types, before[k]?.types)))
for (const id of made) await req(`/content/${id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nRound 8’s rules hold.')
process.exit(fails ? 1 : 0)

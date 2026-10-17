// The crew's day: what an editor can DO from their own page, and the page
// staying the shape that lets them find it.
//
// ASKING FOR A NEW DAY. The late banner offered every crew member "New day",
// and the server answered every one of them "You don't have permission to move
// dates" — asking wanted a planner's right to MOVE dates, which no crew account
// holds. An ask moves nothing until an admin says yes, so the person whose
// deadline it is may ask about it. Only about their own: an editor still may
// not ask to move the operator's shoot day.
//
// HANDING IN OVER A CHANGE REQUEST. The hand-in moved the piece to Ready and
// left the request open, and the reviewer then found Publish refused over
// "changes still outstanding" for a fix that was sitting right there. The
// hand-in now closes the round it answers — and, like the fix button, will not
// close it with the very file that was sent back.
//
// THE PAGE. Read from the source, because these are layout promises a browser
// suite on CI does not exist to keep: crew land on their job on a desk too,
// the day is one list rather than a banner plus a board, a late row's reason
// box keeps its focus, and nothing on it can push a phone sideways.
//
//   node qa/crewday-suite.mjs           (expects a server on :4090)
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
const sid = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id
const finalId = statuses.find((s) => s.is_final)?.id

const sfx = Date.now().toString(36).slice(-5)
const ed = (await req('/users', 'POST', { name: 'Cora Cutter', username: 'cc' + sfx, password: 'pw123456', role: 'editor' })).data
const op = (await req('/users', 'POST', { name: 'Omar Operator', username: 'oo' + sfx, password: 'pw123456', role: 'operator' })).data
const ET = await login('cc' + sfx, 'pw123456')
ok('an editor account holds no right to move dates', !ed.permissions?.move_tasks && !ed.permissions?.manage_content,
  JSON.stringify(ed.permissions))

// ===================== asking for a new day =====================
const late = (await req('/content', 'POST', {
  title: 'Crew day: late cut', channels: ['instagram_main'], type: 'reel', status_id: sid('editing'),
  editor_id: ed.id, operator_id: op.id, recording_date: day(-6), edit_ready_date: day(-2), release_date: day(3),
})).data
const lateMine = (await req('/content/late/mine', 'GET', null, ET)).data
const row = (lateMine || []).find((r) => r.content_id === late.id)
ok('the late cut is on the editor\'s own late list', !!row && row.phase === 'edit' && row.field === 'edit_ready_date',
  JSON.stringify(row))

// r11 · "Let people edit their own tasks" (the research report): a day that
// is the person's OWN moves on their word — the ask is filed and answered at
// once, through every check an admin's yes has. It used to wait on an admin.
const ask = await req(`/content/${late.id}/date-requests`, 'POST',
  { field: 'edit_ready_date', to_date: day(2), reason: 'The footage came in two days late' }, ET)
ok('the editor moves their own deadline, at once', ask.status === 200 && ask.data?.task && ask.data?.request?.state === 'approved',
  `${ask.status} ${JSON.stringify(ask.data).slice(0, 90)}`)
const again = await req(`/content/${late.id}/date-requests`, 'POST',
  { field: 'edit_ready_date', to_date: day(2), reason: 'Asking a second time about it' }, ET)
ok('…and asking for the day it already has is refused', again.status === 400, String(again.status))
const notTheirs = await req(`/content/${late.id}/date-requests`, 'POST',
  { field: 'recording_date', to_date: day(1), reason: 'I would like the shoot moved' }, ET)
ok('…but not on somebody else\'s — the shoot day is the operator\'s', notTheirs.status === 403, String(notTheirs.status))
const shrug = await req(`/content/${late.id}/date-requests`, 'POST',
  { field: 'design_ready_date', to_date: day(1), reason: 'ok' }, ET)
ok('…and a field that is not theirs is refused before any reason is read', shrug.status === 403, String(shrug.status))
const after = (await req('/content/late/mine', 'GET', null, ET)).data.find((r) => r.content_id === late.id)
ok('the moved cut is no longer late', !after, JSON.stringify(after))
const moved = (await req(`/content/${late.id}`)).data
ok('…because the day really moved — nobody had to say yes', String(moved.edit_ready_date || moved.edit_due_revised).slice(0, 10) === day(2), `${moved.edit_ready_date} / ${moved.edit_due_revised}`)

// ===================== handing in over a change request =====================
const cut = (await req('/content', 'POST', {
  title: 'Crew day: sent back', channels: ['instagram_main'], type: 'reel', status_id: sid('editing'),
  editor_id: ed.id, edit_ready_date: day(1), release_date: day(4),
})).data
const first = await req(`/content/${cut.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/file/d/crewday-A' }, ET)
ok('the cut is handed in', first.status === 200 && first.data.status_id === sid('ready'), String(first.status))
const sent = await req(`/content/${cut.id}/revisions`, 'POST', { note: 'Music is too loud in the second half', target: 'editor' })
ok('the reviewer sends it back to the editor', sent.status === 201, String(sent.status))
const back = (await req('/content/revisions/mine', 'GET', null, ET)).data
ok('…and the editor has it waiting', back.some((r) => r.content_id === cut.id), String(back.length))

const bare = await req(`/content/${cut.id}`, 'PATCH', { milestone: 'edited' }, ET)
ok('handing in again with nothing new is refused', bare.status === 400 && bare.data.needs_link === 'ready_link',
  `${bare.status} ${JSON.stringify(bare.data).slice(0, 110)}`)
const same = await req(`/content/${cut.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/file/d/crewday-A' }, ET)
ok('…and so is the very file that was sent back', same.status === 400 && same.data.needs_link === 'ready_link',
  `${same.status} ${JSON.stringify(same.data).slice(0, 110)}`)
const fixed = await req(`/content/${cut.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/file/d/crewday-B' }, ET)
ok('a new file hands the fix in', fixed.status === 200 && fixed.data.status_id === sid('ready'), String(fixed.status))
const left = (await req('/content/revisions/mine', 'GET', null, ET)).data
ok('…and closes the round it answers', !left.some((r) => r.content_id === cut.id), String(left.length))
const full = (await req(`/content/${cut.id}`)).data
ok('…on the record too', (full.revisions || []).length === 1 && !!full.revisions[0].resolved_at,
  JSON.stringify((full.revisions || []).map((r) => r.resolved_at)))
const pub = await req(`/content/${cut.id}`, 'PATCH', { status_id: finalId, post_link: 'https://instagram.com/p/crewday' })
ok('so the reviewer can publish it — no "changes still outstanding"', pub.status === 200,
  `${pub.status} ${JSON.stringify(pub.data).slice(0, 110)}`)

// A request to somebody ELSE on the piece is not closed by this hand-in.
const two = (await req('/content', 'POST', {
  title: 'Crew day: two hats', channels: ['instagram_main'], type: 'reel', status_id: sid('editing'),
  editor_id: ed.id, operator_id: op.id, release_date: day(4),
})).data
await req(`/content/${two.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/file/d/two-A' }, ET)
await req(`/content/${two.id}/revisions`, 'POST', { note: 'Reshoot the second take please', target: 'operator' })
await req(`/content/${two.id}/revisions`, 'POST', { note: 'And recut the ending after that', target: 'editor' })
const twoIn = await req(`/content/${two.id}`, 'PATCH', { milestone: 'edited', ready_link: 'https://drive.google.com/file/d/two-B' }, ET)
const twoFull = (await req(`/content/${two.id}`)).data
const open2 = (twoFull.revisions || []).map((r) => [r.target, !!r.resolved_at])
ok('with a request to each hat, the editor\'s hand-in closes theirs…',
  twoIn.status === 200 && open2.some(([t, done]) => t === 'editor' && done), `${twoIn.status} ${JSON.stringify(open2)}`)
ok('…and leaves the operator\'s open', open2.some(([t, done]) => t === 'operator' && !done), JSON.stringify(open2))

// "Mark as filmed" sits right under the footage box, so the link goes with it.
const OT = await login('oo' + sfx, 'pw123456')
const shoot = (await req('/content', 'POST', {
  title: 'Crew day: filmed', channels: ['instagram_main'], type: 'reel', status_id: sid('to shoot'),
  operator_id: op.id, editor_id: ed.id, recording_date: day(0), release_date: day(4),
})).data
const filmed = await req(`/content/${shoot.id}`, 'PATCH', { milestone: 'shot', shot_link: 'https://drive.google.com/drive/folders/crewday-raw' }, OT)
ok('marking it filmed with a footage link keeps the link', filmed.status === 200 &&
  filmed.data.shot_link === 'https://drive.google.com/drive/folders/crewday-raw', `${filmed.status} ${filmed.data.shot_link || JSON.stringify(filmed.data).slice(0, 90)}`)

for (const t of [late, cut, two, shoot]) await req(`/content/${t.id}`, 'DELETE')

// ===================== the page, from the source =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const modal = src('client/src/components/ContentModal.jsx')
// 13 Oct 2026: the crew's own variant of the old sheet went with its tabs; the
// crew hand their work in from the task window, the same one everybody opens.
const win = src('client/src/components/CoachTask.jsx')
ok('the crew hand in from the task window: one box, one button that says what it does',
  /<HandIn inline key=/.test(win) && /edit: \(\) => tx\('Hand in the edit'\)/.test(win)
  && !/crewViewer|crew-handin-btn/.test(modal))

const brief = src('client/src/pages/Brief.jsx')
ok('My Day for the crew is one list — no late banner and no two-lane board beside it',
  /<CrewDay\b/.test(brief) && !/<MyLate\b/.test(brief) && !/<CrewBoard\b/.test(brief))

const day2 = src('client/src/components/CrewDay.jsx')
ok('a late row\'s reason box keeps its focus — no component declared inside the page',
  !/const Row = \(/.test(day2) && /g\.rows\.map\(row\)/.test(day2))
ok('"Can\'t make it?" only where the server has the job as late', /info && !info\.asked && !info\.flagged/.test(day2))
ok('one filled button on the page, on the job to start with', /const urgent = e === firstUp/.test(day2))

const css = src('client/src/styles.css')
ok('the crew calendar\'s columns can shrink on a phone', /\.cc-grid \{[^}]*repeat\(7, minmax\(0, 1fr\)\)/.test(css))
ok('…and so can a row of the day', /\.cd-main \{[^}]*min-width: 0/.test(css) && /\.cd-body \{[^}]*min-width: 0/.test(css))
ok('…stacked, on a phone, to the width of the row rather than its longest line',
  /\.cd-main \{ flex-direction: column; align-items: stretch;/.test(css))

const consts = src('client/src/lib/constants.js')
ok('"Today" and "Tomorrow" are said in the reader\'s language', /return tx\('Today'\)/.test(consts) && /return tx\('Tomorrow'\)/.test(consts))

const layout = src('client/src/components/Layout.jsx')
ok('the crew\'s phone bar follows their craft, pay among the first two', /crewCaps/.test(layout) && /'docs', 'recordings'\]/.test(layout))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

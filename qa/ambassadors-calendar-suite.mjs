// The Ambassadors calendar: which videos came in, and which still need an
// editor — and handing one over in two taps.
//
//   THE CARDS.    GET /ambassadors/videos — a card per video that came in, on
//                 the day it came in, New / With editor / Done read off the task
//                 made from it. New is late once it has waited over 2 days.
//                 Not drawn: a video they post themselves, one sent back.
//   THE PRESS.    POST /ambassadors/cards/:id/assign — one ordinary task (the
//                 chosen channel, Editing, the editor seated, the video as its
//                 footage), for an admin of that channel and nobody else, once
//                 per video, and taken back by POST /content/:id/undo.
//   THE TABLE.    "Approved" counts a video handed to an editor this month.
//
// The checks that need a day in the past (late, Sent earlier, last month's
// approval) write it into the database, so they run only with DATA_DIR.
//
//   DATA_DIR=<that server's DATA_DIR> node qa/ambassadors-calendar-suite.mjs   (a server on :4090)
import { join } from 'path'
import { pathToFileURL } from 'url'

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
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 864e5))
const TODAY = day()
const MONTH = TODAY.slice(0, 7)
const statuses = (await req('/statuses')).data
const ADMIN = (await req('/auth/me')).data
const EDITING = statuses.find((s) => /^editing$/i.test(s.label))?.id
const READY = statuses.find((s) => /^ready$/i.test(s.label))?.id
const PUBLISHED = statuses.find((s) => s.is_final)?.id

const sfx = Date.now().toString(36).slice(-5)
const mk = async (body) => (await req('/users', 'POST', { password: 'pw123456', ...body })).data
const ed = await mk({ name: `Eldor Cal${sfx}`, username: 'ce' + sfx, role: 'editor' })
const edYt = await mk({ name: `Yulduz Cal${sfx}`, username: 'cy' + sfx, role: 'editor', crew_channels: ['youtube'] })
const member = await mk({ name: `Mira Cal${sfx}`, username: 'cm' + sfx, role: 'member', departments: ['instagram_main'], permissions: { manage_content: true } })
const ytAdmin = await mk({ name: `Yusuf Cal${sfx}`, username: 'cya' + sfx, role: 'admin', admin_channels: ['youtube'] })
const amb = await mk({ name: `Zarina Ambassador${sfx}`, username: 'ca' + sfx, role: 'ambassador' })
const ET = await login('ce' + sfx, 'pw123456')
const MT = await login('cm' + sfx, 'pw123456')
const YT = await login('cya' + sfx, 'pw123456')
const AT = await login('ca' + sfx, 'pw123456')
await req(`/ambassadors/person/${amb.id}`, 'PUT', { university: 'Inha University', status: 'active' })
ok('(an editor, a YouTube-only editor, a member, a YouTube admin and an ambassador)', !!(ed.id && edYt.id && member.id && ytAdmin.id && ET && MT && YT && AT))

// An idea, approved, filmed: a video that came in. `url` is what they sent.
const video = async (format, url) => {
  await req('/ambassadors/me/cards', 'POST', { format, script: `${format}: a day at my university and how SATashkent helped me get in.` }, AT)
  const card = (await req('/ambassadors/me', 'GET', null, AT)).data.cards.find((c) => c.format === format)
  await req(`/ambassadors/cards/${card.id}/approve`, 'POST', { amount: 400000 })
  if (url) await req(`/ambassadors/me/cards/${card.id}/filmed`, 'POST', { video_url: url }, AT)
  return card.id
}
const videos = async (month = '') => (await req(`/ambassadors/videos${month ? `?month=${month}` : ''}`)).data
const find = (d, id) => [...(d.videos || []), ...(d.earlier || [])].find((v) => v.id === id)

// ===================== the cards =====================
const URL1 = 'https://drive.google.com/file/d/1AbCdEf/view'
const c1 = await video(`Campus tour ${sfx}`, URL1)
const cIdea = await video(`Not filmed yet ${sfx}`, '')
let d = await videos()
let v1 = find(d, c1)
ok('a card for the video that came in: New, today, not late', v1?.state === 'new' && v1.day === TODAY && v1.late === false && v1.url === URL1 && v1.task === null, JSON.stringify(v1))
ok('…named, with where they study', v1?.name === amb.name && v1.university === 'Inha University')
ok('no card for an idea nobody has filmed', !find(d, cIdea))
ok('the month and today are the server’s', d.month === MONTH && d.today === TODAY)
const ig = d.channels.find((c) => c.key === 'instagram_main')
ok('Instagram Main is offered, with its editors from the server', !!ig && ig.editors.some((e) => e.id === ed.id), JSON.stringify(ig))
ok('…but not an editor who works only on YouTube', !ig.editors.some((e) => e.id === edYt.id) && d.channels.find((c) => c.key === 'youtube')?.editors.some((e) => e.id === edYt.id))
ok('a written channel is not offered — nobody edits there', !d.channels.some((c) => c.key === 'telegram_main'))
ok('an editor cannot read the calendar', (await req('/ambassadors/videos', 'GET', null, ET)).status === 403)

// Not drawn: a video they post themselves, and one sent back to be filmed again.
const cThem = await video(`They post it ${sfx}`, 'https://youtu.be/abcdefghijk')
await req(`/ambassadors/cards/${cThem}/video-ok`, 'POST', { who_posts: 'them' })
const cBack = await video(`Sent back ${sfx}`, 'https://youtu.be/bcdefghijkl')
await req(`/ambassadors/cards/${cBack}/video-changes`, 'POST', { feedback: 'The logo is missing' })
d = await videos()
ok('a video they post on their own account is not on the calendar', !find(d, cThem))
ok('nor one sent back to be filmed again', !find(d, cBack))

// ===================== who may press =====================
const assign = (id, body, t = T) => req(`/ambassadors/cards/${id}/assign`, 'POST', body, t)
const ownTasks = async () => (await req('/content')).data.filter?.((t) => String(t.title).includes(amb.name)) || []
let r = await assign(c1, { channel: 'instagram_main', editor_id: ed.id }, ET)
ok('an editor is refused', r.status === 403, `${r.status} ${r.data.error}`)
r = await assign(c1, { channel: 'instagram_main', editor_id: ed.id }, MT)
ok('a member of the channel is refused', r.status === 403, `${r.status} ${r.data.error}`)
r = await assign(c1, { channel: 'instagram_main', editor_id: ed.id }, YT)
ok('an admin of another channel is refused', r.status === 403, `${r.status} ${r.data.error}`)
r = await assign(c1, { channel: 'instagram_main', editor_id: edYt.id })
ok('an editor who does not work on the channel is refused', r.status === 400, `${r.status} ${r.data.error}`)
r = await assign(c1, { channel: 'telegram_main', editor_id: ed.id })
ok('a channel nobody edits on is refused', r.status === 400, `${r.status} ${r.data.error}`)
r = await assign(cIdea, { channel: 'instagram_main', editor_id: ed.id })
ok('an idea with no video is refused', r.status === 409, `${r.status} ${r.data.error}`)
ok('…and none of those made a task', (await ownTasks()).length === 0)

// ===================== the press =====================
r = await assign(c1, { channel: 'instagram_main', editor_id: ed.id })
ok('an admin hands the video to an editor', r.status === 201 && r.data.task_id > 0, `${r.status} ${JSON.stringify(r.data)}`)
let taskId = r.data.task_id
let t = (await req(`/content/${taskId}`)).data
ok('exactly one task', (await ownTasks()).length === 1)
ok('…on the chosen channel, at Editing, the editor seated', JSON.stringify(t.channels) === '["instagram_main"]' && t.status_id === EDITING && t.editor_id === ed.id, JSON.stringify({ ch: t.channels, st: t.status_id, ed: t.editor_id }))
ok('…the video attached as footage — the link, as sent', t.shot_link === URL1 && !!t.shot_at)
ok('…an ordinary video task, owned by the admin who pressed, the cut due in two days', t.type === 'reel' && t.assignee_id === (ADMIN.user || ADMIN).id && t.edit_ready_date === day(2), JSON.stringify({ type: t.type, owner: t.assignee_id, due: t.edit_ready_date }))
ok('…and the ambassador named on it, in no paid seat', t.title.includes(amb.name) && String(t.description).includes(amb.name)
  && ![t.assignee_id, t.operator_id, t.editor_id, t.designer_id, t.reviewer_id, ...(t.faces || [])].includes(amb.id))
const bell = (await req('/notifications', 'GET', null, ET)).data
ok('the editor hears about it like any new work', JSON.stringify(bell).includes(String(t.title).slice(0, 20)))
ok('the task is on the editor’s list', (await req('/content', 'GET', null, ET)).data.some?.((x) => x.id === taskId))
d = await videos()
v1 = find(d, c1)
ok('the card is With editor now, read off the task', v1?.state === 'editing' && v1.task?.id === taskId && v1.task.editor === ed.name && v1.task.channel === 'Instagram Main', JSON.stringify(v1?.task))

r = await assign(c1, { channel: 'instagram_main', editor_id: ed.id })
ok('a second press is refused, with the reason', r.status === 409 && /already set/.test(r.data.error) && r.data.task_id === taskId, `${r.status} ${r.data.error}`)
ok('…and makes no second task', (await ownTasks()).length === 1)

// ===================== undo =====================
r = await req(`/content/${taskId}/undo`, 'POST', null, ET)
ok('somebody else cannot take the press back', r.status === 403, `${r.status} ${r.data.error}`)
r = await req(`/content/${taskId}/undo`, 'POST')
ok('the admin can, within ten seconds — the task is gone', r.status === 200 && r.data.gone === true && (await req(`/content/${taskId}`)).status === 404, `${r.status} ${JSON.stringify(r.data)}`)
d = await videos()
ok('…and the card is New again', find(d, c1)?.state === 'new' && find(d, c1)?.task === null)
r = await assign(c1, { channel: 'instagram_main', editor_id: ed.id })
ok('so it can be handed over again', r.status === 201 && r.data.task_id !== taskId)
taskId = r.data.task_id

// ===================== out =====================
await req(`/content/${taskId}`, 'PATCH', { ready_link: 'https://drive.google.com/file/d/cut1/view', status_id: READY })
r = await req(`/content/${taskId}`, 'PATCH', { status_id: PUBLISHED, post_link: 'https://www.instagram.com/reel/cal-suite/' })
ok('(the task is published)', r.status === 200, `${r.status} ${r.data.error || ''}`)
d = await videos()
ok('the card is Done once its task is out', find(d, c1)?.state === 'done' && find(d, c1)?.task.done === true)

// ===================== days in the past =====================
if (process.env.DATA_DIR) {
  const { createClient } = await import('@libsql/client')
  const db = createClient({ url: `file:${join(process.env.DATA_DIR, 'dashboard.db')}`, intMode: 'number' })
  const backdate = (id, iso) => db.execute({ sql: "UPDATE ambassador_card_events SET created_at = ? WHERE card_id = ? AND kind = 'video'", args: [iso, id] })
  const cLate = await video(`Waited ${sfx}`, 'https://youtu.be/cdefghijklm')
  const cTwo = await video(`Two days ${sfx}`, 'https://youtu.be/defghijklmn')
  await backdate(cLate, `${day(-3)}T06:00:00.000Z`)
  await backdate(cTwo, `${day(-2)}T06:00:00.000Z`)
  d = await videos(day(-3).slice(0, 7))
  ok('a New video that has waited 3 days is late', find(d, cLate)?.late === true && find(d, cLate)?.waited === 3, JSON.stringify(find(d, cLate)))
  d = await videos(day(-2).slice(0, 7))
  ok('…one that has waited 2 is not yet', find(d, cTwo)?.late === false && find(d, cTwo)?.waited === 2)

  const first = new Date(`${MONTH}-01T00:00:00Z`)
  first.setUTCDate(0)
  const lastMonthDay = first.toISOString().slice(0, 10)
  const cOld = await video(`Last month ${sfx}`, 'https://youtu.be/efghijklmno')
  await backdate(cOld, `${lastMonthDay}T06:00:00.000Z`)
  d = await videos()
  ok('a New video from last month is in “Sent earlier”, not in this month', d.earlier.some((v) => v.id === cOld) && !d.videos.some((v) => v.id === cOld))
  ok('…and on its own day in last month', (await videos(lastMonthDay.slice(0, 7))).videos.some((v) => v.id === cOld && v.day === lastMonthDay))

  // "Approved": an idea approved last month, its video handed over this month.
  const count = async () => (await req('/ambassadors')).data.people.find((p) => p.user_id === amb.id)?.approved
  const before = await count()
  await db.execute({ sql: 'UPDATE ambassador_cards SET approved_at = ? WHERE id = ?', args: [`${lastMonthDay}T06:00:00.000Z`, cOld] })
  const dropped = await count()
  await assign(cOld, { channel: 'instagram_main', editor_id: ed.id })
  ok('“Approved” counts a video handed to an editor this month — once', dropped === before - 1 && await count() === before, `${before} → ${dropped} → ${await count()}`)
  db.close()
} else console.log('· no DATA_DIR for the server at BASE — the checks that need a day in the past are skipped (CI passes it)')

// ===================== the page's readings =====================
const lib = await import(pathToFileURL(join(ROOT, 'client/src/lib/ambCalendar.js')).href)
ok('YouTube keeps its start time', lib.embedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')?.src === 'https://www.youtube.com/embed/dQw4w9WgXcQ?start=90'
  && lib.embedOf('https://youtu.be/dQw4w9WgXcQ?t=42')?.src === 'https://www.youtube.com/embed/dQw4w9WgXcQ?start=42'
  && lib.embedOf('https://youtube.com/shorts/dQw4w9WgXcQ')?.src === 'https://www.youtube.com/embed/dQw4w9WgXcQ')
ok('a Drive file plays in Drive’s own player', lib.embedOf('https://drive.google.com/file/d/1AbC-dEf/view?usp=sharing')?.src === 'https://drive.google.com/file/d/1AbC-dEf/preview'
  && lib.embedOf('https://drive.google.com/open?id=1AbC')?.src === 'https://drive.google.com/file/d/1AbC/preview')
ok('a video file plays in the native player; anything else is only a link', lib.embedOf('https://cdn.example.com/a/clip.MP4')?.file === true
  && lib.embedOf('https://www.instagram.com/reel/abc/') === null && lib.embedOf('not a link') === null && lib.embedOf('javascript:alert(1)') === null)
const runs = lib.dayRuns('2026-10', [{ day: '2026-10-02' }, { day: '2026-10-05' }], '2026-10-06')
ok('the phone’s month: days with a video, and one line per empty run, split at today',
  JSON.stringify(runs.map((x) => x.day || `${x.from}..${x.to}:${x.ahead ? 'ahead' : 'gone'}`))
  === JSON.stringify(['2026-10-01..2026-10-01:gone', '2026-10-02', '2026-10-03..2026-10-04:gone', '2026-10-05', '2026-10-06..2026-10-31:ahead']), JSON.stringify(runs))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exitCode = fails ? 1 : 0

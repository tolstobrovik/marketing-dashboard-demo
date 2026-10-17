// Ambassador 2.0: their two weeks, their rates, and a brief they can film from.
//
// An ambassador is not staff — one page, and the server refuses them
// everything else. That does not change. What changes is that a task GIVEN to
// one (an admin adds them as its owner) is now something they can see:
//
//   THE DAYS.   /ambassadors/me/tasks — when each task is filmed and when its
//               cut is due. With no editor on it the cut's day is not a date
//               anybody agreed to, so it comes back empty and the page says TBD.
//   THE BRIEF.  /ambassadors/me/tasks/:id — ТЗ, script, references. Read-only,
//               and only for a task that is theirs.
//   THE HAND-IN. …/footage — where the footage is, saved as written. A file
//               name is taken; no stage gate runs and no stage moves. Staff
//               are held exactly as strictly as before.
//   THE RATES.  /ambassadors/me/rates — the card they are on: per kind of
//               piece, the flat rate, the view threshold and the per-1,000.
//
//   node qa/ambassador2-suite.mjs        (expects a server on :4090)
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
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 864e5))
const statuses = (await req('/statuses')).data
const IDEA = statuses.find((s) => /^idea$/i.test(s.label))?.id
const chKey = (await req('/channels')).data.find((c) => c.format === 'social')?.key

const sfx = Date.now().toString(36).slice(-5)
const mk = async (name, username, role, departments = []) =>
  (await req('/users', 'POST', { name, username, password: 'pw123456', role, departments })).data
const amb = await mk('Aziza Ambassador', 'am' + sfx, 'ambassador')
const other = await mk('Bobur Ambassador', 'ao' + sfx, 'ambassador')
const ed = await mk('Eldor Editor', 'ae' + sfx, 'editor')
const AT = await login('am' + sfx, 'pw123456')
const OT = await login('ao' + sfx, 'pw123456')
const ET = await login('ae' + sfx, 'pw123456')
ok('(two ambassadors and an editor)', amb.role === 'ambassador' && other.role === 'ambassador' && !!AT && !!OT && !!ET, JSON.stringify([amb.role, other.role]))

const task = async (body) => (await req('/content', 'POST', { channels: [chKey], type: 'reel', status_id: IDEA, ...body })).data
const a = await task({
  title: 'Amb: campus tour', assignee_ids: [amb.id], editor_id: ed.id,
  recording_date: day(2), edit_ready_date: day(5),
  tz: 'Vertical, 30–40 seconds, captions on, upbeat music.',
  script: 'Open on the gate. Walk to the library. End on the question: have you applied?',
  reference_text: 'Like this one, but ours: https://www.instagram.com/reel/abc123/',
  reference_links: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
})
const b = await task({ title: 'Amb: no editor yet', assignee_ids: [amb.id], recording_date: day(3), edit_ready_date: day(6) })
const c = await task({ title: 'Amb: somebody else’s', assignee_ids: [other.id], recording_date: day(1) })
const d = await task({ title: 'Amb: same day', assignee_ids: [amb.id], editor_id: ed.id, recording_date: day(4), edit_ready_date: day(4) })
ok('(an admin can give a task to an ambassador)', a.id && a.assignees?.includes(amb.id), JSON.stringify(a).slice(0, 140))

// ===================== the days =====================
let r = await req('/ambassadors/me/tasks', 'GET', null, AT)
const mine = r.data
ok('the ambassador sees the tasks given to them', r.status === 200 && [a.id, b.id, d.id].every((id) => mine.some((t) => t.id === id)), `${r.status} ${JSON.stringify(mine.map?.((t) => t.id))}`)
ok('…and nobody else’s', !mine.some((t) => t.id === c.id))
const A = mine.find((t) => t.id === a.id)
ok('each carries the day it is filmed and the day its cut is due', A?.recording_date === day(2) && A?.edit_ready_date === day(5) && A?.editor === 'Eldor Editor', JSON.stringify(A))
const B = mine.find((t) => t.id === b.id)
ok('with no editor yet the cut’s day is empty — the page says TBD', B?.editor === null && B?.edit_ready_date === null && B?.recording_date === day(3), JSON.stringify(B))
const D = mine.find((t) => t.id === d.id)
ok('filming and the cut on one day are both there to stack', D?.recording_date === day(4) && D?.edit_ready_date === day(4))
ok('the list says which tasks have a brief to read', A?.has_brief === true && B?.has_brief === false)

// ===================== the brief =====================
r = await req(`/ambassadors/me/tasks/${a.id}`, 'GET', null, AT)
ok('the brief carries the ТЗ, the script and the references', r.status === 200 && /Vertical, 30/.test(r.data.tz) && /Open on the gate/.test(r.data.script)
  && /instagram\.com\/reel/.test(r.data.reference_text) && r.data.reference_links?.[0] === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', JSON.stringify(r.data).slice(0, 200))
ok('…and nothing of the pipeline — no stage, no crew ids', !('status_id' in r.data) && !('operator_id' in r.data) && !('editor_id' in r.data), Object.keys(r.data).join(','))
r = await req(`/ambassadors/me/tasks/${b.id}`, 'GET', null, AT)
ok('an unwritten brief comes back empty, for the page to hide', r.status === 200 && r.data.tz === '' && r.data.script === '' && r.data.reference_links.length === 0 && r.data.reference_photos.length === 0)
ok('another ambassador’s task has no brief for them', (await req(`/ambassadors/me/tasks/${c.id}`, 'GET', null, AT)).status === 404)

// ===================== the hand-in =====================
r = await req(`/ambassadors/me/tasks/${a.id}/footage`, 'POST', { link: 'IMG_4432.MOV — in the shared Drive folder' }, AT)
ok('a file name is taken as readily as a link — no gate, no refusal', r.status === 200 && r.data.task?.shot_link === 'IMG_4432.MOV — in the shared Drive folder', `${r.status} ${JSON.stringify(r.data)}`)
let full = (await req(`/content/${a.id}`)).data
ok('…saved on the task, where the editor looks for it', full.shot_link === 'IMG_4432.MOV — in the shared Drive folder')
ok('…and the stage did not move — that is not an ambassador’s to do', full.status_id === IDEA)
ok('…on the record', (full.activity || []).some((x) => x.field === 'shot_link' && x.user_name === 'Aziza Ambassador'))
const edBell = (await req('/notifications', 'GET', null, ET)).data.events || []
ok('the editor’s bell says the footage is in', edBell.some((e) => e.content_id === a.id && /handed in the footage/.test(e.text)))
r = await req(`/ambassadors/me/tasks/${a.id}/footage`, 'POST', { link: 'https://drive.google.com/file/d/amb-footage/view' }, AT)
ok('a link replaces it', r.status === 200 && (await req(`/content/${a.id}`)).data.shot_link === 'https://drive.google.com/file/d/amb-footage/view')
ok('nothing at all is the one thing refused', (await req(`/ambassadors/me/tasks/${a.id}/footage`, 'POST', { link: '   ' }, AT)).status === 400)
ok('they cannot hand in on a task that is not theirs', (await req(`/ambassadors/me/tasks/${c.id}/footage`, 'POST', { link: 'x.mov' }, AT)).status === 404)
ok('…and the owner of that one can', (await req(`/ambassadors/me/tasks/${c.id}/footage`, 'POST', { link: 'x.mov' }, OT)).status === 200)

// ===================== the rates =====================
r = await req('/ambassadors/me/rates', 'GET', null, AT)
ok('with no card set, the rates come back empty rather than invented', r.status === 200 && Array.isArray(r.data.kinds), JSON.stringify(r.data))
const card = await req('/reports/pay/rules/role:ambassador', 'PUT', {
  currency: 'UZS',
  kind_rules: { post: { flat: 50000, gate: 10000, per_1k: 6000 }, reel: { flat: 80000, gate: 20000, per_1k: 5000 } },
})
ok('(the admin sets the ambassador role’s card)', card.status < 300, `${card.status} ${card.data.error || ''}`)
r = await req('/ambassadors/me/rates', 'GET', null, AT)
const post = r.data.kinds?.find((k) => k.kind === 'post'), reel = r.data.kinds?.find((k) => k.kind === 'reel')
ok('My Rates shows the role’s card: posts — fixed, threshold, per 1,000', post?.flat === 50000 && post?.gate === 10000 && post?.per_1k === 6000, JSON.stringify(r.data))
ok('…and reels', reel?.flat === 80000 && reel?.gate === 20000 && reel?.per_1k === 5000)
ok('…and says where it comes from', r.data.source === 'role' && r.data.currency === 'UZS')
await req('/reports/pay/rules/role:ambassador', 'DELETE')

// ===================== still one page =====================
ok('the board is still not theirs', (await req('/content', 'GET', null, AT)).status === 403)
ok('…nor the team', (await req('/users', 'GET', null, AT)).status === 403)
ok('…nor the task itself through the staff route', (await req(`/content/${a.id}`, 'GET', null, AT)).status === 403)
ok('…and the brief cannot be edited by them', (await req(`/content/${a.id}`, 'PATCH', { script: 'my own script' }, AT)).status === 403
  && /Open on the gate/.test((await req(`/content/${a.id}`)).data.script))
ok('…nor the programme’s admin queue', (await req('/ambassadors', 'GET', null, AT)).status === 403)

// ===================== the page =====================
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const comp = read('client/src/components/AmbassadorTasks.jsx')
const page = read('client/src/pages/Ambassadors.jsx')
ok('the page draws the calendar and the rates', /<MiniCalendar tasks=\{tasks\}/.test(page) && /<MyRates rates=\{rates\}/.test(page))
ok('the brief is its own lightweight window — not the staff task sheet', /<BriefModal/.test(page) && !/ContentModal/.test(page) && !/ContentModal|StageGate/.test(comp))
ok('a phone gets a chronological list instead of the grid', /useIsPhone\(\)/.test(comp) && /ambt-list/.test(comp) && /ambt-grid/.test(comp))
ok('filming is stacked above the cut on a shared day', comp.indexOf("kind: 'film'") > 0 && comp.indexOf("kind: 'film'") < comp.indexOf("kind: 'edit'"))
ok('a missing cut day reads TBD', /tx\('TBD'\)/.test(comp))
ok('an empty brief section is not drawn', /\{b\?\.tz && \(/.test(comp) && /\{b\?\.script && \(/.test(comp) && /\{hasRefs && \(/.test(comp))
const i18n = read('client/src/lib/i18n.jsx')
for (const [en, ru, uz] of [
  ['Mini Calendar', 'Мини-календарь', 'Mini taqvim'],
  ['Filming Due', 'Съемка до', 'Suratga olish muddati'],
  ['Edit Due', 'Монтаж до', 'Montaj muddati'],
  ['My Rates & Thresholds', 'Мои ставки и пороги', 'Mening stavkalarim va chegaralarim'],
  ['Task Brief (TZ)', 'ТЗ задачи', 'Vazifa TQ (Texnik topshiriq)'],
  ['Script', 'Сценарий', 'Ssenariy'],
  ['References', 'Референсы', 'Referenslar'],
  ['Submit footage link', 'Ссылка на исходники', 'Xomaki videolar havolasi'],
]) ok(`“${en}” reads as the spec wrote it`, i18n.includes(`"${en}": "${ru}"`) && i18n.includes(`"${en}": "${uz}"`))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

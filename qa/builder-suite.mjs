// The task builder: four small questions instead of a form, and the quieter
// board around it.
//
// WHAT IT SENDS. The builder writes a new task through the same route the
// full sheet used, at the same stage (the idea), so everything here is the
// server agreeing with the exact shape the builder posts: a name, a kind, a
// day, the crew as faces, notes whose links become the reference, pictures as
// the reference album — and files hung on the task once it exists.
//
// WHERE A REFUSAL POINTS. The builder takes a person back to the question a
// refusal is about. It can only do that because the server names the field:
// a crew seat on the wrong channel carries `crew_field`, and a description the
// admin demands says «Description».
//
// THE PAGE. Read from the source: every new task goes through the builder, the
// four steps are four components, Enter and Ctrl+Enter do what they say, the
// window keeps one height, motion respects the system setting, and the board
// card shows faces and a one-press move instead of a chip per hat.
//
//   node qa/builder-suite.mjs           (expects a server on :4090)
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
const CH = 'instagram_main'

const sfx = Date.now().toString(36).slice(-5)
const smm = (await req('/users', 'POST', {
  name: 'Sara Smm', username: 'bs' + sfx, password: 'pw123456', role: 'member',
  departments: [CH], permissions: { manage_content: true, move_tasks: true },
})).data
const op = (await req('/users', 'POST', { name: 'Otabek Films', username: 'bo' + sfx, password: 'pw123456', role: 'operator' })).data
const ed = (await req('/users', 'POST', { name: 'Elyor Cuts', username: 'be' + sfx, password: 'pw123456', role: 'editor' })).data
const far = (await req('/users', 'POST', {
  name: 'Farrux Elsewhere', username: 'bf' + sfx, password: 'pw123456', role: 'crew', crew_roles: ['operator'], crew_channels: ['youtube'],
})).data
const ST = await login('bs' + sfx, 'pw123456')

// Exactly what TaskBuilder.payloadOf() builds.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const shape = (over = {}) => ({
  title: 'Builder: SAT results reel', channels: [CH], type: 'reel', status_id: idea?.id ?? null,
  release_date: day(1), recording_date: null,
  description: 'Top five scores, like this one https://www.instagram.com/reel/builder1',
  reference_links: ['https://www.instagram.com/reel/builder1'],
  reference_photos: [{ photo: PNG, thumb: PNG }], photo: PNG, photo_thumb: PNG,
  operator_id: op.id, editor_id: ed.id, campaign_id: null, ...over,
})
const made = []

// ===================== what it sends =====================
const a = await req('/content', 'POST', shape(), ST)
ok('an SMM makes a task with exactly what the builder sends', a.status === 201, `${a.status} ${a.data?.error || ''}`)
if (a.data?.id) made.push(a.data.id)
const full = (await req(`/content/${a.data.id}`, 'GET', null, ST)).data
ok('…born an idea', full.status_id === idea?.id, String(full.status_id))
ok('…a reel on the one channel', full.type === 'reel' && JSON.stringify(full.channels) === JSON.stringify([CH]))
ok('…going out on the day picked', full.release_date === day(1), full.release_date)
ok('…with the faces picked for filming and cutting', full.operator_id === op.id && full.editor_id === ed.id,
  `${full.operator_id}/${full.editor_id}`)
ok('…the notes as its description, and their link as its reference',
  /Top five scores/.test(full.description || '') && (full.reference_links || []).includes('https://www.instagram.com/reel/builder1'))
ok('…the picture as its reference album', (full.reference_photos || []).length === 1 && !!full.photo)
ok('…and it is the SMM\'s own task', full.assignee_id === smm.id, String(full.assignee_id))

const bare = await req('/content', 'POST', shape({
  title: 'Builder: just a name and a kind', release_date: null, description: '', reference_links: [],
  reference_photos: [], photo: null, photo_thumb: null, operator_id: null, editor_id: null,
}), ST)
ok('a name and a kind are enough — "Create now" on the second step', bare.status === 201, `${bare.status} ${bare.data?.error || ''}`)
if (bare.data?.id) made.push(bare.data.id)

const file = await req(`/content/${a.data.id}/files`, 'POST', { name: 'brief.txt', data: 'data:text/plain;base64,aGVsbG8=' }, ST)
ok('a dropped file is hung on the task once it exists', file.status === 201 || file.status === 200, `${file.status} ${file.data?.error || ''}`)

const byAdmin = await req('/content', 'POST', shape({ title: 'Builder: given by an admin', assignee_ids: [smm.id] }))
ok('an admin\'s "Whose task is it?" face makes it that person\'s', byAdmin.status === 201 && byAdmin.data.assignee_id === smm.id,
  `${byAdmin.status} ${byAdmin.data?.assignee_id}`)
if (byAdmin.data?.id) made.push(byAdmin.data.id)

// ===================== where a refusal points =====================
const wrong = await req('/content', 'POST', shape({ title: 'Builder: wrong channel shooter', operator_id: far.id }), ST)
ok('somebody who does not work on the channel cannot be picked to film', wrong.status === 400, String(wrong.status))
ok('…and the refusal names the seat, so the builder goes back to "Who films it?"', wrong.data?.crew_field === 'operator_id',
  JSON.stringify(wrong.data).slice(0, 120))

const before = (await req('/fields')).data
const keep = {}
for (const k of ['format', 'rubrika', 'script', 'tz', 'reference', 'description']) if (before[k]) keep[k] = { state: before[k].state, types: before[k].types, ...(before[k].options ? { options: before[k].options } : {}) }
await req('/fields', 'POST', { ...keep, description: { state: 'required', types: ['reel'] } })
const noDesc = await req('/content', 'POST', shape({ title: 'Builder: no description', description: '', reference_links: [] }), ST)
ok('when an admin demands a description, an idea without one is refused', noDesc.status === 400, `${noDesc.status}`)
ok('…in words the builder can send them back to step four with', /Description/i.test(noDesc.data?.error || ''), noDesc.data?.error)
const withDesc = await req('/content', 'POST', shape({ title: 'Builder: with description' }), ST)
ok('…and one with a description goes through', withDesc.status === 201, `${withDesc.status} ${withDesc.data?.error || ''}`)
if (withDesc.data?.id) made.push(withDesc.data.id)
await req('/fields', 'POST', keep)
const after = (await req('/fields')).data
ok('(the admin\'s rules are put back as they were)', after.description?.state === before.description?.state, after.description?.state)

for (const id of made) await req(`/content/${id}`, 'DELETE')

// ===================== the page, from the source =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8')
const modal = src('client/src/components/ContentModal.jsx')
ok('every new task opens in the builder, whichever page asked for it',
  /export default function ContentModal\(props\)/.test(modal) && /!props\.item && !full/.test(modal) && /<TaskBuilder/.test(modal))
ok('…and "All fields" hands every answer to the full sheet', /startFull/.test(modal) && /defaults\.title/.test(modal) && /defaults\.operator_id/.test(modal))

const builder = src('client/src/components/builder/TaskBuilder.jsx')
ok('four steps, each its own component',
  ['StepTitle', 'StepType', 'StepWhen', 'StepMore'].every((c) => new RegExp(`import ${c} from './${c}.jsx'`).test(builder)))
ok('Ctrl/⌘+Enter makes the task from any step', /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/.test(builder))
ok('Create is offered before the last step', /tb-now/.test(builder))
ok('what was typed survives closing the window', /satashkent_builder_\$\{user\.id\}/.test(builder) && /writeJSON\(DRAFT/.test(builder))
ok('a refusal about a crew seat goes back to the step that holds that seat',
  /e\.data\?\.crew_field\) goTo\(SEAT_STEP\[e\.data\.crew_field\]\)/.test(builder)
    && /operator_id: 'shoot', editor_id: 'edit', designer_id: 'design'/.test(builder))
const title = src('client/src/components/builder/StepTitle.jsx')
ok('the name box is focused and Enter moves on', /ref\.current\?\.focus\(\)/.test(title) && /e\.key === 'Enter'/.test(title))
const type = src('client/src/components/builder/StepType.jsx')
ok('a kind is one press, and reels come first', /onClick=\{\(\) => onPick\(k\.key\)\}/.test(type) && /KINDS = \[\s*\{ key: 'reel'/.test(type))
// Each kind of channel and work has its own face in the form, read off what
// the team actually gives (the live board's last 120 days).
ok('the channel\'s usual kinds are the big tiles; the rest one small row under them',
  /social: \['reel', 'post', 'story'\]/.test(type) && /ads: \['reel', 'target', 'post'\]/.test(type) && /text: \['post'\]/.test(type)
    && /tx\('Something else'\)/.test(type))
// …when the page's channel may be used: a design given on a written channel
// asks where it goes instead (the check of the review, 14 Oct 2026).
ok('a Telegram channel opened from its page asks no kind — it is a post',
  /const givenOk = !!defaults\.channels\?\.\[0\] && canUse\(defaults\.channels\[0\]\)/.test(builder)
    && /const skipKind = \(format === 'text' \|\| !!defaults\.design\) && givenOk/.test(builder)
    && /if \(byKey\[ch\]\?\.format === 'text'\) return 'post'/.test(builder))
ok('the header says what is being given, in that kind\'s colour, and so does the progress',
  /className="tb-head"/.test(builder) && /'--tb-accent': ACCENT\[d\.type\]/.test(builder)
    && /\.tb-dot\.on \.tb-dot-bar \{ background: var\(--tb-accent/.test(src('client/src/styles.css')))
ok('the main button names the step it goes to', /tx\('Next: \{step\}', \{ step: tx\(steps\[at \+ 1\]\.label\) \}\)/.test(builder))
ok('the last step asks what this kind of work needs', /What should they film\?/.test(builder) && /What should it look like\?/.test(builder)
  && /What goes in the post\?/.test(builder))
ok('the usual distances out are one press on the release step', /QUICK = \{ text: \[0, 1, 2\]/.test(builder)
  && /tb-quick/.test(src('client/src/components/builder/StepWhen.jsx')))
const when = src('client/src/components/builder/StepWhen.jsx')
ok('the day is pressed on a card of weeks, not typed into the browser\'s own picker',
  /<MiniCalendar /.test(when) && !/type="date"/.test(when))

const css = src('client/src/styles.css')
ok('the builder keeps one height from step to step', /\.modal-body\.tb-body \{ height:/.test(css))
ok('…and slides only for people who have not asked for less motion', /prefers-reduced-motion: reduce\) \{ \.tb-stage \{ animation: none/.test(css))
ok('the card\'s moves wait for the pointer on a desk and are simply there on touch',
  /@media \(hover: hover\) \{\s*\.tcard-acts/.test(css) && /@media \(hover: none\) \{\s*\.tcard-acts/.test(css))

const board = src('client/src/components/ContentBoard.jsx')
ok('a card shows its people as faces, once each', /tcard-people/.test(board) && /<Avatar/.test(board) && !/Operator — films it/.test(board))
ok('…and moves on with one press, through the same door a drop uses', /onMove\(item, nextOf\(item\)\.id\)/.test(board))
// 13 Oct 2026: the history is the task window's record (TaskMore) now.
const more = src('client/src/components/TaskMore.jsx')
ok('the history log is folded to one line until asked for', !/activity\.slice\(0, 3\)/.test(more) && /Show the \{n\} changes/.test(more))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

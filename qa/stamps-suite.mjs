// A handover clock is written by the handover — and by nothing else.
//
// Arriving in Editing stamps shot_at: the footage reached the editor. Arriving
// at review stamps edited_at: the cut reached review. The rule that wrote them
// only asked whether a move ENDED past the gate, never whether it CROSSED it.
// So a card already in Editing without a shoot stamp — created straight there,
// or caught up across several stages in one drag — had its shoot stamped by
// the NEXT move: the editor handing the cut on, the planner publishing. The
// operator was then "late" by however long the edit took. On the live board
// that was one operator carrying 284 late-days for shoots done on the day.
//
//   A. which stamps were invented — the pure test the one-time repair uses
//   B. the board no longer invents them, and still stamps a real crossing
//
// B runs against the shared 4090 stack.
import { pathToFileURL } from 'node:url'

const ROOT = process.env.DASHB_ROOT
  ? pathToFileURL(process.env.DASHB_ROOT.replace(/[\\/]?$/, '/'))
  : new URL('../', import.meta.url)
const { backfilledStamps } = await import(new URL('server/deadlines.js', ROOT).href)

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

// ===================== A. which stamps were invented =====================
const STAGES = [
  { id: 1, label: 'Idea', sort: 0, is_final: 0 }, { id: 2, label: 'To shoot', sort: 1, is_final: 0 },
  { id: 4, label: 'Editing', sort: 2, is_final: 0 }, { id: 5, label: 'Ready', sort: 3, is_final: 0 },
  { id: 6, label: 'Published', sort: 4, is_final: 1 }, { id: 7, label: 'Deleted', sort: 5, is_final: 0 },
]
const T = (s) => `2026-08-${s}T10:00:00.000Z`
const plus = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString()
const rows = [
  { id: 1, shot_at: T(10) },                          // To shoot → Editing: a real crossing
  { id: 2, shot_at: T(11) },                          // Editing → Ready: invented
  { id: 3, shot_at: T(12), edited_at: T(12) },        // Ready → Published: both invented
  { id: 4, edited_at: T(13) },                        // Editing → Ready: a real crossing
  { id: 5, shot_at: T(14) },                          // from the folded «Shot»: cannot be placed, left alone
  { id: 6, shot_at: T(15) },                          // restored from Deleted: left alone
  { id: 7, shot_at: T(16) },                          // nothing logged near it: left alone
  { id: 8, shot_at: T(17) },                          // two moves near: the closer one decides
  { id: 9, shot_at: T(18) },                          // stage renamed in case only: still recognised
]
const moves = [
  { content_id: 1, created_at: plus(T(10), 3), old_value: 'To shoot' },
  { content_id: 2, created_at: plus(T(11), 4), old_value: 'Editing' },
  { content_id: 3, created_at: plus(T(12), 2), old_value: 'Ready' },
  { content_id: 4, created_at: plus(T(13), 5), old_value: 'Editing' },
  { content_id: 5, created_at: plus(T(14), 3), old_value: 'Shot' },
  { content_id: 6, created_at: plus(T(15), 3), old_value: 'Deleted' },
  { content_id: 7, created_at: plus(T(16), 60_000), old_value: 'Editing' },
  { content_id: 8, created_at: plus(T(17), 1500), old_value: 'To shoot' },
  { content_id: 8, created_at: plus(T(17), 200), old_value: 'Ready' },
  { content_id: 9, created_at: plus(T(18), 3), old_value: 'EDITING' },
]
const found = backfilledStamps(rows, moves, STAGES)
const has = (id, field) => found.some((f) => f.id === id && f.field === field)
ok('a shoot stamped by a move INTO Editing is real', !has(1, 'shot_at'))
ok('a shoot stamped by a move that started in Editing was invented', has(2, 'shot_at'))
ok('publishing from Ready invented both clocks it wrote', has(3, 'shot_at') && has(3, 'edited_at'))
ok('a cut stamped by a move from Editing into Ready is real', !has(4, 'edited_at'))
ok('a stage no longer on the board cannot be placed, so it is left alone', !has(5, 'shot_at'))
ok('…and neither is a card restored from Deleted', !has(6, 'shot_at'))
ok('a stamp with no move logged beside it is left alone', !has(7, 'shot_at'))
ok('when two moves sit near one stamp, the one written with it decides', has(8, 'shot_at'))
ok('a stage label is matched whatever its case', has(9, 'shot_at'))
ok('…and nothing else is named', found.length === 5, JSON.stringify(found.map((f) => `${f.id}:${f.field}`)))
ok('every repair carries the value it would clear, so it can be put back',
  found.every((f) => f.was && f.was === rows.find((r) => r.id === f.id)[f.field]))

// ===================== B. the board no longer invents them =====================
const BASE = process.env.BASE || 'http://localhost:4090'
const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const TOK = await login('admin', 'admin123')
const req = async (p, m = 'GET', b) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOK}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(Date.now() + off * 86400000))
const ch = (await req('/channels')).data[0].key
const st = (await req('/statuses')).data
const sid = (re) => st.find((s) => re.test(s.label)).id
const stamp = Date.now().toString(36)
const read = async (id) => (await req(`/content/${id}`)).data
const phase = (t, key) => (t.phases || []).find((p) => p.phase === key)
const made = []
const mk = async (over) => { const r = await req('/content', 'POST', { channels: [ch], type: 'reel', ...over }); made.push(r.data.id); return r }

// Born straight into Editing, five days after its shoot day: a board being
// caught up on footage that already exists.
const caught = await mk({ title: `Stamps caught up ${stamp}`, status_id: sid(/^editing$/i), recording_date: day(-5), edit_ready_date: day(2), release_date: day(6) })
ok('a card can be created straight into Editing', caught.status === 201, JSON.stringify(caught.data).slice(0, 100))
let t = await read(caught.data.id)
ok('…with no shoot stamp, because nobody handed anything over', !t.shot_at, String(t.shot_at))

const toReady = await req(`/content/${caught.data.id}`, 'PATCH', { status_id: sid(/^ready$/i) })
ok('the editor hands the cut on', toReady.status === 200, JSON.stringify(toReady.data).slice(0, 100))
t = await read(caught.data.id)
ok('the SHOOT is not stamped by the editor\'s move — this was the bug', !t.shot_at, String(t.shot_at))
ok('…so the operator is not charged with the edit\'s days', phase(t, 'shoot')?.state === 'ok',
  `${phase(t, 'shoot')?.state} — the old stamp read late by ${5} days`)
ok('the CUT is stamped, because this move really did cross into review', !!t.edited_at, String(t.edited_at))
const editedAt = t.edited_at

const out = await req(`/content/${caught.data.id}`, 'PATCH', { status_id: st.find((s) => s.is_final).id, post_link: `https://instagram.com/p/stamps-a-${stamp}` })
ok('it can be published', out.status === 200, JSON.stringify(out.data).slice(0, 100))
t = await read(caught.data.id)
ok('publishing does not invent a shoot either', !t.shot_at, String(t.shot_at))
ok('…and does not rewrite the cut\'s real moment', t.edited_at === editedAt, `${t.edited_at} vs ${editedAt}`)

// Born at review, then published: the edit clock must not be dated "published".
const atReady = await mk({ title: `Stamps born ready ${stamp}`, status_id: sid(/^ready$/i), recording_date: day(-6), edit_ready_date: day(-4), release_date: day(1) })
await req(`/content/${atReady.data.id}`, 'PATCH', { status_id: st.find((s) => s.is_final).id, post_link: `https://instagram.com/p/stamps-b-${stamp}` })
t = await read(atReady.data.id)
ok('a card born at review and published gets no invented cut stamp', !t.edited_at, String(t.edited_at))
ok('…nor an invented shoot', !t.shot_at, String(t.shot_at))
ok('…and its editor is not charged for a cut dated the day it went out', phase(t, 'edit')?.state !== 'late', phase(t, 'edit')?.state)

// And a real handover is still recorded, at the moment it happens.
const real = await mk({ title: `Stamps real ${stamp}`, status_id: sid(/^to shoot$/i), recording_date: day(0), edit_ready_date: day(3), release_date: day(6) })
const before = Date.now()
await req(`/content/${real.data.id}`, 'PATCH', { status_id: sid(/^editing$/i) })
t = await read(real.data.id)
ok('a move from To shoot into Editing still stamps the shoot', !!t.shot_at, String(t.shot_at))
ok('…at the moment of the move', t.shot_at && Math.abs(Date.parse(t.shot_at) - before) < 60_000, String(t.shot_at))

for (const id of made) await req(`/content/${id}`, 'DELETE')

console.log(fails === 0 ? '\n✔ stamps suite passed' : `\n✘ stamps suite: ${fails} failed`)
process.exit(fails ? 1 : 0)

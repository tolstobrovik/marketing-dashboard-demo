// "You are late" has to mean the same thing everywhere a person is told it.
//
// A late handover re-promises the next deadline — round 58 made that write
// itself — and from then on the re-promise IS the deadline. deadlines.js has
// always read it so. Two corners of the server did not:
//
//   THE STRIP on a person's own page (`/content/late/mine`) and the AUTO-FLAG
//   that puts a hand up after three silent days both read the original day
//   alone. So an editor handed work late and given a new day was told "you are
//   late" on their own page while the warnings, the missed list and the pay run
//   had them on time — and three days on, the board would have raised a flag
//   on the planners' queue about a piece that was exactly where it had been
//   agreed to be.
//
//   THE ASK. That strip's "new date" button files a request against the cut's
//   day, and approving it wrote the ORIGINAL — underneath a re-promise that
//   overrides it. The editor asked, the admin said yes, and the day on the
//   editor's desk did not move.
//
// The release day is pinned as untouched on purpose: it is also the day the
// piece goes out, on every calendar, so a request to move it moves THAT.
//
// Runs against the shared 4090 stack.
const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
// Tashkent days, the way the server counts them.
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))

const ch = (await req('/channels')).data[0].key
const idea = (await req('/statuses')).data.find((s) => /^idea$/i.test(s.label)).id
const stamp = Date.now().toString(36)
const editor = (await req('/users', 'POST', {
  name: 'LS Editor', username: `ls_ed_${stamp}`, password: 'probe123', role: 'editor', departments: [ch],
})).data
const E = await login(`ls_ed_${stamp}`, 'probe123')
const lateFor = async () => (await req('/content/late/mine', 'GET', null, E)).data
const read = async (id) => (await req(`/content/${id}`)).data

// Handed over two days after the cut was due; a new day agreed, three out.
const task = (await req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: idea, title: `LS handed late ${stamp}`,
  editor_id: editor.id, edit_ready_date: day(-2), release_date: day(9),
})).data
const mine = (list) => list.find((r) => r.content_id === task.id && r.phase === 'edit')

// ===================== the strip =====================
ok('before any re-promise, a cut two days past its day is late on the editor\'s own page',
  !!mine(await lateFor()), JSON.stringify(mine(await lateFor()) || null))

await req(`/content/${task.id}`, 'PATCH', { edit_due_revised: day(3) })
ok('once a new day is agreed, the editor\'s own page stops calling it late',
  !mine(await lateFor()), JSON.stringify(mine(await lateFor()) || null))

await req(`/content/${task.id}`, 'PATCH', { edit_due_revised: day(-1) })
const againLate = mine(await lateFor())
ok('a re-promise that is itself missed is late again', !!againLate, JSON.stringify(againLate || null))
ok('…against the day that was AGREED, not the one before it',
  againLate?.due === day(-1), `${againLate?.due} — agreed ${day(-1)}, original ${day(-2)}`)
ok('…and counted from it', againLate?.days_late === 1, String(againLate?.days_late))

// ===================== the ask =====================
await req(`/content/${task.id}`, 'PATCH', { edit_due_revised: day(4) })
const asked = await req(`/content/${task.id}/date-requests`, 'POST', {
  field: 'edit_ready_date', to_date: day(6), reason: 'The footage arrived two days late so the cut needs two more days',
})
ok('a request can still be filed against the cut\'s day', asked.status === 201, JSON.stringify(asked.data).slice(0, 120))
ok('…and it is measured from the day that is live, not the original',
  asked.data.from_date === day(4), `from ${asked.data.from_date} — live ${day(4)}, original ${day(-2)}`)
ok('…while still filed under the name people know it by', asked.data.field === 'edit_ready_date', asked.data.field)

const yes = await req(`/content/date-requests/${asked.data.id}/decide`, 'POST', { approve: true })
ok('an admin can approve it', yes.status === 200, JSON.stringify(yes.data).slice(0, 120))
let t = await read(task.id)
ok('approving moves the LIVE day — the one on the editor\'s desk', t.edit_due_revised === day(6),
  `revised ${t.edit_due_revised}, wanted ${day(6)}`)
ok('…and leaves the original where it was, so the pair still shows what the delay cost',
  t.edit_ready_date === day(-2), `original ${t.edit_ready_date}`)

// A request that waited while the re-promise moved under it is answering a
// question nobody is asking any more.
const waiting = await req(`/content/${task.id}/date-requests`, 'POST', {
  field: 'edit_ready_date', to_date: day(8), reason: 'Two more interviews to cut in before this is finished',
})
await req(`/content/${task.id}`, 'PATCH', { edit_due_revised: day(7) })
const stale = await req(`/content/date-requests/${waiting.data.id}/decide`, 'POST', { approve: true })
ok('a request overtaken by a new re-promise comes back stale instead of overwriting it',
  stale.status === 409, `${stale.status} ${JSON.stringify(stale.data)}`)
ok('…and the day agreed in between is left standing', (await read(task.id)).edit_due_revised === day(7))

// Without any re-promise the ask works exactly as it always did.
const plain = (await req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: idea, title: `LS plain ${stamp}`, editor_id: editor.id, edit_ready_date: day(2),
})).data
const plainAsk = await req(`/content/${plain.id}/date-requests`, 'POST', {
  field: 'edit_ready_date', to_date: day(5), reason: 'The music licence has not come through yet, need three days',
})
await req(`/content/date-requests/${plainAsk.data.id}/decide`, 'POST', { approve: true })
const p = await read(plain.id)
ok('with no re-promise, approving moves the cut\'s day itself', p.edit_ready_date === day(5) && !p.edit_due_revised,
  `edit_ready_date ${p.edit_ready_date}, revised ${p.edit_due_revised}`)

// The release day is also the day it goes OUT. A request to move it moves it.
const rel = (await req('/content', 'POST', {
  channels: [ch], type: 'reel', status_id: idea, title: `LS release ${stamp}`, release_date: day(5),
})).data
await req(`/content/${rel.id}`, 'PATCH', { review_due_revised: day(7) })
const relAsk = await req(`/content/${rel.id}/date-requests`, 'POST', {
  field: 'release_date', to_date: day(10), reason: 'The campaign it belongs to has been pushed back a week',
})
await req(`/content/date-requests/${relAsk.data.id}/decide`, 'POST', { approve: true })
const r = await read(rel.id)
ok('a request to move the release day moves the release day, re-promise or not',
  r.release_date === day(10) && r.review_due_revised === day(7),
  `release ${r.release_date}, review re-promise ${r.review_due_revised}`)

for (const id of [task.id, plain.id, rel.id]) await req(`/content/${id}`, 'DELETE')
await req(`/users/${editor.id}`, 'DELETE')

console.log(fails === 0 ? '\n✔ latesync suite passed' : `\n✘ latesync suite: ${fails} failed`)
process.exit(fails ? 1 : 0)

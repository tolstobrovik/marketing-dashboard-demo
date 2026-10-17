// The design board, the reference album, and the contract the publish window
// leans on.
//
// THE PUBLISH REFUSAL CARRIES `needs`. Landing on the final stage without the
// published link is refused — that rule is old and deliberate, and nothing
// here argues with it. What was missing was a way out of the refusal: the
// handover window had no step for a link that is not a handover, so it fell
// through to its fatal branch and drew a dead end with the sentence "paste the
// link" on it and nowhere to paste one. StageGate now opens a box on exactly
// that refusal, which it recognises by `needs: 'post_link'` — so the field is
// pinned here, on BOTH refusals. A rejected link must keep it too, or the
// window closes on the person the moment they mistype.
//
// THE REFERENCE ALBUM. One box for one screenshot was the shape of the brief
// nobody writes: the layout, the thing it must NOT look like and the logo
// lockup are three answers, and a designer given the first guesses the rest.
// The task carries up to eight, and the single photo/photo_thumb pair stays
// element 0 of them — a dozen places ask "is there a reference at all" and not
// one of them should have to learn what an array is. Both directions are
// pinned: an album sets the pair, and a lone photo from an older client
// becomes an album of one.
//
// THE DESIGN BOARD has columns of its own. Not the content pipeline's — a
// designer's piece used to sit in a column called Editing between two videos
// they had nothing to do with — and no walls: moving artwork to «Sent back»
// is somebody describing their own work, not a handover anybody answers for.
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

// A one-pixel PNG. The point is the plumbing, not the picture.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pics = (n) => Array.from({ length: n }, () => ({ photo: PNG, thumb: PNG }))

const ch = (await req('/channels')).data[0].key
const stages = (await req('/statuses')).data
const firstStage = stages[0].id
const finalStage = stages.find((s) => s.is_final)?.id
const mk = (over = {}) => req('/content', 'POST', {
  channels: [ch], type: 'post', status_id: firstStage, title: 'Design suite probe', ...over,
})

// ===================== the publish refusal =====================
const pub = (await mk()).data
const noLink = await req(`/content/${pub.id}`, 'PATCH', { status_id: finalStage })
ok('publishing without the link is still refused', noLink.status === 400, String(noLink.status))
ok('…and the refusal names the field, so the window can ask for it',
  noLink.data.needs === 'post_link', JSON.stringify(noLink.data))

// Words are not an address, and this is the refusal a typo actually lands on.
const words = await req(`/content/${pub.id}`, 'PATCH', { status_id: finalStage, post_link: 'posted it this morning' })
ok('something that points nowhere is refused too', words.status === 400, String(words.status))
ok('…and it ALSO names the field — a typo must not close the box',
  words.data.needs === 'post_link', JSON.stringify(words.data))

// A bare domain IS a link here, deliberately: server/text.js takes one because
// that is how half of them arrive. Pinned because the window leans on it — the
// box must not be stricter than the thing it is asking on behalf of.
const bare = await req(`/content/${pub.id}`, 'PATCH', { status_id: finalStage, post_link: 'instagram.com/p/xyz' })
ok('a bare domain is taken, scheme or no scheme', bare.status === 200, String(bare.status))
await req(`/content/${pub.id}`, 'DELETE')

const pub2 = (await mk()).data
const good = await req(`/content/${pub2.id}`, 'PATCH', { status_id: finalStage, post_link: 'https://instagram.com/p/xyz' })
ok('and a full URL, of course', good.status === 200, JSON.stringify(good.data).slice(0, 90))
await req(`/content/${pub2.id}`, 'DELETE')

// ===================== the reference album =====================
const born = await mk({ reference_photos: pics(3) })
ok('a task can be born with three reference photos', born.status === 201, String(born.status))
const id = born.data.id
const readBack = async () => (await req(`/content/${id}`)).data

let t = await readBack()
ok('…all three come back', (t.reference_photos || []).length === 3, String((t.reference_photos || []).length))
ok('…and the single photo is the first of them', !!t.photo, t.photo ? 'set' : 'null')

await req(`/content/${id}`, 'PATCH', { reference_photos: pics(5) })
t = await readBack()
ok('the album can be added to', (t.reference_photos || []).length === 5, String((t.reference_photos || []).length))

await req(`/content/${id}`, 'PATCH', { reference_photos: pics(20) })
t = await readBack()
ok('…and stops at eight, whatever is sent', (t.reference_photos || []).length === 8, String((t.reference_photos || []).length))

await req(`/content/${id}`, 'PATCH', { reference_photos: [] })
t = await readBack()
ok('emptying the album empties the single photo with it',
  (t.reference_photos || []).length === 0 && !t.photo,
  `${(t.reference_photos || []).length} photos, photo=${t.photo ? 'set' : 'null'}`)

// The other direction: the Pravki screenshot path and any older client still
// send one photo, and the album must not be left behind disagreeing with it.
await req(`/content/${id}`, 'PATCH', { photo: PNG, photo_thumb: PNG })
t = await readBack()
ok('one photo from an older client becomes an album of one',
  (t.reference_photos || []).length === 1 && !!t.photo, String((t.reference_photos || []).length))

await req(`/content/${id}`, 'PATCH', { reference_photos: [{ photo: 'https://example.com/nope.png' }] })
t = await readBack()
ok('anything that is not a data URL is dropped, not stored',
  (t.reference_photos || []).length === 0, JSON.stringify(t.reference_photos).slice(0, 80))

// The bytes never ride on the list — that was true of the single photo and has
// to stay true of eight of them, or every poll carries megabytes.
await req(`/content/${id}`, 'PATCH', { reference_photos: pics(4) })
const listRow = (await req('/content')).data.find((x) => x.id === id)
ok('the album does not ride on the list rows', !(listRow.reference_photos || []).length,
  JSON.stringify((listRow.reference_photos || []).length))
ok('…but the list still says there IS a picture', !!listRow.has_photo, String(listRow.has_photo))

// ===================== the design board =====================
const dstages = (await req('/design-statuses')).data
ok('the design board has columns of its own', dstages.length >= 2, String(dstages.length))
ok('…and they are not the content pipeline’s',
  !dstages.some((d) => stages.some((s) => s.label === d.label)),
  JSON.stringify(dstages.map((d) => d.label)))

const onto = await req(`/content/${id}`, 'PATCH', { design_status_id: dstages[1].id })
ok('artwork can be moved to a design column', onto.status === 200, String(onto.status))
t = await readBack()
ok('…and stays there', t.design_status_id === dstages[1].id, String(t.design_status_id))
ok('…and the column travels on the list, which is what the board reads',
  (await req('/content')).data.find((x) => x.id === id)?.design_status_id === dstages[1].id)

ok('a column that does not exist is refused',
  (await req(`/content/${id}`, 'PATCH', { design_status_id: 999999 })).status === 400)
await req(`/content/${id}`, 'PATCH', { design_status_id: null })
t = await readBack()
ok('a card can be taken off the board again', t.design_status_id == null, String(t.design_status_id))

// Columns are the admin's to shape, like the content stages.
const added = await req('/design-statuses', 'POST', { label: 'Suite column', color: '#123456' })
ok('a column can be added', added.status === 201, String(added.status))
ok('…renamed', (await req(`/design-statuses/${added.data.id}`, 'PATCH', { label: 'Suite renamed' })).data.label === 'Suite renamed')

// Deleting a column must never delete the work standing in it.
await req(`/content/${id}`, 'PATCH', { design_status_id: added.data.id })
ok('…and deleted', (await req(`/design-statuses/${added.data.id}`, 'DELETE')).status === 200)
t = await readBack()
ok('the artwork standing on a deleted column moves, it does not vanish',
  t.design_status_id != null && t.design_status_id !== added.data.id, String(t.design_status_id))

// The board is not a wall: nothing about a design move is gated, which is the
// whole difference from the content pipeline. A member on the channel moves
// their own work without anybody's permission.
const member = (await req('/users', 'POST', {
  name: 'DS Designer', username: 'ds_designer', password: 'probe123', role: 'designer', departments: [ch],
})).data
const mT = await login('ds_designer', 'probe123')
await req(`/content/${id}`, 'PATCH', { designer_id: member.id })
const byThem = await req(`/content/${id}`, 'PATCH', { design_status_id: dstages[1].id }, mT)
ok('the designer moves their own artwork without a gate', byThem.status === 200, JSON.stringify(byThem.data).slice(0, 90))

await req(`/content/${id}`, 'DELETE')
await req(`/users/${member.id}`, 'DELETE')

console.log(fails === 0 ? '\n✔ design suite passed' : `\n✘ design suite: ${fails} failed`)
process.exit(fails ? 1 : 0)

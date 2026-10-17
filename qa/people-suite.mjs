// The people board: the monthly record of how each person's work is going.
//   node qa/people-suite.mjs              (expects a server on :4090)
//
// Most of this suite is about who is REFUSED. The board holds notes written
// about people, by their manager, that the subject is not meant to read —
// so "an admin cannot open it" and "the person it is about cannot open it"
// are the two assertions the whole feature rests on.
const BASE = process.env.BASE || 'http://localhost:4090'
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

const sfx = Date.now().toString(36).slice(-5)
const mk = async (u, name, role = 'member') => (await req('/users', 'POST', {
  name, username: u + sfx, password: 'pw123456', role, departments: role === 'member' ? ['instagram_main'] : [],
})).data
const boss = await mk('boss', 'Bek Boss', 'admin')
const other = await mk('oth', 'Olim Other', 'admin')
const worker = await mk('wrk', 'Ravshan Worker')
const bossT = await login(boss.username, 'pw123456')
const otherT = await login(other.username, 'pw123456')
const workerT = await login(worker.username, 'pw123456')

console.log('\n— nobody gets in until they are given the rank —')
let r = await req('/people/board', 'GET', null, bossT)
ok('a fresh admin is refused', r.status === 403, `got ${r.status}`)
r = await req('/people/board', 'GET', null, workerT)
ok('a member is refused', r.status === 403, `got ${r.status}`)
r = await req('/people/superadmins', 'GET', null, bossT)
ok('even the list of who holds it is shut', r.status === 403, `got ${r.status}`)
r = await req(`/people/superadmins/${boss.id}`, 'PUT', { superadmin: true }, bossT)
ok('an admin cannot grant it to themselves', r.status === 403, `got ${r.status}`)

console.log('\n— the way in on a fresh database —')
// Nobody holds the rank here: the migration names one real username and this
// is not that database. The only way in is the script an operator would use
// on the server, which is the point — there is no back door through the API.
const { execFileSync } = await import('node:child_process')
try {
  execFileSync('node', ['scripts/grant-superadmin.js', 'admin'], { stdio: 'pipe' })
} catch (e) {
  console.log(`  (could not grant: ${String(e.stderr || e.message).trim().split('\n')[0]})`)
}
r = await req('/people/superadmins')
ok('the script let the first holder in', r.status === 200, `got ${r.status} — is DATA_DIR pointing at the running server's database?`)
if (r.status !== 200) {
  console.log(fails ? `\n${fails} FAILED` : '\nall good')
  process.exit(fails ? 1 : 0)
}

const S = T
console.log('\n— writing —')
r = await req('/people/notes', 'POST', { about_id: worker.id, month: '2026-09', body: 'Could not finish the September plan; given a week.' }, S)
ok('a note saves', r.status === 201, `${r.status} ${JSON.stringify(r.data)}`)
const note = r.data
r = await req('/people/notes', 'POST', { about_id: worker.id, month: 'September', body: 'x' }, S)
ok('a month has to be a month', r.status === 400, `got ${r.status}`)
r = await req('/people/notes', 'POST', { about_id: worker.id, month: '2026-09', body: '   ' }, S)
ok('an empty note is refused', r.status === 400, `got ${r.status}`)
r = await req('/people/notes', 'POST', { about_id: 999999, month: '2026-09', body: 'x' }, S)
ok('an unknown person is refused', r.status === 404, `got ${r.status}`)

console.log('\n— reading —')
r = await req(`/people/notes?about=${worker.id}&month=2026-09`, 'GET', null, S)
ok('the note comes back', r.data?.length === 1, JSON.stringify(r.data))
ok('with its author named', !!r.data?.[0]?.author_name, JSON.stringify(r.data?.[0]))
r = await req(`/people/notes?about=${worker.id}`, 'GET', null, workerT)
ok('the person it is about still cannot read it', r.status === 403, `got ${r.status}`)
r = await req('/people/board?month=2026-09', 'GET', null, S)
const onBoard = (r.data?.people || []).find((p) => p.id === worker.id)
ok('the board counts it', onBoard?.this_month === 1, JSON.stringify(onBoard))
ok('the board says when anybody last wrote', onBoard?.last_month === '2026-09', JSON.stringify(onBoard))
ok('ambassadors are not on this board', !(r.data?.people || []).some((p) => p.role === 'ambassador'))

console.log('\n— editing keeps the old words —')
r = await req(`/people/notes/${note.id}`, 'PATCH', { body: 'Could not finish the September plan; given two weeks.' }, S)
ok('the author may edit', r.status === 200, `${r.status} ${JSON.stringify(r.data)}`)
ok('it is marked as edited', r.data?.edited === true, JSON.stringify(r.data))
r = await req(`/people/notes/${note.id}/history`, 'GET', null, S)
ok('the previous version is kept', r.data?.was?.length === 1, JSON.stringify(r.data))
ok('and says what it used to say', /given a week/.test(r.data?.was?.[0]?.body || ''), JSON.stringify(r.data?.was))
ok('alongside what it says now', /two weeks/.test(r.data?.now?.body || ''), JSON.stringify(r.data?.now))

console.log('\n— somebody else\'s note is not yours to change —')
// Give a second superadmin the rank so there is a real second reader.
r = await req(`/people/superadmins/${other.id}`, 'PUT', { superadmin: true }, S)
ok('a superadmin may hand the rank on', r.status === 200, `${r.status} ${JSON.stringify(r.data)}`)
const other2 = await login(other.username, 'pw123456')
r = await req(`/people/notes/${note.id}`, 'PATCH', { body: 'rewritten by someone else' }, other2)
ok('another superadmin cannot edit it', r.status === 403, `got ${r.status}`)
r = await req(`/people/notes/${note.id}`, 'DELETE', null, other2)
ok('nor delete it', r.status === 403, `got ${r.status}`)
r = await req(`/people/notes?about=${worker.id}`, 'GET', null, other2)
ok('but may read it', r.status === 200 && r.data?.length >= 1, `got ${r.status}`)

console.log('\n— the last way in cannot be closed —')
// Only ever takes the rank off accounts this suite is responsible for: its
// own, and the seeded 'admin' it let in above. Run against a database with
// real holders on it, this checks nothing rather than locking anybody out.
const mine = new Set(['admin', boss.username, other.username, worker.username])
let holders = (await req('/people/superadmins', 'GET', null, other2)).data || []
const strangers = holders.filter((h) => !mine.has(h.username))
if (strangers.length) {
  console.log(`  (this database has holders the suite did not create: ${strangers.map((h) => h.username).join(', ')} — leaving them alone and skipping the last-holder rule)`)
} else {
  for (const h of holders) {
    if (h.id === other.id) continue
    await req(`/people/superadmins/${h.id}`, 'PUT', { superadmin: false }, other2)
  }
  holders = (await req('/people/superadmins', 'GET', null, other2)).data || []
  ok('one holder is left', holders.length === 1, JSON.stringify(holders.map((x) => x.username)))
  r = await req(`/people/superadmins/${other.id}`, 'PUT', { superadmin: false }, other2)
  ok('the last one may not step down', r.status === 400, `got ${r.status} ${JSON.stringify(r.data)}`)
  r = await req('/people/board', 'GET', null, other2)
  ok('and the board is still open to them', r.status === 200, `got ${r.status}`)
}

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

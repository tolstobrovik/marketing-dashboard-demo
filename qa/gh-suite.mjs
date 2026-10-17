// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// GitHub-storage test suite against the mock GitHub API. Verifies the
// optimized driver end-to-end: cold-start call count, ETag 304 polling,
// no-op flush skipping, two-instance conflict healing, and squash.
import { spawn } from 'child_process'
import { rmSync, readFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const MOCK = 'http://localhost:9977'
const REPO = process.env.REPO_DIR || ROOT
// The server, started the way pm2 starts it.
const SERVER = REPO + '/server/index.js'

// The scratch DATA_DIRs these instances stand on. os.tmpdir() rather than the
// literal "/tmp", which on Windows is a path on whichever drive happens to be
// current — and the `rm -rf` that used to clear them went through cmd.exe,
// which has never heard of `rm`. It threw on the first line, so the suite
// never got as far as booting anything. On Linux os.tmpdir() is /tmp unless
// TMPDIR says otherwise, so CI keeps the directories it always had.
const TMP = (name) => join(tmpdir(), name)
const wipe = (...names) => { for (const n of names) rmSync(TMP(n), { recursive: true, force: true }) }
let fails = 0
const ok = (name, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? '✔' : '✘ FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const calls = async () => (await fetch(`${MOCK}/__calls`)).json()
const resetCalls = () => fetch(`${MOCK}/__reset`, { method: 'POST' })
const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0)

// Start an app "instance" (a fresh server process)
// on a port, with its own DATA_DIR (its own /tmp).
const instances = []
async function startInstance(port, dir) {
  const child = spawn('node', [SERVER], {
    env: {
      ...process.env,
      GITHUB_API_BASE: MOCK,
      GITHUB_DATA_FORCE: '1',
      DATA_DIR: dir, PORT: String(port),
      PATH: process.env.PATH,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  instances.push(child)
  // "instance exited 1" is what this said when somebody else's server was on
  // the port, which sent a whole gate run looking for a bug in the storage
  // layer. The regression gate's boot_api had refused to run against a stranger's
  // server for two rounds now, for exactly this reason; this block spawns its
  // own instance and never learned. A port already answering is named as that
  // before anything is started, and a death is reported with what the process
  // actually said.
  try {
    const held = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (held.ok) throw new Error(`PORT ${port} IS ALREADY HELD — something else is answering there, so this suite would have tested somebody else's server`)
  } catch (e) {
    if (String(e.message).startsWith('PORT ')) throw e   // ours; anything else means the port is free
  }
  let said = ''
  child.stdout.on('data', (d) => { said += d.toString() })
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (d.toString().includes('API listening')) resolve() })
    child.on('exit', (c) => reject(new Error(
      `instance exited ${c}${said.trim() ? ` — it said: ${said.trim().slice(-300)}` : ' with nothing on stdout'}`)))
    setTimeout(() => reject(new Error('instance start timeout')), 15000)
  })
  return {
    req: async (path, { method = 'GET', body, token } = {}) => {
      const res = await fetch(`http://localhost:${port}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      let data = {}
      try { data = await res.json() } catch { /* empty */ }
      return { status: res.status, data }
    },
  }
}

wipe('ghtest-a', 'ghtest-b', 'ghtest-c')

// === 0. A database that has lost itself is never uploaded ===
// 9 October 2026: two copies of the app restarted together on one data
// directory; one read the file half-written, seeded a fresh database and
// uploaded it over the team's. These hold the three things that now stand in
// the way, and the deploy that starts one copy.
{
  const { pagesOf, lostItself } = await import(pathToFileURL(REPO + '/server/ghstore.js').href)
  const image = (pages, length = pages * 4096) => {
    const b = Buffer.alloc(Math.max(length, 100))
    b.write('SQLite format 3\0', 0, 'latin1')
    b.writeUInt16BE(4096, 16); b.writeUInt32BE(7, 24); b.writeUInt32BE(pages, 28); b.writeUInt32BE(7, 92)
    return b
  }
  ok('a database image says how many pages it holds', pagesOf(image(3561)) === 3561)
  ok('…by its own header, not its length: the wiped one was 131 pages in a 14 MB file', pagesOf(image(131, 3561 * 4096)) === 131)
  ok('…and what is not a database holds none', pagesOf(Buffer.from('not a database')) === 0 && pagesOf(null) === 0)
  ok('3,561 pages becoming 131 is another database, not an edit', lostItself(3561, 131) === true)
  ok('…a vacuum that drops a few free pages is an edit', lostItself(3561, 3466) === false)
  ok('…and a small database may do as it likes', lostItself(131, 20) === false)
  const db = readFileSync(REPO + '/server/db.js', 'utf8').replace(/\r\n/g, '\n')
  const push = db.slice(db.indexOf('const pushOnce = async'), db.indexOf('let inFlight = null'))
  const asks = push.indexOf('lostItself(cleanPages, pagesOf(bytes))')
  ok('the upload asks that question before it sends anything', asks > 0 && asks < push.indexOf('store.push(bytes)'))
  ok('…and takes the stored copy back instead', /store\.forget\(\)\s+await sync\(true\)/.test(push))
  ok('…the squash, which rewrites the whole branch, asks it too',
    /squash: async \(\) => \{[\s\S]*?lostItself\(cleanPages, pagesOf\(bytes\)\)[\s\S]*?store\.squash\(bytes\)/.test(db))
  ok('the file is never written half-way at start: beside its name, under this process’s own, then renamed',
    db.includes('const tmp = `${file}.${process.pid}.tmp`') && /writeFileSync\(tmp, initial\.bytes\); renameSync\(tmp, file\)/.test(db))
  ok('…and what is open must be what was downloaded', /PRAGMA page_count/.test(db) && /seen !== cleanPages/.test(db))
  ok('a copy with no users is never seeded over stored data', /heldData\?\.\(\)\) throw new Error\('refusing to seed/.test(db))
  const sh = readFileSync(REPO + '/deploy.sh', 'utf8')
  ok('the deploy starts exactly one copy', sh.includes('pm2 delete marketing-dashboard') && sh.indexOf('pm2 delete marketing-dashboard') < sh.indexOf('pm2 startOrReload'))
}

// === 1. Very first boot ever: branch created, seed uploaded ===
await resetCalls()
const A = await startInstance(4091, TMP('ghtest-a'))
let r = await A.req('/health')
ok('first boot healthy', r.status === 200 && r.data.storage === 'github')
const loginA = await A.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
ok('admin login on first boot', loginA.status === 200 && !!loginA.data.token)
const TA = loginA.data.token
await new Promise((r2) => setTimeout(r2, 300)) // let the post-response flush land
let c = await calls()
ok('seed flushed to repo', (c['contents-put'] || 0) >= 1, JSON.stringify(c))

// === 2. Warm cold start: a second instance boots from existing data ===
await resetCalls()
const B = await startInstance(4092, TMP('ghtest-b'))
await B.req('/health') // forces the lazy init to complete
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('cold start costs ≤2 GitHub calls', sum(c) >= 1 && sum(c) <= 2, JSON.stringify(c))
ok('cold start needs no branch/tree calls', !c['ref-get'] && !c['tree-get'], JSON.stringify(c))
const loginB = await B.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
ok('login works on second instance', loginB.status === 200)
const TB = loginB.data.token

// === 3. Read-only traffic causes zero uploads and 304 polls ===
await resetCalls()
await new Promise((r2) => setTimeout(r2, 4200)) // let the sync TTL lapse
await B.req('/channels', { token: TB })
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('read-only request uploads nothing', !c['contents-put'], JSON.stringify(c))

// === 4. Cross-instance sync: A writes, B sees it after TTL ===
const task = await A.req('/content', { method: 'POST', token: TA, body: { title: 'Optimize everything', channels: ['youtube'], type: 'post' } })
ok('A creates task', task.status === 201 || task.status === 200, String(task.status))
await new Promise((r2) => setTimeout(r2, 4500)) // flush + B's sync TTL
const bView = await B.req('/content', { token: TB })
ok('B sees A\'s task after one sync interval', !!bView.data.find?.((t) => t.title === 'Optimize everything'))

// === 5. Two-instance write conflict heals via journal replay ===
// B is now fresh; write on B and on A back-to-back without letting the other pull.
const tB = await B.req('/content', { method: 'POST', token: TB, body: { title: 'From B', channels: ['youtube'], type: 'post' } })
await new Promise((r2) => setTimeout(r2, 300))
const tA = await A.req('/content', { method: 'POST', token: TA, body: { title: 'From A', channels: ['youtube'], type: 'post' } })
ok('both writes accepted', tB.status === 201 && tA.status === 201, `${tB.status}/${tA.status}`)
await new Promise((r2) => setTimeout(r2, 4500))
const merged = await B.req('/content', { token: TB })
const titles = (merged.data || []).map((t) => t.title)
ok('conflict merged: both tasks in one copy', titles.includes('From A') && titles.includes('From B'), titles.join(', '))

// === 6. No-op writes do not create commits (hash skip) ===
await resetCalls()
const h = await A.req('/health') // triggers ready→initSchema only on fresh boot; use a real no-op instead:
await A.req('/cron/daily') // snapshots — may write; so measure a pure GET after
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
const putsAfterCron = c['contents-put'] || 0
await resetCalls()
await A.req('/channels', { token: TA })
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('plain GET after cron flushes nothing', !c['contents-put'], JSON.stringify(c))
ok('health stayed ok', h.status === 200)

// === 7. Fresh instance after squash still boots clean ===
await A.req('/cron/daily') // includes squash
await new Promise((r2) => setTimeout(r2, 500))
await resetCalls()
const C = await startInstance(4093, TMP('ghtest-c'))
await C.req('/health')
await new Promise((r2) => setTimeout(r2, 300))
c = await calls()
ok('post-squash cold start ≤2 calls', sum(c) >= 1 && sum(c) <= 2, JSON.stringify(c))
const loginC = await C.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
ok('login works after squash on new instance', loginC.status === 200)
const cView = await C.req('/content', { token: loginC.data.token })
const cTitles = (cView.data || []).map((t) => t.title)
ok('data intact after squash', cTitles.includes('From A') && cTitles.includes('From B'), cTitles.join(', '))

// === 8. A boot beside a dead process's journal (12 Oct 2026) ===
// The process was killed mid-write and left dashboard.db-journal behind. The
// next boot downloads a fresh copy over dashboard.db; SQLite must not take the
// old journal for this file's own and roll a different database's pages into
// it ("malformed", then "no such table: main.users"). The journal here is a
// real one, taken from an open transaction on another database.
{
  const { createClient } = await import('@libsql/client')
  wipe('ghtest-d', 'ghtest-other')
  mkdirSync(TMP('ghtest-d'), { recursive: true })
  mkdirSync(TMP('ghtest-other'), { recursive: true })
  const other = join(TMP('ghtest-other'), 'other.db')
  const oc = createClient({ url: `file:${other}` })
  await oc.executeMultiple(`CREATE TABLE stuff (id INTEGER PRIMARY KEY, b BLOB);
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
    INSERT INTO stuff (b) SELECT randomblob(400) FROM n;`)
  await oc.execute('PRAGMA cache_size = 10') // small, so the transaction spills and its journal is synced
  const tx = await oc.transaction('write')
  await tx.execute('UPDATE stuff SET b = randomblob(400)')
  const journal = `${other}-journal`
  const built = existsSync(journal) && statSync(journal).size > 4096
  ok('a hot journal was built for the test', built, built ? `${statSync(journal).size} bytes` : 'no journal on disk')
  copyFileSync(join(TMP('ghtest-a'), 'dashboard.db'), join(TMP('ghtest-d'), 'dashboard.db'))
  if (built) copyFileSync(journal, join(TMP('ghtest-d'), 'dashboard.db-journal'))
  tx.close()
  oc.close()

  const D = await startInstance(4094, TMP('ghtest-d'))
  r = await D.req('/health')
  ok('boot beside a stale journal is healthy', r.status === 200, String(r.status))
  const loginD = await D.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  ok('login works after it', loginD.status === 200, String(loginD.status))
  const dView = await D.req('/content', { token: loginD.data.token })
  const dTitles = (dView.data || []).map?.((t) => t.title) || []
  ok('the downloaded data, not the journal’s', dTitles.includes('From A') && dTitles.includes('From B'), dTitles.join(', '))
}

// === 9. A damaged copy on the branch stops at the door ===
// A fresh instance with nothing of its own refuses it — and above all does not
// boot onto an empty database and upload the seed over the team's data. A
// running instance keeps its own copy and puts a whole one back.
{
  const fileNow = async () => (await fetch(`${MOCK}/__file`)).json()
  const { blobSha: damaged } = await (await fetch(`${MOCK}/__damage`, { method: 'POST' })).json()
  await resetCalls()
  wipe('ghtest-e')
  const E = await startInstance(4095, TMP('ghtest-e'))
  r = await E.req('/health')
  await new Promise((r2) => setTimeout(r2, 500))
  c = await calls()
  ok('a fresh instance uploads nothing over a damaged copy', !c['contents-put'], JSON.stringify(c))
  ok('the damaged copy is still the one on the branch', (await fileNow()).blobSha === damaged)
  const loginE = await E.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  ok('and it does not sign anybody in to a seeded database', loginE.status !== 200, String(loginE.status))

  await new Promise((r2) => setTimeout(r2, 4200)) // A's sync TTL lapses
  const aView = await A.req('/content', { token: TA })
  const aTitles = (aView.data || []).map?.((t) => t.title) || []
  ok('a running instance keeps serving its own copy', aView.status === 200 && aTitles.includes('From A'), String(aView.status))
  await new Promise((r2) => setTimeout(r2, 1500))
  const healed = await fileNow()
  ok('and puts a whole copy back on the branch', !!healed.blobSha && healed.blobSha !== damaged)

  wipe('ghtest-f')
  const F = await startInstance(4096, TMP('ghtest-f'))
  const loginF = await F.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  const fView = await F.req('/content', { token: loginF.data?.token })
  const fTitles = (fView.data || []).map?.((t) => t.title) || []
  ok('a fresh instance boots from the healed copy', loginF.status === 200 && fTitles.includes('From A'), fTitles.join(', '))
}

// === 10. Two copies starting in the same second on ONE data directory ===
// What the server did on 9 October 2026: pm2 held two copies of the app, and a
// deploy reloads both at once. Whatever each of them makes of the file they
// share, the stored database must come out of it with the team's work in it.
wipe('ghtest-twin', 'ghtest-g')
const [D1, D2] = await Promise.all([startInstance(4097, TMP('ghtest-twin')), startInstance(4098, TMP('ghtest-twin'))])
// Each is asked to sign in at once: the boot, the seed check and the first
// flush all happen here. A boot that refuses a file it cannot trust is retried.
const signIn = async (inst) => {
  for (let i = 0; i < 8; i++) {
    const res = await inst.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
    if (res.status === 200) return res.data.token
    await new Promise((r2) => setTimeout(r2, 500))
  }
  return null
}
const up = (await Promise.all([signIn(D1), signIn(D2)])).filter(Boolean).length
await new Promise((r2) => setTimeout(r2, 1500))
// How many of the two came up is not the promise: sharing one file, a copy
// may refuse to start on what it finds there (and on Windows, where the file
// cannot be renamed into place, one usually does). The promise is what a
// third, on a directory of its own, then reads back from the store.
const G = await startInstance(4099, TMP('ghtest-g'))
const loginG = await G.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
const eTitles = ((await G.req('/content', { token: loginG.data.token })).data || []).map((t) => t.title)
ok('two copies starting at once on one data directory leave the stored database with the team’s work in it',
  loginG.status === 200 && eTitles.includes('From A') && eTitles.includes('From B'), `${up} of 2 came up · ${eTitles.join(', ').slice(0, 90)}`)

console.log(fails === 0 ? '\nAll storage checks passed.' : `\n${fails} CHECKS FAILED`)
for (const i of instances) i.kill()
process.exit(fails === 0 ? 0 : 1)

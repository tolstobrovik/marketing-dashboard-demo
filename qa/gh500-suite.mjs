// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// The production "Request failed (500)" hunt, proven fixed:
//  1. a GitHub outage DURING requests must not fail them (serve local copy)
//  2. an outage AT COLD START must not poison the instance — it answers 503
//     politely and heals itself the moment GitHub is back
//  3. writes made during an outage survive: journaled, flushed once healed
import { spawn } from 'child_process'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const MOCK = 'http://localhost:9977'
const REPO = ROOT
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
const outage = (on) => fetch(`${MOCK}/__outage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) })

const instances = []
async function startInstance(port, dir) {
  const child = spawn('node', [SERVER], {
    env: { ...process.env, GITHUB_API_BASE: MOCK, GITHUB_DATA_FORCE: '1', DATA_DIR: dir, PORT: String(port), PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', () => {})
  instances.push(child)
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (d.toString().includes('API listening')) resolve() })
    child.on('exit', (c) => reject(new Error(`instance exited ${c}`)))
    setTimeout(() => reject(new Error('instance start timeout')), 15000)
  })
  return {
    kill: () => child.kill('SIGKILL'),
    req: async (path, { method = 'GET', body, token } = {}) => {
      const res = await fetch(`http://localhost:${port}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      let data = {}
      try { data = await res.json() } catch { /* html/empty */ }
      return { status: res.status, data }
    },
  }
}
const loginOf = async (inst) =>
  (await inst.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })).data.token

wipe('gh500-a', 'gh500-b', 'gh500-c')
await outage(false)

const A = await startInstance(4511, TMP('gh500-a'))
const tA = await loginOf(A)
const pre = await A.req('/content', { method: 'POST', token: tA, body: { title: 'gh500: before outage', channels: ['instagram_main'], type: 'post' } })
ok('healthy add works', pre.status === 201, `status=${pre.status}`)

await outage(true)
await new Promise((r) => setTimeout(r, 4200))
const during = await A.req('/content', { method: 'POST', token: tA, body: { title: 'gh500: during outage', channels: ['instagram_main'], type: 'post' } })
ok('add during a GitHub outage still answers 201 (local copy)', during.status === 201, `status=${during.status}`)
const list = await A.req('/content', { token: tA })
ok('reads keep working through the outage', list.status === 200 && Array.isArray(list.data), `status=${list.status}`)

const B = await startInstance(4512, TMP('gh500-b'))
const cold = await B.req('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
ok('cold boot in an outage answers 503 + message (not a bare 500)', cold.status === 503 && /unreachable|try again/i.test(cold.data?.error || ''), `status=${cold.status}`)

await outage(false)
const healedTok = await loginOf(B)
ok('the SAME instance heals once GitHub is back', !!healedTok)
const healedAdd = await B.req('/content', { method: 'POST', token: healedTok, body: { title: 'gh500: after healing', channels: ['instagram_main'], type: 'post' } })
ok('and serves writes again', healedAdd.status === 201, `status=${healedAdd.status}`)

await new Promise((r) => setTimeout(r, 4200))
await A.req('/content', { token: tA })
await new Promise((r) => setTimeout(r, 500))
const C = await startInstance(4513, TMP('gh500-c'))
const tC = await loginOf(C)
const listC = (await C.req('/content', { token: tC })).data
const titles = Array.isArray(listC) ? listC.map((c) => c.title) : []
ok('write made during the outage survived to the store', titles.includes('gh500: during outage'), titles.filter((t) => /gh500/.test(t)).join(' | '))
ok('write made after healing survived too', titles.includes('gh500: after healing'))

for (const c of instances) c.kill()
console.log(fails === 0 ? '\nGitHub-outage resilience suite clean.' : `\n${fails} PROBLEMS`)
process.exit(fails === 0 ? 0 : 1)

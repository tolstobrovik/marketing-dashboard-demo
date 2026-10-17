// The memory guard (server/memguard.js), on the real server with its limits
// moved down to where any process crosses them: over the soft line uploads
// are turned away (retryably) and everything else is still answered; over
// the hard line the process leaves cleanly, for pm2 to start a fresh one.
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = process.env.DASHB_ROOT || process.cwd()
let fails = 0
const ok = (name, cond, extra = '') => {
  if (!cond) fails++
  console.log(`${cond ? '✔' : '✘ FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const dirs = []

function start(port, env) {
  const dir = mkdtempSync(join(tmpdir(), 'memguard-'))
  dirs.push(dir)
  const child = spawn(process.execPath, [join(ROOT, 'server/index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, GITHUB_DATA_FORCE: '', NICE: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let said = ''
  child.stdout.on('data', (d) => { said += d })
  child.stderr.on('data', (d) => { said += d })
  const exited = new Promise((r) => child.on('exit', (code) => r(code)))
  return { child, exited, said: () => said }
}
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await wait(250)
  }
  return false
}

// ---- over the soft line ----
const A = start(4180, { MEM_SOFT_MB: '1', MEM_HARD_MB: '100000', MEM_TREND_MS: '2000' })
ok('the server comes up', await up('http://localhost:4180/api/health'))
await wait(6000) // one tick of the guard
const piece = await fetch('http://localhost:4180/api/drive/uploads/piece', { method: 'PUT', body: Buffer.alloc(1024) })
const pieceBody = await piece.json().catch(() => ({}))
ok('an upload piece is turned away while memory is high', piece.status === 503 && pieceBody.retryable === true, String(piece.status))
ok('…with a time to come back', Number(piece.headers.get('retry-after')) > 0)
const big = await fetch('http://localhost:4180/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(1100000) }),
})
ok('so is any request bringing a megabyte or more', big.status === 503, String(big.status))
const login = await fetch('http://localhost:4180/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})
ok('everything else is still answered', login.status === 200, String(login.status))
ok('the log says what is using the memory', /Memory high .*rss \d+ MB .*in flight:/.test(A.said()), A.said().slice(-200))
ok('every so often it writes down what the memory is made of', /Memory trend: rss \d+ MB, heap \d+ MB, buffers \d+ MB.*uploads \d+/.test(A.said()), A.said().match(/Memory trend:[^\n]*/)?.[0] || 'no trend line')
A.child.kill('SIGKILL')

// ---- over the hard line ----
const B = start(4181, { MEM_SOFT_MB: '1', MEM_HARD_MB: '1' })
ok('a second server comes up', await up('http://localhost:4181/api/health'))
const code = await Promise.race([B.exited, wait(15000).then(() => 'still running')])
ok('over the hard line it leaves by itself, cleanly', code === 0, String(code))
ok('…and says why', /over the 1 MB limit — restarting cleanly/.test(B.said()) && /memory limit — shutting down/.test(B.said()))
if (code === 'still running') B.child.kill('SIGKILL')

for (const d of dirs) rmSync(d, { recursive: true, force: true })
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

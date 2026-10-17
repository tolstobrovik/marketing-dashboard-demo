// What actually goes out on the wire when the people board is summarised.
//
// The masking itself is checked as pure text in qa/anon-suite.mjs. This one
// checks the thing that anon-suite cannot: that the router really uses it —
// that a note naming somebody, sent to be summarised, reaches the provider
// with the name gone, and comes back to the reader with it restored.
//
// A provider that records what it was asked is the only way to assert this.
// Every provider here is a stand-in on one port (qa/mock-ai.mjs), which keeps
// what it was sent; the suite then reads that back and looks for names in it.
//
// Self-contained: stack on 4119, mock on 9998.
import { spawn } from 'child_process'

const SP = new URL('.', import.meta.url).pathname
const ROOT = SP + '..'
const B = 'http://localhost:4119/api'
const MOCK = 'http://localhost:9998'

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
const boot = (a, e) => { const p = spawn(process.execPath, a, { env: { ...process.env, ...e }, stdio: 'ignore' }); procs.push(p); return p }
const stop = () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } }
process.on('exit', stop)

const DATA = SP + 'pai-' + Date.now()
boot([SP + 'mock-ai.mjs'], { MOCK_AI_PORT: '9998' })
boot([ROOT + '/server/index.js'], {
  DATA_DIR: DATA, PORT: '4119',
  ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: MOCK,
})
const up = async (url) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
ok('the mock and the stack are up', (await up(MOCK + '/__calls')) && (await up(B + '/health')))

const login = async (u, p) => (await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, tok = T) => {
  const r = await fetch(B + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

// The first holder, the way a real server gets one.
const { execFileSync } = await import('node:child_process')
execFileSync('node', [ROOT + '/scripts/grant-superadmin.js', 'admin'], { stdio: 'pipe', env: { ...process.env, DATA_DIR: DATA } })
ok('there is a superadmin', (await req('/people/superadmins')).status === 200)

const sfx = Date.now().toString(36).slice(-5)
const worker = (await req('/users', 'POST', {
  name: 'Ravshan Xolmatov', username: 'ravshan' + sfx, password: 'pw123456', role: 'member', departments: ['instagram_main'],
})).data
ok('somebody to write about', !!worker?.id, JSON.stringify(worker))

await req('/people/notes', 'POST', {
  about_id: worker.id, month: '2026-09',
  body: 'Ravshan could not finish the September plan. I gave Ravshan Xolmatov a one-week plan and told @' + worker.username + ' to report back.',
})
await req('/people/notes', 'POST', {
  about_id: worker.id, month: '2026-08',
  body: 'Xolmatov delivered August early. 30 of 30 posts went out.',
})

await fetch(MOCK + '/__reset', { method: 'POST' })
const out = await req('/people/summary', 'POST', { about_id: worker.id })
ok('the summary route answers', out.status === 200, `${out.status} ${JSON.stringify(out.data)}`)
ok('it read both notes', out.data?.notes === 2, JSON.stringify(out.data?.notes))

const calls = await (await fetch(MOCK + '/__calls')).json()
ok('something was actually sent', calls.length > 0, `${calls.length} calls`)
const sent = calls.map((c) => c.text).join('\n')

console.log('\n— nothing identifying left this server —')
ok('no first name went out', !/Ravshan/i.test(sent))
ok('no surname went out', !/Xolmatov/i.test(sent))
ok('no username went out', !sent.includes(worker.username))
ok('the alias went out instead', /Person [A-Z]/.test(sent), sent.slice(0, 200))
ok('the notes themselves did go out', /September plan/.test(sent) && /30 of 30/.test(sent))
ok('both months went out', /2026-09/.test(sent) && /2026-08/.test(sent))

console.log('\n— and the reader still sees a name —')
// The stand-in echoes the prompt rather than summarising it, so there is no
// real summary to unmask here. What can be checked is that whatever comes
// back has been put through the reverse map: an alias must never survive to
// the reader, because the reader is being shown a person.
const shown = JSON.stringify(out.data?.summary || '') + JSON.stringify(out.data?.points || [])
ok('no alias reaches the reader', !/Person [A-Z]\b/.test(shown), shown.slice(0, 200))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
stop()
process.exit(fails ? 1 : 0)

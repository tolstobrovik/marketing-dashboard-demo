// The demo in one command: `npm run demo`.
//
// First run (or `npm run demo:reset`): a fresh local database, filled with a
// made-up team and six weeks of made-up work around today's date
// (scripts/demo-data.mjs). Then the app starts — the API on :4000 and the
// page on http://localhost:5173.
//
// Everything stays on this machine, in data/dashboard.db. Delete that file,
// or run `npm run demo:reset`, for a fresh board whose days line up with today.
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbFile = join(root, 'data', 'dashboard.db')
const API = 'http://localhost:4000'
const reset = process.argv.includes('--reset')
const node = (script, env = {}) => spawn(process.execPath, [join(root, script)], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
const done = (child) => new Promise((ok, fail) => child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`exited with ${code}`)))))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const health = () => fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null)

async function build() {
  if (await health()) {
    console.error('✖ Something is already running on :4000 — stop `npm run demo` / `npm run dev` first (Ctrl+C), then run this again.')
    process.exit(1)
  }
  console.log('→ A fresh demo database…')
  await done(node('server/seed.js'))
  const api = node('server/index.js', { PORT: '4000', NICE: '0' })
  try {
    for (let i = 0; i < 120; i++) {
      const h = await health()
      if (h?.ok !== false && h?.storage === 'file') break
      await wait(500)
    }
    await done(node('scripts/demo-data.mjs', { DEMO_API: API }))
  } finally {
    api.kill()
    await wait(800)
  }
}

if (reset || !existsSync(dbFile)) await build()

console.log(`
  ┌──────────────────────────────────────────────────────────────┐
  │  Open  http://localhost:5173                                 │
  │                                                              │
  │  Password for everybody:  demo-team-2026                     │
  │                                                              │
  │  admin     — sees everything                                 │
  │  dilnoza   — a content maker (SMM)                           │
  │  malika    — a copywriter (text channels)                    │
  │  otabek    — an operator (films)                             │
  │  eldor     — an editor                                       │
  │  nigora    — a designer                                      │
  │  aziz      — operator & editor                               │
  │                                                              │
  │  Ctrl+C stops it.  npm run demo:reset  for a fresh board.    │
  └──────────────────────────────────────────────────────────────┘
`)
const dev = spawn('npm run dev', { cwd: root, stdio: 'inherit', shell: true })
dev.on('exit', (code) => process.exit(code ?? 0))

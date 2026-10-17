// The server: one long-running process under pm2 (ecosystem.config.cjs),
// serving the API and the built client on one port.
import http from 'http'
import { setPriority } from 'os'
import { app } from './app.js'
import { initDb, closeDb, flushPending, storageConfig, storageStatus } from './db.js'
import { startDropWatch } from './dropin.js'
import { guardRequest, startMemGuard } from './memguard.js'

// This box is shared with other projects, and they come first. A lower
// priority costs nothing while the machine is idle and hands them the CPU the
// moment it is not. NICE=0 turns it off.
try { setPriority(0, Number(process.env.NICE ?? 10)) } catch { /* not permitted here — run as is */ }

const PORT = process.env.PORT || 4000

// Listen first, boot the database after. A boot that failed used to be a
// process that exited, which pm2 restarted, which downloaded the database
// again and failed again — a loop that held a core at 100% (12 Oct 2026).
// Now the process stays up, the API answers 503 with the reason, and the
// boot is retried on a widening interval. The built client is served either
// way, so the page loads and says what is wrong.
let ready = false
let booting = null // the boot in progress; a request that comes in during it waits for it
let bootReason = null
let dropWatch = null
let retry = null

let attempts = 0
let lastTry = 0

// One boot at a time. Retried on a widening interval (5s up to 5 min), and
// sooner when a request comes in — but never more than once every 5 seconds,
// so a crowd of requests against a dead store is a crowd of 503s, not a crowd
// of downloads.
function boot() {
  if (booting) return booting
  clearTimeout(retry)
  lastTry = Date.now()
  booting = (async () => {
    try {
      await initDb()
      ready = true
      bootReason = null
      console.log('Database ready')
      // Drive drop-in: files dropped into the team's three Drive folders find
      // their task (server/dropin.js). It reads the database, so it waits for it.
      dropWatch = startDropWatch()
    } catch (e) {
      bootReason = e.message
      const wait = Math.min(5000 * 2 ** attempts++, 5 * 60000)
      console.error(`Database boot failed — trying again in ${Math.round(wait / 1000)}s:`, e.message)
      retry = setTimeout(boot, wait)
    } finally {
      booting = null
    }
  })()
  return booting
}

function notReady(res) {
  const refused = / GitHub refused the storage token[^]*/.exec(bootReason || '')
  res.statusCode = 503
  res.setHeader('Content-Type', 'application/json')
  if (!refused) res.setHeader('Retry-After', '5')
  res.end(JSON.stringify({
    error: refused
      ? `Storage is locked out:${refused[0].replace(' — GitHub', ' GitHub')}`
      : 'The data store is starting — try again in a moment',
    reason: bootReason,
    retryable: !refused,
    config: (() => { try { return storageConfig() } catch { return null } })(),
  }))
}

const server = http.createServer(async (req, res) => {
  if (guardRequest(req, res)) return
  if (!ready && req.url.startsWith('/api')) {
    const pending = booting || (Date.now() - lastTry >= 5000 ? boot() : null)
    if (pending) {
      let timer
      await Promise.race([pending, new Promise((r) => { timer = setTimeout(r, 20000) })])
      clearTimeout(timer)
    }
    if (!ready) return notReady(res)
  }
  // What a request wrote goes up to GitHub as soon as it is answered, not on
  // the next tick of the interval below — a GET can write too (the nightly
  // route, a sync that refused a damaged copy). With nothing written it costs
  // nothing, and a flush already running is joined, not repeated (db.js).
  res.on('finish', () => { if (ready) flushPending().catch((e) => console.error('Post-response flush failed:', e.message)) })
  app(req, res)
})
server.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`))
boot()

// Whatever the per-request flush missed is pushed out on a short interval.
// Memory: a clean restart well before the kernel's OOM killer (memguard.js).
const memGuard = startMemGuard(() => shutdown('memory limit'), async () => {
  if (!ready) return null
  const s = await storageStatus()
  return { uploads: s.uploads ?? 0, database: s.bytes ? `${Math.round(s.bytes / 1048576)} MB` : '-' }
})

const flusher = setInterval(() => { if (ready) flushPending().catch(() => {}) }, 3000)
flusher.unref?.()

// Graceful shutdown: pm2 sends SIGINT on every reload. Stop taking new
// connections, let in-flight requests finish, flush pending writes, close the
// database, exit — with a hard 8s ceiling so a stuck request can't block it.
let stopping = false
function shutdown(reason) {
  if (stopping) return
  stopping = true
  console.log(`${reason} — shutting down`)
  clearInterval(flusher)
  clearInterval(memGuard)
  clearTimeout(retry)
  if (dropWatch) clearInterval(dropWatch)
  const bye = () => (ready ? flushPending() : Promise.resolve()).catch(() => {}).finally(() => { closeDb(); process.exit(0) })
  server.close(bye)
  setTimeout(bye, 8000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e))
process.on('uncaughtException', (e) => { console.error('Uncaught exception:', e); shutdown('uncaught exception') })

// The memory guard. The server is shared with other projects, and on
// 13 Oct 2026 the kernel's OOM killer took this process at 676 MB resident —
// past pm2's 400 MB ceiling, which pm2 only looks at every 30 seconds, and
// far past the V8 heap cap, which does not count Buffers. By then the whole
// box was short (sshd was throttling logins), so the other projects felt it.
//
// This looks every 5 seconds, at the number the kernel looks at (RSS):
//  - above SOFT: collect garbage, refuse what would bring more in (a request
//    body over 1 MB, a Drive upload piece) with a retryable 503, and log
//    what is using the memory and which requests are in flight;
//  - above HARD: log the same, then shut down cleanly (writes flushed) and
//    let pm2 start a fresh process — well before the kernel has to choose.
// MEM_SOFT_MB and MEM_HARD_MB move the lines.
const MB = 1024 * 1024
// Sized for the box it shares (3.8 GB, ~330 MB free, no swap, Oct 2026).
const SOFT = Number(process.env.MEM_SOFT_MB || 250) * MB
const HARD = Number(process.env.MEM_HARD_MB || 320) * MB

// Requests in flight, by route shape (ids folded away), so the log says
// "8 × PUT /api/drive/uploads/piece", not one line per request.
const inFlight = new Map()
let seq = 0
const shapeOf = (req) => `${req.method} ${String(req.url).split('?')[0]
  .replace(/\/[0-9]+(?=\/|$)/g, '/:id').replace(/\/[\w-]{20,}(\.\w+)?(?=\/|$)/g, '/:token')}`

let high = false
let lastGc = 0
let lastLog = 0

const mb = (n) => `${Math.round(n / MB)} MB`
function report(why) {
  const m = process.memoryUsage()
  const routes = {}
  for (const r of inFlight.values()) routes[r] = (routes[r] || 0) + 1
  const busiest = Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([r, n]) => `${n} × ${r}`).join(', ') || 'none'
  console.error(`Memory ${why}: rss ${mb(m.rss)} (heap ${mb(m.heapUsed)}/${mb(m.heapTotal)}, ` +
    `buffers ${mb(m.arrayBuffers)}, external ${mb(m.external)}) — in flight: ${busiest}`)
}

// Whether a request should be turned away while memory is high: the ones
// that bring a body of a megabyte or more into this process.
const heavy = (req) => Number(req.headers['content-length'] || 0) >= MB || /\/uploads\/piece/.test(req.url)

// Wraps the request handler. Returns true when it answered the request itself.
export function guardRequest(req, res) {
  if (high && heavy(req)) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Retry-After', '15')
    res.end(JSON.stringify({ error: 'The server is busy — try again in a moment', retryable: true }))
    return true
  }
  const id = ++seq
  inFlight.set(id, shapeOf(req))
  res.on('close', () => inFlight.delete(id))
  return false
}

// Every ten minutes, one line: what the memory is made of, beside what the
// process has done. Memory that steps up with `uploads` and never comes back
// is a leak in the save path; memory that rises and falls is slow freeing.
async function trend(extra) {
  const m = process.memoryUsage()
  let more = ''
  try { const x = extra ? await extra() : null; if (x) more = ` · ${Object.entries(x).map(([k, v]) => `${k} ${v}`).join(', ')}` } catch { /* not booted yet */ }
  console.log(`Memory trend: rss ${mb(m.rss)}, heap ${mb(m.heapUsed)}, buffers ${mb(m.arrayBuffers)}, ` +
    `external ${mb(m.external)}, up ${Math.round(process.uptime() / 60)} min${more}`)
}

export function startMemGuard(onHard, extra) {
  const trendTimer = setInterval(() => { trend(extra) }, Number(process.env.MEM_TREND_MS || 600000))
  trendTimer.unref?.()
  const timer = setInterval(() => {
    const rss = process.memoryUsage.rss()
    if (rss >= HARD) {
      report(`over the ${mb(HARD)} limit — restarting cleanly before the kernel has to`)
      clearInterval(timer)
      clearInterval(trendTimer)
      onHard()
      return
    }
    const now = Date.now()
    if (rss >= SOFT) {
      if (!high || now - lastLog > 60000) { report(`high (over ${mb(SOFT)}) — turning away uploads until it falls`); lastLog = now }
      high = true
      // --expose-gc (ecosystem.config.cjs): a Buffer's memory is returned only
      // when the small object holding it is collected, which V8 is in no
      // hurry to do while its own heap is comfortable.
      if (global.gc && now - lastGc > 30000) { lastGc = now; global.gc() }
    } else if (high && rss < SOFT * 0.9) {
      high = false
      console.log(`Memory back to ${mb(rss)} — taking uploads again`)
    }
  }, 5000)
  timer.unref?.()
  return timer
}

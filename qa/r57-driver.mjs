// Where the app lives. Defaults to the sandbox path these suites were
// written in, so nothing changes there; set DASHB_ROOT to run them on a
// laptop or in CI, where the checkout is somewhere else entirely.
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
// Drives the storage layer the way server/index.js does: a write, then a
// flush, per "request" — several at once, with no HTTP in between.
import { pathToFileURL } from 'url'

// A computed path cannot be a static import specifier — this one is resolved
// at run time, which is the whole point of DASHB_ROOT. It goes through
// pathToFileURL because a bare absolute path is only a valid specifier by
// accident: on Windows the loader reads the "C:" as a URL scheme and refuses
// it. A file:// URL is what it wants on either platform, and on Linux it
// names the very same module the bare path did.
const { initDb, run, flushPending } = await import(pathToFileURL(ROOT + '/server/db.js').href)

const N = Number(process.env.R57_N || 8)
await initDb()
await flushPending()                       // settle whatever boot wrote
const t0 = Date.now()
await Promise.all([...Array(N)].map(async (_, i) => {
  await run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    `r57-${i}`, `v${i}-${t0}`)
  await flushPending()                     // what server/index.js does after each write
}))
console.log('DRIVER-DONE')

// Leave by the door, not the window. process.exit() tears the loop down where
// it stands, and on Windows libsql's native handle is sometimes already
// closing when it does — libuv aborts, and the driver dies with 127 AFTER
// finishing its work, which the suite can only read as a failed driver.
// Nothing here holds the loop open (the storage layer's one lingering timer is
// unref'd), so falling off the end is enough. The timer below is the failsafe
// for the day that stops being true: unref'd, so it cannot keep the process
// alive by itself, but it still fires if something else is doing so.
setTimeout(() => process.exit(0), 5000).unref()

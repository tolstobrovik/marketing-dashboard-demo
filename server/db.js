// Database layer: SQLite, behind one tiny API, in one of two places:
//  - github: the team's database. The file lives on this repository's
//            `appdata` branch; the server keeps a working copy under DATA_DIR
//            and uploads it after each write (GITHUB_DATA_FORCE=1 + a token,
//            which ecosystem.config.cjs sets when .env.production has one).
//  - file:   local development — a private SQLite file under ./data
//            (override with DATA_DIR).
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { planProjectMigration } from './projectshape.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, existsSync, statSync } from 'fs'
import { GITHUB_DATA } from './config.js'
import { createGhStore, pagesOf, lostItself } from './ghstore.js'
import { scriptKey } from './text.js'


const __dirname = dirname(fileURLToPath(import.meta.url))
// Windows answers two questions here differently from every host this
// deploys to: how long a path may be, and whether a file that is open can
// be renamed over. Both are answered where they are asked, below.
const WINDOWS = process.platform === 'win32'
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data')
// A task's reference photos, as files beside the database rather than inside
// it: the database is pushed to GitHub on every change, and twenty pictures a
// task would make every push of it heavy. These are not pushed anywhere —
// the deploy's rsync leaves DATA_DIR alone, and so does a redeploy.
export const MEDIA_DIR = join(DATA_DIR, 'media')
// Where people pressed (routes/track.js): a file a day, beside the database
// for the same reason — never pushed, left alone by the deploy.
export const TRACK_DIR = join(DATA_DIR, 'track')

// The storage credentials, environment first. A token in config.js has to be
// committed and redeployed to change; one in the host's environment can be
// replaced in a minute, without a commit and without the secret ever touching
// the repository. That matters because these tokens EXPIRE — when this one
// does, the whole dashboard goes dark until it is replaced.
const GH_DATA = GITHUB_DATA && {
  ...GITHUB_DATA,
  token: process.env.GITHUB_DATA_TOKEN || process.env.GH_DATA_TOKEN || GITHUB_DATA.token,
  repo: process.env.GITHUB_DATA_REPO || GITHUB_DATA.repo,
  branch: process.env.GITHUB_DATA_BRANCH || GITHUB_DATA.branch,
  path: process.env.GITHUB_DATA_PATH || GITHUB_DATA.path,
}
// A placeholder is not a token — treat the unfilled default as "not set" so
// the app says so plainly instead of arguing with GitHub about it.
const GH_TOKEN_SET = !!GH_DATA?.token && !/^REPLACE_WITH/.test(GH_DATA.token)

// The one true answer to "what is this deployment's storage credential?" —
// resolved once, here, and exported so nothing has to work it out again.
// The session secret is derived from it (auth.js), and deriving it a second
// time from a DIFFERENT source is how a deployment ends up signing sessions
// with a string that is published in the repository. Null when there is no
// real credential at all: a placeholder never counts as one.
export const storageSecret = () =>
  (GH_TOKEN_SET ? GH_DATA.token : null)

// GitHub-repo storage is asked for (ecosystem.config.cjs does, when the server
// has a token); without it the app runs on a private local file.
const GH_MODE = !!GH_DATA?.token && process.env.GITHUB_DATA_FORCE === '1'
export const STORAGE = GH_MODE ? 'github' : 'file'

const rowsOf = (rs) => rs.rows.map((r) => {
  const o = {}
  rs.columns.forEach((c, i) => { o[c] = r[i] })
  return o
})

// Opening the local SQLite file, with the one failure that is worth naming.
// libsql reports a path it cannot open as ConnectionFailed(<path>: 14), and 14
// is SQLITE_CANTOPEN — the same code you get for a directory that is not there,
// so the message sends you looking for the wrong thing. On Windows the usual
// cause is length: MAX_PATH is 260 characters unless long paths are switched on
// machine-wide, and a DATA_DIR under a temp or scratch folder goes past that
// without ever looking long. Say which it is, at the point it happens.
const openLocal = (createClient, file) => {
  try {
    return createClient({ url: `file:${file}`, intMode: 'number' })
  } catch (e) {
    if (WINDOWS && file.length >= 260) {
      throw new Error(`Cannot open the database at ${file} — that path is ${file.length} ` +
        'characters and Windows refuses 260 or more unless long paths are enabled. ' +
        'Set DATA_DIR to somewhere shorter. ' + e.message)
    }
    throw e
  }
}

async function createLibsqlBackend() {
  const { createClient } = await import('@libsql/client')
  mkdirSync(DATA_DIR, { recursive: true })
  const client = openLocal(createClient, join(DATA_DIR, 'dashboard.db'))
  return {
    all: async (sql, args) => rowsOf(await client.execute({ sql, args })),
    run: async (sql, args) => {
      const rs = await client.execute({ sql, args })
      return {
        changes: rs.rowsAffected,
        lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
      }
    },
    batch: async (stmts) =>
      (await client.batch(stmts.map(([sql, ...args]) => ({ sql, args })), 'write')).map(rowsOf),
    exec: (sql) => client.executeMultiple(sql),
    close: () => client.close(),
  }
}

// SQLite in /tmp as the working copy; the GitHub repo as the durable copy.
// Reads check the data branch head (cheap, throttled) and re-download when
// another instance wrote; writes are journaled and uploaded once per request
// with compare-and-swap — on a conflict the fresh remote copy is pulled and
// this instance's unflushed statements are replayed on top, then retried.
async function createGithubBackend() {
  const { createClient } = await import('@libsql/client')
  const store = createGhStore(GH_DATA)
  mkdirSync(DATA_DIR, { recursive: true })
  const file = join(DATA_DIR, 'dashboard.db')

  let client = null
  let journal = []   // unflushed write statements since the last upload
  let dirty = false
  let lastCheck = 0
  let syncing = null // serializes pull/swap/replay
  let writing = 0    // write statements in flight — drained before a swap
  let flushError = null
  let flushes = 0
  let cleanHash = null // file hash as of the last pull/upload — skips no-op flushes
  let cleanPages = 0   // pages in the last copy this machine and GitHub agreed on
  let staleBoot = null // set when we opened a local copy because GitHub was down
  let lastSync = 0     // when the durable store last answered us

  const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const openClient = () => openLocal(createClient, file)
  // A name only this process writes under. Two copies of the app on one data
  // directory used to share "dashboard.db.tmp", and each other's half files.
  const tmp = `${file}.${process.pid}.tmp`

  // SQLite's side files belong to the copy being replaced. A stale one replayed
  // onto a fresh database is a corrupt database, so they go with it.
  //
  // That includes the boot: a process killed mid-write (pm2's memory ceiling,
  // the kernel's OOM killer) leaves its -journal behind, and the next boot
  // used to write the downloaded copy over the file and leave the journal
  // beside it. SQLite took it for a crashed transaction of THIS file and
  // rolled the old copy's pages into the new one — "database disk image is
  // malformed" on 12 Oct 2026, then "no such table: main.users" two thousand
  // lines after the table had been created, then a restart loop.
  const dropSidecars = (of = file) => {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (existsSync(of + suffix)) rmSync(of + suffix, { force: true })
    }
  }

  // Is this a database SQLite can read whole? null when it is, else what is
  // wrong with it. quick_check reads every page, which on a database of a few
  // megabytes is milliseconds — cheap next to the download it guards.
  const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1')
  const damageOf = async (c) => {
    try {
      const rs = await c.execute('PRAGMA quick_check')
      const verdict = rs.rows.map((r) => String(r[0])).join('; ')
      return verdict === 'ok' ? null : verdict.slice(0, 200)
    } catch (e) {
      return e.message
    }
  }
  // Write a downloaded copy beside the live file and check it there, before
  // anything is replaced. A damaged copy on the branch — however it got there
  // — must stop at the door, not become the working copy and then the copy
  // every other instance pulls.
  const stage = async (bytes) => {
    if (!bytes || bytes.length < 100 || !bytes.subarray(0, 16).equals(SQLITE_MAGIC)) return 'not a SQLite database'
    dropSidecars(tmp)
    writeFileSync(tmp, bytes)
    const c = openLocal(createClient, tmp)
    const bad = await damageOf(c)
    try { c.close() } catch { /* already closed */ }
    dropSidecars(tmp)
    if (bad) rmSync(tmp, { force: true })
    return bad
  }

  // Open the copy this machine already holds — with its own journal, which IS
  // this file's and rolls back correctly — when GitHub cannot give a better
  // one. False, and the file gone, when it is the half-written leftovers of a
  // killed instance.
  const openOwnCopy = async () => {
    if (!existsSync(file)) return false
    client = openClient()
    let bad
    try {
      await client.execute({ sql: 'SELECT 1 FROM meta LIMIT 1', args: [] })
      bad = await damageOf(client)
    } catch (e) {
      bad = e.message
    }
    if (!bad) {
      cleanPages = Number(rowsOf(await client.execute('PRAGMA page_count'))[0]?.page_count || 0)
      return true
    }
    console.error('This machine’s copy of the database is unusable too:', bad)
    try { client.close() } catch { /* not open */ }
    client = null
    rmSync(file, { force: true })
    dropSidecars()
    return false
  }

  // Swap in a fresh copy atomically: write beside the live file, rename over
  // it, then reopen. Queries running on the old handle keep reading the old
  // inode until it is closed a moment later — nothing ever sees a half file.
  //
  // Windows will not have it. A rename onto a file anything still holds open is
  // EPERM there, and closing the handle first does not buy it: libsql lets the
  // OS handle go lazily, and the rename was still failing a second and a half
  // after the close. Writing THROUGH the open file IS allowed, so that is the
  // swap there — with the old handle closed BEFORE the write rather than five
  // seconds after, because a reader left on a file being rewritten underneath
  // it is worse than one that fails: it succeeds, and returns nonsense. The
  // trade is a query in flight dying instead of finishing on the old copy.
  // That is a laptop's problem and not a deployment's: this branch exists so
  // qa/gh-suite and qa/gh500-suite can run before a push, and every server
  // this ships to is Linux and still renames.
  const applyBytes = async (bytes) => {
    const bad = await stage(bytes)
    if (bad) {
      // Ours goes back up on the next flush: pushOnce skips a file it thinks
      // is clean, so it is told it is not.
      cleanHash = null
      dirty = true
      throw new Error(`the copy on GitHub is damaged (${bad}) — keeping this machine’s copy and uploading it over that one`)
    }
    while (writing > 0) await new Promise((r) => setTimeout(r, 10))
    const old = client
    if (WINDOWS) {
      if (old) { try { old.close() } catch { /* already closed */ } }
      dropSidecars()
      writeFileSync(file, bytes)
      rmSync(tmp, { force: true })
    } else {
      dropSidecars()
      renameSync(tmp, file)
    }
    cleanHash = hashOf(bytes)
    cleanPages = pagesOf(bytes)
    client = openClient()
    if (old && !WINDOWS) setTimeout(() => { try { old.close() } catch { /* already closed */ } }, 5000).unref?.()
  }

  const replayJournal = async () => {
    // Each statement stands alone. One that will not apply — a row the pulled
    // copy already contains, a constraint the fresh data now makes true — must
    // not take the writes behind it down with it: the loop used to throw, the
    // caller swallowed it, and everything after the bad entry was simply gone.
    for (const entry of journal) {
      try {
        if (entry.exec) await client.executeMultiple(entry.exec)
        else await client.execute({ sql: entry.sql, args: entry.args })
      } catch (e) {
        console.error('journal replay skipped a statement:', e.message)
      }
    }
  }

  const sync = (force = false) => {
    if (syncing) return syncing
    if (!force && Date.now() - lastCheck < 4000) return Promise.resolve()
    syncing = (async () => {
      try {
        const { changed, bytes } = await store.pull()
        lastCheck = Date.now()
        lastSync = Date.now()
        staleBoot = null // the durable store answered — we are current again
        if (changed && bytes) {
          await applyBytes(bytes)
          if (journal.length) await replayJournal()
        }
      } catch (e) {
        // A GitHub hiccup must not fail the user's request — serve the local
        // copy and try again on a later call. Writes stay journaled, and the
        // compare-and-swap upload keeps correctness whenever GitHub is back.
        lastCheck = Date.now()
        console.error('GitHub data sync failed:', e.message)
      } finally {
        syncing = null
      }
    })()
    return syncing
  }

  // First boot: one download brings sha + contents together; the branch only
  // needs creating the very first time the app ever runs. GitHub blips at
  // cold start are retried here with a widening backoff.
  let initial = null
  let bootError = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      initial = await store.pull()
      bootError = null
      break
    } catch (e) {
      bootError = e
      if (attempt < 4) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt + Math.random() * 150))
    }
  }
  if (bootError) {
    // GitHub is still unreachable. A WARM instance rides this out on its local
    // copy (see sync's catch) — a cold one used to answer every request "the
    // data store is briefly unreachable" instead. So when this machine still
    // holds a database file from an earlier boot, open THAT and carry on:
    // sync() pulls the fresh copy the moment GitHub answers again, and the
    // compare-and-swap upload keeps writes correct meanwhile.
    if (!(await openOwnCopy())) throw bootError
    staleBoot = bootError.message
    lastCheck = 0 // the next query re-pulls the moment GitHub is back
    console.error('GitHub unreachable at boot — serving this machine’s copy:', bootError.message)
  } else {
    if (!initial.exists) await store.ensureBranch()
    lastCheck = Date.now()
    lastSync = Date.now()
    const bad = initial.bytes ? await stage(initial.bytes) : null
    if (bad) {
      // The branch holds a copy SQLite cannot read. Never boot past that onto
      // an empty database — the seed would be uploaded over the team's data.
      // A whole copy left on this machine is served instead and uploaded over
      // the damaged one; with none, refuse, and say where to look.
      if (!(await openOwnCopy())) {
        throw new Error(`The database on the ${GH_DATA.branch} branch is damaged (${bad}) and this machine has no ` +
          'whole copy to fall back on. Put back the last good data/dashboard.db from that branch’s history, then restart.')
      }
      staleBoot = `the copy on GitHub is damaged (${bad})`
      cleanHash = null
      dirty = true
      console.error(`The database on GitHub is damaged (${bad}) — serving this machine’s copy and uploading it over that one.`)
    } else {
      // Whole, or not there: stage() wrote it beside its name, and it is
      // renamed onto it. writeFileSync(file) empties the file before it fills
      // it, and on 9 October 2026 a second copy of the app, starting in the
      // same second, opened it in between and found "no users". (Windows
      // cannot rename onto an open file — see applyBytes — and is a laptop.)
      dropSidecars()
      if (initial.bytes) {
        if (WINDOWS) { writeFileSync(file, initial.bytes); rmSync(tmp, { force: true }) }
        else renameSync(tmp, file)
        cleanHash = hashOf(initial.bytes)
        cleanPages = pagesOf(initial.bytes)
      } else if (existsSync(file)) rmSync(file) // stale /tmp leftovers from a previous instance
      client = openClient()
      if (cleanPages) {
        // …and what is now open must be what was just downloaded. If it is not,
        // somebody else is writing in this directory, and going on would end in
        // seeding an "empty" database over the team's. Fail the boot instead:
        // it is retried from a fresh download on the next request.
        const seen = Number(rowsOf(await client.execute('PRAGMA page_count'))[0]?.page_count || 0)
        if (seen !== cleanPages) {
          try { client.close() } catch { /* not open */ }
          throw new Error(`the database on disk holds ${seen} pages and the one just downloaded ${cleanPages} — is a second copy of the app running on ${DATA_DIR}?`)
        }
      }
    }
  }
  // Did GitHub already hold a database when this process started? seedIfEmpty asks.
  const bootPages = initial?.bytes ? pagesOf(initial.bytes) : 0

  const pushOnce = async () => {
    // Idempotent statements (schema init on a warm database, same-value
    // updates) leave the file byte-identical — skip the round-trip entirely.
    // Read once and reused by the first attempt below when nothing was
    // written in between: each read is the whole database (~15 MB).
    const first = readFileSync(file)
    const firstAt = journal.length
    if (hashOf(first) === cleanHash) {
      journal = []
      dirty = false
      flushError = null
      return
    }
    // The upload replaces the copy every instance pulls. A damaged one sent
    // up would take them all down, so it stays here and says why.
    const bad = await damageOf(client)
    if (bad) {
      flushError = `this machine’s copy of the database is damaged (${bad}) — not uploading it`
      console.error('GitHub data flush refused:', flushError)
      return
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Everything journaled up to here is inside the bytes we are about to
        // send. Anything appended while the upload is in the air is not, and
        // has to survive it.
        const sentUpTo = journal.length
        const bytes = attempt === 0 && sentUpTo === firstAt ? first : readFileSync(file)
        if (process.env.ALLOW_DATA_SHRINK !== '1' && lostItself(cleanPages, pagesOf(bytes))) {
          // Not an edit: this machine's copy is not the team's database any
          // more. GitHub's stays exactly as it is; what was journaled here
          // belongs to the impostor and goes with it; and the stored one is
          // fetched again, so the next request is answered from real data.
          const was = cleanPages
          const now = pagesOf(bytes)
          console.error(`GitHub data flush REFUSED: this copy went from ${was} pages to ${now} — another database, not an edit. The stored one is untouched and is being fetched again.`)
          journal = []
          dirty = false
          store.forget()
          await sync(true)
          flushError = lostItself(was, pagesOf(readFileSync(file)))
            ? `refused to upload a database that shrank from ${was} pages to ${now}; the stored copy is untouched — restart this process`
            : null
          return
        }
        const result = await store.push(bytes)
        if (result === true) {
          cleanHash = hashOf(bytes)
          cleanPages = pagesOf(bytes)
          flushError = null
          // Only the bytes actually UPLOADED are safely stored. Writes that
          // landed mid-upload are not in them, and calling the file clean here
          // used to lose exactly those. But the statements that DID go up must
          // still leave the journal: a later sync replays whatever is left on
          // top of a freshly pulled copy, and replaying a row that is already
          // in it collides — which used to abandon the rest of the replay and
          // lose the writes behind it.
          journal = journal.slice(sentUpTo)
          dirty = journal.length > 0 || hashOf(readFileSync(file)) !== cleanHash
          // Compact the data branch periodically even if the nightly cron
          // never fires — one commit per ~100 keeps the repo small forever.
          if (++flushes % 100 === 0) await store.squash(readFileSync(file)).catch(() => {})
          // An upload leaves ~100 MB of Buffers and strings behind it, and
          // SQLite statements hold native memory until their small JS
          // wrappers are collected. The heap itself stays near 40 MB, so V8
          // sees no reason to collect — and on 13 Oct 2026 RSS reached 676 MB
          // with 39 MB of heap. A collection now costs a few milliseconds and
          // hands all of it back (--expose-gc, ecosystem.config.cjs).
          globalThis.gc?.()
          return
        }
        await sync(true) // conflict: pull fresh copy, replay journal, retry
      } catch (e) {
        flushError = e.message
        console.error('GitHub data flush failed:', e.message)
        return
      }
    }
    flushError = 'conflict retries exhausted'
    console.error('GitHub data flush failed: conflict retries exhausted')
  }

  // One upload at a time. Two overlapping requests each used to push the whole
  // database: the second lost the compare-and-swap, downloaded the fresh copy,
  // replayed and pushed again — three round trips of a megabyte-odd for one
  // change. Several people working at once turned that into the traffic that
  // gets a deployment throttled. Callers now JOIN the flush already running,
  // and only start another if their own write is still unsaved when it ends.
  let inFlight = null
  const flush = async () => {
    for (let i = 0; i < 4 && dirty; i++) {
      if (!inFlight) break
      const running = inFlight
      await running.catch(() => { /* the joiner reads flushError, not the throw */ })
      if (!dirty) return          // the flush we waited on carried our write
      if (inFlight === running) break // nobody queued behind it — our turn
    }
    if (!dirty) return
    inFlight = pushOnce()
    try { await inFlight } finally { inFlight = null }
  }

  return {
    all: async (sql, args) => {
      await sync()
      return rowsOf(await client.execute({ sql, args }))
    },
    run: async (sql, args) => {
      await sync()
      writing++
      try {
        const rs = await client.execute({ sql, args })
        journal.push({ sql, args })
        dirty = true
        return {
          changes: rs.rowsAffected,
          lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid),
        }
      } finally {
        writing--
      }
    },
    batch: async (stmts) => {
      await sync()
      writing++
      try {
        const out = (await client.batch(stmts.map(([sql, ...args]) => ({ sql, args })), 'write')).map(rowsOf)
        for (const [sql, ...args] of stmts) journal.push({ sql, args })
        dirty = true
        return out
      } finally {
        writing--
      }
    },
    exec: async (sql) => {
      await sync()
      writing++
      try {
        await client.executeMultiple(sql)
        journal.push({ exec: sql })
        dirty = true
      } finally {
        writing--
      }
    },
    close: () => client.close(),
    heldData: () => bootPages > 0,
    flush,
    resync: () => sync(true),
    // Everything an admin needs to tell "all is well" from "GitHub is down"
    // or "this database is getting heavy" — one glance at /api/health.
    status: () => ({
      uploads: flushes,                                   // since this process started
      dirty,
      flushError,
      stale: staleBoot,                                   // serving a local copy; GitHub said this
      bytes: existsSync(file) ? statSync(file).size : 0,   // every write re-uploads this much
      pages: cleanPages,                                   // what the database itself says it holds — a wiped one kept its old length
      pending: journal.length,
      synced_secs_ago: lastSync ? Math.round((Date.now() - lastSync) / 1000) : null,
    }),
    squash: async () => {
      await flush()
      // Deleted photos leave free pages behind — reclaim them before the
      // upload, so the file the team pays for on every write keeps shrinking
      // instead of only ever growing.
      try { await client.executeMultiple('VACUUM;') } catch (e) { console.error('vacuum failed:', e.message) }
      const bytes = readFileSync(file)
      // The squash deletes the branch and writes it again from this file — the
      // one upload that would also take the history with it.
      if (process.env.ALLOW_DATA_SHRINK !== '1' && lostItself(cleanPages, pagesOf(bytes))) {
        throw new Error(`squash refused: this copy went from ${cleanPages} pages to ${pagesOf(bytes)}`)
      }
      const result = await store.squash(bytes)
      if (result !== true) throw new Error('squash upload conflicted')
      // Only a landed upload makes the file "clean" — marking it earlier would
      // let the next flush skip a real change and quietly lose it.
      cleanHash = hashOf(bytes)
      cleanPages = pagesOf(bytes)
    },
  }
}

// The backend boots lazily and NEVER caches a failure: a GitHub outage during
// a cold start used to reject this promise once and poison the instance for
// its whole life — every request answered 500 until the host recycled it.
// Now a failed boot clears itself and the next request simply tries again.
let backendPromise
function backend() {
  backendPromise ||= (GH_MODE ? createGithubBackend() : createLibsqlBackend())
    .catch((e) => { backendPromise = undefined; throw e })
  return backendPromise
}

// Persist any journaled writes to GitHub (no-op on a local file). The server
// calls it after each write request, on an interval, and at shutdown.
export async function flushPending() {
  const b = await backend()
  if (b.flush) await b.flush()
}
// What the app was CONFIGURED with — readable without a working database, so
// a locked-out deployment can still explain itself. Never the token's value:
// only whether one is set, and which source won. That single word separates
// "the new token never reached the app" (still says config.js → the variable
// went to the wrong place, or the deploy predates it) from "the token itself
// is refused" (says environment → the credential lacks Contents write, or
// was pasted with a stray space).
export function storageConfig() {
  if (!GH_MODE) return { storage: STORAGE }
  const fromEnv = !!(process.env.GITHUB_DATA_TOKEN || process.env.GH_DATA_TOKEN)
  return {
    storage: STORAGE,
    token: GH_TOKEN_SET ? 'set' : 'missing',
    token_from: fromEnv ? 'environment' : 'config.js',
    token_tail: GH_TOKEN_SET ? `…${String(GH_DATA.token).slice(-4)}` : null, // enough to tell two tokens apart
    repo: GH_DATA?.repo,
    branch: GH_DATA?.branch,
  }
}
export async function storageStatus() {
  const b = await backend()
  return { ...storageConfig(), ...(b.status ? b.status() : {}) }
}
// Force-refresh the local copy from the durable store (github mode only) —
// used when a just-created user isn't visible to this instance yet.
export async function resyncStorage() {
  const b = await backend()
  if (b.resync) await b.resync()
}
// Compact the GitHub data branch to one commit (no-op on other backends).
export async function squashData() {
  const b = await backend()
  if (b.squash) await b.squash()
}

const cleanArgs = (args) => args.map((v) => (v === undefined ? null : v))

export async function all(sql, ...args) {
  return (await backend()).all(sql, cleanArgs(args))
}
export async function get(sql, ...args) {
  return (await all(sql, ...args))[0]
}
export async function run(sql, ...args) {
  return (await backend()).run(sql, cleanArgs(args))
}
// One transaction: statements as [sql, ...args]; returns each statement's rows.
export async function batch(stmts) {
  return (await backend()).batch(stmts.map(([sql, ...args]) => [sql, ...cleanArgs(args)]))
}
export async function exec(sql) {
  await (await backend()).exec(sql)
}
export function closeDb() {
  if (backendPromise) backendPromise.then((b) => b.close()).catch(() => {})
}

// The whole app lives on the team's clock: a "day" starts at midnight in
// Tashkent (UTC+5) no matter where the server or the browser happens to run.
export const TIMEZONE = 'Asia/Tashkent'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }) // YYYY-MM-DD
export function dayISO(offset = 0) {
  return dayFmt.format(new Date(Date.now() + offset * 86400000))
}
// The Tashkent calendar day of a full ISO timestamp.
export const tashkentDay = (iso) => dayFmt.format(new Date(iso))

// What a member may do unless the admin changes it (Telegram-style rights).
export const DEFAULT_PERMS = {
  edit_metrics: true,     // change metric values (+/-)
  manage_metrics: false,  // add / rename / retarget / delete metrics
  manage_layout: false,   // reorder metrics, pin the main metric
  manage_content: true,   // create & edit content tasks, dates, details
  move_tasks: true,       // drag tasks between stages / days
  review_publish: true,   // move Ready → Published on a channel you're on (SMM)
  request_changes: true,  // send a task back to the crew for fixes (Pravki)
  deliver_work: true,     // deliver / re-deliver a stage's file link
  // Runs the ambassador programme: reads the queue, answers cards, sets terms,
  // and creates the student accounts. Off by default and deliberately narrow —
  // it is a job on this board, not a way onto the rest of it. See
  // server/routes/ambassadors.js and the carve-out in routes/users.js.
  manage_ambassadors: false,
}
export const PERM_KEYS = Object.keys(DEFAULT_PERMS)

export async function initSchema() {
  const ID = 'INTEGER PRIMARY KEY AUTOINCREMENT'
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            ${ID},
      name          TEXT    NOT NULL,
      username      TEXT    NOT NULL,
      email         TEXT,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'member',
      crew_roles    TEXT    NOT NULL DEFAULT '[]',
      departments   TEXT    NOT NULL DEFAULT '[]',
      permissions   TEXT    NOT NULL DEFAULT '{}',
      color         TEXT    NOT NULL DEFAULT '#A22036',
      avatar        TEXT,
      phone         TEXT,
      position      TEXT,
      duties        TEXT,
      work_start    TEXT,
      work_end      TEXT,
      work_days     TEXT,
      telegram_chat_id TEXT,
      -- The language this person last chose in the dashboard — the bot speaks
      -- it too (tgcopy.js). NULL until they pick one: English.
      lang          TEXT,
      -- Set when someone signs in with a password that is published in this
      -- repository (the documented first-boot one). Cleared the moment they
      -- pick their own. A public repo plus a public URL makes this the
      -- shortest path into the dashboard, so it is worth saying out loud.
      weak_password INTEGER NOT NULL DEFAULT 0,
      telegram_code    TEXT,
      -- WHEN THIS PERSON IS NOT AVAILABLE, on a repeating week.
      --
      -- Working hours say when somebody is at work. They do not say that the
      -- operator is in lectures every Tuesday afternoon, and this team is a
      -- college-prep company: half the crew are students, and "free between
      -- nine and six" is false for most of them most of the week. A planner
      -- who cannot see that books a shoot into a seminar, and finds out on
      -- the day.
      --
      -- A list of [{ d, from, to, label }], d being 0-6 the way work_days
      -- already counts them. Repeating weekly, because a study timetable is
      -- the thing that repeats; one-off engagements are a booked task.
      study_blocks     TEXT    NOT NULL DEFAULT '[]',
      created_at    TEXT    NOT NULL
    );

    -- Sidebar channels are data, not code: the admin adds/renames/reorders them.
    CREATE TABLE IF NOT EXISTS channels (
      id      ${ID},
      key     TEXT UNIQUE NOT NULL,
      label   TEXT NOT NULL,
      icon    TEXT NOT NULL DEFAULT 'star',
      head_id INTEGER,
      -- The one Drive folder this channel's footage and cuts live in. With it
      -- set, nobody pastes a URL per task: they say WHICH file in the folder
      -- ("1-3", "reel 14"), which is what they would have said out loud
      -- anyway, and the board keeps the folder.
      drive_url TEXT NOT NULL DEFAULT '',
      -- The most video ads this channel may have going out on one day. Ads
      -- are bought a month at a time and burn their audience if they land in
      -- a heap, so the ceiling belongs to the CHANNEL rather than to whoever
      -- happens to be making them. 0 is what every channel was before this
      -- existed: no ceiling.
      daily_ad_cap INTEGER NOT NULL DEFAULT 0,
      -- WHAT KIND OF SURFACE THIS IS.
      --
      -- Every rule about what a task owes used to be keyed on the content
      -- TYPE alone — a 'post' needs a designer, a 'post' needs a Reference —
      -- which is true of a post on Instagram and nonsense for the same word on
      -- Telegram. So the board asked a team writing a Telegram announcement
      -- for artwork, a designer and a reference image, and refused to let the
      -- piece move until it got them.
      --
      -- A type says what the piece IS. A format says where it is going, and
      -- the two together decide what it owes. See CHANNEL_FORMATS.
      format TEXT NOT NULL DEFAULT 'social',
      -- The most characters one post may have here: 280 on X, 500 on Threads,
      -- 3000 on LinkedIn. Data, not code, because the platforms change it and
      -- an admin should not need a deploy to follow them. NULL is no limit,
      -- which is what every channel was before this existed. The server
      -- refuses a move to Ready or beyond over it (content.js, tooLong).
      char_limit INTEGER,
      -- Its finished videos go on to TikTok and YouTube Shorts (October 2026):
      -- a video task here shows the two ticks "Also TikTok" and "Also Shorts",
      -- and publishing it makes one repost task per tick (server/reposts.js).
      -- Set for Instagram Main and Instagram Uzb by addRepostChannels; data,
      -- so an admin can switch it on for another channel without a deploy.
      video   INTEGER NOT NULL DEFAULT 0,
      sort    INTEGER NOT NULL DEFAULT 0
    );

    -- content_type binds a metric to a task type (post/reel/story/video):
    -- creating a task of that type raises the plan (target +1), completing it
    -- fills it (current +1). NULL = a manual number (followers, reach, ...).
    CREATE TABLE IF NOT EXISTS trackers (
      id           ${ID},
      department   TEXT    NOT NULL,
      label        TEXT    NOT NULL,
      current      INTEGER NOT NULL DEFAULT 0,
      target       INTEGER NOT NULL DEFAULT 1,
      unit         TEXT    NOT NULL DEFAULT '',
      period       TEXT    NOT NULL DEFAULT 'monthly',
      content_type TEXT,
      is_primary   INTEGER NOT NULL DEFAULT 0,
      sort         INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT    NOT NULL
    );

    -- One snapshot per metric per day → powers the growth comparison.
    CREATE TABLE IF NOT EXISTS metric_history (
      id         ${ID},
      tracker_id INTEGER NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
      date       TEXT    NOT NULL,
      value      INTEGER NOT NULL,
      UNIQUE(tracker_id, date)
    );

    -- The content pipeline stages (editable by the admin).
    CREATE TABLE IF NOT EXISTS statuses (
      id       ${ID},
      label    TEXT NOT NULL,
      color    TEXT NOT NULL DEFAULT '#8b8388',
      sort     INTEGER NOT NULL DEFAULT 0,
      is_final INTEGER NOT NULL DEFAULT 0
    );

    -- The DESIGN pipeline stages, which are deliberately not the content ones.
    --
    -- A designer's piece used to sit in a column called Editing between two
    -- videos they had nothing to do with: the content board's stages describe
    -- a thing being filmed, and artwork is not filmed. The two pipelines now
    -- run side by side on the same task — a post can be on «Editing» for the
    -- channel and «Sent back» for the designer at once, because those are
    -- answers to different questions.
    --
    -- Same shape as statuses so the admin panel, the reorder call and the
    -- delete-with-fallback all read the same way. No is_final: nothing is
    -- gated on reaching the end of this one, which is the whole difference —
    -- the content board's final stage is a wall with the published link on
    -- it, and a design board that refused work would just be in the way.
    CREATE TABLE IF NOT EXISTS design_statuses (
      id       ${ID},
      label    TEXT NOT NULL,
      color    TEXT NOT NULL DEFAULT '#8b8388',
      sort     INTEGER NOT NULL DEFAULT 0
    );

    -- One content task = one card on the board, one pill on both calendars,
    -- one row in the to-do list. A task can live on several channels at once
    -- (channels = JSON array); its type binds it to each channel's plan metric.
    CREATE TABLE IF NOT EXISTS content (
      id             ${ID},
      title          TEXT    NOT NULL,
      channels       TEXT    NOT NULL DEFAULT '[]',
      type           TEXT    NOT NULL DEFAULT 'post',
      assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assignees      TEXT    NOT NULL DEFAULT '[]', -- every assignee; assignee_id mirrors the first
      created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status_id      INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
      recording_date TEXT,
      recording_time TEXT,
      recording_end  TEXT,
      edit_ready_date TEXT,  -- the EDITOR's deadline: the cut must be ready
      design_ready_date TEXT, -- the DESIGNER's deadline: the artwork must be ready
      ready_at       TEXT,   -- when it first reached ready/final — late-work proof
      ready_link     TEXT,   -- the editor's finished cut (the "Edit ready" link)
      shot_link      TEXT,   -- operator's raw footage link (Google Drive)
      design_link    TEXT,   -- designer's finished artwork link
      -- Where the finished piece actually went live. Nothing recorded this:
      -- the board knew a task had reached Published and not one thing about
      -- where to go and look at it, which is also why no report could ever
      -- list what a person had made.
      post_link      TEXT,
      -- WHO IS IN IT. Not who filmed it or cut it — whose face carries the
      -- piece. On a target video that is the whole product, and it is a
      -- different person from the crew often enough that borrowing one of
      -- their fields would have lied about both.
      face_id        INTEGER,
      -- How much of it people sat through, as a percentage that was SKIPPED.
      -- Typed in beside the view count, from the same place, by the same
      -- people. Lower is better, and the pay tiers read it.
      skip_rate      REAL,
      skip_rate_at   TEXT,
      -- The month this piece was PAID in, stamped when an admin closes a
      -- month. "Paid" is a fact somebody recorded, not something worked out
      -- from the calendar — a month that has not been closed is not paid, and
      -- the register says so rather than guessing.
      paid_month     TEXT,
      paid_at        TEXT,
      paid_by        INTEGER,
      reference_text TEXT,   -- style / mood / length / format notes for the crew
      reference_links TEXT   NOT NULL DEFAULT '[]', -- example URLs (reference videos/posts)
      -- The reference PICTURES, as [{ photo, thumb }] — a brief is rarely one
      -- screenshot. The photo/photo_thumb pair below stays the FIRST of these
      -- and is kept in step with element 0, because the board asks "is there a
      -- reference at all" in a dozen places (the shoot gate, the card's
      -- has_photo flag) and none of them should have to learn about arrays.
      reference_photos TEXT  NOT NULL DEFAULT '[]',
      format         TEXT,   -- the shape of the piece: talking head, split screen…
      rubrika        TEXT,   -- the recurring column (rubric) it belongs to
      script         TEXT,   -- the written script / shot plan
      tz             TEXT,   -- техническое задание: what the EDITOR is told to make. The script is what gets filmed; the ТЗ is what gets cut.
      script_key     TEXT,   -- fingerprint of the above, so "is this script already on another task" is a lookup rather than a scan
      release_date   TEXT,
      release_time   TEXT,
      description    TEXT    NOT NULL DEFAULT '',
      photo          TEXT,
      operator_id    INTEGER,
      editor_id      INTEGER,
      designer_id    INTEGER, -- posts are designed, not shot: one designer hat
      -- Where this sits on the DESIGN board. Null means nobody has put it on
      -- one yet, which the board reads as its first stage rather than as a
      -- card that does not exist — work arrives by being handed to a designer,
      -- not by someone remembering to file it.
      design_status_id INTEGER,
      reviewer_id    INTEGER, -- the review owner: answers for a late review
      reviewers      TEXT    NOT NULL DEFAULT '[]', -- review can be shared; reviewer_id mirrors the first
      faces          TEXT    NOT NULL DEFAULT '[]', -- a target creative can carry several brand faces; face_id mirrors the first
      -- The handover clocks. Each stage's owner is judged from the moment the
      -- work actually reached them to the moment they passed it on, so a stage
      -- that was handed over late never reads as its owner's fault.
      shot_at        TEXT,   -- entered Editing: the shooter's part is done
      edited_at      TEXT,   -- entered Ready: the editor's part is done
      -- ---- the time the crew agreed to ----
      -- A shoot day is not a fact until the person holding the camera has
      -- said they can be there, and an edit deadline is not a deadline until
      -- the editor has said it fits. Both are booked by the planner and
      -- ANSWERED by the crew: '' while it is waiting, 'yes' once accepted,
      -- 'no' with a reason when they cannot. An accepted time is then locked
      -- — the planner cannot quietly move a slot somebody has already cleared
      -- their afternoon for; changing it puts the question back and tells
      -- them.
      shoot_ack      TEXT    NOT NULL DEFAULT '',
      shoot_ack_at   TEXT,
      shoot_ack_by   INTEGER,
      shoot_ack_note TEXT,
      edit_ack       TEXT    NOT NULL DEFAULT '',
      edit_ack_at    TEXT,
      edit_ack_by    INTEGER,
      edit_ack_note  TEXT,
      -- When a handover lands late the mover must re-promise the next stage's
      -- date. The original stays untouched, so the pair shows what was planned
      -- and what the delay forced.
      edit_due_revised   TEXT,
      review_due_revised TEXT,
      checklist      TEXT    NOT NULL DEFAULT '[]',
      todo_sort      INTEGER NOT NULL DEFAULT 0,
      pinned         INTEGER NOT NULL DEFAULT 0,
      photo_thumb    TEXT,
      done_at        TEXT,
      -- Whose miss was it, when the board cannot work it out and a person
      -- decides instead. Null means "read it from the work" (deadlines.js).
      miss_blame     TEXT,
      miss_blame_note TEXT,
      miss_blame_by  INTEGER,
      -- What it actually got. NULL is not zero: it means nobody has written a
      -- number down yet, and a board that cannot tell those apart reports a
      -- month of unmeasured work as a month of no views.
      views          INTEGER,
      views_at       TEXT,
      views_by       INTEGER,
      -- The reviewer's yes on the delivered cut (Pravka 2.0). NULL means
      -- nobody has said it; the third delivery needs nobody to, because the
      -- pravka limit approves it as it stands.
      approved_at    TEXT,
      approved_by    INTEGER,
      approved_name  TEXT    NOT NULL DEFAULT '',
      -- What a piece on a WRITTEN channel is, for the copywriter's per-item
      -- rates: just_post | post_plus | webinar. NULL anywhere else — the
      -- server clears it when a task stops going to a text channel.
      telegram_type  TEXT,
      -- A guiding (teaching) post earns its bonus on top of the base rate;
      -- it never replaces it. 0 off a written channel, always.
      is_guiding     INTEGER NOT NULL DEFAULT 0,
      -- A post on a short written channel (X, Threads, LinkedIn — format
      -- 'short') that carries a video or a picture. Off, nobody films or
      -- designs it: it is typed and goes out. On, the channel's format stops
      -- taking the crew off the table and the admin's crew rules for its type
      -- decide, exactly as on Instagram (channelFormatsFor). One switch, no
      -- new rule.
      with_media     INTEGER NOT NULL DEFAULT 0,
      -- Where else this video goes once it is published: the keys of the
      -- repost channels ticked in the task window ("Also TikTok", "Also
      -- Shorts"), as JSON. Read when the piece is published, never after —
      -- the server refuses a change to it once it is out (server/reposts.js).
      repost_to      TEXT    NOT NULL DEFAULT '[]',
      created_at     TEXT    NOT NULL
    );

    -- Campaign plan (admin): overview table, month calendar, project list.
    CREATE TABLE IF NOT EXISTS campaigns (
      id       ${ID},
      name     TEXT NOT NULL,
      timing   TEXT NOT NULL DEFAULT '',
      channel  TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT '',
      goal     TEXT NOT NULL DEFAULT '',
      notes    TEXT NOT NULL DEFAULT '',
      duration TEXT NOT NULL DEFAULT 'short',  -- short | long
      owner    TEXT NOT NULL DEFAULT '',
      status   TEXT NOT NULL DEFAULT '',
      ongoing  INTEGER NOT NULL DEFAULT 0,
      months   TEXT NOT NULL DEFAULT '[]',     -- ["2026-07", ...]
      checklist TEXT NOT NULL DEFAULT '[]',    -- [{"text","done"}, ...]
      sort     INTEGER NOT NULL DEFAULT 0
    );

    -- Whiteboards (org structure, planning): cards can be bound to a team
    -- member and linked into a hierarchy; data = {"nodes":[],"edges":[]}.
    CREATE TABLE IF NOT EXISTS boards (
      id         ${ID},
      name       TEXT NOT NULL,
      data       TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      created_by INTEGER,
      updated_at TEXT NOT NULL
    );

    -- Projects: permanent areas of the business with one owner. No start or
    -- end date — a project that needs dates is a campaign. Checklist items:
    -- [{text, owner_id, due, done, done_at}].
    CREATE TABLE IF NOT EXISTS projects (
      id            ${ID},
      name          TEXT NOT NULL,
      owner_id      INTEGER,
      metric        TEXT NOT NULL DEFAULT '',
      target        REAL NOT NULL DEFAULT 0,
      actual        REAL NOT NULL DEFAULT 0,
      start_date    TEXT,                            -- a project is a stretch, not a due date
      deadline      TEXT,
      status        TEXT NOT NULL DEFAULT 'on_track', -- on_track | at_risk | off_track | done | closed
      status_reason TEXT NOT NULL DEFAULT '',        -- why, when at risk or off track
      description   TEXT NOT NULL DEFAULT '',
      success       TEXT NOT NULL DEFAULT '',        -- LEGACY: migrated into criteria
      numbers       TEXT NOT NULL DEFAULT '[]',      -- [{name,current,target,updated_at,updated_by}]
      criteria      TEXT NOT NULL DEFAULT '[]',      -- [{text,done}] — what must be TRUE at the end
      budget        REAL,
      checklist     TEXT NOT NULL DEFAULT '[]',
      photo         TEXT,
      photo_thumb   TEXT,
      last_activity TEXT,
      created_at    TEXT NOT NULL
    );

    -- Dated free-text notes on projects and campaigns. Author and date are
    -- automatic; notes count as project activity.
    CREATE TABLE IF NOT EXISTS notes (
      id         ${ID},
      kind       TEXT    NOT NULL,   -- 'project' | 'campaign'
      ref_id     INTEGER NOT NULL,
      author_id  INTEGER,
      text       TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );

    -- Personal tasks: each account's private checklist in To-Do. Never shown
    -- to anyone else and never part of channel boards, calendars or plans.
    CREATE TABLE IF NOT EXISTS personal_tasks (
      id         ${ID},
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      note       TEXT    NOT NULL DEFAULT '',
      due_date   TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      sort       INTEGER NOT NULL DEFAULT 0,
      done_at    TEXT,
      created_at TEXT    NOT NULL
    );

    -- Launch programs (built for the Target team's ad launches): a named run
    -- with dates and a hand-set state — planned, running, halted, finished.
    -- Shown as a Gantt on the channel dashboard ('programs' widget).
    CREATE TABLE IF NOT EXISTS programs (
      id         ${ID},
      channel    TEXT    NOT NULL,
      name       TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'planned',
      platform   TEXT    NOT NULL DEFAULT 'both',
      branches   TEXT    NOT NULL DEFAULT '[]',
      start_date TEXT,
      end_date   TEXT,
      budget     REAL,
      note       TEXT    NOT NULL DEFAULT '',
      checklist  TEXT    NOT NULL DEFAULT '[]',
      creatives  TEXT    NOT NULL DEFAULT '[]',
      created_at TEXT    NOT NULL
    );

    -- Hiring needs: the positions the team still has to fill.
    CREATE TABLE IF NOT EXISTS hiring (
      id         ${ID},
      title      TEXT    NOT NULL,
      note       TEXT    NOT NULL DEFAULT '',
      priority   INTEGER NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'open',
      created_at TEXT    NOT NULL
    );

    -- Candidates: the people we're considering for those positions.
    CREATE TABLE IF NOT EXISTS candidates (
      id         ${ID},
      name       TEXT    NOT NULL,
      contacts   TEXT    NOT NULL DEFAULT '',
      position   TEXT    NOT NULL DEFAULT '',
      salary     TEXT    NOT NULL DEFAULT '',
      portfolio  TEXT    NOT NULL DEFAULT '',
      experience TEXT    NOT NULL DEFAULT '',
      notes      TEXT    NOT NULL DEFAULT '',
      stage      TEXT    NOT NULL DEFAULT 'new',
      created_at TEXT    NOT NULL
    );

    -- Per-person paperwork: SOPs, responsibility sheets and other documents
    -- shared between the company and one member. Files ride as data URLs;
    -- lists never carry the bytes (see routes/docs.js).
    CREATE TABLE IF NOT EXISTS person_docs (
      id          ${ID},
      user_id     INTEGER NOT NULL,
      kind        TEXT    NOT NULL DEFAULT 'sop',
      title       TEXT    NOT NULL,
      file_name   TEXT    NOT NULL,
      mime        TEXT    NOT NULL DEFAULT 'application/pdf',
      data        TEXT    NOT NULL,
      size        INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    -- Per-person KPIs, managed in one place: target, current standing, and
    -- who last touched it when.
    CREATE TABLE IF NOT EXISTS person_kpis (
      id         ${ID},
      user_id    INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      target     TEXT    NOT NULL DEFAULT '',
      current    TEXT    NOT NULL DEFAULT '',
      unit       TEXT    NOT NULL DEFAULT '',
      notes      TEXT    NOT NULL DEFAULT '',
      sort       INTEGER NOT NULL DEFAULT 0,
      -- What the board itself can count for this KPI, so 'current' stops
      -- being a number somebody retypes once a month and starts being the
      -- work. Empty means the old behaviour: an admin types it.
      source     TEXT    NOT NULL DEFAULT '',
      -- Which way the target points. 'atleast' for "twenty cuts"; 'atmost'
      -- for "no more than two late", where beating the target means a
      -- SMALLER number and the naive comparison pays exactly the wrong people.
      direction  TEXT    NOT NULL DEFAULT 'atleast',
      -- What hitting it is worth. This is the join the board was missing:
      -- the KPIs were already here, and payroll was worked out somewhere else
      -- from the same numbers, by hand.
      reward     REAL    NOT NULL DEFAULT 0,
      updated_by INTEGER,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    -- ============================================================
    -- SPRINTS. A weekly board that shares exactly one thing with the rest
    -- of this platform: it READS the users table for id, name and avatar.
    -- It never writes there, never reads content, channels, releases or
    -- anything else, and nothing outside these tables reads from it.
    -- Every table is prefixed sprint_ so that isolation is visible rather
    -- than merely intended.
    -- ============================================================

    -- One row per week. Monday 00:00 to Saturday 12:00 Tashkent, with the
    -- meeting at 15:00 that Saturday. Times are stored as ISO instants, the
    -- same as every other timestamp here — the Tashkent-ness lives in how
    -- they are worked out, not in how they are written down.
    /* Who came, and when.
       Nobody is late by default: a day with no row here says nothing at all,
       which is the honest reading of "nobody wrote anything down". Only an
       admin writes rows, and the register only ever says what one of them
       said. One row per person per day. */
    CREATE TABLE IF NOT EXISTS attendance (
      id          ${ID},
      user_id     INTEGER NOT NULL,
      day         TEXT    NOT NULL,          -- a Tashkent day, YYYY-MM-DD
      status      TEXT    NOT NULL,          -- on_time | late | away
      arrived_at  TEXT,                      -- HH:MM, only meaningful when late
      note        TEXT    NOT NULL DEFAULT '',
      marked_by   INTEGER,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sprints (
      id         ${ID},
      code       TEXT    NOT NULL,                  -- 'S36', the ISO week
      start_at   TEXT    NOT NULL,
      freeze_at  TEXT    NOT NULL,
      meeting_at TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'active', -- active | closed
      created_at TEXT    NOT NULL
    );

    -- Who may close a sprint, edit after the freeze, and promote from the
    -- backlog. Those three things and nothing else. It ships EMPTY and is
    -- filled by hand after deploy: the platform Admin flag is deliberately
    -- not inherited, so an admin who is not in here works under the same
    -- freeze as everybody else.
    CREATE TABLE IF NOT EXISTS sprint_owners (
      user_id INTEGER NOT NULL
    );

    -- A task exists once, however many weeks it runs for. What week it
    -- belongs to lives in sprint_task_sprints; what was committed FOR that
    -- week lives in sprint_checklist_items. A backlog item is a row here
    -- with status 'idea' and no sprint row at all.
    --
    -- There is no not_delivered status. Not delivered is an outcome of a
    -- task in a WEEK, not a state of the task.
    CREATE TABLE IF NOT EXISTS sprint_tasks (
      id                   ${ID},
      title                TEXT    NOT NULL,
      description          TEXT    NOT NULL DEFAULT '',
      status               TEXT    NOT NULL DEFAULT 'idea', -- idea|todo|in_progress|blocked|done
      is_growth            INTEGER NOT NULL DEFAULT 0,
      deadline             TEXT,
      result_type          TEXT,                            -- link|file|text|NULL
      result_link          TEXT    NOT NULL DEFAULT '',
      result_text          TEXT    NOT NULL DEFAULT '',
      result_attachment_id INTEGER,
      blocker_reason       TEXT    NOT NULL DEFAULT '',
      blocker_note         TEXT    NOT NULL DEFAULT '',
      carried_count        INTEGER NOT NULL DEFAULT 0,
      -- Dropped, not deleted. A week's record that changes after the week is
      -- over is not a record: deleting a task used to take it out of
      -- sprint_task_sprints, and /history counts that table live, so a closed
      -- week quietly went from twelve tasks to eleven. A dropped task leaves
      -- the board and stays in the count.
      dropped_at           TEXT,
      dropped_by           INTEGER,
      dropped_reason       TEXT    NOT NULL DEFAULT '',
      -- WHICH week dropped it. A task can run for three weeks before somebody
      -- gives up on it, and without this the drop was a fact about the task
      -- rather than about a week: all three read "1 dropped", including the
      -- two that carried it and worked on it.
      dropped_sprint_id    INTEGER,
      created_by           INTEGER,
      created_at           TEXT    NOT NULL,
      updated_at           TEXT    NOT NULL
    );

    -- What was changed after the fact, and by whom. The content side has had
    -- this since round 36; the sprint board had nothing at all, so a moved
    -- deadline or an un-ticked result left no trace to read back on Saturday.
    -- Titles are written down at the moment of the change so the line still
    -- reads like a sentence if the task is later dropped.
    CREATE TABLE IF NOT EXISTS sprint_activity (
      id          ${ID},
      task_id     INTEGER NOT NULL,
      task_title  TEXT    NOT NULL DEFAULT '',
      sprint_id   INTEGER,
      user_id     INTEGER,
      user_name   TEXT    NOT NULL DEFAULT '',
      kind        TEXT    NOT NULL,           -- deadline|status|dropped|restored
      old_value   TEXT,
      new_value   TEXT,
      note        TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL
    );

    -- Assignees are read from the platform users table and stored by id.
    -- Removing somebody from the platform is not this module's business;
    -- their name simply stops resolving and the task keeps the id.
    CREATE TABLE IF NOT EXISTS sprint_task_assignees (
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL
    );

    -- One row per task per week it appears in. This is what lets a task
    -- span several weeks, and it is where the verdict for that week lives.
    CREATE TABLE IF NOT EXISTS sprint_task_sprints (
      task_id   INTEGER NOT NULL,
      sprint_id INTEGER NOT NULL,
      outcome   TEXT                                -- delivered|not_delivered|NULL
    );

    -- The weekly slice. A task running three weeks has three separate
    -- groups of items, so opening a sprint shows what was committed for
    -- THAT week and not the whole history. Nothing here is scored or
    -- weighted; there are no points anywhere in this module.
    CREATE TABLE IF NOT EXISTS sprint_checklist_items (
      id        ${ID},
      task_id   INTEGER NOT NULL,
      sprint_id INTEGER NOT NULL,
      text      TEXT    NOT NULL,
      done      INTEGER NOT NULL DEFAULT 0,
      done_at   TEXT,
      position  INTEGER NOT NULL DEFAULT 0
    );

    -- Same shape as the platform's own attachments: the bytes live in the
    -- row as a data URI, because this deployment has no file storage and no
    -- CDN. Capped at 5 MB before encoding, refused by the route.
    CREATE TABLE IF NOT EXISTS sprint_attachments (
      id          ${ID},
      task_id     INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      mime        TEXT    NOT NULL DEFAULT '',
      size        INTEGER NOT NULL DEFAULT 0,       -- bytes of the original file
      data        TEXT    NOT NULL,                 -- data:<mime>;base64,…
      uploaded_by INTEGER,
      created_at  TEXT    NOT NULL
    );

    -- ---- the ambassador programme -------------------------------------------
    -- Students who post about SATashkent on their own accounts. This feature
    -- owns exactly these three tables and reads nothing else but the users
    -- table. Ambassador cards are NOT content tasks, never reach a channel board, are
    -- not counted in any company total, and their payouts are not Finance.
    -- Delete these three tables and the rest of the dashboard is unchanged.
    CREATE TABLE IF NOT EXISTS ambassadors (
      id                   ${ID},
      user_id              INTEGER NOT NULL,   -- the only key out of this feature
      university           TEXT    NOT NULL DEFAULT '',
      telegram             TEXT    NOT NULL DEFAULT '',
      -- The contract, as the admin uploaded it. Stored beside the row the way
      -- person_docs does: a data URL, its name and its type.
      contract_name        TEXT    NOT NULL DEFAULT '',
      contract_mime        TEXT    NOT NULL DEFAULT '',
      contract_data        TEXT,
      contract_size        INTEGER NOT NULL DEFAULT 0,
      contract_at          TEXT,
      -- What their terms USUALLY are. These pre-tick the boxes at approval and
      -- have no other power: once a card is approved it carries its own copy,
      -- and changing these can never reach back into it.
      default_we_edit      INTEGER NOT NULL DEFAULT 0,
      default_posts_own    INTEGER NOT NULL DEFAULT 1,
      default_collaborator INTEGER NOT NULL DEFAULT 0,
      -- Three boxes cannot describe every arrangement anybody ever agrees to.
      -- This is the one that says what was actually agreed, in words.
      default_terms_other  TEXT    NOT NULL DEFAULT '',
      status               TEXT    NOT NULL DEFAULT 'active',  -- active|paused|ended
      created_at           TEXT    NOT NULL,
      updated_at           TEXT    NOT NULL
    );

    -- One idea, from the moment it is sent to the moment it is paid.
    --
    -- A rejected card is not a new row: version goes up and the state returns
    -- to waiting, so the whole argument stays on one card. The four terms are
    -- COPIED here at approval and are read only afterwards — that is the
    -- promise the ambassador was given, and nothing later may edit it.
    CREATE TABLE IF NOT EXISTS ambassador_cards (
      id             ${ID},
      ambassador_id  INTEGER NOT NULL,
      format         TEXT    NOT NULL DEFAULT '',
      script         TEXT    NOT NULL DEFAULT '',
      reference_url  TEXT    NOT NULL DEFAULT '',
      planned_date   TEXT,
      -- waiting|needs_changes|can_film|review|reshoot|to_post|posted|done|paid
      state          TEXT    NOT NULL DEFAULT 'waiting',
      -- The VIDEO, before anybody posts anything. Separate from main_video_url,
      -- which is where the thing ended up once it was live — the two were one
      -- column, which is how a video nobody had approved could only be reported
      -- by claiming it was already public.
      video_url      TEXT    NOT NULL DEFAULT '',
      video_ok_at    TEXT,
      video_ok_by    INTEGER,
      -- 'them' | 'us' — decided when the video is approved, not before. Some
      -- deals the ambassador posts and tags us, some we post it ourselves, and
      -- which one it is can change after the video exists.
      who_posts      TEXT    NOT NULL DEFAULT '',
      version        INTEGER NOT NULL DEFAULT 1,
      we_edit        INTEGER NOT NULL DEFAULT 0,
      posts_own      INTEGER NOT NULL DEFAULT 0,
      collaborator   INTEGER NOT NULL DEFAULT 0,
      terms_other    TEXT    NOT NULL DEFAULT '',  -- whatever the three boxes cannot say
      posted_at      TEXT,                          -- when they said it was live
      amount         INTEGER,                             -- typed by a human, every time
      approved_by    INTEGER,
      approved_at    TEXT,
      feedback       TEXT    NOT NULL DEFAULT '',
      main_video_url TEXT    NOT NULL DEFAULT '',
      story_clip_url TEXT    NOT NULL DEFAULT '',
      checked_by     INTEGER,
      checked_at     TEXT,
      paid_month     TEXT,                                -- the month it reached done
      -- The editing task an admin made from this video (the Ambassadors
      -- calendar, October 2026). A link and nothing more: whether the video
      -- is with an editor or out is read off that task, so there is no second
      -- state to keep in step. Negative while the task is being made (the
      -- press's claim); a task that no longer exists (an undo) leaves the
      -- video new again.
      task_id        INTEGER,
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL
    );

    -- Every submission and every answer to one, kept.
    --
    -- Without this a card held one link and one comment, each overwritten by
    -- the next: a second video looked exactly like the first, a rejection
    -- disappeared the moment it was acted on, and "he says he sent it again"
    -- could not be settled by anyone. An argument about work needs the work's
    -- history, not its latest state.
    CREATE TABLE IF NOT EXISTS ambassador_card_events (
      id         ${ID},
      card_id    INTEGER NOT NULL,
      kind       TEXT    NOT NULL,   -- video | post | sent_back | approved | script
      by_id      INTEGER,            -- null when the ambassador did it
      text       TEXT    NOT NULL DEFAULT '',
      url        TEXT    NOT NULL DEFAULT '',
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL
    );

    -- A month, closed. Paying happens outside this system; this records that
    -- somebody said it had been done, and who.
    CREATE TABLE IF NOT EXISTS ambassador_payouts (
      id            ${ID},
      month         TEXT    NOT NULL,
      ambassador_id INTEGER NOT NULL,
      total         INTEGER NOT NULL DEFAULT 0,
      marked_by     INTEGER,
      marked_at     TEXT    NOT NULL
    );

    -- ---- the people board: what a month was like, per person -------------
    --
    -- A month of somebody's work is remembered by whoever watched it, and
    -- three months later nobody can say whether the thing that went wrong in
    -- September was the first time or the fourth. A review written from
    -- memory is a review of the last fortnight. This is the written record
    -- those conversations are supposed to start from.
    --
    -- It is deliberately NOT on the person's profile. These are notes ABOUT
    -- somebody, written by whoever runs the team, and a note that its subject
    -- can read is a note that gets written carefully rather than honestly.
    -- Only a superadmin reads this board — see the column of that name on
    -- users, and superadminOnly in server/auth.js.
    CREATE TABLE IF NOT EXISTS person_notes (
      id         ${ID},
      about_id   INTEGER NOT NULL,   -- who it is about
      month      TEXT    NOT NULL,   -- 'YYYY-MM'; the month being described
      body       TEXT    NOT NULL,
      author_id  INTEGER NOT NULL,
      created_at TEXT    NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_person_notes_about ON person_notes(about_id, month);

    -- Every version a note has ever had, one row per replacement.
    --
    -- A note that can be edited without trace is a note that can be rewritten
    -- after the fact, and a record of somebody's year that can be quietly
    -- rewritten is worth nothing in the conversation it exists for. The
    -- author may fix their words; they may not make the earlier ones
    -- disappear.
    CREATE TABLE IF NOT EXISTS person_note_versions (
      id       ${ID},
      note_id  INTEGER NOT NULL,
      body     TEXT    NOT NULL,   -- what it said BEFORE this edit
      saved_at TEXT    NOT NULL,   -- when it was replaced
      saved_by INTEGER NOT NULL    -- who replaced it
    );
    CREATE INDEX IF NOT EXISTS idx_person_note_versions ON person_note_versions(note_id);

    -- Translations and plain-language versions, kept.
    --
    -- The same brief is opened by the shooter, the editor and whoever is
    -- checking on them, and it does not change between openings. Translating
    -- it once is the difference between a feature that costs money every time
    -- somebody reads a task and one that costs money once. The key is a hash
    -- of the job and the exact text, so an edited brief simply misses and is
    -- done again.
    CREATE TABLE IF NOT EXISTS ai_cache (
      k          TEXT PRIMARY KEY,   -- sha256(kind|target|text)
      kind       TEXT NOT NULL,      -- 't' to translate, 's:<lang>' to simplify
      target     TEXT NOT NULL,
      out        TEXT NOT NULL,
      provider   TEXT NOT NULL,      -- who produced it, shown to the reader
      created_at TEXT NOT NULL
    );

    -- What people are paid, and on what.
    --
    -- The rates are DATA, not code: they differ per person, they change, and
    -- baking a wage into a git repository turns a pay rise into a deploy. One
    -- row with a NULL user_id is the default card everybody starts from; a row
    -- with a user_id overrides it for that person. Everything is per period:
    -- the base per month, the rest per piece delivered. The arithmetic lives
    -- in server/routes/reports.js.
    -- ---- the KPI card: one person, one month, a set of ladders ------------
    -- Every KPI sheet this team runs on has the same shape and no two of them
    -- have the same contents: a metric, five bands from A+ to D, and what each
    -- band pays. Skip rate for the person who films and cuts, quality leads
    -- for the commercial manager, channel growth and forwards for the
    -- copywriter, deadline misses and plan shipped for operations. Some are
    -- gated: a bonus that pays nothing at all until a floor is cleared.
    --
    -- So the board stores the SHAPE and not the numbers. A card is a month, a
    -- fixed salary and a list of ladders; the amounts are the admin's, set in
    -- the last five days of the month the way the sheets say, and none of them
    -- is written into this code.
    --
    -- A metric is either one the board already measures — how many pieces were
    -- late, what the skip rate averaged, how many views the month got — or one
    -- nobody here can see, like leads or forwards, which is typed in for the
    -- month. Both end up in the same ladder and are read the same way.
    CREATE TABLE IF NOT EXISTS kpi_cards (
      id          ${ID},
      user_id     INTEGER NOT NULL,
      month       TEXT    NOT NULL,           -- 'YYYY-MM'
      currency    TEXT    NOT NULL DEFAULT 'UZS',
      fixed       REAL    NOT NULL DEFAULT 0, -- the salary floor, paid whatever the grades
      ladders     TEXT    NOT NULL DEFAULT '[]',
      readings    TEXT    NOT NULL DEFAULT '{}', -- hand-entered values, per ladder key
      note        TEXT    NOT NULL DEFAULT '',
      updated_by  INTEGER,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL,
      UNIQUE (user_id, month)
    );

    CREATE TABLE IF NOT EXISTS pay_rules (
      id            ${ID},
      user_id       INTEGER,                       -- NULL = the default card
      currency      TEXT    NOT NULL DEFAULT 'UZS',
      base          REAL    NOT NULL DEFAULT 0,    -- paid whatever the count
      per_shoot     REAL    NOT NULL DEFAULT 0,
      per_edit      REAL    NOT NULL DEFAULT 0,
      per_design    REAL    NOT NULL DEFAULT 0,
      per_publish   REAL    NOT NULL DEFAULT 0,
      per_review    REAL    NOT NULL DEFAULT 0,
      quota         REAL    NOT NULL DEFAULT 0,    -- pieces expected in the period
      quota_bonus   REAL    NOT NULL DEFAULT 0,    -- paid whole when the quota is met
      ontime_bonus  REAL    NOT NULL DEFAULT 0,    -- paid whole, or not at all
      ontime_target REAL    NOT NULL DEFAULT 90,   -- the per cent that earns it
      late_penalty  REAL    NOT NULL DEFAULT 0,    -- per piece delivered late
      per_1k_views  REAL    NOT NULL DEFAULT 0,    -- paid per thousand views the maker's pieces got
      views_target  REAL    NOT NULL DEFAULT 0,    -- views expected in the period
      views_bonus   REAL    NOT NULL DEFAULT 0,    -- paid whole when the views target is met
      -- Shooting and editing, priced by what the piece IS. A YouTube video is
      -- a day's shoot and a week's cut; a reel is an afternoon. Left at 0 the
      -- flat per_shoot / per_edit above still stands, so a board that has not
      -- set them is unaffected and can adopt them one kind at a time.
      per_shoot_reel    REAL NOT NULL DEFAULT 0,
      per_edit_reel     REAL NOT NULL DEFAULT 0,
      per_shoot_youtube REAL NOT NULL DEFAULT 0,
      per_edit_youtube  REAL NOT NULL DEFAULT 0,
      per_shoot_target  REAL NOT NULL DEFAULT 0,
      per_edit_target   REAL NOT NULL DEFAULT 0,
      -- Being IN the piece is a job too. A target video is shot by one person
      -- and carried by another standing in front of the camera, and the board
      -- has recorded who that was since the day it had a face field without
      -- ever paying them for it.
      per_face          REAL NOT NULL DEFAULT 0,
      per_face_reel     REAL NOT NULL DEFAULT 0,
      per_face_youtube  REAL NOT NULL DEFAULT 0,
      per_face_target   REAL NOT NULL DEFAULT 0,
      -- ---- what a piece is worth, by what kind of piece it is --------------
      -- The maker's side of the card, and the one place a flat per-piece rate
      -- was always going to be wrong: a post that half the city read and a
      -- post nobody opened were the same money. So each kind of piece carries
      -- its own rule —
      --
      --   { post: { flat, gate, per_1k }, reel: {…}, youtube: {…}, target: {…} }
      --
      --   flat    what the piece pays when it does not clear the gate
      --   gate    the views it has to reach to be paid by the thousand
      --   per_1k  what a thousand views is worth once it has
      --
      -- Over the gate the thousands are the WHOLE payment for that piece —
      -- 15 700 views at 1 000 a thousand is 15 700, not 15 700 plus the flat
      -- and not 5 700 for the part above the gate. Under it, the flat and
      -- nothing else. A kind with no rule here is paid exactly as it was
      -- before any of this existed, which is what lets a board adopt it one
      -- kind at a time. JSON rather than three more columns per kind: the
      -- next kind this team wants to price apart should not need a migration.
      kind_rules  TEXT NOT NULL DEFAULT '{}',
      -- A card this shape belongs to a ROLE rather than a person: every
      -- editor is paid the editor card unless somebody has been given one of
      -- their own. user_id is NULL on these, as it is on the board-wide
      -- default, and the role column is what tells the two apart.
      role  TEXT,
      -- HOW this person is paid, as opposed to at what rates. See PAY_SCHEMES.
      -- Everybody was on piecework before this existed, so that is the default
      -- and an existing board's numbers do not move.
      scheme  TEXT NOT NULL DEFAULT 'piece',
      -- The safety pillow: the month cannot come to less than this.
      --
      -- Work FILLS it. A month where the company could not hand over enough
      -- to do is still paid the pillow in full; a month where somebody did
      -- more than it holds is paid for what they did, the pillow having been
      -- filled on the way past. It is a floor under the month, never a bonus
      -- on top of one — max(pillow, earned), which is the whole of the rule.
      pillow  REAL NOT NULL DEFAULT 0,
      updated_by    INTEGER,
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL
    );

    -- What was actually paid, and when.
    --
    -- Everything above this line is a CALCULATOR: it reads the month off the
    -- board and works out what the month is worth. It has never been able to
    -- answer the only question anybody asks out loud — "was I paid for
    -- August?" — because nothing recorded that the money went out, and the
    -- figure re-derived itself for ever. Edit a task from August in October
    -- and August's payslip quietly changed.
    --
    -- So closing a month FREEZES it. The figures as they stood are written
    -- down whole, and from then on the month is read from this row rather
    -- than recomputed. Re-opening it deletes the row and the calculator takes
    -- over again, which is the only honest way back.
    CREATE TABLE IF NOT EXISTS payouts (
      id         ${ID},
      user_id    INTEGER NOT NULL,
      month      TEXT    NOT NULL,                 -- 'YYYY-MM'
      currency   TEXT    NOT NULL DEFAULT 'UZS',
      total      REAL    NOT NULL DEFAULT 0,
      breakdown  TEXT    NOT NULL DEFAULT '{}',    -- the figures as they stood
      note       TEXT    NOT NULL DEFAULT '',
      paid_at    TEXT,                             -- the day the money went out
      marked_by  INTEGER,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL,
      UNIQUE (user_id, month)
    );

    -- ---- the two places a person may disagree with the calculator ----------
    --
    -- Everything above works the month out from the board, which is right
    -- nearly always and wrong in the ways real months are wrong: a job that
    -- took three days because the client changed their mind twice, an advance
    -- paid in cash mid-month, a fine everybody agreed to, a piece whose rate
    -- nobody had set when it went out. A calculator with no way to say any of
    -- that gets overruled in a spreadsheet nobody else can see, and then the
    -- board's numbers are decoration.
    --
    -- So: one row per hand-made change, each with a reason and a name on it,
    -- and the calculated figure kept beside the new one rather than replaced.
    CREATE TABLE IF NOT EXISTS pay_overrides (
      id         ${ID},
      user_id    INTEGER NOT NULL,
      content_id INTEGER NOT NULL,
      hat        TEXT    NOT NULL,            -- which job on that piece
      month      TEXT    NOT NULL,            -- 'YYYY-MM', the month it lands in
      amount     REAL    NOT NULL DEFAULT 0,  -- what it pays instead
      was        REAL    NOT NULL DEFAULT 0,  -- what the calculator said
      note       TEXT    NOT NULL DEFAULT '',
      created_by INTEGER,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL,
      UNIQUE (user_id, content_id, hat)
    );

    -- A line on the month that belongs to no piece: a bonus, a fine, an
    -- advance already handed over, a correction to a month that closed wrong.
    CREATE TABLE IF NOT EXISTS pay_adjustments (
      id         ${ID},
      user_id    INTEGER NOT NULL,
      month      TEXT    NOT NULL,            -- 'YYYY-MM'
      kind       TEXT    NOT NULL DEFAULT 'bonus', -- bonus | fine | advance | correction
      label      TEXT    NOT NULL DEFAULT '',
      amount     REAL    NOT NULL DEFAULT 0,  -- signed: a fine is negative
      note       TEXT    NOT NULL DEFAULT '',
      created_by INTEGER,
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    -- Raising a hand. The crew could always deliver late; they had no way to
    -- say so in advance, so the first anybody knew was the deadline passing.
    -- A flag is the cheap early word: "I cannot take this" or "this will be
    -- late", with the reason, sitting on the task where the plan is made
    -- instead of in a voice note somebody has to remember.
    CREATE TABLE IF NOT EXISTS task_flags (
      id          ${ID},
      content_id  INTEGER NOT NULL,
      kind        TEXT    NOT NULL DEFAULT 'at_risk',   -- at_risk | cant_take
      reason      TEXT    NOT NULL DEFAULT '',
      raised_by   INTEGER,
      raised_name TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL,
      cleared_at  TEXT,
      cleared_by  INTEGER,
      cleared_name TEXT   NOT NULL DEFAULT ''
    );

    -- Voice notes. A Pravki that takes four minutes to type takes fifteen
    -- seconds to say, and half of what a reviewer means is in the tone. The
    -- BYTES live here rather than on the comment, so no list, poll or task
    -- payload ever drags a minute of audio along — the clip is fetched by the
    -- press that plays it, exactly like a document.
    CREATE TABLE IF NOT EXISTS voice_notes (
      id         ${ID},
      content_id INTEGER NOT NULL,
      user_id    INTEGER,
      author     TEXT    NOT NULL DEFAULT '',
      mime       TEXT    NOT NULL DEFAULT 'audio/webm',
      secs       INTEGER NOT NULL DEFAULT 0,
      size       INTEGER NOT NULL DEFAULT 0,
      data       TEXT    NOT NULL,            -- data:<mime>;base64,…
      created_at TEXT    NOT NULL
    );

    -- What a pravka points at: the screenshots pasted into it and the files
    -- dropped on it. The note carries a Markdown link to each one, and the
    -- bytes live here — away from the revision row, like a voice note — so a
    -- task's history never drags its pictures along until they are drawn.
    -- A task's reference photos and videos. Only what they are lives here:
    -- a photo's bytes are a file under MEDIA_DIR (file), a video is in the
    -- task's Google Drive folder (link). Up to twenty a task, old album
    -- included; whoever works on the task adds, and whoever added one — or
    -- plans the channel — removes it.
    CREATE TABLE IF NOT EXISTS reference_media (
      id          ${ID},
      content_id  INTEGER NOT NULL,
      kind        TEXT    NOT NULL DEFAULT 'image', -- image | video
      name        TEXT    NOT NULL DEFAULT '',
      mime        TEXT    NOT NULL DEFAULT '',
      size        INTEGER NOT NULL DEFAULT 0,
      file        TEXT,
      link        TEXT,
      uploaded_by INTEGER,
      uploader    TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pravka_files (
      id          ${ID},
      content_id  INTEGER NOT NULL,
      name        TEXT    NOT NULL DEFAULT '',
      mime        TEXT    NOT NULL DEFAULT '',
      size        INTEGER NOT NULL DEFAULT 0,
      data        TEXT    NOT NULL,           -- data:<mime>;base64,…
      uploaded_by INTEGER,
      uploader    TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL
    );

    -- Moving a promised day. A deadline that has a date is a promise, and a
    -- promise the person who made it can quietly move is not one — so only an
    -- admin moves a date that is already set. Everyone else ASKS, in writing,
    -- and the ask is the record: which day, to which day, and why. An admin
    -- answers it; the date moves on their yes, not before, and the whole
    -- exchange stays on the task so the reason is never just remembered.
    CREATE TABLE IF NOT EXISTS date_requests (
      id           ${ID},
      content_id   INTEGER NOT NULL,
      field        TEXT    NOT NULL,          -- recording_date | edit_ready_date | design_ready_date | release_date
      from_date    TEXT,                      -- the promised day, as it stood when asked
      to_date      TEXT,                      -- the day being asked for (null = clear it)
      reason       TEXT    NOT NULL DEFAULT '',
      state        TEXT    NOT NULL DEFAULT 'open',  -- open | approved | declined | stale
      asked_by     INTEGER,
      asked_name   TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL,
      decided_by   INTEGER,
      decided_name TEXT    NOT NULL DEFAULT '',
      decided_at   TEXT,
      decided_note TEXT    NOT NULL DEFAULT ''
    );

    -- Pravki (revisions): when the SMM reviews a Ready task and asks for
    -- changes, one row records the round, who asked, which crew stage it went
    -- back to, and the change note. Plain history — no escalation logic.
    CREATE TABLE IF NOT EXISTS revisions (
      id             ${ID},
      content_id     INTEGER NOT NULL,
      round          INTEGER NOT NULL DEFAULT 1,
      requested_by   INTEGER,
      requested_name TEXT    NOT NULL DEFAULT '',
      target         TEXT    NOT NULL DEFAULT 'editor', -- operator | editor | designer
      note           TEXT    NOT NULL DEFAULT '',
      -- A Pravki note is usually about a FRAME, so it can carry the screenshot
      -- that shows it, pasted straight from the clipboard.
      photo          TEXT,
      photo_thumb    TEXT,
      created_at     TEXT    NOT NULL,
      resolved_at    TEXT,
      -- The file the round sent back ('' when there was none; NULL on a round
      -- opened before this was kept), and the one that fixed it — so "a new
      -- file" means new since the round opened, not since the last save.
      sent_link      TEXT,
      fixed_link     TEXT,
      resolved_by    INTEGER,
      resolved_name  TEXT    NOT NULL DEFAULT ''
    );

    -- The talk under one round: the reviewer and the crew going back and
    -- forth about what is still wrong, until a new file closes it.
    CREATE TABLE IF NOT EXISTS revision_notes (
      id          ${ID},
      revision_id INTEGER NOT NULL,
      content_id  INTEGER NOT NULL,
      user_id     INTEGER,
      author      TEXT    NOT NULL DEFAULT '',
      text        TEXT    NOT NULL,
      created_at  TEXT    NOT NULL
    );

    -- One-time flags (e.g. "campaigns seeded") so seed data never re-appears.
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

    -- The talk that belongs to the task: one thread per piece of content.
    CREATE TABLE IF NOT EXISTS comments (
      id         ${ID},
      content_id INTEGER NOT NULL,
      user_id    INTEGER,
      author     TEXT    NOT NULL DEFAULT '',
      text       TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );

    -- The bell: persisted events (someone moved your task). Deadline
    -- reminders are computed at read time and never stored.
    CREATE TABLE IF NOT EXISTS notifications (
      id         ${ID},
      user_id    INTEGER NOT NULL,
      kind       TEXT    NOT NULL DEFAULT 'status',
      text       TEXT    NOT NULL,
      content_id INTEGER,
      created_at TEXT    NOT NULL,
      read_at    TEXT
    );

    -- The paper trail: one row per meaningful change on a task — who, which
    -- field, from what, to what. Names and stage labels are written down at
    -- the moment of the change, so the log still reads like a sentence after
    -- people or stages are renamed or removed (and after the task itself is).
    CREATE TABLE IF NOT EXISTS activity (
      id            ${ID},
      content_id    INTEGER,
      content_title TEXT    NOT NULL DEFAULT '',
      user_id       INTEGER,
      user_name     TEXT    NOT NULL DEFAULT '',
      kind          TEXT    NOT NULL DEFAULT 'updated', -- created | updated | deleted
      field         TEXT,
      old_value     TEXT,
      new_value     TEXT,
      created_at    TEXT    NOT NULL
    );

    -- The nudges an admin keeps ready: "did the week get planned?", "does
    -- every task carry its brief?". Each one can be fired at anybody on
    -- demand, or left to arrive by itself on chosen weekdays at a chosen
    -- hour (Tashkent). last_sent holds the day it last went out, so a
    -- schedule fires once a day however many times the hour is checked.
    CREATE TABLE IF NOT EXISTS tg_templates (
      id         ${ID},
      title      TEXT    NOT NULL,
      text       TEXT    NOT NULL,
      audience   TEXT    NOT NULL DEFAULT 'linked', -- linked | role:<role> | channel:<key> | users:<id,id>
      days       TEXT    NOT NULL DEFAULT '[]',     -- weekday numbers, 1 = Monday; empty = on demand only
      hour       INTEGER NOT NULL DEFAULT 9,        -- Tashkent hour the schedule fires at
      enabled    INTEGER NOT NULL DEFAULT 1,
      last_sent  TEXT,                              -- Tashkent day it last went out
      sort       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL
    );

    -- The real paperwork a task carries: a ТЗ in Word, a reference deck as
    -- PDF, a spreadsheet of slots. The BYTES live in their own table (as a
    -- base64 data URL) precisely so no list, poll or task payload ever drags
    -- a 4 MB brief along — the modal reads names and sizes, and a document
    -- is fetched only when somebody opens it.
    -- The ten-second regret. One row per task, overwritten by every move, so
    -- only the LAST move is ever undoable. It holds what the task looked like
    -- immediately before — the stage, the clocks, the hats, the promises — and
    -- the plan counters are walked back from the difference when it is used.
    CREATE TABLE IF NOT EXISTS undo_moves (
      content_id INTEGER PRIMARY KEY,
      user_id    INTEGER,
      before     TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );

    -- What the board is actually used for. Two questions an admin kept asking
    -- and had no way to answer: is this person on the platform at all, and
    -- which parts of it does anybody touch? Both are counted per DAY and per
    -- person, never per event — there is no log of who opened what at 14:32,
    -- because a board that keeps one is a board people stop being honest on.
    --
    -- Time is measured as seconds with the tab OPEN AND VISIBLE, sent up in
    -- heartbeats. A tab left open behind a laptop lid stops counting.
    CREATE TABLE IF NOT EXISTS usage_day (
      user_id  INTEGER NOT NULL,
      day      TEXT    NOT NULL,          -- Tashkent day, YYYY-MM-DD
      seconds  INTEGER NOT NULL DEFAULT 0,
      first_at TEXT,
      last_at  TEXT,
      PRIMARY KEY (user_id, day)
    );

    -- One row per person per day per thing-pressed. kind 'tap' is a button,
    -- kind 'page' is a screen that was opened.
    CREATE TABLE IF NOT EXISTS usage_tap (
      user_id INTEGER NOT NULL,
      day     TEXT    NOT NULL,
      kind    TEXT    NOT NULL DEFAULT 'tap',
      action  TEXT    NOT NULL,
      n       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day, kind, action)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id           ${ID},
      content_id   INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      mime         TEXT    NOT NULL DEFAULT '',
      size         INTEGER NOT NULL DEFAULT 0, -- bytes of the original file
      data         TEXT    NOT NULL,           -- data:<mime>;base64,…
      uploaded_by  INTEGER,
      uploader     TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL
    );

    -- One video, posted again: which repost task a published piece made on
    -- which repost channel (TikTok, YouTube Shorts). The unique pair is the
    -- whole point — the row is CLAIMED (insert-or-ignore) before the task is
    -- made, so publishing twice, or undoing and publishing again, can never
    -- make a second repost of the same video on the same channel. touched is
    -- set by the first edit, comment, file or stage move on the repost task:
    -- an undo of the publish takes back only the ones nobody has touched.
    CREATE TABLE IF NOT EXISTS content_reposts (
      id             ${ID},
      source_id      INTEGER NOT NULL,
      target_channel TEXT    NOT NULL,
      repost_id      INTEGER,
      touched        INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL,
      UNIQUE(source_id, target_channel)
    );

    -- Drive drop-in (server/dropin.js): one row per file somebody put in one
    -- of the three drop folders in Google Drive. The row is the CLAIM — made
    -- (insert-or-ignore on file_id) before anything is attached or anybody
    -- told, so two server processes watching the same folders attach a file
    -- once. The file itself stays in Drive; this is what the task shows of
    -- it. content_id NULL = nobody could tell which task it is for yet.
    CREATE TABLE IF NOT EXISTS drive_drops (
      id           ${ID},
      file_id      TEXT    NOT NULL UNIQUE,
      folder       TEXT    NOT NULL,          -- recording | pravka | ready
      name         TEXT    NOT NULL DEFAULT '',
      size         INTEGER NOT NULL DEFAULT 0,
      mime         TEXT    NOT NULL DEFAULT '',
      link         TEXT    NOT NULL DEFAULT '',
      duration_ms  INTEGER,
      has_thumb    INTEGER NOT NULL DEFAULT 0,
      file_at      TEXT,                      -- when Drive says the file was made
      content_id   INTEGER,
      revision_id  INTEGER,                   -- the open round a Pravka file answers
      matched_by   TEXT,                      -- id | title | hand | upload (the task window's Drive box)
      attached_by  INTEGER,
      attached_name TEXT   NOT NULL DEFAULT '',
      attached_at  TEXT,
      created_at   TEXT    NOT NULL
    );

    -- What Google Drive says about a link pasted on a task (server/taskfiles.js):
    -- an old cut in somebody's Drive, a folder of footage. Keyed by the Drive id,
    -- not by the task — the same file can be on two tasks — and read again when
    -- it goes stale, so a link shared with the team account later starts
    -- working by itself. state: ok | unshared (Google says no, or no such file).
    -- Every file somebody uploaded through the board (r11, the owner's
    -- "History"): who, onto which task, as which job — so a wrong file can be
    -- found and fixed later, from the Uploads page. The file stays in Drive;
    -- deleted_at says it was sent to the Drive's bin from the board.
    CREATE TABLE IF NOT EXISTS drive_uploads (
      id           ${ID},
      file_id      TEXT    NOT NULL UNIQUE,
      content_id   INTEGER NOT NULL,
      user_id      INTEGER NOT NULL,
      kind         TEXT    NOT NULL DEFAULT '',  -- shoot | edit | design | reference | box
      name         TEXT    NOT NULL DEFAULT '',
      size         INTEGER NOT NULL DEFAULT 0,
      mime         TEXT    NOT NULL DEFAULT '',
      link         TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL,
      deleted_at   TEXT,
      deleted_by   INTEGER
    );

    -- A person's private calendar address (routes/calendar.js): Apple
    -- Calendar or Google subscribes to /api/calendar/feed/<token>.ics. The
    -- token is the key, so it lives here and never on the user row.
    CREATE TABLE IF NOT EXISTS cal_feeds (
      user_id      INTEGER PRIMARY KEY,
      token        TEXT    NOT NULL UNIQUE,
      created_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drive_links (
      id           ${ID},
      drive_id     TEXT    NOT NULL UNIQUE,
      state        TEXT    NOT NULL DEFAULT 'ok',
      is_folder    INTEGER NOT NULL DEFAULT 0,
      name         TEXT    NOT NULL DEFAULT '',
      mime         TEXT    NOT NULL DEFAULT '',
      size         INTEGER NOT NULL DEFAULT 0,
      duration_ms  INTEGER,
      has_thumb    INTEGER NOT NULL DEFAULT 0,
      link         TEXT    NOT NULL DEFAULT '',
      children     TEXT,                      -- a folder: its files, as JSON
      checked_at   TEXT    NOT NULL
    );
  `)

  await migrate()
  await fingerprintScripts()
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_personal_user ON personal_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_content_sort ON content(pinned, todo_sort);
    CREATE INDEX IF NOT EXISTS idx_content_operator ON content(operator_id, recording_date);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
    CREATE INDEX IF NOT EXISTS idx_activity_content ON activity(content_id, id);
    -- Everything a task drags in when it is opened: its revisions, its
    -- documents, its clips, its day-move asks. Each was a table scan.
    CREATE INDEX IF NOT EXISTS idx_revisions_content ON revisions(content_id);
    CREATE INDEX IF NOT EXISTS idx_revnotes_revision ON revision_notes(revision_id);
    CREATE INDEX IF NOT EXISTS idx_revnotes_content ON revision_notes(content_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_content ON attachments(content_id);
    CREATE INDEX IF NOT EXISTS idx_voice_content ON voice_notes(content_id);
    CREATE INDEX IF NOT EXISTS idx_pravka_files_content ON pravka_files(content_id);
    CREATE INDEX IF NOT EXISTS idx_reference_media_content ON reference_media(content_id);
    CREATE INDEX IF NOT EXISTS idx_dreq_content ON date_requests(content_id, state);
    CREATE INDEX IF NOT EXISTS idx_flags_content ON task_flags(content_id, cleared_at);
    CREATE INDEX IF NOT EXISTS idx_reposts_repost ON content_reposts(repost_id);
    CREATE INDEX IF NOT EXISTS idx_drive_drops_content ON drive_drops(content_id);
    CREATE INDEX IF NOT EXISTS idx_drive_uploads_user ON drive_uploads(user_id, created_at);
    -- The repeat-script check. Without this it read every script in the
    -- database — a script runs to 20,000 characters, so a board with a
    -- thousand tasks on it read megabytes to answer one question on every
    -- single save. script_key is a fingerprint of the same normalisation the
    -- check uses, so the question is now one indexed lookup.
    CREATE INDEX IF NOT EXISTS idx_content_script_key ON content(script_key);

    -- One card per person, and exactly one default (NULL user_id). SQLite
    -- treats NULLs as distinct in a unique index, so the single
    -- default row is kept by the route rather than by the index.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_rules_user ON pay_rules(user_id);

    -- One card per role, beside the one card per person. Partial, because
    -- every personal card has a NULL role and they would collide otherwise.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_rules_role ON pay_rules(role) WHERE user_id IS NULL;

    -- A month is closed for a person once. Two admins pressing "record as
    -- paid" at the same moment would otherwise write two rows, and the
    -- history would show the month twice.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_user_month ON payouts(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_payout_month ON payouts(month);

    -- Sprints. The unique pairs are the honest ones: a task is in a week
    -- once and assigned to a person once, and saying so here means a double
    -- click cannot make it twice.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint_owner     ON sprint_owners(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint_task_week ON sprint_task_sprints(task_id, sprint_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint_assignee  ON sprint_task_assignees(task_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_sprint_week_tasks       ON sprint_task_sprints(sprint_id);
    CREATE INDEX IF NOT EXISTS idx_sprint_check_slice      ON sprint_checklist_items(task_id, sprint_id, position);
    CREATE INDEX IF NOT EXISTS idx_sprint_att_task         ON sprint_attachments(task_id);
    /* One ambassador record per account, enforced: two admins setting somebody
       up at the same moment would otherwise make two, and the cards would
       split between them. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ambassador_user   ON ambassadors(user_id);
    CREATE INDEX IF NOT EXISTS idx_ambassador_cards_who     ON ambassador_cards(ambassador_id, state);
    CREATE INDEX IF NOT EXISTS idx_ambassador_cards_month   ON ambassador_cards(paid_month);
    CREATE INDEX IF NOT EXISTS idx_ambassador_events_card   ON ambassador_card_events(card_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ambassador_payout ON ambassador_payouts(month, ambassador_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_day    ON attendance(user_id, day);
    CREATE INDEX IF NOT EXISTS idx_attendance_when           ON attendance(day);
    CREATE INDEX IF NOT EXISTS idx_sprints_status          ON sprints(status, start_at);
    /* One row per week, enforced rather than assumed: the week is looked up by
       its start, and two requests arriving together on a Monday morning would
       otherwise both find nothing and both insert. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sprint_week          ON sprints(start_at);

  `)
}

async function hasColumn(table, col) {
  return (await all(`PRAGMA table_info(${table})`)).some((c) => c.name === col)
}

// Fingerprint the scripts already on the board, once. Without this the repeat
// check would be blind to every task that existed before it — and doing it in
// SQL would fold whitespace differently from the JS that writes new keys,
// which is a subtler way of being blind.
async function fingerprintScripts() {
  try {
    const rows = await all("SELECT id, script FROM content WHERE script_key IS NULL AND script IS NOT NULL AND script <> ''")
    if (!rows.length) return
    await batch(rows.map((r) => ['UPDATE content SET script_key = ? WHERE id = ?', scriptKey(r.script), r.id]))
  } catch { /* a fresh database has no rows to fingerprint */ }
}

async function migrate() {
  try {
    if (!(await hasColumn('users', 'permissions'))) await exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'")
    if (!(await hasColumn('users', 'lang'))) await exec('ALTER TABLE users ADD COLUMN lang TEXT')
    if (!(await hasColumn('content', 'tz'))) await exec('ALTER TABLE content ADD COLUMN tz TEXT')
    for (const [col, decl] of [
      ['shoot_ack', "TEXT NOT NULL DEFAULT ''"], ['shoot_ack_at', 'TEXT'], ['shoot_ack_by', 'INTEGER'], ['shoot_ack_note', 'TEXT'],
      ['edit_ack', "TEXT NOT NULL DEFAULT ''"], ['edit_ack_at', 'TEXT'], ['edit_ack_by', 'INTEGER'], ['edit_ack_note', 'TEXT'],
      ['miss_blame', 'TEXT'], ['miss_blame_note', 'TEXT'], ['miss_blame_by', 'INTEGER'],
      ['views', 'INTEGER'], ['views_at', 'TEXT'], ['views_by', 'INTEGER'],
      ['approved_at', 'TEXT'], ['approved_by', 'INTEGER'], ['approved_name', "TEXT NOT NULL DEFAULT ''"],
      ['telegram_type', 'TEXT'], ['is_guiding', 'INTEGER NOT NULL DEFAULT 0'],
    ]) if (!(await hasColumn('content', col))) await exec(`ALTER TABLE content ADD COLUMN ${col} ${decl}`)
    if (!(await hasColumn('trackers', 'content_type'))) await exec('ALTER TABLE trackers ADD COLUMN content_type TEXT')
    // The ambassador programme grew a terms line the three boxes could not say,
    // and a moment somebody said their video was live.
    for (const [tbl, col, decl] of [
      ['ambassadors', 'default_terms_other', "TEXT NOT NULL DEFAULT ''"],
      ['ambassador_cards', 'terms_other', "TEXT NOT NULL DEFAULT ''"],
      ['ambassador_cards', 'posted_at', 'TEXT'],
      // The video, reviewed before anything is posted (Sept 2026).
      ['ambassador_cards', 'video_url', "TEXT NOT NULL DEFAULT ''"],
      ['ambassador_cards', 'video_ok_at', 'TEXT'],
      ['ambassador_cards', 'video_ok_by', 'INTEGER'],
      ['ambassador_cards', 'who_posts', "TEXT NOT NULL DEFAULT ''"],
      // The editing task made from the video (October 2026).
      ['ambassador_cards', 'task_id', 'INTEGER'],
    ]) if (!(await hasColumn(tbl, col))) await exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${decl}`)
    // Older databases stored a single channel per task — rebuild to the new shape.
    if (await hasColumn('content', 'channel')) {
      await exec(`
        ALTER TABLE content RENAME TO content_legacy;
        CREATE TABLE content (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          title          TEXT    NOT NULL,
          channels       TEXT    NOT NULL DEFAULT '[]',
          type           TEXT    NOT NULL DEFAULT 'post',
          assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
          status_id      INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
          recording_date TEXT,
          recording_time TEXT,
          release_date   TEXT,
          release_time   TEXT,
          description    TEXT    NOT NULL DEFAULT '',
          photo          TEXT,
          checklist      TEXT    NOT NULL DEFAULT '[]',
          todo_sort      INTEGER NOT NULL DEFAULT 0,
          done_at        TEXT,
          created_at     TEXT    NOT NULL
        );
        INSERT INTO content (id, title, channels, type, assignee_id, created_by, status_id,
          recording_date, recording_time, release_date, release_time, description, photo, checklist, done_at, created_at)
        SELECT id, title, json_array(channel), 'post', assignee_id, created_by, status_id,
          recording_date, recording_time, release_date, release_time, description, photo, checklist, done_at, created_at
        FROM content_legacy;
        DROP TABLE content_legacy;
      `)
    }
    if (!(await hasColumn('users', 'admin_channels'))) await exec("ALTER TABLE users ADD COLUMN admin_channels TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('users', 'study_blocks'))) await exec("ALTER TABLE users ADD COLUMN study_blocks TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('channels', 'drive_url'))) await exec("ALTER TABLE channels ADD COLUMN drive_url TEXT NOT NULL DEFAULT ''")
    if (!(await hasColumn('users', 'daily_cap'))) await exec('ALTER TABLE users ADD COLUMN daily_cap INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('users', 'crew_channels'))) await exec("ALTER TABLE users ADD COLUMN crew_channels TEXT NOT NULL DEFAULT '[]'")
    // Reads the people board. NOT one of DEFAULT_PERMS on purpose: `can()`
    // hands every admin every permission, and routes/users.js blanks the
    // permissions of anybody who is not a member — either one would have made
    // this rank either universal or temporary. A column is neither.
    if (!(await hasColumn('users', 'superadmin'))) await exec('ALTER TABLE users ADD COLUMN superadmin INTEGER NOT NULL DEFAULT 0')
    // r11 · the makers' colours (see the Postgres branch above).
    if (!(await hasColumn('content', 'color'))) await exec('ALTER TABLE content ADD COLUMN color INTEGER')
    if (!(await hasColumn('users', 'color_mode'))) await exec("ALTER TABLE users ADD COLUMN color_mode TEXT NOT NULL DEFAULT 'own'")
    if (!(await hasColumn('users', 'color_map'))) await exec("ALTER TABLE users ADD COLUMN color_map TEXT NOT NULL DEFAULT '{}'")
    // pay_rules arrived in round 73 without a quota; the table is created by
    // CREATE TABLE IF NOT EXISTS, which will not add a column to one that is
    // already there, so an existing board needs these two spelled out.
    if (!(await hasColumn('channels', 'daily_ad_cap'))) await exec('ALTER TABLE channels ADD COLUMN daily_ad_cap INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('channels', 'format'))) await exec("ALTER TABLE channels ADD COLUMN format TEXT NOT NULL DEFAULT 'social'")
    if (!(await hasColumn('channels', 'char_limit'))) await exec('ALTER TABLE channels ADD COLUMN char_limit INTEGER')
    if (!(await hasColumn('content', 'with_media'))) await exec('ALTER TABLE content ADD COLUMN with_media INTEGER NOT NULL DEFAULT 0')
    // The hours an ask offers (an operator's "I can do it another time"), so a yes books them.
    for (const col of ['to_time', 'to_end']) if (!(await hasColumn('date_requests', col))) await exec(`ALTER TABLE date_requests ADD COLUMN ${col} TEXT`)
    if (!(await hasColumn('channels', 'video'))) await exec('ALTER TABLE channels ADD COLUMN video INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('content', 'repost_to'))) await exec("ALTER TABLE content ADD COLUMN repost_to TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('person_kpis', 'source'))) await exec("ALTER TABLE person_kpis ADD COLUMN source TEXT NOT NULL DEFAULT ''")
    if (!(await hasColumn('person_kpis', 'direction'))) await exec("ALTER TABLE person_kpis ADD COLUMN direction TEXT NOT NULL DEFAULT 'atleast'")
    if (!(await hasColumn('person_kpis', 'reward'))) await exec('ALTER TABLE person_kpis ADD COLUMN reward REAL NOT NULL DEFAULT 0')
    if (!(await hasColumn('pay_rules', 'quota'))) await exec('ALTER TABLE pay_rules ADD COLUMN quota REAL NOT NULL DEFAULT 0')
    if (!(await hasColumn('pay_rules', 'scheme'))) await exec("ALTER TABLE pay_rules ADD COLUMN scheme TEXT NOT NULL DEFAULT 'piece'")
    if (!(await hasColumn('pay_rules', 'pillow'))) await exec('ALTER TABLE pay_rules ADD COLUMN pillow REAL NOT NULL DEFAULT 0')
    if (!(await hasColumn('pay_rules', 'quota_bonus'))) await exec('ALTER TABLE pay_rules ADD COLUMN quota_bonus REAL NOT NULL DEFAULT 0')
    if (!(await hasColumn('pay_rules', 'per_1k_views'))) await exec('ALTER TABLE pay_rules ADD COLUMN per_1k_views REAL NOT NULL DEFAULT 0')
    if (!(await hasColumn('projects', 'start_date'))) await exec('ALTER TABLE projects ADD COLUMN start_date TEXT')
    // Many numbers and tickable criteria per project (Sept 2026). The old
    // single metric/target/actual and the free-text `success` STAY in the
    // table: migrateProjectShape() below reads them, and a column nobody
    // reads costs nothing next to a column somebody needed and dropped.
    if (!(await hasColumn('projects', 'numbers'))) await exec("ALTER TABLE projects ADD COLUMN numbers TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('projects', 'criteria'))) await exec("ALTER TABLE projects ADD COLUMN criteria TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('projects', 'status_reason'))) await exec("ALTER TABLE projects ADD COLUMN status_reason TEXT NOT NULL DEFAULT ''")
    // Shooting and editing priced by kind of work. Added one at a time so a
    // board part-way through an earlier migration finishes cleanly.
    for (const col of ['per_shoot_reel', 'per_edit_reel', 'per_shoot_youtube', 'per_edit_youtube', 'per_shoot_target', 'per_edit_target',
      // Standing in front of the camera, priced the same way (Sept 2026).
      'per_face', 'per_face_reel', 'per_face_youtube', 'per_face_target']) {
      if (!(await hasColumn('pay_rules', col))) await exec(`ALTER TABLE pay_rules ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`)
    }
    // What a piece is worth by what KIND of piece it is, and the role a card
    // can belong to instead of a person. Both default to "nothing set", which
    // is what keeps an existing board's pay exactly where it was.
    if (!(await hasColumn('pay_rules', 'kind_rules'))) await exec("ALTER TABLE pay_rules ADD COLUMN kind_rules TEXT NOT NULL DEFAULT '{}'")
    if (!(await hasColumn('pay_rules', 'role'))) await exec('ALTER TABLE pay_rules ADD COLUMN role TEXT')
    if (!(await hasColumn('pay_rules', 'views_target'))) await exec('ALTER TABLE pay_rules ADD COLUMN views_target REAL NOT NULL DEFAULT 0')
    if (!(await hasColumn('pay_rules', 'views_bonus'))) await exec('ALTER TABLE pay_rules ADD COLUMN views_bonus REAL NOT NULL DEFAULT 0')
    if (!(await hasColumn('sprint_tasks', 'dropped_at'))) await exec('ALTER TABLE sprint_tasks ADD COLUMN dropped_at TEXT')
    if (!(await hasColumn('sprint_tasks', 'dropped_by'))) await exec('ALTER TABLE sprint_tasks ADD COLUMN dropped_by INTEGER')
    if (!(await hasColumn('sprint_tasks', 'dropped_reason'))) await exec("ALTER TABLE sprint_tasks ADD COLUMN dropped_reason TEXT NOT NULL DEFAULT ''")
    if (!(await hasColumn('sprint_tasks', 'dropped_sprint_id'))) await exec('ALTER TABLE sprint_tasks ADD COLUMN dropped_sprint_id INTEGER')
    if (!(await hasColumn('content', 'post_link'))) await exec('ALTER TABLE content ADD COLUMN post_link TEXT')
    if (!(await hasColumn('content', 'face_id'))) await exec('ALTER TABLE content ADD COLUMN face_id INTEGER')
    if (!(await hasColumn('content', 'faces'))) await exec("ALTER TABLE content ADD COLUMN faces TEXT NOT NULL DEFAULT '[]'")
    // Which reference photo the card's picture (photo / photo_thumb) is a copy
    // of; null when the card's picture is the old album's or somebody's own.
    if (!(await hasColumn('content', 'photo_media_id'))) await exec('ALTER TABLE content ADD COLUMN photo_media_id INTEGER')
    if (!(await hasColumn('content', 'skip_rate'))) await exec('ALTER TABLE content ADD COLUMN skip_rate REAL')
    if (!(await hasColumn('content', 'skip_rate_at'))) await exec('ALTER TABLE content ADD COLUMN skip_rate_at TEXT')
    if (!(await hasColumn('content', 'paid_month'))) await exec('ALTER TABLE content ADD COLUMN paid_month TEXT')
    if (!(await hasColumn('content', 'paid_at'))) await exec('ALTER TABLE content ADD COLUMN paid_at TEXT')
    if (!(await hasColumn('content', 'paid_by'))) await exec('ALTER TABLE content ADD COLUMN paid_by INTEGER')
    if (!(await hasColumn('content', 'script_key'))) await exec('ALTER TABLE content ADD COLUMN script_key TEXT')
    if (!(await hasColumn('comments', 'voice_id'))) await exec('ALTER TABLE comments ADD COLUMN voice_id INTEGER')
    if (!(await hasColumn('comments', 'voice_secs'))) await exec('ALTER TABLE comments ADD COLUMN voice_secs INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('revisions', 'voice_id'))) await exec('ALTER TABLE revisions ADD COLUMN voice_id INTEGER')
    if (!(await hasColumn('revisions', 'voice_secs'))) await exec('ALTER TABLE revisions ADD COLUMN voice_secs INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('revisions', 'photo'))) await exec('ALTER TABLE revisions ADD COLUMN photo TEXT')
    if (!(await hasColumn('revisions', 'photo_thumb'))) await exec('ALTER TABLE revisions ADD COLUMN photo_thumb TEXT')
    if (!(await hasColumn('revisions', 'sent_link'))) await exec('ALTER TABLE revisions ADD COLUMN sent_link TEXT')
    if (!(await hasColumn('revisions', 'fixed_link'))) await exec('ALTER TABLE revisions ADD COLUMN fixed_link TEXT')
    if (!(await hasColumn('revisions', 'resolved_by'))) await exec('ALTER TABLE revisions ADD COLUMN resolved_by INTEGER')
    if (!(await hasColumn('revisions', 'resolved_name'))) await exec("ALTER TABLE revisions ADD COLUMN resolved_name TEXT NOT NULL DEFAULT ''")
    if (!(await hasColumn('content', 'todo_sort'))) await exec('ALTER TABLE content ADD COLUMN todo_sort INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('content', 'pinned'))) await exec('ALTER TABLE content ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('content', 'photo_thumb'))) await exec('ALTER TABLE content ADD COLUMN photo_thumb TEXT')
    if (!(await hasColumn('content', 'reference_photos'))) await exec("ALTER TABLE content ADD COLUMN reference_photos TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('content', 'design_status_id'))) await exec('ALTER TABLE content ADD COLUMN design_status_id INTEGER')
    if (!(await hasColumn('users', 'avatar'))) await exec('ALTER TABLE users ADD COLUMN avatar TEXT')
    if (!(await hasColumn('channels', 'head_id'))) await exec('ALTER TABLE channels ADD COLUMN head_id INTEGER')
    if (!(await hasColumn('channels', 'dashboard'))) await exec('ALTER TABLE channels ADD COLUMN dashboard TEXT')
    if (!(await hasColumn('programs', 'platform'))) await exec("ALTER TABLE programs ADD COLUMN platform TEXT NOT NULL DEFAULT 'both'")
    if (!(await hasColumn('programs', 'checklist'))) await exec("ALTER TABLE programs ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('programs', 'creatives'))) await exec("ALTER TABLE programs ADD COLUMN creatives TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('campaigns', 'checklist'))) await exec("ALTER TABLE campaigns ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('campaigns', 'project_id'))) {
      await exec(`
        ALTER TABLE campaigns ADD COLUMN project_id INTEGER;
        ALTER TABLE campaigns ADD COLUMN owner_id INTEGER;
        ALTER TABLE campaigns ADD COLUMN start_date TEXT;
        ALTER TABLE campaigns ADD COLUMN end_date TEXT;
        ALTER TABLE campaigns ADD COLUMN metric TEXT NOT NULL DEFAULT '';
        ALTER TABLE campaigns ADD COLUMN target REAL NOT NULL DEFAULT 0;
        ALTER TABLE campaigns ADD COLUMN actual REAL NOT NULL DEFAULT 0;
        ALTER TABLE campaigns ADD COLUMN budget REAL;
        ALTER TABLE campaigns ADD COLUMN stage TEXT NOT NULL DEFAULT 'idea';
      `)
      await exec("ALTER TABLE campaigns ADD COLUMN channels TEXT NOT NULL DEFAULT '[]'")
    }
    if (!(await hasColumn('content', 'campaign_id'))) await exec('ALTER TABLE content ADD COLUMN campaign_id INTEGER')
    if (!(await hasColumn('projects', 'photo'))) await exec('ALTER TABLE projects ADD COLUMN photo TEXT; ALTER TABLE projects ADD COLUMN photo_thumb TEXT;')
    if (!(await hasColumn('campaigns', 'photo'))) await exec("ALTER TABLE campaigns ADD COLUMN photo TEXT; ALTER TABLE campaigns ADD COLUMN photo_thumb TEXT; ALTER TABLE campaigns ADD COLUMN description TEXT NOT NULL DEFAULT '';")
    if (!(await hasColumn('content', 'operator_id'))) await exec('ALTER TABLE content ADD COLUMN operator_id INTEGER; ALTER TABLE content ADD COLUMN editor_id INTEGER;')
    if (!(await hasColumn('content', 'designer_id'))) await exec('ALTER TABLE content ADD COLUMN designer_id INTEGER')
    if (!(await hasColumn('content', 'design_ready_date'))) await exec('ALTER TABLE content ADD COLUMN design_ready_date TEXT')
    if (!(await hasColumn('content', 'ready_link'))) await exec('ALTER TABLE content ADD COLUMN ready_link TEXT')
    if (!(await hasColumn('content', 'assignees'))) await exec("ALTER TABLE content ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('users', 'crew_roles'))) await exec("ALTER TABLE users ADD COLUMN crew_roles TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('content', 'recording_end'))) await exec('ALTER TABLE content ADD COLUMN recording_end TEXT')
    if (!(await hasColumn('users', 'phone'))) {
      await exec(`
        ALTER TABLE users ADD COLUMN phone TEXT;
        ALTER TABLE users ADD COLUMN position TEXT;
        ALTER TABLE users ADD COLUMN duties TEXT;
        ALTER TABLE users ADD COLUMN work_start TEXT;
        ALTER TABLE users ADD COLUMN work_end TEXT;
        ALTER TABLE users ADD COLUMN work_days TEXT;
      `)
    }
    if (!(await hasColumn('projects', 'success'))) await exec("ALTER TABLE projects ADD COLUMN success TEXT NOT NULL DEFAULT ''")
    if (!(await hasColumn('content', 'edit_ready_date'))) await exec('ALTER TABLE content ADD COLUMN edit_ready_date TEXT; ALTER TABLE content ADD COLUMN ready_at TEXT;')
    if (!(await hasColumn('programs', 'branches'))) await exec("ALTER TABLE programs ADD COLUMN branches TEXT NOT NULL DEFAULT '[]'")
    if (!(await hasColumn('content', 'shot_link'))) await exec('ALTER TABLE content ADD COLUMN shot_link TEXT; ALTER TABLE content ADD COLUMN design_link TEXT;')
    if (!(await hasColumn('content', 'format'))) await exec('ALTER TABLE content ADD COLUMN format TEXT; ALTER TABLE content ADD COLUMN rubrika TEXT; ALTER TABLE content ADD COLUMN script TEXT;')
    if (!(await hasColumn('content', 'reference_text'))) await exec("ALTER TABLE content ADD COLUMN reference_text TEXT; ALTER TABLE content ADD COLUMN reference_links TEXT NOT NULL DEFAULT '[]';")
    if (!(await hasColumn('users', 'telegram_chat_id'))) await exec('ALTER TABLE users ADD COLUMN telegram_chat_id TEXT; ALTER TABLE users ADD COLUMN telegram_code TEXT;')
    if (!(await hasColumn('users', 'weak_password'))) await exec('ALTER TABLE users ADD COLUMN weak_password INTEGER NOT NULL DEFAULT 0')
    if (!(await hasColumn('content', 'reviewer_id'))) {
      await exec(`
        ALTER TABLE content ADD COLUMN reviewer_id INTEGER;
        ALTER TABLE content ADD COLUMN reviewers TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE content ADD COLUMN shot_at TEXT;
        ALTER TABLE content ADD COLUMN edited_at TEXT;
        ALTER TABLE content ADD COLUMN edit_due_revised TEXT;
        ALTER TABLE content ADD COLUMN review_due_revised TEXT;
      `)
    }
  } catch (e) {
    console.warn('Skipping legacy migrations:', e.message)
  }
}

// ---- what a task on THESE channels, of THIS type, actually owes ------------
//
// The two halves of the question, finally asked together. The type rules say
// what a piece of this kind needs; the channel formats say what this surface
// can need at all. A field or a hat survives only if BOTH want it.
//
// Across several channels the answer is the UNION, and that is the honest way
// round: a piece cross-posted to Instagram and Telegram is still going on
// Instagram, so it still needs the artwork. Only a task going nowhere but
// Telegram stops being asked.
//
// A task with no channels yet — a brand-new idea — is judged by the type
// rules alone, exactly as before. It is not "no channel, therefore nothing is
// needed"; it is "nobody has said where this is going yet".
//
// `withMedia` is the task's own switch (content.with_media): a short written
// post that carries a video or a picture is judged as a feed post, so the type
// rules put the editor or the designer back on it. It never touches 'text'
// (Telegram), whose item type and pay read the raw format.
export async function channelFormatsFor(keys, withMedia = false) {
  const list = (Array.isArray(keys) ? keys : []).map(String).filter(Boolean)
  if (!list.length) return []
  const rows = await all(`SELECT key, format FROM channels WHERE key IN (${list.map(() => '?').join(',')})`, ...list)
  return rows.map(formatOf).map((f) => (withMedia && f === 'short' ? 'social' : f))
}

// The tightest post-length limit among these channels, with the channel it
// belongs to — or null when none of them has one.
export async function charLimitFor(keys) {
  const list = (Array.isArray(keys) ? keys : []).map(String).filter(Boolean)
  if (!list.length) return null
  return (await get(`SELECT label, char_limit FROM channels WHERE char_limit > 0 AND key IN (${list.map(() => '?').join(',')})
    ORDER BY char_limit LIMIT 1`, ...list)) || null
}

// Does any of these formats allow this brief field / this hat? With no formats
// to go on, everything is allowed and the type rules stand alone.
export const formatsAllowField = (formats, key) =>
  !formats.length || formats.some((f) => CHANNEL_FORMATS[f]?.fields.includes(key))
export const formatsAllowCrew = (formats, hat) =>
  !formats.length || formats.some((f) => CHANNEL_FORMATS[f]?.crew.includes(hat))

export async function getChannelKeys() {
  return (await all('SELECT key FROM channels ORDER BY sort')).map((r) => r.key)
}

// ---- stage rules: who may move a task OUT of each stage ------------------
// The admin regulates which kind of actor advances work from which stage
// (Admin → Pipeline). Defaults mirror the natural chain — the operator works
// until Shot, the editor until Ready, the SMM everywhere — extended to
// earlier stages so behind-schedule work can still be pushed forward.
// Rules only ever narrow: they never grant crew powers they don't have, and
// the Published gate keeps its own key (review_publish).
//
// The operator also leaves Shot, because the handover out of Shot is the
// shooter's own act: it is where they name the editor and hand over the
// footage. That move is not a free pass — the gate makes them prove it.
export const STAGE_ACTORS = ['operator', 'editor', 'designer', 'member']
export function defaultMayLeave(actor, label) {
  const l = String(label || '').toLowerCase()
  if (/^deleted$/.test(l)) return actor === 'member'
  if (actor === 'member') return true
  // "shot" was the stage folded into Editing in round 82. The operator's part
  // ends when the footage is handed over, which the milestone tick now does,
  // so To shoot is the last stage they may leave.
  if (actor === 'operator') return /idea|to shoot/.test(l)
  if (actor === 'editor' || actor === 'designer') return /idea|to shoot|editing/.test(l)
  return false
}
export async function getStageRules() {
  try {
    const row = await get("SELECT value FROM meta WHERE key = 'stage_rules'")
    const o = JSON.parse(row?.value || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}
// Effective answer for one actor kind leaving one stage: the stored override
// when the admin set one, the role default otherwise.
export async function mayLeaveStage(actor, statusId) {
  if (!statusId) return true
  const st = await get('SELECT label FROM statuses WHERE id = ?', statusId)
  if (!st) return true
  const rules = await getStageRules()
  const v = rules?.[actor]?.[String(statusId)]
  return v === undefined ? defaultMayLeave(actor, st.label) : !!v
}

// ---- the task form, tuned by the admin (ClickUp-style custom fields) ----
// Each briefing field can be off, optional or required, scoped to content
// types; Format and Rubrika also carry admin-managed option lists. Stored
// in meta 'task_fields'; getTaskFields always answers the EFFECTIVE config
// (stored overrides merged over these defaults).
export const TASK_FIELD_KEYS = ['format', 'rubrika', 'script', 'tz', 'reference', 'description']
const ALL_TYPES = ['post', 'reel', 'story', 'video', 'target', 'other']
export const DEFAULT_TASK_FIELDS = {
  format:      { state: 'optional', types: ['reel', 'video'], options: ['Talking head', 'Split screen', 'Voiceover', 'Interview', 'Vlog', 'Skit'] },
  rubrika:     { state: 'optional', types: [...ALL_TYPES], options: [] },
  script:      { state: 'optional', types: ['reel', 'video'] },
  // ТЗ is what the editor is told to make of the footage — a different thing
  // from the script the operator films by, and the one most boards want to
  // insist on, so it is switchable like the rest.
  tz:          { state: 'optional', types: ['reel', 'video'] },
  reference:   { state: 'optional', types: [...ALL_TYPES] },
  description: { state: 'optional', types: [...ALL_TYPES] },
}
// ---- which pages this board shows ------------------------------------------
// Round 82 removed eight destinations because there were too many; the answer
// to "too many" should not be a permanent decision taken once by whoever built
// the thing. So the switchable ones are switchable: an admin turns a page off
// and it leaves the sidebar, the phone's More sheet and its own route for
// everybody, and comes back the same way.
//
// This is TIDYING, not permission. The data behind a hidden page is still
// served — a hidden Statistics page does not make anybody's misses secret —
// and the pages that are the job itself (My Day, the channel boards) cannot be
// switched off at all, because a board with no way into the work is not a
// tidier board, it is a broken one.
export const PAGE_KEYS = ['overview', 'releases', 'recordings', 'missed', 'design', 'docs', 'sprints', 'projects', 'crew', 'team']
const DEFAULT_PAGES = Object.fromEntries(PAGE_KEYS.map((k) => [k, true]))

export async function getPageRules() {
  let stored = {}
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'page_rules'"))?.value || '{}')
    if (!stored || typeof stored !== 'object') stored = {}
  } catch { stored = {} }
  const out = { ...DEFAULT_PAGES }
  for (const k of PAGE_KEYS) if (typeof stored[k] === 'boolean') out[k] = stored[k]
  return out
}

// ---- and who each page is FOR ----------------------------------------------
// The switch above answers "does this board have a Design page at all". This
// answers the other half: "whose page is it". A designer's board is furniture
// to an operator — a door they open once, find nothing of theirs behind, and
// never open again — so a page can be aimed at the people who do that job.
//
// An audience is a list of the account kinds that get the door. EMPTY means
// everybody, which is what every page was before this existed, so nothing
// narrowed when the column appeared. Admins are never in the list because
// admins always have every page: an admin who could switch a page off and
// then not see the switch is an admin locked out of their own settings.
//
// The vocabulary is the vocabulary the role picker already uses — a member, or
// one of the three crew capabilities — so setting an audience is choosing from
// the same words used to hire somebody, not learning a second scheme.
//
// Still visibility rather than a lock, exactly like the switch above: a page
// aimed at designers is not shown to an operator, but the work behind it is
// the same content the board already serves them. It sorts the doors; it does
// not pretend to be a safe. Design and Sprints are views over work the account
// already has, so there is nothing behind them to refuse — which is why the
// rule is stored and served here and APPLIED in one place on the client
// (openTo in client/src/lib/pages.jsx), rather than copied into both.
// 'admin' alone means only admins (r11): admins always have every page, so
// an audience of just 'admin' is a door nobody else is given.
export const PAGE_AUDIENCES = ['admin', 'member', 'editor', 'operator', 'designer']
// Design ships aimed at designers because that is what the page is: the
// designer's own board. The publishing calendar and Projects ship aimed at the
// people who plan (owning a project still opens Projects for anybody, see
// STAKE in client/src/lib/pages.jsx), and the filming calendar at the people
// who plan and film. Every other page ships open; an admin changes any of it.
// r11 · the research report: 4 of 6 ignore pages, and some do not know what
// Sprints, Statistics and Post-production are for. Those ship for admins only;
// an admin opens any of them to a job in Admin → Settings → Pages. Payment
// (docs) stays open to everyone — the owner wanted it back the same day.
const DEFAULT_AUDIENCE = { design: ['designer'], releases: ['member'], recordings: ['member', 'operator'], projects: ['member'],
  sprints: ['admin'], missed: ['admin'], crew: ['admin'] }

export async function getPageAudience() {
  let stored = {}
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'page_audience'"))?.value || '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {}
  } catch { stored = {} }
  const out = {}
  for (const k of PAGE_KEYS) {
    const v = Array.isArray(stored[k]) ? stored[k] : DEFAULT_AUDIENCE[k]
    // Order by the vocabulary, not by the order somebody clicked the chips, so
    // two admins setting the same audience store the same bytes.
    out[k] = PAGE_AUDIENCES.filter((a) => (v || []).includes(a))
  }
  return out
}

// ---- the one notice the board is allowed to put in front of everybody -----
// A change people should hear about BEFORE it lands, written by an admin and
// read by everyone: "the pay page moves to Documents on Monday". It replaces
// the daily digest that used to push at people whether or not anything had
// happened — a board that speaks every day is a board people stop reading, and
// the thing worth saying is not usually daily.
//
// Deliberately one notice and not a queue. Two banners stacked above the work
// is the density this was meant to remove, so posting a new one replaces the
// old one, and clearing the text takes the banner away entirely.
//
// `id` is what makes dismissal honest. A person dismisses THIS notice, not
// notices in general, so editing the text raises the id and the banner comes
// back for everybody — otherwise the second announcement would be silently
// swallowed by the first one's dismissal, which is the failure that makes
// people distrust banners.
export async function getPlannedUpdate() {
  let stored = null
  try { stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'planned_update'"))?.value || 'null') } catch { stored = null }
  if (!stored || typeof stored !== 'object') return null
  const text = String(stored.text ?? '').trim().slice(0, 240)
  if (!text) return null // no text is how a notice is taken down
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(stored.at || '')) ? String(stored.at) : null
  // r10 (the October survey: "tell us before an update"): the hour it lands,
  // the list of what changes ("Change asked → Needs changes"), and how many
  // days ahead the banner appears.
  return { id: Math.max(1, Math.round(Number(stored.id) || 1)), text, at, ...noticeExtras(stored) }
}
export function noticeExtras(n) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(n?.time || '')) ? String(n.time) : null
  const changes = (Array.isArray(n?.changes) ? n.changes : []).map((c) => String(c ?? '').trim().slice(0, 140)).filter(Boolean).slice(0, 8)
  const lead = [1, 3, 7].includes(Number(n?.lead)) ? Number(n.lead) : 3
  return { time, changes, lead }
}

// ---- what a reel earns, by how much of it people watched ------------------
// A tier is a band of SKIP RATE and what a piece in that band pays the person
// who filmed it and the person who cut it. Lower skip is better, so A is the
// tightest band and the bands are read in order.
//
// It lives in meta beside the other board-wide rules rather than in a table:
// it is one short list an admin edits as a whole, and every read wants all of
// it. Empty means nobody is paid by tier — which is what everyone was before
// this existed, so no board changed when it appeared.
export const DEFAULT_SKIP_TIERS = []
export async function getSkipTiers() {
  let stored = []
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'skip_tiers'"))?.value || '[]')
    if (!Array.isArray(stored)) stored = []
  } catch { stored = [] }
  return stored
    .map((t) => ({
      name: String(t?.name ?? '').trim().slice(0, 12),
      min: Number(t?.min) || 0,
      max: Number(t?.max) || 0,
      per_film: Number(t?.per_film) || 0,
      per_edit: Number(t?.per_edit) || 0,
    }))
    .filter((t) => t.name && t.max >= t.min)
    .slice(0, 12)
}
// Which tier a piece falls in. A piece nobody has measured falls in NO tier —
// it is not "the worst one", it is not counted, the same way an uncounted view
// adds nothing rather than adding zero.
export function tierFor(tiers, skip) {
  if (skip === null || skip === undefined || Number.isNaN(Number(skip))) return null
  const v = Number(skip)
  return tiers.find((t) => v >= t.min && v <= t.max) || null
}

// ---- how many pieces earns which grade ------------------------------------
// "A+ is twenty-four reels a month, A is twenty." The admin sets the ladder;
// everybody sees which rung they are on and what the next one costs. Same
// shape and same reasoning as the tiers above.
export async function getMakerGrades() {
  let stored = []
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'maker_grades'"))?.value || '[]')
    if (!Array.isArray(stored)) stored = []
  } catch { stored = [] }
  return stored
    .map((g) => ({ name: String(g?.name ?? '').trim().slice(0, 12), pieces: Math.max(0, Math.round(Number(g?.pieces) || 0)) }))
    .filter((g) => g.name && g.pieces > 0)
    .sort((a, b) => b.pieces - a.pieces)
    .slice(0, 12)
}
// The rung somebody is standing on, and the one above it. Nothing delivered is
// not a grade — it is the bottom of the ladder, and saying "F" at somebody who
// has just joined is not what this is for.
export function gradeFor(grades, count) {
  const n = Number(count) || 0
  const at = grades.find((g) => n >= g.pieces) || null
  const next = [...grades].reverse().find((g) => g.pieces > n) || null
  return { grade: at?.name || null, at: at?.pieces ?? null, next: next?.name || null, next_at: next?.pieces ?? null, count: n }
}

export async function getTaskFields() {
  let stored = {}
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'task_fields'"))?.value || '{}')
    if (!stored || typeof stored !== 'object') stored = {}
  } catch { stored = {} }
  const out = {}
  for (const k of TASK_FIELD_KEYS) {
    const d = DEFAULT_TASK_FIELDS[k]
    const s = stored[k] || {}
    out[k] = {
      state: ['off', 'optional', 'required'].includes(s.state) ? s.state : d.state,
      types: Array.isArray(s.types) ? s.types.map(String).filter((t) => ALL_TYPES.includes(t)) : [...d.types],
    }
    if (d.options) {
      out[k].options = Array.isArray(s.options)
        ? [...new Set(s.options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 40)
        : [...d.options]
    }
  }
  // The one demand that is not the admin's to switch off. A designed post is
  // a paying task for its maker from the day it reaches Editing, and what
  // makes it one is the ТЗ the designer works from — so a post carries a ТЗ
  // whatever this setting says about reels. `must` is the types a field is
  // asked of regardless of state and types; the channel's format still has
  // its say (formatsAllowField), which is what keeps a Telegram post, where
  // nobody designs anything, from being asked.
  out.tz.must = ['post']
  return out
}
// Is this field DEMANDED of this type — by the admin's setting, or by a rule
// of the board's own (`must`)? One reader, so the walls agree.
export const fieldDemanded = (rule, type) =>
  !!rule && ((rule.must || []).includes(type) || (rule.state === 'required' && rule.types.includes(type)))

// Which crew hats a task of each type is EXPECTED to carry — the rule the
// Unassigned / gap views count by. The admin tunes it (Admin → Pipeline) so
// a text-only post stops demanding a designer nobody ever planned to assign.
// Stored in meta 'crew_needs'; missing keys fall back to these defaults,
// which reproduce the pre-tuning behavior exactly.
// Everything a task carries that is meaningless without it. Deleting a task
// used to take only its attachments, which left the heaviest rows in the
// database — a voice note and a Pravki screenshot are base64 blobs — alive
// with nothing left to reach them by. Named in ONE place because a task can
// be deleted directly or swept up when its last channel goes, and the two
// paths drifting apart is how the leak started.
//
// `activity` is the deliberate exception: it writes down names and titles at
// the moment of the change so the log still reads like a sentence afterwards.
export const TASK_CHILD_TABLES = [
  'attachments', 'voice_notes', 'pravka_files', 'reference_media', 'comments', 'revisions', 'revision_notes', 'date_requests', 'undo_moves', 'task_flags',
  'notifications',   // a bell line pointing at a task nobody can open is a dead end
  // A repost row belongs to both ends: the source that made it and the repost
  // task it made. Either one gone, the row goes; the other task stays.
  'content_reposts',
  // A dropped file's row: the task gone, the file is still in Drive, and the
  // watcher finds it again and lists it under Unmatched.
  'drive_drops',
  // An upload's History line: the task gone, there is nothing left to fix on it.
  'drive_uploads',
]
const CHILD_WHERE = { content_reposts: 'source_id = ? OR repost_id = ?' }
export const taskChildDeletes = (id) =>
  TASK_CHILD_TABLES.map((t) => (CHILD_WHERE[t]
    ? [`DELETE FROM ${t} WHERE ${CHILD_WHERE[t]}`, id, id]
    : [`DELETE FROM ${t} WHERE content_id = ?`, id]))

// Sprint tasks are never deleted — round 85 made dropping the only way off a
// board, because a week whose numbers change after the week is over is not a
// record. The cascade that used to take a sprint task's week rows, checklists,
// assignees and files with it went with the delete that called it.

// The sprint board needs a week to stand on, and one only: the week we are
// in. No users, no owners, no sample tasks — sprint_owners ships empty on
// purpose and is filled by hand after deploy.
//
// Idempotent by the week's own start, so a restart on Tuesday does not open
// a second sprint, and a board that was closed on Saturday does not have its
// history reopened by a boot on Sunday.
// The first sprint owner.
//
// The table ships empty by design and was meant to be filled in by hand after
// the first deploy, which is fine for one row and no way to run a team. This
// puts the first one in so the module is usable the moment it lands; every
// change after that is made in Admin, where an admin can add and remove
// owners without touching the database.
//
// It runs once ever, and "once" starts when the person is actually found. A
// flag burned on a board where they do not exist yet would mean they never
// become an owner however long they are on the team afterwards. Written the
// moment they are made one, so an admin taking it away later sticks, and a
// restart does not put them back.
const FIRST_SPRINT_OWNER = 'Asadbek Urakov'
export async function ensureFirstSprintOwner() {
  if (await get("SELECT value FROM meta WHERE key = 'sprint_owner_seeded'")) return
  const name = FIRST_SPRINT_OWNER.trim().toLowerCase()
  const first = name.split(/\s+/)[0]
  const who = await get(
    `SELECT id FROM users
      WHERE lower(name) = ? OR lower(username) = ? OR lower(username) = ?
      ORDER BY CASE WHEN lower(name) = ? THEN 0 ELSE 1 END LIMIT 1`,
    name, name.replace(/\s+/g, ''), first, name)
  if (!who) return
  try { await run('INSERT INTO sprint_owners (user_id) VALUES (?)', who.id) } catch { /* already one */ }
  await run("INSERT INTO meta (key, value) VALUES ('sprint_owner_seeded', ?)", new Date().toISOString())
}

// Keys an admin typed into the panel.
//
// They live in meta beside the other deployment facts. They are never sent to
// a browser: the panel is told a key exists and where it came from, never what
// it is. ai.js keeps them in memory because secret() is called on every
// request; this is what fills that memory, at boot and after each save.
export async function saveAiKey(envName, value) {
  const key = `ai_key_${envName}`
  if (value) await run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  else await run('DELETE FROM meta WHERE key = ?', key)
}
export async function loadAiKeys() {
  const rows = await all("SELECT key, value FROM meta WHERE key LIKE 'ai_key_%'")
  const map = {}
  for (const r of rows) if (r.value) map[r.key.slice('ai_key_'.length)] = r.value
  const { useTypedKeys } = await import('./ai.js')
  useTypedKeys(map)
  return Object.keys(map)
}

export async function ensureCurrentSprint() {
  const { weekOf } = await import('./sprintweek.js')
  const week = weekOf()
  const already = await get('SELECT id FROM sprints WHERE start_at = ?', week.start_at)
  if (already) return already.id
  try {
    const info = await run(
      'INSERT INTO sprints (code, start_at, freeze_at, meeting_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      week.code, week.start_at, week.freeze_at, week.meeting_at, 'active', new Date().toISOString())
    return info.lastInsertRowid
  } catch {
    // Somebody else inserted this week between the check and the write. The
    // unique index caught it; the row we wanted exists either way.
    return (await get('SELECT id FROM sprints WHERE start_at = ?', week.start_at))?.id ?? null
  }
}

export const CREW_NEED_KEYS = ['operator', 'editor', 'designer']
export const DEFAULT_CREW_NEEDS = {
  operator: ['reel', 'video'],
  editor: ['reel', 'video'],
  designer: ['post'],
}
export async function getCrewNeeds() {
  let stored = {}
  try {
    stored = JSON.parse((await get("SELECT value FROM meta WHERE key = 'crew_needs'"))?.value || '{}')
    if (!stored || typeof stored !== 'object') stored = {}
  } catch { stored = {} }
  const out = {}
  for (const k of CREW_NEED_KEYS) {
    out[k] = Array.isArray(stored[k])
      ? stored[k].map(String).filter((t) => ALL_TYPES.includes(t))
      : [...DEFAULT_CREW_NEEDS[k]]
  }
  return out
}

// Task types a piece can be. 'target' is paid promotion — a creative made
// for an ad set rather than for the feed.
export const CONTENT_TYPES = ['post', 'reel', 'story', 'video', 'target', 'other']

// ---- what kind of surface a channel is -------------------------------------
//
// The board knew what a piece WAS (a post, a reel) and never where it was
// going, so one set of rules had to cover every channel at once. A written
// Telegram announcement was asked for artwork, a designer and a reference
// image, because somewhere a rule says a 'post' needs those — and it does, on
// Instagram.
//
// A format is the second half of that question. It is named for the shape of
// the surface rather than for a brand, because a board that adds Threads next
// year should not need a code change to describe it.
//
//   crew    the hats a task on this channel can need at all. The type rules
//           still decide which of them THIS piece needs; the format can only
//           take a hat off the table, never put one on.
//   fields  the brief fields worth asking for here, same way round.
//
// Nothing here is a permission and nothing here is a deadline: it is the list
// of questions worth asking. A format that allows a field still leaves the
// admin's own off/optional/required setting in charge of it.
export const CHANNEL_FORMATS = {
  social: {
    label: 'Social feed',
    hint: 'Images and video in a feed — Instagram, TikTok',
    crew: ['operator', 'editor', 'designer'],
    fields: ['format', 'rubrika', 'script', 'tz', 'reference', 'description'],
  },
  text: {
    label: 'Written channel',
    hint: 'Words go out — Telegram, announcements, a blog. Nobody films or designs.',
    crew: [],
    fields: ['rubrika', 'description'],
  },
  // Short written posts with a length limit — X, Threads, LinkedIn. Written
  // like 'text' (nobody films or designs; the client reads both as a written
  // channel), but kept apart from it because 'text' is Telegram's: its item
  // type and the copywriter's per-item pay are Telegram's categories and mean
  // nothing on X. A post here that carries a video or a picture says so on the
  // task (with_media) and is judged as 'social' instead.
  short: {
    label: 'Short posts',
    hint: 'Short written posts with a length limit — X, Threads, LinkedIn',
    crew: [],
    fields: ['rubrika', 'description'],
  },
  // A finished video posted again — TikTok, YouTube Shorts. Nothing is made
  // here: the repost task arrives at Ready with the source's video and caption
  // (server/reposts.js), and its one step is to post it and paste the link.
  repost: {
    label: 'Reposts',
    hint: 'A finished video posted again — TikTok, YouTube Shorts. Nobody films or edits: it arrives ready and goes out.',
    crew: [],
    fields: ['description'],
  },
  video: {
    label: 'Long video',
    hint: 'YouTube and anything else filmed and edited at length',
    // A designer belongs here, and leaving them out was a real hole rather
    // than a tidy simplification: the thumbnail is the most looked-at image a
    // YouTube channel makes, and end cards and covers are drawn too. Found by
    // round43, which asks a post on YouTube for its designer and was right to.
    crew: ['operator', 'editor', 'designer'],
    fields: ['format', 'rubrika', 'script', 'tz', 'reference', 'description'],
  },
  ads: {
    label: 'Paid promotion',
    hint: 'Creatives made for an ad set rather than for a feed',
    crew: ['operator', 'editor', 'designer'],
    fields: ['rubrika', 'reference', 'description'],
  },
}
export const CHANNEL_FORMAT_KEYS = Object.keys(CHANNEL_FORMATS)

// ---- how a person is paid ---------------------------------------------------
//
// Not at WHAT RATES — that is the rate card — but by what arrangement. A board
// that runs one arrangement for everybody is a board that cannot hire the next
// person on different terms without somebody keeping the difference in a
// spreadsheet, which is where pay disputes come from.
//
//   earns   where the month's earnings come from: the piecework the rate card
//           works out, the graded KPI card, or nothing at all
//   floor   whether a safety pillow stands under the result
//
// THE PILLOW IS A FLOOR, NOT A BONUS. Work fills it. A month the company could
// not fill is still paid in full; a month that ran past it is paid for what
// was actually done. max(pillow, earned) — and writing it down here because
// "X plus the work he did" can be read two ways and only one of them is a
// pillow. The payslip draws the top-up as its own line so the arithmetic is on
// screen rather than in somebody's head.
export const PAY_SCHEMES = {
  piece: {
    label: 'Piecework',
    hint: 'Base, the per-piece rates and the bonuses — what every card did before schemes existed.',
    earns: 'piece', floor: false, kpi: false,
  },
  fixed: {
    label: 'Fixed salary',
    hint: 'The base, whatever the month held. Nothing is counted per piece.',
    earns: 'base', floor: false, kpi: false,
  },
  kpi: {
    label: 'Full KPI',
    hint: 'The month is the KPI card: its fixed part and whatever the ladders graded.',
    earns: 'kpi', floor: false, kpi: true,
  },
  fixed_kpi: {
    label: 'Fixed + KPI',
    hint: 'A salary that does not move, and the KPI card on top of it.',
    earns: 'base+kpi', floor: false, kpi: true,
  },
  pillow: {
    label: 'Safety pillow, then piecework',
    hint: 'Guaranteed the pillow. Piecework fills it; anything past it is paid on top.',
    earns: 'piece', floor: true, kpi: false,
  },
  pillow_kpi: {
    label: 'Safety pillow, then KPI',
    hint: 'Guaranteed the pillow. The KPI card fills it; anything past it is paid on top.',
    earns: 'kpi', floor: true, kpi: true,
  },
}
export const PAY_SCHEME_KEYS = Object.keys(PAY_SCHEMES)
export const schemeOf = (v) => (PAY_SCHEMES[v] ? v : 'piece')
export const formatOf = (row) =>
  (row && CHANNEL_FORMATS[row.format]) ? row.format : 'social'

// Every channel that existed before formats did gets the one it obviously is,
// once, from its own icon and key — a board should not have to go and re-teach
// the app what its Telegram channel is. Anything unrecognised stays 'social',
// which is exactly how the board behaved before this existed, so a guess that
// misses changes nothing. After this runs the admin's own choice is the truth
// and nothing here looks again.
const FORMAT_GUESS = [
  [/telegram|blog|news|announce/i, 'text'],
  [/youtube|yt\b|video/i, 'video'],
  [/target|\bads?\b|promo/i, 'ads'],
]
// ---- X, LinkedIn and Threads (October 2026) ---------------------------------
// Three written channels, added to the live board by a migration rather than
// by seedIfEmpty, which only ever runs on an empty database. Once, behind a
// meta flag, so a channel an admin later deletes stays deleted; and each row
// is ON CONFLICT DO NOTHING on the unique key, so two pm2 copies booting at
// once — the server has run two — still leave one of each.
//
// Their tasks are Jahongir's (the owner's call): the channel head is the first
// account whose name starts with Jahongir, looked up now. Nobody is added as a
// member — members are added like on any channel, and admins see every
// channel already.
const TEXT_CHANNELS = [
  ['x_twitter', 'X (Twitter)', 'pen', 280],
  ['linkedin', 'LinkedIn', 'globe', 3000],
  ['threads', 'Threads', 'megaphone', 500],
]
export async function addTextChannels() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'text_channels_2026_10'")) return
  const head = await get("SELECT id FROM users WHERE LOWER(name) LIKE 'jahongir%' ORDER BY id LIMIT 1")
  let sort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM channels')).m
  for (const [key, label, icon, limit] of TEXT_CHANNELS) {
    if (await get('SELECT 1 AS x FROM channels WHERE key = ?', key)) continue
    sort += 1
    await run(`INSERT INTO channels (key, label, icon, head_id, format, char_limit, sort) VALUES (?, ?, ?, ?, 'short', ?, ?)
      ON CONFLICT(key) DO NOTHING`, key, label, icon, head?.id ?? null, limit, sort)
  }
  await run("INSERT INTO meta (key, value) VALUES ('text_channels_2026_10', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    head ? `head ${head.id}` : 'no head')
}

// ---- TikTok and YouTube Shorts (October 2026) -------------------------------
// Two channels a finished Instagram video is posted on again. Kept apart from
// the block above so the two migrations can be read, and reverted, alone.
//
// Added the way X, LinkedIn and Threads were: once, behind a meta flag, so a
// channel an admin deletes stays deleted; only when the key is missing, so a
// TikTok channel somebody already made is left exactly as it is; and ON
// CONFLICT DO NOTHING on the unique key, so two pm2 copies booting at once
// still leave one of each. Format 'repost' (CHANNEL_FORMATS): the path is
// Ready -> Published. The head is the first account named Jahongir, if any —
// the repost tasks are his (server/reposts.js finds him again on every
// publish, by name). Nobody is added as a member.
//
// The same flag switches `video` on for Instagram Main and Instagram Uzb, the
// two accounts whose videos go on to them.
export const REPOST_CHANNELS = [
  ['tiktok', 'TikTok', 'music'],
  ['youtube_shorts', 'YouTube Shorts', 'youtube'],
]
export async function addRepostChannels() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'repost_channels_2026_10'")) return
  const head = await get("SELECT id FROM users WHERE LOWER(name) LIKE 'jahongir%' ORDER BY id LIMIT 1")
  let sort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM channels')).m
  for (const [key, label, icon] of REPOST_CHANNELS) {
    if (await get('SELECT 1 AS x FROM channels WHERE key = ?', key)) continue
    sort += 1
    await run(`INSERT INTO channels (key, label, icon, head_id, format, sort) VALUES (?, ?, ?, ?, 'repost', ?)
      ON CONFLICT(key) DO NOTHING`, key, label, icon, head?.id ?? null, sort)
  }
  await run("UPDATE channels SET video = 1 WHERE key IN ('instagram_main', 'instagram_uzb')")
  await run("INSERT INTO meta (key, value) VALUES ('repost_channels_2026_10', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    head ? `head ${head.id}` : 'no head')
}

async function guessChannelFormats() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'channel_formats_guessed'")) return
  for (const c of await all('SELECT id, key, label, icon FROM channels')) {
    const hay = `${c.key} ${c.label} ${c.icon}`
    const hit = FORMAT_GUESS.find(([re]) => re.test(hay))
    if (hit) await run('UPDATE channels SET format = ? WHERE id = ?', hit[1], c.id)
  }
  await run("INSERT INTO meta (key, value) VALUES ('channel_formats_guessed', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

const now = () => new Date().toISOString()

export async function seedIfEmpty() {
  if ((await get('SELECT COUNT(*) AS n FROM users')).n > 0) return
  // No users, over a database GitHub already holds, is not a first boot: it
  // is this machine looking at the wrong file. Seeding it is how the team's
  // data was replaced on 9 October 2026.
  if ((await backend()).heldData?.()) throw new Error('refusing to seed: the stored database has data and this copy has no users')

  // A fresh database starts clean: the team's channels, the pipeline stages,
  // and a single admin account. No demo members, metrics or tasks — the admin
  // creates real ones in the app (change the admin password right away).
  const channels = [
    ['instagram_main', 'Instagram Main', 'instagram'],
    ['instagram_uzb', 'Instagram Uzb', 'instagram'],
    ['telegram_uzb', 'Telegram Uzb', 'telegram'],
    ['telegram_main', 'Telegram Main', 'telegram'],
    ['target', 'Target', 'target'],
    ['youtube', 'YouTube', 'youtube'],
  ]

  // ---- pipeline statuses ----
  // Five working stages and a graveyard. There used to be a sixth, Shot,
  // between the shoot and the edit — a column whose only job was to be left,
  // because footage that is shot is footage the editor can start on.
  //
  // Deleted is the graveyard: a planned or filmed piece that was killed. It
  // stays on the record (the planner's and operator's work happened) but
  // stops counting for the editor.
  const statusList = [
    ['Idea', '#8b8388', 0],
    ['To shoot', '#fab219', 0],
    ['Editing', '#CB3351', 0],
    ['Ready', '#2a78d6', 0],
    ['Published', '#0ca30c', 1],
    ['Deleted', '#6d6a70', 0],
  ]

  await batch([
    ...channels.map(([key, label, icon], i) =>
      ['INSERT INTO channels (key, label, icon, sort) VALUES (?, ?, ?, ?)', key, label, icon, i]),
    ...statusList.map(([label, color, final], i) =>
      ['INSERT INTO statuses (label, color, sort, is_final) VALUES (?, ?, ?, ?)', label, color, i, final]),
    [`
      INSERT INTO users (name, username, email, password_hash, role, departments, permissions, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, 'Admin', 'admin', null, bcrypt.hashSync('admin123', 10), 'admin', '[]', '{}', '#A22036', now()],
  ])
}

// The team's July–December campaign plan. Seeds once (also into existing
// databases), then never again — the admin owns the data from there.
export async function seedCampaignsIfEmpty() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'campaigns_seeded'")) return
  const stmts = []
  if ((await get('SELECT COUNT(*) AS n FROM campaigns')).n === 0) {
    const Y = new Date().getFullYear()
    const m = (mm) => `${Y}-${String(mm).padStart(2, '0')}`
    const plan = [
      { name: 'Admissions Hype', timing: 'July 10–15', channel: 'All channels + offline banners in key locations',
        audience: 'Internal for aura, external for awareness', goal: 'Stay top of mind in the college-prep community',
        duration: 'short', owner: 'Ourselves', months: [m(7)] },
      { name: 'Free App Launch', timing: 'July 15 – August 1', channel: 'All digital channels',
        audience: 'Self-preps and their parents', goal: 'Build brand awareness and consideration',
        notes: 'Depends on IT shipping a good product', duration: 'short', owner: 'Ourselves',
        status: 'Depends on IT delivery', months: [m(7), m(8)] },
      { name: 'Alumni Event', timing: 'August 22', channel: 'Digital internal first, digital and news after',
        audience: 'All audiences', goal: 'Brand awareness, loyalty and referrals',
        duration: 'short', owner: 'Ourselves', months: [m(8)] },
      { name: 'Ochilish — Grand Opening', timing: 'September, announce 15 days before',
        channel: 'External news, private channel, bloggers, influencers',
        audience: 'Chilanzar locals for consideration, others for aura', goal: 'Show scale — SATashkent is big',
        notes: 'Chilanzar branch', duration: 'short', owner: 'Ourselves', months: [m(9)] },
      { name: '20 Prep Students', timing: 'Starts once an owner is assigned', channel: 'Instagram, Telegram Uzbek, YouTube',
        audience: 'All audiences', goal: 'Constant exposure — show what happens inside',
        notes: 'Series following 20 students preparing', duration: 'long',
        status: 'Blocked — needs an owner before launch', ongoing: true },
      { name: 'Ambassadorlar', timing: 'Plan in August, launch in September', channel: 'Set by each ambassador',
        audience: 'Set by each ambassador', goal: 'SATashkent is global, not only local',
        notes: 'Pay top university students per video in August', duration: 'long', months: [m(8), m(9)] },
      { name: 'Kazakh Online Campaign', timing: 'July 15 onward', channel: 'satashkent.kz',
        audience: 'Kazakh audience and Shoxrux', goal: 'Run the second Kazakh Marathon',
        notes: '1–2 posts per month on the main account', duration: 'long', owner: 'Abdulaziz', ongoing: true },
      { name: 'Student Union Events', timing: 'Set by UB', channel: 'Instagram and Telegram where they fit',
        audience: 'Regional and priority audience', goal: 'Stay top of mind',
        notes: 'The Union runs regional events, we cover them', duration: 'long', owner: 'UB',
        status: 'Needs coordination with UB', ongoing: true },
      { name: 'YouTube', timing: 'July onward', channel: 'YouTube',
        audience: 'Learners and general audience', goal: 'High value and high conversion',
        duration: 'long', status: 'Needs a full owner', ongoing: true },
      { name: 'Football Competition', timing: 'Set by UB', channel: 'Where it fits',
        audience: 'Schools and lyceums', goal: 'The event everyone wants — SATashkent owns UC',
        notes: 'Confirmed', duration: 'short', owner: 'Ourselves', ongoing: true },
    ]
    plan.forEach((c, i) => stmts.push([`
      INSERT INTO campaigns (name, timing, channel, audience, goal, notes, duration, owner, status, ongoing, months, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, c.name, c.timing || '', c.channel || '', c.audience || '', c.goal || '', c.notes || '',
      c.duration || 'short', c.owner || '', c.status || '', c.ongoing ? 1 : 0,
      JSON.stringify(c.months || []), i]))
  }
  stmts.push(["INSERT INTO meta (key, value) VALUES ('campaigns_seeded', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value"])
  await batch(stmts)
}

// One-time reclassification (July 2026 spec): long-running rows in the old
// campaign plan become projects, the "YouTube" row dies (it is a channel),
// and old prose fields (timing / audience / free-text status) move into an
// imported note. Everything else stays a campaign, as an Idea until its
// owner, dates and target are filled in.
// Projects grow many numbers and tickable criteria (Sept 2026).
//
// Runs once, guarded by a meta key, and writes ONLY into the new columns:
// metric, target, actual and success are left exactly as they were. If this
// turns out wrong, the old shape is still sitting in the row to rebuild from.
//
// What it does, per project:
//   the single metric/target/actual  →  the first number
//   the success paragraph            →  one criterion per sentence, unticked
//   any status                       →  On track
//
// planProjectMigration() decides all of that. A project already holding numbers or criteria is skipped, which makes
// this safe to re-run and safe to land on a board somebody has already edited.
async function migrateProjectShape() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'project_shape_v2'")) return
  const rows = await all('SELECT * FROM projects')
  let moved = 0
  for (const row of rows) {
    const plan = planProjectMigration(row)
    if (plan.skipped) continue
    await run('UPDATE projects SET numbers = ?, criteria = ?, status = ?, status_reason = ? WHERE id = ?',
      JSON.stringify(plan.to.numbers), JSON.stringify(plan.to.criteria),
      plan.to.status, plan.to.status_reason, row.id)
    moved++
  }
  if (rows.length) console.log(`\u2192 projects: moved ${moved} of ${rows.length} to numbers + criteria`)
  await run("INSERT INTO meta (key, value) VALUES ('project_shape_v2', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// Projects handed to an account that no longer exists, handed back.
//
// An ambassador account was made under a staff member's own name, and sat in
// the project owner list beside the real one with nothing to tell the two
// apart. Three projects went to the wrong "Asadbek Urakov". When that
// ambassador was later removed, their username was scrambled and their
// password replaced — so the projects were left owned by an account nobody
// can sign in to, missing from their real owner's "Mine", and uneditable by
// anyone but an admin.
//
// The rule is deliberately narrow, because this rewrites who owns things:
//   - only projects and campaigns owned by a REMOVED account move — their
//     ownership is already broken, so nothing that works is being changed;
//   - only to an active, non-ambassador account with EXACTLY the same name;
//   - only when there is exactly ONE such account. Two candidates means a
//     human has to choose, so it is left alone and said in the log.
// Runs once. The owner check in pcmodel.js stops it recurring.
async function repairGhostOwners() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'ghost_owner_repair_v1'")) return
  // substr, not LIKE: in a LIKE pattern the underscore is itself a wildcard.
  const ghosts = await all("SELECT id, name FROM users WHERE substr(username, 1, 8) = 'removed_'")
  for (const g of ghosts) {
    const projects = (await get('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?', g.id))?.n || 0
    const campaigns = (await get('SELECT COUNT(*) AS n FROM campaigns WHERE owner_id = ?', g.id))?.n || 0
    if (!projects && !campaigns) continue
    const heirs = await all(
      "SELECT id FROM users WHERE name = ? AND id != ? AND role != 'ambassador' AND substr(username, 1, 8) != 'removed_'",
      g.name, g.id)
    if (heirs.length !== 1) {
      console.log(`\u2192 owners: ${projects} project(s) of removed account ${g.id} left alone \u2014 ${heirs.length} accounts named ${JSON.stringify(g.name)}`)
      continue
    }
    await run('UPDATE projects SET owner_id = ? WHERE owner_id = ?', heirs[0].id, g.id)
    await run('UPDATE campaigns SET owner_id = ? WHERE owner_id = ?', heirs[0].id, g.id)
    console.log(`\u2192 owners: ${projects} project(s) and ${campaigns} campaign(s) moved from removed account ${g.id} to ${heirs[0].id} (${g.name})`)
  }
  await run("INSERT INTO meta (key, value) VALUES ('ghost_owner_repair_v1', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// What two fixed bugs had already left behind, put right once.
//
//   - Deleting an account cleared the single assignee column and left the
//     person's id inside the JSON lists beside it (assignees, reviewers,
//     faces), so a piece went on naming somebody who is not there. The delete
//     now takes the id out of the lists; this does the same for the rows it
//     missed. Only ids that match NO account are removed, and the mirror
//     column takes the next name on the list.
//   - A sprint idea given a column through PATCH /sprints/tasks/:id left the
//     Backlog without ever joining a week: it showed on no board and could
//     not be promoted ("already in a sprint"). That route now refuses; the
//     tasks it stranded go back to being ideas, which is the last place
//     anybody could see them. Dropped tasks are left alone.
// Runs once.
async function repairAuditLeftovers() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'audit_repairs_2026_10'")) return
  const real = new Set((await all('SELECT id FROM users')).map((u) => u.id))
  const LISTS = { assignees: 'assignee_id', reviewers: 'reviewer_id', faces: 'face_id' }
  let pieces = 0
  for (const row of await all('SELECT id, assignees, reviewers, faces FROM content')) {
    for (const [list, mirror] of Object.entries(LISTS)) {
      let ids = []
      try { ids = JSON.parse(row[list] || '[]') } catch { continue }
      if (!Array.isArray(ids) || ids.every((id) => real.has(Number(id)))) continue
      const kept = ids.filter((id) => real.has(Number(id)))
      await run(`UPDATE content SET ${list} = ?, ${mirror} = ? WHERE id = ?`, JSON.stringify(kept), kept[0] ?? null, row.id)
      pieces += 1
    }
  }
  if (pieces) console.log(`→ repairs: ${pieces} list(s) no longer name an account that is gone`)
  const stranded = await all(`
    SELECT id FROM sprint_tasks
    WHERE status != 'idea' AND dropped_at IS NULL
      AND id NOT IN (SELECT task_id FROM sprint_task_sprints)`)
  for (const t of stranded) await run("UPDATE sprint_tasks SET status = 'idea' WHERE id = ?", t.id)
  if (stranded.length) console.log(`→ repairs: ${stranded.length} sprint task(s) that were on no board are back in the Backlog`)
  await run("INSERT INTO meta (key, value) VALUES ('audit_repairs_2026_10', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// The first superadmin.
//
// Somebody has to be able to open the people board before anybody can be
// given the rank, and a rank that a deploy hands out to whoever happens to be
// admin number one is not a decision anybody made. This names the account it
// was asked for and nothing else: if that username is not on this database —
// a colleague's laptop, a test copy — nobody gets it, and the board stays
// shut rather than falling open to the first row in the table.
//
// Afterwards it is the superadmins' own business. Granting lives in
// server/routes/people.js and is refused to everybody else, this one included:
// re-running the migration cannot take the rank back or move it.
async function seedSuperadmin() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'superadmin_seed_v1'")) return
  const who = await get('SELECT id, name, superadmin FROM users WHERE username = ?', 'asadbek')
  if (!who) {
    console.log('\u2192 people board: nobody named asadbek here, so no superadmin was made')
  } else if (who.superadmin) {
    console.log(`\u2192 people board: ${who.name} is already a superadmin`)
  } else {
    await run('UPDATE users SET superadmin = 1 WHERE id = ?', who.id)
    console.log(`\u2192 people board: ${who.name} (${who.id}) is the first superadmin`)
  }
  await run("INSERT INTO meta (key, value) VALUES ('superadmin_seed_v1', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

async function migrateCampaignsToProjects() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'projects_migrated'")) return
  const rows = await all('SELECT * FROM campaigns')
  const toProject = ['Kazakh Online Campaign', 'Ambassadorlar', 'Student Union Events']
  const nowIso = new Date().toISOString()
  for (const c of rows) {
    if (c.name === 'YouTube') { await run('DELETE FROM campaigns WHERE id = ?', c.id); continue }
    const owner = c.owner
      ? await get('SELECT id FROM users WHERE name = ? OR username = ?', c.owner, String(c.owner).toLowerCase())
      : null
    const prose = [
      c.timing ? `Timing: ${c.timing}` : '',
      c.channel ? `Channels: ${c.channel}` : '',
      c.audience ? `Audience: ${c.audience}` : '',
      c.status ? `Status: ${c.status}` : '',
      c.owner && !owner ? `Owner: ${c.owner}` : '',
      c.notes || '',
    ].filter(Boolean).join(' · ')
    if (toProject.includes(c.name)) {
      const info = await run(
        "INSERT INTO projects (name, owner_id, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",
        c.name, owner?.id ?? null, c.goal || '', nowIso)
      if (prose) await run('INSERT INTO notes (kind, ref_id, author_id, text, created_at) VALUES (?, ?, NULL, ?, ?)',
        'project', info.lastInsertRowid, `Imported from the old campaign plan — ${prose}`, nowIso)
      await run('DELETE FROM campaigns WHERE id = ?', c.id)
    } else {
      await run("UPDATE campaigns SET owner_id = ?, stage = 'idea' WHERE id = ?", owner?.id ?? null, c.id)
      if (prose) await run('INSERT INTO notes (kind, ref_id, author_id, text, created_at) VALUES (?, ?, NULL, ?, ?)',
        'campaign', c.id, `Imported from the old campaign plan — ${prose}`, nowIso)
    }
  }
  await run("INSERT INTO meta (key, value) VALUES ('projects_migrated', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// One-time import (July 2026): the team's ClickUp content plan lands on the
// Instagram Main release calendar. Their pipeline maps 1:1 onto ours
// (SYOMKA QILINADI→To shoot · MONTAJDA→Editing · TAYYOR→Ready ·
// INSTAGRAM CHIQDI→Published). Cards already released are recorded as
// Published/done on their real dates; upcoming ones wait in To shoot.
// Deleted ClickUp cards were left out. Runs once (meta flag), and each row
// double-checks for an existing title+date so nothing ever duplicates.
async function importJulyIgPlan() {
  // Real deployments only — scratch file databases (tests, local hacking)
  // shouldn't inherit the team's live plan. IG_PLAN_FORCE=1 overrides.
  if (STORAGE === 'file' && process.env.IG_PLAN_FORCE !== '1') return
  // v2: re-checks every row (fills anything a partial v1 run missed) and
  // carries the fuller titles read from the zoomed ClickUp screenshots.
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'ig_plan_2026_07_v2'")) return
  const setFlag = () =>
    run("INSERT INTO meta (key, value) VALUES ('ig_plan_2026_07_v2', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  const chan = await get("SELECT key FROM channels WHERE key = 'instagram_main'")
  if (!chan) { await setFlag(); return } // channel gone — nowhere to import
  // Rows a v1 run may have created under the shorter guessed titles.
  const RENAMES = [
    ['2026-06-30', 'Educational Video — what ECs are helpful', 'Educational Video — what ECs are helpful and which aren’t'],
    ['2026-07-02', 'Educational Video — Rating the recommendations', 'Educational Video — Rating the recommendations (Diyor)'],
    ['2026-07-04', 'Info Video — 1-1 sessions with CTA (Mirabbos)', 'Info Video — 1-1 sessions with CTA (Mirabbos and Jasmina)'],
    ['2026-07-08', 'Educational Video — After receiving 610 in the SAT', 'Educational Video — After receiving 610 in the English section'],
    ['2026-07-11', 'Info Video — SU how it works (Mirabbos)', 'Info Video — SU how it works (Mirabbos and Jasmina)'],
    ['2026-07-22', 'Educational Video with CTA', 'Educational Video with CTA (How did this guy receive 1500+?)'],
  ]
  for (const [date, oldTitle, newTitle] of RENAMES) {
    await run("UPDATE content SET title = ? WHERE title = ? AND release_date = ? AND channels LIKE '%instagram_main%'",
      newTitle, oldTitle, date)
  }
  const V = 'video', P = 'post', B = 'Branding', S = 'Sales'
  const PLAN = [
    ['2026-06-29', 'AP: What’s your AP?', V, B],
    ['2026-06-29', 'AP Results Main', V, B],
    ['2026-06-29', 'AP Results Trial N1', V, B],
    ['2026-06-29', 'AP Results Trial N2', V, B],
    ['2026-06-30', 'Educational Video — what ECs are helpful and which aren’t', V, B],
    ['2026-07-01', 'Results Analytics Post — Ulugbek', P, B],
    ['2026-07-02', 'Educational Video — Rating the recommendations (Diyor)', V, B],
    ['2026-07-03', 'Chelovechek find it', P, B],
    ['2026-07-04', 'Info Video — 1-1 sessions with CTA (Mirabbos and Jasmina)', V, B],
    ['2026-07-07', 'Educational Video (Solving June Math)', V, B],
    ['2026-07-08', 'AP Results Post', P, B],
    ['2026-07-08', 'Educational Video — After receiving 610 in the English section', V, B],
    ['2026-07-09', 'Results reel: Solohiddin', V, B],
    ['2026-07-09', 'Educational Video (Solving June Math)', V, B],
    ['2026-07-10', 'Ayyubkhon’s Project X Finalized', V, B],
    ['2026-07-10', 'AP Results Story of the Student', V, B],
    ['2026-07-11', 'Duels Sales', V, S],
    ['2026-07-11', 'Info Video — SU how it works (Mirabbos and Jasmina)', V, B],
    ['2026-07-13', 'AP Results Video', V, B],
    ['2026-07-14', 'Info video — reference to SATashkent', V, B],
    ['2026-07-15', 'Educational Video (Profile check)', V, B],
    ['2026-07-16', 'AP Results Video', V, B],
    ['2026-07-16', 'Educational Video', V, B],
    ['2026-07-17', 'Info video — reference to SATashkent', V, B],
    ['2026-07-17', 'Sales', V, S],
    ['2026-07-18', 'Random but viral content', V, B],
    ['2026-07-20', 'Educational Video (Solving June Math)', V, B],
    ['2026-07-21', 'SAT Results', V, B],
    ['2026-07-22', 'Educational Video with CTA (How did this guy receive 1500+?)', V, B],
    ['2026-07-23', 'SAT Results with CTA', V, B],
    ['2026-07-24', 'Sales', V, S],
    ['2026-07-25', 'Random but viral content', V, B],
  ]
  const statuses = await all('SELECT id, label, is_final FROM statuses ORDER BY sort, id')
  const byLabel = (l) => statuses.find((s) => s.label.toLowerCase() === l)?.id
  const published = byLabel('published') ?? statuses.find((s) => s.is_final)?.id ?? statuses.at(-1)?.id ?? null
  const toShoot = byLabel('to shoot') ?? statuses[1]?.id ?? statuses[0]?.id ?? null
  const admin = await get("SELECT id FROM users WHERE username = 'admin'")
  const today = dayISO(0)
  for (const [date, title, type, turi] of PLAN) {
    const dupe = await get(
      "SELECT id FROM content WHERE title = ? AND release_date = ? AND channels LIKE '%instagram_main%'", title, date)
    if (dupe) continue
    const past = date < today
    await run(`
      INSERT INTO content (title, channels, type, created_by, status_id, release_date, description, done_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, title, '["instagram_main"]', type, admin?.id ?? null,
      past ? published : toShoot, date,
      `Imported from the ClickUp content plan · Content turi: ${turi}`,
      past ? `${date}T07:00:00.000Z` : null, // noon Tashkent on its release day
      new Date().toISOString())
  }
  await setFlag()
}

// One-time recovery (July 2026): the team got locked out of the admin
// account, so on the next deploy 'admin' works with the documented password
// again. Runs exactly once (meta flag) — changing the password afterwards
// sticks, and this never fires again.
async function ensureAdminAccess() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'admin_reset_2026_07'")) return
  const row = await get("SELECT id FROM users WHERE username = 'admin'")
  const hash = bcrypt.hashSync('admin123', 10)
  if (row) {
    await run("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?", hash, row.id)
  } else {
    await run(`
      INSERT INTO users (name, username, email, password_hash, role, departments, permissions, color, created_at)
      VALUES ('Admin', 'admin', NULL, ?, 'admin', '[]', '{}', '#A22036', ?)
    `, hash, new Date().toISOString())
  }
  await run("INSERT INTO meta (key, value) VALUES ('admin_reset_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// A starter set of nudges, written once so the admin has something to send
// on the first day rather than a blank page. Each is disabled until somebody
// turns it on, and every word is editable — these are a starting point, not
// a policy. Added once; after that the list belongs to the admin.
async function seedTemplatesOnce() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'tg_templates_seeded'")) return
  const now = new Date().toISOString()
  const rows = [
    ['Is the week planned?',
      'Доброе утро! 🌅 Загляните в свой день: у всех ли задач этой недели есть дата съёмки и дата выхода?\n\nПять минут сейчас — и неделя пойдёт спокойно.',
      'linked', '[1]', 9],
    ['Does every task carry its brief?',
      'Привет! ✍️ Быстрая проверка: у каждой задачи есть описание и ТЗ?\n\nЧем понятнее задача, тем меньше правок потом — команда скажет спасибо.',
      'linked', '[3]', 11],
    ['Anything waiting on you?',
      'Добрый день! 👀 Если на вас висят правки или незакрытые задачи — самое время их разобрать.\n\nОдна закрытая задача сегодня — это минус один аврал завтра.',
      'linked', '[5]', 15],
    ['How did the week go?',
      'Пятница! 🎬 Отметьте выпущенное и перенесите то, что не успели.\n\nЧистая доска в пятницу — спокойный понедельник.',
      'linked', '[5]', 17],
    ['Shoot day tomorrow',
      'Завтра съёмочный день 🎥 Проверьте: техника, локация, сценарий и время у всех совпадают?\n\nЛучше сверить сегодня, чем переснимать потом.',
      'linked', '[]', 10],
  ]
  for (const [i, [title, text, audience, days, hour]] of rows.entries()) {
    await run(`INSERT INTO tg_templates (title, text, audience, days, hour, enabled, sort, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)`, title, text, audience, days, hour, i, now)
  }
  await run("INSERT INTO meta (key, value) VALUES ('tg_templates_seeded', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

// Schema + seeds, exactly once per process — server/index.js awaits this
// before the API answers. A failed attempt (storage briefly down) is not
// cached: the next boot attempt starts a fresh one instead of replaying the
// same rejection forever.
let initPromise
// ---- folding the Shot stage away -------------------------------------------
// The pipeline carried six working stages, and one of them existed only to be
// left: a piece landed on Shot the moment the operator ticked "filmed", and
// then waited for somebody to notice it and drag it to Editing. Footage that
// is shot IS footage the editor can start on, so the tick hands it straight
// over now and the column goes.
//
// A board that is already running cannot simply lose a column with work in
// it. Everything standing on Shot moves to the stage that follows it — the
// piece keeps its place in the pipeline, it just stops waiting in a room with
// no door. Runs once, on both engines, and does nothing at all on a board
// where an admin has since made their own stage called Shot again: the marker
// is written whether or not there was anything to fold.
async function foldShotStage() {
  if (await get("SELECT 1 AS x FROM meta WHERE key = 'fold_shot_stage'")) return
  const stages = await all('SELECT id, label, sort FROM statuses ORDER BY sort, id')
  const shot = stages.find((s) => /^shot$/i.test(String(s.label || '').trim()))
  if (shot) {
    // Where the work goes: the next stage along, which on the shipped
    // pipeline is Editing. Never the graveyard, and never nowhere.
    const after = stages.filter((s) => (s.sort > shot.sort || (s.sort === shot.sort && s.id > shot.id))
      && !/^deleted$/i.test(String(s.label || '')))
    const target = after.find((s) => /^editing$|^edit$/i.test(String(s.label || ''))) || after[0]
    if (target) {
      await run('UPDATE content SET status_id = ? WHERE status_id = ?', target.id, shot.id)
      // The admin's stage rules are keyed by status id in a meta blob; the
      // entry for a stage that no longer exists is an answer to a question
      // nobody can ask, so it goes with it.
      try {
        const raw = await get("SELECT value FROM meta WHERE key = 'stage_rules'")
        const rules = JSON.parse(raw?.value || '{}')
        let touched = false
        for (const actor of Object.keys(rules || {})) {
          if (rules[actor] && rules[actor][String(shot.id)] !== undefined) {
            delete rules[actor][String(shot.id)]
            touched = true
          }
        }
        if (touched) {
          await run("INSERT INTO meta (key, value) VALUES ('stage_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            JSON.stringify(rules))
        }
      } catch { /* no rules stored, or unreadable — the stage still goes */ }
      await run('DELETE FROM statuses WHERE id = ?', shot.id)
    }
  }
  await run("INSERT INTO meta (key, value) VALUES ('fold_shot_stage', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

export function initDb() {
  initPromise ||= (async () => {
    await initSchema()
    await ensureCurrentSprint()
    await seedIfEmpty()
    await seedCampaignsIfEmpty()
    await migrateCampaignsToProjects()
    await migrateProjectShape()
    await repairGhostOwners()
    await repairAuditLeftovers()
    await seedSuperadmin()
    await loadAiKeys()
    await ensureFirstSprintOwner()
    await ensureAdminAccess()
    await importJulyIgPlan()
    await seedTemplatesOnce()
    await foldShotStage()
    await guessChannelFormats()
    await addTextChannels()
    await addRepostChannels()
    // The Target team's dashboard leads with launch programs — once, and only
    // if the admin hasn't customized that channel's layout yet.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'target_programs_default'"))) {
      await run("UPDATE channels SET dashboard = ? WHERE key = 'target' AND dashboard IS NULL",
        JSON.stringify(['programs', 'content']))
      await run("INSERT INTO meta (key, value) VALUES ('target_programs_default', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // Instagram Main outranks Instagram Uzb in the sidebar — once; after that
    // the admin's own reordering (Admin → Channels arrows) is the truth.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'ig_order_2026_07'"))) {
      const main = await get("SELECT id, sort FROM channels WHERE key = 'instagram_main'")
      const uzb = await get("SELECT id, sort FROM channels WHERE key = 'instagram_uzb'")
      if (main && uzb && main.sort > uzb.sort) {
        await run('UPDATE channels SET sort = ? WHERE id = ?', uzb.sort, main.id)
        await run('UPDATE channels SET sort = ? WHERE id = ?', main.sort, uzb.id)
      }
      await run("INSERT INTO meta (key, value) VALUES ('ig_order_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // The designer's clock got its own field. Posts used to borrow the
    // edit-ready date for design work — move those over, once.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'design_date_2026_07'"))) {
      await run(`
        UPDATE content SET design_ready_date = edit_ready_date, edit_ready_date = NULL
        WHERE type = 'post' AND edit_ready_date IS NOT NULL AND design_ready_date IS NULL
      `)
      await run("INSERT INTO meta (key, value) VALUES ('design_date_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // The design board's own columns. Seeded when the table is empty rather
    // than behind a meta flag, because "empty" is the honest question here:
    // it covers a fresh database and the live one equally, and an admin who
    // deletes every stage has told us something we should not silently undo
    // on the next boot — the delete route keeps one, so empty only ever means
    // "never filled".
    //
    // These are a starting point, not a contract. The admin renames, recolours
    // and reorders them like the content stages, and nothing in the server
    // reads them by name.
    if (!(await get('SELECT 1 AS x FROM design_statuses'))) {
      const designList = [
        ['New task', '#8b8388'],
        ['Sent back', '#CB3351'],
        ['In progress', '#2a78d6'],
        ['On hold', '#fab219'],
        ['Manager review', '#7d5bd6'],
        ['Approved', '#0ca30c'],
      ]
      await batch(designList.map(([label, color], i) =>
        ['INSERT INTO design_statuses (label, color, sort) VALUES (?, ?, ?)', label, color, i]))
    }
    // The Deleted stage (July 2026): killed content keeps its record instead
    // of vanishing. Added once to existing databases; the admin owns it after.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'deleted_status_2026_07'"))) {
      const have = await get("SELECT 1 AS x FROM statuses WHERE LOWER(label) = 'deleted'")
      if (!have) {
        const maxSort = (await get('SELECT COALESCE(MAX(sort), -1) AS m FROM statuses')).m
        await run("INSERT INTO statuses (label, color, sort, is_final) VALUES ('Deleted', '#6d6a70', ?, 0)", maxSort + 1)
      }
      await run("INSERT INTO meta (key, value) VALUES ('deleted_status_2026_07', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    }
    // Fix units minted by the old auto-pluralizer ("story" + s).
    await run("UPDATE trackers SET unit = 'stories' WHERE unit = 'storys'")
    // Handover stamps the board invented (September 2026). A move that did not
    // cross a gate used to stamp that gate's clock anyway — so a card already
    // in Editing had its SHOOT dated the moment the editor handed the cut on,
    // and the operator carried "delivered 40 days late" for a shoot done on
    // the day. The stamping is fixed in content.js; this clears the stamps it
    // had already written, once. Only stamps whose own paper-trail entry shows
    // a move that started past the gate are touched — see backfilledStamps.
    // Last in the sequence on purpose: every other migration, the stage fold
    // among them, has settled the pipeline this reads.
    //
    // Clearing is the honest repair, not a guess at the "real" moment: with no
    // stamp, a passed phase reads as on time and the report credits the work
    // on the day it was due, exactly as for every card nobody ever stamped.
    // What was cleared is kept, whole, in the meta row, so the repair can be
    // read back — or put back — by anybody who wants to check it.
    if (!(await get("SELECT 1 AS x FROM meta WHERE key = 'unstamp_backfilled_2026_09'"))) {
      const { backfilledStamps } = await import('./deadlines.js')
      const found = backfilledStamps(
        await all('SELECT id, shot_at, edited_at FROM content WHERE shot_at IS NOT NULL OR edited_at IS NOT NULL'),
        await all("SELECT content_id, created_at, old_value FROM activity WHERE field = 'stage'"),
        await all('SELECT id, label, sort, is_final FROM statuses'),
      )
      // `AND field = was`: a stamp that has changed since it was read is not
      // the one this was about, and is left as it is.
      if (found.length)
        await batch(found.map((f) => [`UPDATE content SET ${f.field} = NULL WHERE id = ? AND ${f.field} = ?`, f.id, f.was]))
      await run("INSERT INTO meta (key, value) VALUES ('unstamp_backfilled_2026_09', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        JSON.stringify(found))
    }
  })().catch((e) => { initPromise = undefined; throw e })
  return initPromise
}

// A user's crew capabilities as an array — the stored crew_roles when set,
// otherwise derived from the legacy single role. Multi-select lives here:
// ['editor','operator','designer'] in any combination.
export function crewRolesOf(row) {
  try {
    const arr = JSON.parse(row.crew_roles || '[]')
    if (Array.isArray(arr) && arr.length) return arr
  } catch { /* fall through to the legacy role */ }
  return { editor: ['editor'], operator: ['operator'], designer: ['designer'], crew: ['editor', 'operator'] }[row.role] || []
}

// API-safe user (no password hash); permissions merged with defaults.
// A study timetable, read back safely. Anything malformed is no timetable at
// all rather than a crash on somebody's profile: this is drawn on every
// booking screen, and a bad row must not take the picker down with it.
export function cleanStudyBlocks(v) {
  let raw = v
  if (typeof raw === 'string') { try { raw = JSON.parse(raw || '[]') } catch { return [] } }
  if (!Array.isArray(raw)) return []
  const hhmm = (x) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || '')) ? String(x) : null)
  return raw.map((b) => {
    const d = Number(b?.d)
    const from = hhmm(b?.from)
    const to = hhmm(b?.to)
    // A block that ends before it starts is not a block; nor is one on a day
    // that is not a day of the week.
    if (!Number.isInteger(d) || d < 0 || d > 6 || !from || !to || from >= to) return null
    return { d, from, to, label: String(b?.label || '').trim().slice(0, 40) }
  }).filter(Boolean).slice(0, 40)
}

export function publicUser(row) {
  if (!row) return null
  let perms = {}
  try { perms = JSON.parse(row.permissions || '{}') } catch { /* ignore */ }
  // Member defaults are for members. Crew roles (editor/operator/designer or
  // any mix) carry no granular rights at all — their powers come from being
  // on a task's crew.
  // An ambassador is not staff. They are a student with a login to one page,
  // and DEFAULT_PERMS would have handed them the rights of a member.
  const crew = ['editor', 'operator', 'designer', 'crew', 'ambassador'].includes(row.role)
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    weak_password: row.weak_password ? 1 : 0,
    email: row.email,
    role: row.role,
    crew_roles: crewRolesOf(row),
    departments: JSON.parse(row.departments || '[]'),
    // Which channels this admin runs. EMPTY means all of them, which is what
    // every admin was before this existed — so nobody's reach changed by the
    // column appearing.
    admin_channels: (() => { try { return JSON.parse(row.admin_channels || '[]') } catch { return [] } })(),
    // How many pieces this person can be given for one day. 0 = no ceiling,
    // which is what everyone was before this existed.
    daily_cap: row.daily_cap || 0,
    // The channels this crew member works on. EMPTY means all of them — again,
    // what everyone was — so nobody's reach narrowed when the column appeared.
    crew_channels: (() => { try { return JSON.parse(row.crew_channels || '[]') } catch { return [] } })(),
    permissions: crew ? {} : { ...DEFAULT_PERMS, ...perms },
    // Reads the people board, and may hand that out. A rank, not a right.
    superadmin: row.superadmin ? 1 : 0,
    color: row.color,
    // r11 · what this maker uses their ten piece colours for: 'own' (picked per
    // piece), 'stage', 'type', 'month', 'channel' or 'none'; and, for the
    // automatic ones, which of the ten each value gets. Everyone reads these,
    // so the crew sees a maker's pieces in the maker's colours.
    color_mode: row.color_mode || 'own',
    color_map: (() => { try { return JSON.parse(row.color_map || '{}') } catch { return {} } })(),
    avatar: row.avatar || null,
    phone: row.phone || null,
    position: row.position || null,
    duties: row.duties || null,
    work_start: row.work_start || null,
    work_end: row.work_end || null,
    work_days: (() => { try { return JSON.parse(row.work_days || 'null') } catch { return null } })(),
    // The repeating week this person is not available in — lectures, a second
    // job, anything. Read alongside the hours, because "at work 9-6" and
    // "free 9-6" are not the same sentence.
    study_blocks: cleanStudyBlocks(row.study_blocks),
    lang: row.lang || null,
    created_at: row.created_at,
  }
}

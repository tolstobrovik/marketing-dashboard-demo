import { Router } from 'express'
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import readline from 'node:readline'
import { dayISO, TRACK_DIR } from '../db.js'
import { authRequired, adminOnly, wrap } from '../auth.js'

const router = Router()

// ---- where people struggle (round 13) ----------------------------------------
//
// The owner, 14 Oct 2026: "track everything that is possible — a heatmap, and a
// daily and weekly file so that we know how to make it better, like where
// people reach out to close a task". Unlike /api/usage, which counts per day on
// purpose, this IS a log of moments, by name — the owner's decision, and the
// team is told in "What changed". What nobody's log holds is what they TYPE:
// the browser sends the label of what was pressed, never the value of a box.
//
// One file a day beside the database (DATA_DIR/track/2026-10-14.ndjson), never
// inside it: the database is pushed to GitHub whole on every change, and a
// day of clicks would make every push heavy. The deploy leaves DATA_DIR alone.
// Read back a line at a time, so a week is never held in memory as text.

const MAX_EVENTS = 300                    // one batch from one tab
const MAX_DAY_BYTES = 40 * 1024 * 1024    // a runaway tab stops filling the disk
const TYPES = new Set(['page', 'click', 'error', 'open', 'close', 'change', 'search'])
const str = (v, n) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n); return s || undefined }
const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined }
const fileOf = (day) => join(TRACK_DIR, `${day}.ndjson`)
// A real calendar day: 2026-02-31 is not one (it threw a 500 further down).
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s
// One of the board's own pages — never "//other.site", which the admin's heatmap
// button would have followed off the board (the hunt, 15 Oct 2026).
const ownPath = (v) => { const s = str(v, 120); return s && /^\/(?![/\\])/.test(s) ? s : undefined }
// What the board said no with, without what the person typed: the refusals quote
// it («тест» is a placeholder…), and typed words are never kept.
const unquoted = (v) => str(String(v ?? '').replace(/[«“"][^»”"]*[»”"]/g, '«…»'), 160)

// ---- in: a batch of what one person did -------------------------------------
// The body never names a person: the token does.
router.post('/', authRequired, wrap(async (req, res) => {
  const list = Array.isArray(req.body?.events) ? req.body.events.slice(0, MAX_EVENTS) : []
  if (!list.length) return res.json({ ok: true, n: 0 })
  mkdirSync(TRACK_DIR, { recursive: true })
  const file = fileOf(dayISO())
  if (existsSync(file) && statSync(file).size > MAX_DAY_BYTES) return res.json({ ok: true, n: 0, full: true })
  const now = Date.now()
  const lines = []
  for (const e of list) {
    if (!e || !TYPES.has(e.ty)) continue
    const at = num(e.t, now - 6 * 3600e3, now + 60e3) ?? now
    lines.push(JSON.stringify({
      at: new Date(at).toISOString(), u: req.user.id, n: str(req.user.name, 60), r: req.user.role, ty: e.ty,
      p: ownPath(e.p), from: ownPath(e.from), x: num(e.x, 0, 20000), y: num(e.y, 0, 400000),
      vw: num(e.vw, 0, 20000), vh: num(e.vh, 0, 20000), el: str(e.el, 80), tag: str(e.tag, 24),
      dead: e.dead ? 1 : undefined, rage: e.rage ? 1 : undefined, w: e.w ? 1 : undefined,
      task: num(e.task, 0, 1e9), ms: num(e.ms, 0, 864e5), k: num(e.k, 0, 1e5), msg: unquoted(e.msg),
    }))
  }
  if (lines.length) await appendFile(file, lines.join('\n') + '\n')
  res.json({ ok: true, n: lines.length })
}))

// ---- reading it back -------------------------------------------------------
async function* eventsOf(days) {
  for (const d of days) {
    const f = fileOf(d)
    if (!existsSync(f)) continue
    const rl = readline.createInterface({ input: createReadStream(f), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line) continue
      try { yield JSON.parse(line) } catch { /* a line cut by a crash */ }
    }
  }
}
// A page as one place: /campaigns/12 and /campaigns/40 are the same screen.
const pageOf = (p) => String(p || '/').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id') || '/'
const plusDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const mondayOf = (day) => plusDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))
const weekOf = (day) => Array.from({ length: 7 }, (_, i) => plusDays(mondayOf(day), i))
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const secs = (ms) => (ms < 60e3 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60e3)} min ${Math.round((ms % 60e3) / 1000)} s`)
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by)
const who = (set, names) => [...set].map((u) => names.get(u) || `#${u}`).slice(0, 6).join(', ') + (set.size > 6 ? ` +${set.size - 6}` : '')
const top = (m, n) => [...m.entries()].sort((a, b) => (b[1].n ?? b[1]) - (a[1].n ?? a[1])).slice(0, n)
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')
// ponytail: a hard cap on distinct keys per table; past it, presses count as "(other)".
const MAX_KEYS = 5000
const keyIn = (m, k) => (m.has(k) || m.size < MAX_KEYS ? k : `${k.split('␟')[0]}␟(other)`)

// Everything one report says, from one pass over the lines.
async function readDays(days) {
  const names = new Map()
  const people = new Map()     // u → { role, views, clicks, opens, changes, first, last }
  const pages = new Map()      // page → { views, people:Set, clicks, dead, rage }
  const pressed = new Map()    // `${page}␟${el}` → { n, people:Set }
  const inWindow = new Map()   // el → { n, people:Set } — what is pressed inside a task window
  const dead = new Map()
  const rage = new Map()
  const errors = new Map()
  const empty = new Map()      // u → searches that found nothing
  const trips = new Map()      // 'A → B → C' → n
  const seq = new Map()        // u → the last three pages
  const open = new Map()       // u → { task, at, clicks, toChange }
  const sessions = []          // { ms, clicks, changed, toChange }
  let total = 0
  for await (const e of eventsOf(days)) {
    total++
    names.set(e.u, e.n)
    const me = people.get(e.u) || { role: e.r, views: 0, clicks: 0, opens: 0, changes: 0, first: e.at, last: e.at }
    me.last = e.at
    people.set(e.u, me)
    const page = pageOf(e.p)
    const pg = pages.get(page) || { views: 0, people: new Set(), clicks: 0, dead: 0, rage: 0 }
    pages.set(page, pg)
    if (e.ty === 'page') {
      me.views++; pg.views++; pg.people.add(e.u)
      const s = [...(seq.get(e.u) || []), page].slice(-3)
      seq.set(e.u, s)
      if (s.length === 3 && new Set(s).size > 1) bump(trips, s.join(' → '))
    } else if (e.ty === 'click') {
      me.clicks++; pg.clicks++; pg.people.add(e.u)
      const label = e.el || e.tag || '?'
      const k = keyIn(pressed, `${page}␟${label}`)
      const pr = pressed.get(k) || { n: 0, people: new Set() }
      pr.n++; pr.people.add(e.u); pressed.set(k, pr)
      if (e.w) { const wk = keyIn(inWindow, label); const w = inWindow.get(wk) || { n: 0, people: new Set() }; w.n++; w.people.add(e.u); inWindow.set(wk, w) }
      if (e.dead) { pg.dead++; const d = dead.get(k) || { n: 0, people: new Set() }; d.n++; d.people.add(e.u); dead.set(k, d) }
      if (e.rage) { pg.rage++; const r = rage.get(k) || { n: 0, people: new Set() }; r.n++; r.people.add(e.u); rage.set(k, r) }
      const o = e.w && e.task ? open.get(`${e.u}:${e.task}`) : null
      if (o) o.clicks++
    } else if (e.ty === 'error') {
      const m = errors.get(e.msg) || { n: 0, people: new Set(), pages: new Set() }
      m.n++; m.people.add(e.u); m.pages.add(page); errors.set(e.msg, m)
    } else if (e.ty === 'search' && !e.k) {
      bump(empty, e.u)
    } else if (e.ty === 'open') {
      me.opens++
      open.set(`${e.u}:${e.task}`, { task: e.task, at: Date.parse(e.at), clicks: 0, toChange: null })
    } else if (e.ty === 'change') {
      me.changes++
      const o = open.get(`${e.u}:${e.task}`)
      if (o && o.toChange == null) o.toChange = o.clicks
    } else if (e.ty === 'close') {
      const o = open.get(`${e.u}:${e.task}`)
      if (o) {
        sessions.push({ ms: e.ms ?? Math.max(0, Date.parse(e.at) - o.at), clicks: o.clicks, changed: o.toChange != null, toChange: o.toChange })
        open.delete(`${e.u}:${e.task}`)
      }
    }
  }
  return { names, people, pages, pressed, inWindow, dead, rage, errors, empty, trips, sessions, total }
}

// ---- the report: one day or one week, as Markdown ---------------------------
async function reportOf(days, title) {
  const r = await readDays(days)
  const L = []
  L.push(`# How the board was used — ${title}`, '')
  if (!r.total) { L.push('Nothing was recorded.'); return L.join('\n') + '\n' }
  L.push(`${r.total} things recorded, ${r.people.size} ${r.people.size === 1 ? 'person' : 'people'}, ${r.sessions.length} task windows opened and closed.`, '')

  // What to improve first — the plain conclusions; the tables below are the evidence.
  const fixes = []
  for (const [k, d] of top(r.dead, 8)) if (d.n >= 5) { const [page, el] = k.split('␟'); fixes.push(`People pressed «${el}» on ${page} ${d.n} times (${who(d.people, r.names)}), and it is not a button. Make it one, or stop it looking like one.`) }
  for (const [k, d] of top(r.rage, 8)) if (d.n >= 2) { const [page, el] = k.split('␟'); fixes.push(`«${el}» on ${page} was pressed again and again (${d.n} bursts, ${who(d.people, r.names)}): it is slow, or it looks like it did nothing.`) }
  for (const [msg, m] of top(r.errors, 8)) if (m.n >= 3) fixes.push(`The board said «${msg}» ${m.n} times (${who(m.people, r.names)}, on ${[...m.pages].join(', ')}). Whatever leads people there needs a clearer guide before they press.`)
  const acted = r.sessions.filter((s) => s.changed)
  const toAct = median(acted.map((s) => s.toChange))
  if (acted.length >= 3 && toAct > 5) fixes.push(`Moving a task on takes ${toAct} presses inside its window (the middle case). The step should be reachable in two or three.`)
  const glances = r.sessions.filter((s) => !s.changed && s.ms < 4000).length
  if (r.sessions.length >= 5 && glances / r.sessions.length > 0.4) fixes.push(`${glances} of ${r.sessions.length} task windows were closed within 4 seconds without a change — people open tasks to look for something the list could already say.`)
  const lost = [...r.empty.entries()].filter(([, n]) => n >= 2)
  if (lost.length) fixes.push(`Searches that found nothing: ${lost.map(([u, n]) => `${r.names.get(u)} ${n}`).join(', ')}. Search should find what they mean.`)
  L.push('## What to improve first', '', ...(fixes.length ? fixes.map((f) => `- ${f}`) : ['- Nothing stood out.']), '')

  L.push('## Who was on it', '', '| Person | Role | Pages | Presses | Tasks opened | Changed a task | First | Last |', '|---|---|---|---|---|---|---|---|')
  for (const [u, p] of [...r.people.entries()].sort((a, b) => b[1].clicks - a[1].clicks))
    L.push(`| ${cell(r.names.get(u))} | ${cell(p.role)} | ${p.views} | ${p.clicks} | ${p.opens} | ${p.changes} | ${p.first.slice(11, 16)} | ${p.last.slice(11, 16)} |`)
  L.push('', '_Times are UTC (Tashkent is UTC+5)._', '')

  L.push('## Pages', '', '| Page | Views | People | Presses | Not-a-button presses | Repeated presses |', '|---|---|---|---|---|---|')
  for (const [page, p] of [...r.pages.entries()].filter(([, p]) => p.views || p.clicks).sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 25))
    L.push(`| ${cell(page)} | ${p.views} | ${p.people.size} | ${p.clicks} | ${p.dead} | ${p.rage} |`)
  L.push('')

  L.push('## Closing a task (inside the task window)', '')
  if (r.sessions.length) {
    L.push(`- Windows opened and closed: ${r.sessions.length}; a change made in ${acted.length}.`)
    L.push(`- Time a window stays open (middle case): ${secs(median(r.sessions.map((s) => s.ms)))}.`)
    if (acted.length) L.push(`- Presses before the first change (middle case): ${toAct}.`)
    L.push(`- Closed within 4 seconds with nothing changed: ${glances}.`, '', 'Where people reach inside the window:', '', '| Pressed | Times | People |', '|---|---|---|')
    for (const [el, w] of top(r.inWindow, 15)) L.push(`| ${cell(el)} | ${w.n} | ${who(w.people, r.names)} |`)
  } else L.push('- No task window was opened.')
  L.push('')

  L.push('## What was pressed most', '', '| Page | Pressed | Times | People |', '|---|---|---|---|')
  for (const [k, p] of top(r.pressed, 25)) { const [page, el] = k.split('␟'); L.push(`| ${cell(page)} | ${cell(el)} | ${p.n} | ${p.people.size} |`) }
  L.push('')

  L.push('## Where people got stuck', '')
  L.push('Pressed though it is not a button:', '', '| Page | What | Times | Who |', '|---|---|---|---|')
  for (const [k, d] of top(r.dead, 15)) { const [page, el] = k.split('␟'); L.push(`| ${cell(page)} | ${cell(el)} | ${d.n} | ${who(d.people, r.names)} |`) }
  L.push('', 'Pressed again and again within a second:', '', '| Page | What | Bursts | Who |', '|---|---|---|---|')
  for (const [k, d] of top(r.rage, 15)) { const [page, el] = k.split('␟'); L.push(`| ${cell(page)} | ${cell(el)} | ${d.n} | ${who(d.people, r.names)} |`) }
  L.push('', 'What the board said no with:', '', '| Message | Times | Who |', '|---|---|---|')
  for (const [msg, m] of top(r.errors, 15)) L.push(`| ${cell(msg)} | ${m.n} | ${who(m.people, r.names)} |`)
  L.push('')

  L.push('## Common trips (three pages in a row)', '', '| Trip | Times |', '|---|---|')
  for (const [t, n] of top(r.trips, 12)) L.push(`| ${cell(t)} | ${n} |`)
  L.push('')
  return L.join('\n')
}

// The days there is anything for, newest first, and the weeks they make.
router.get('/days', authRequired, adminOnly, wrap(async (_req, res) => {
  const days = existsSync(TRACK_DIR)
    ? readdirSync(TRACK_DIR).map((f) => f.replace(/\.ndjson$/, '')).filter(isDay).sort().reverse() : []
  const weeks = [...new Set(days.map(mondayOf))]
  res.json({ days: days.map((d) => ({ day: d, bytes: statSync(fileOf(d)).size })), weeks })
}))

// ?day=2026-10-14 or ?week=2026-10-12 (its Monday); &download=1 hands it over as a file.
router.get('/report', authRequired, adminOnly, wrap(async (req, res) => {
  const { day, week, download } = req.query
  if (!isDay(day) && !isDay(week)) return res.status(400).json({ error: 'Pick a day or a week' })
  const days = isDay(week) ? weekOf(week) : [day]
  const title = isDay(week) ? `the week of ${mondayOf(week)}` : day
  const md = await reportOf(days, title)
  res.type('text/markdown; charset=utf-8')
  if (download) res.set('Content-Disposition', `attachment; filename="board-usage-${isDay(week) ? `week-${mondayOf(week)}` : day}.md"`)
  res.send(md)
}))

// Where on one page people pressed: the heatmap's dots, the newest kept —
// for one report's day (?day=) or week (?week=), else the last ?days= days.
router.get('/heat', authRequired, adminOnly, wrap(async (req, res) => {
  const page = pageOf(req.query.path)
  const n = Math.min(30, Math.max(1, Number(req.query.days) || 7))
  const days = isDay(req.query.week) ? weekOf(req.query.week) : isDay(req.query.day) ? [req.query.day]
    : Array.from({ length: n }, (_, i) => dayISO(i - n + 1))   // oldest first: the newest are kept
  const pts = []
  for await (const e of eventsOf(days)) {
    if (e.ty !== 'click' || pageOf(e.p) !== page || !e.vw) continue
    pts.push({ x: Math.round((e.x / e.vw) * 1000) / 1000, y: e.y, w: e.vw, d: e.dead ? 1 : undefined, r: e.rage ? 1 : undefined })
    if (pts.length > 12000) pts.splice(0, 6000)
  }
  res.json({ page, days: days.length, from: days[0], to: days[days.length - 1], points: pts.slice(-6000) })
}))

export default router
export { reportOf, pageOf }

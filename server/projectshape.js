// The shape of a project's numbers and criteria (Sept 2026).
//
// No imports on purpose. db.js runs the migration and routes/projects.js
// enforces the rules — two callers that must agree to the letter, so the
// rules live in one file neither of them owns. (It also keeps db.js out of a
// circular import: pcmodel.js already imports db.js, so db.js cannot import
// pcmodel.js back.)

const clampNum = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  // Every number here is a count of something that happened — visitors,
  // leads, posts. None of them can run backwards, which is the same rule the
  // old single metric already applied.
  return Math.max(0, Math.round(n))
}

// [{name, current, target, updated_at, updated_by}]
//
// `prev` is the stored list. A number's "last updated" is NOT taken from the
// client: it is stamped here, and only when the current value actually moves.
// Renaming a number or correcting its target is not an update of the number
// itself — saying it was would make "updated 2 days ago" mean "somebody
// touched this form", which is the opposite of what the red line is for.
export function cleanNumbers(v, prev = [], who = null, nowIso = new Date().toISOString()) {
  const before = new Map((Array.isArray(prev) ? prev : []).map((n) => [String(n?.id ?? ''), n]))
  return (Array.isArray(v) ? v : [])
    .map((n, i) => {
      const id = String(n?.id ?? '') || `n${i}_${Math.random().toString(36).slice(2, 8)}`
      const old = before.get(id)
      const current = clampNum(n?.current)
      const moved = !old || clampNum(old.current) !== current
      return {
        id,
        name: String(n?.name ?? '').trim().slice(0, 60),
        current,
        target: clampNum(n?.target),
        // An untouched number keeps the stamp it had. A moved one gets this
        // moment and this person; a brand-new one counts as moved, so a
        // number starting at 0 is "updated today" rather than instantly stale.
        updated_at: moved ? nowIso : (old.updated_at || null),
        updated_by: moved ? (who ?? null) : (old.updated_by ?? null),
        // The steps under this number are NEVER taken from the form that
        // edits the number. Two different people write to these: the owner
        // renames a number and moves its value, and anybody on the team adds
        // or ticks a step — through routes of their own. If the numbers form
        // carried steps too, one person saving a target from a page they
        // opened ten minutes ago would silently delete everything the other
        // had ticked since. So they are carried over from what is stored, and
        // the step routes are the only thing that can change them.
        steps: cleanSteps(old?.steps),
      }
    })
    .filter((n) => n.name)
    .slice(0, 40)
}

// ---- the little steps under a number ---------------------------------------
//
// A number is a destination: 500 downloads, 40 reviews. It says nothing about
// how anybody gets there, so the gap between "we are at 120" and "500" was
// filled by whatever people held in their heads.
//
// Steps are that gap, written down: short lines anybody on the team can add
// and tick under the number they are for. Deliberately NOT the project's
// success criteria, which are what must be TRUE at the end and are the
// owner's; these are the work on the way, and the person doing a piece of it
// is usually not the person who owns the project.
//
// [{ id, text, done, by, by_name, at, done_by, done_name, done_at }]
export function cleanSteps(v) {
  return (Array.isArray(v) ? v : [])
    .map((s, i) => ({
      id: String(s?.id ?? '') || `s${i}_${Math.random().toString(36).slice(2, 8)}`,
      text: String(s?.text ?? '').trim().slice(0, 200),
      done: !!s?.done,
      by: s?.by ?? null,
      by_name: String(s?.by_name ?? '').slice(0, 60),
      at: s?.at || null,
      done_by: s?.done_by ?? null,
      done_name: String(s?.done_name ?? '').slice(0, 60),
      done_at: s?.done_at || null,
    }))
    .filter((s) => s.text)
    .slice(0, 30)
}

// [{text, done}] — a criterion is one short line that is either true or not.
export function cleanCriteria(v) {
  return (Array.isArray(v) ? v : [])
    .map((c) => ({
      text: String(c?.text ?? '').trim().slice(0, 300),
      done: !!c?.done,
    }))
    .filter((c) => c.text)
    .slice(0, 60)
}

export const parseJson = (v) => {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

// done    finished, and everything it promised was met — earned, see doneBlockers
// closed  finished, and it fell short. An event planned for 100 that 50 came
//         to is over and did happen; it is not "done" in the sense Done means,
//         and it must not sit on the board as live work either. Closed says so
//         honestly, with a reason, and keeps the real result on record rather
//         than inviting somebody to lower the target to 50 after the fact —
//         which would erase exactly what the next plan should learn from.
export const STATUSES = ['on_track', 'at_risk', 'off_track', 'done', 'closed']

// The three a project used to have. They are still accepted — not because
// anybody should send them, but because something always does: a browser
// holding the previous bundle through a deploy, a script written last month.
// Refusing them turned "save this project" into an error about a word the
// person never typed.
//
// They all land on On track, which is exactly what the migration does to the
// stored ones, so the API and the migration cannot tell two different stories.
// Note that 'closed' becomes On track rather than Done: Done is earned under
// the new rule, and a legacy caller cannot hand it out.
// 'closed' is NOT here any more. It was, when it only ever meant the old
// status; it is a real status now, and mapping it to on_track would silently
// turn every Closed somebody chose back into On track.
const LEGACY_STATUS = { active: 'on_track', paused: 'on_track' }
export const normaliseStatus = (v) => {
  const s = String(v ?? '')
  return LEGACY_STATUS[s] || s
}
export const STATUS_LABELS = {
  on_track: 'On track', at_risk: 'At risk', off_track: 'Off track', done: 'Done', closed: 'Closed',
}
// These owe the room a reason. At risk and off track: why it is in trouble.
// Closed: how it ended — "50 of 100 came, the venue capped it at 60". A
// project that finished short with no word on why teaches nobody anything.
export const NEEDS_REASON = ['at_risk', 'off_track', 'closed']

// A number is "hit" when it reaches its target. A number with no target set
// cannot be missed — there is nothing to miss — so it counts as hit rather
// than holding a project short of Done forever on a box nobody filled in.
export const numberHit = (n) => !(Number(n?.target) > 0) || Number(n?.current) >= Number(n?.target)

// How far along a project is, as two rates that are never mixed.
//
// "0 of 5 numbers hit" is a count of finish lines crossed, and it cannot tell
// five numbers at 90% from five at nothing — both read 0 of 5. The rate says
// how far along the way they are.
//
// numbers_avg  the mean of each number's progress, EACH CAPPED AT 100. Without
//              the cap one number at 300% averages with two at zero into
//              "100%" — a project reading finished with two thirds of its
//              numbers untouched. Beating one target does not pay for missing
//              another.
//              A number with no target is left out rather than counted as
//              100: it has no finish line to be a percentage of, and counting
//              it as complete would lift the average for a box nobody filled.
//              null when there is nothing measurable.
// criteria_pct the share ticked. null when there are no criteria.
//
// Kept apart on purpose. A project whose numbers are all met and whose
// criteria are untouched is not "50% done" — it is two different stories,
// and a blended figure would tell neither.
export function tally(numbers, criteria) {
  const ns = Array.isArray(numbers) ? numbers : []
  const cs = Array.isArray(criteria) ? criteria : []
  const measurable = ns.filter((n) => Number(n?.target) > 0)
  const numbersAvg = measurable.length
    ? Math.round(measurable.reduce((sum, n) =>
        sum + Math.min(100, (Math.max(0, Number(n.current) || 0) / Number(n.target)) * 100), 0) / measurable.length)
    : null
  const done = cs.filter((c) => c.done).length
  return {
    numbers_hit: ns.filter(numberHit).length,
    numbers_total: ns.length,
    numbers_avg: numbersAvg,
    criteria_done: done,
    criteria_total: cs.length,
    criteria_pct: cs.length ? Math.round((done / cs.length) * 100) : null,
  }
}

// What still stands between this project and Done. Empty means it may be set.
//
// This is the gate, and it is enforced by the API — not only hidden in the
// UI. A rule that lives in a dropdown is a suggestion: anything that can PATCH
// a project could still write Done straight past it.
export function doneBlockers(numbers, criteria) {
  const out = []
  for (const n of (Array.isArray(numbers) ? numbers : [])) {
    if (!numberHit(n)) out.push(`${n.name}: ${Number(n.current) || 0} of ${Number(n.target) || 0}`)
  }
  const short = (Array.isArray(criteria) ? criteria : []).filter((c) => !c.done)
  for (const c of short) out.push(`not ticked: ${c.text}`)
  return out
}

// ---------------------------------------------------------------------------
// The migration, as a PLAN rather than as a write.
//
// planProjectMigration() touches nothing. It takes a stored row and returns
// what the new columns would hold, so the preview script can print the whole
// board and the migration can apply exactly what was printed. One function,
// so "show me before running it" means something.

// The old success box was one paragraph of prose. Each sentence in it was a
// separate promise, so each sentence becomes a criterion.
//
// Splitting on a full stop alone breaks "$12.50" and "e.g." into nonsense, so
// a stop only ends a sentence when what follows is a space and a capital (or
// the end of the text) and what precedes is not a known abbreviation.
const ABBREV = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|no|fig|min|max|hrs?|Mr|Mrs|Ms|Dr|St)$/i
export function splitCriteria(text) {
  const src = String(text || '').trim()
  if (!src) return []
  const out = []
  let buf = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    buf += ch
    if (ch !== '.' && ch !== '\n') continue
    if (ch === '.') {
      const head = buf.slice(0, -1)
      if (/\d$/.test(head) && /^\d/.test(src.slice(i + 1))) continue  // 12.50
      if (ABBREV.test(head)) continue                                  // e.g.
      const rest = src.slice(i + 1)
      if (rest && !/^\s/.test(rest)) continue                          // mid-word
    }
    out.push(buf)
    buf = ''
  }
  if (buf.trim()) out.push(buf)
  return out
    .map((t) => t.replace(/\s+/g, ' ').replace(/\.$/, '').trim())
    .filter(Boolean)
    .map((t) => ({ text: t.slice(0, 300), done: false }))
    .slice(0, 60)
}

// What this one row would become. `row` is a raw projects record.
export function planProjectMigration(row, nowIso = new Date().toISOString()) {
  const already = parseJson(row.numbers).length > 0 || parseJson(row.criteria).length > 0

  // The old single metric becomes the first number, keeping the value people
  // have been typing into it every week. A project that never had one gets no
  // number rather than an empty tile.
  const numbers = []
  const oldTarget = Number(row.target) || 0
  const oldActual = Number(row.actual) || 0
  const oldMetric = String(row.metric || '').trim()
  if (oldMetric || oldTarget > 0) {
    numbers.push({
      id: 'n_migrated_1',
      // A target with no metric name existed — the form allowed it. It still
      // has to be called something, and the tile shows the name.
      name: oldMetric || 'Target',
      current: Math.max(0, Math.round(oldActual)),
      target: Math.max(0, Math.round(oldTarget)),
      // Carried across as the day the project last showed any activity: the
      // truest thing available. Inventing "just now" would paint every
      // migrated number fresh and hide exactly the staleness the red line is
      // meant to surface.
      updated_at: row.last_activity || row.created_at || nowIso,
      updated_by: null,
    })
  }

  const criteria = splitCriteria(row.success)

  // Everything becomes On track. Nothing is Done unless it earns it under the
  // new rule — including the projects that were 'closed', which is why a
  // closed project comes back as live work for somebody to close properly.
  const status = 'on_track'

  // A row with no metric, no target and no success text has nothing to move,
  // and if its status already reads on_track then applying this plan would
  // write the values that are already there. Saying "would change" about that
  // is not a small inaccuracy here: every write to this database is a commit
  // on the appdata branch, so a no-op row costs a commit and tells whoever
  // reviewed the preview that something happened to a project when nothing
  // did. Both the preview and the migration skip these.
  const noop = numbers.length === 0 && criteria.length === 0 &&
    (row.status || '') === status && !String(row.status_reason || '')

  return {
    id: row.id,
    name: row.name,
    skipped: already || noop,  // already migrated, already edited, or nothing to move
    noop,                      // …and this is WHY, when it was not migrated before
    from: {
      metric: oldMetric, target: oldTarget, actual: oldActual,
      success: String(row.success || ''), status: row.status || 'active',
    },
    to: { numbers, criteria, status, status_reason: '' },
  }
}

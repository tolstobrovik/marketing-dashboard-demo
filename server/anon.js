// Taking the names out before the text leaves the building.
//
// The people board holds the frankest writing on this system: what somebody's
// September was actually like, written by their manager, for their manager.
// Summarising a year of it is exactly the job a model is good at, and sending
// it out under everybody's real names is exactly the thing you cannot undo.
// A provider's logs are not ours, a retention policy is not ours, and "we
// only sent it to be summarised" is not a defence anybody who has been
// written about would accept.
//
// So the names come out first. The model reads about Person A and Person B,
// writes about Person A and Person B, and the board puts the real names back
// when it renders. Nothing goes out that would identify anybody, and the
// reader cannot tell the difference.
//
// This module has no imports on purpose: it is pure text in, text out, and
// it is tested that way (qa/anon-suite.mjs).

// A, B, ... Z, AA, AB — enough for a team many times this one's size.
export function aliasFor(i) {
  let out = ''
  let n = i
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `Person ${out}`
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A name is only a name when it stands alone. Not \b: that is ASCII, and
// half this team's names are not — \bАня\b never matches, which would have
// been a silent leak rather than a visible bug.
const bounded = (needle) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle)}(?![\\p{L}\\p{N}])`, 'giu')

// Which written forms of a person should be caught. The full name, the parts
// of it long enough to be a name rather than an initial, and the username —
// people write "Ravshan", "Ravshan Xolmatov" and "@ravshan" and mean one man.
function formsOf(person) {
  const out = []
  const name = String(person?.name || '').trim()
  if (name) {
    out.push(name)
    for (const part of name.split(/\s+/)) if (part.length >= 3) out.push(part)
  }
  const username = String(person?.username || '').trim()
  if (username.length >= 3) { out.push(username); out.push(`@${username}`) }
  return out
}

// Build the two-way map for a set of people.
//
// Everyone gets an alias whether or not they are mentioned, so the same
// person is Person A in every summary of the same board — a map that
// depended on who happened to be written about would rename people between
// two readings of the same page.
export function aliasMap(people) {
  const byId = new Map()
  const byAlias = new Map()
  const forms = []
  const list = (Array.isArray(people) ? people : []).filter((p) => p && p.id != null)
  list.forEach((p, i) => {
    const alias = aliasFor(i)
    byId.set(p.id, alias)
    byAlias.set(alias, p.name || alias)
    for (const f of formsOf(p)) forms.push({ text: f, alias })
  })
  // Longest first, so "Ravshan Xolmatov" is spent before "Ravshan" can eat
  // half of it and leave a surname stranded next to an alias.
  forms.sort((a, b) => b.text.length - a.text.length)
  return { byId, byAlias, forms }
}

// Names out. Anything not in the map is left alone — this replaces what it
// was told about and does not guess at what else might be a name.
export function mask(text, map) {
  let out = String(text ?? '')
  if (!out) return out
  for (const { text: needle, alias } of map?.forms || []) out = out.replace(bounded(needle), alias)
  return out
}

// Names back. The model was asked to write "Person A" and generally does;
// anything it invents beyond the map is left as it stands rather than
// guessed at.
export function unmask(text, map) {
  let out = String(text ?? '')
  if (!out) return out
  // Longest alias first. "Person A" is the start of "Person AA", so taking the
  // map in its own order turned the 27th person into the 1st plus a stray "A".
  const pairs = [...(map?.byAlias || [])].sort((a, b) => b[0].length - a[0].length)
  for (const [alias, name] of pairs) out = out.split(alias).join(name)
  return out
}

// Did anything identifying survive? Used as a last gate before a request
// leaves, so a bug in the masking shows up as a refusal here rather than as
// a name in somebody else's logs.
export function leaks(text, map) {
  const found = []
  const body = String(text ?? '')
  for (const { text: needle } of map?.forms || []) {
    if (bounded(needle).test(body)) found.push(needle)
  }
  return [...new Set(found)]
}

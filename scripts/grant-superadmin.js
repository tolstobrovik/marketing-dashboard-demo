#!/usr/bin/env node
// Hand somebody the people board, from the server itself.
//
//   node scripts/grant-superadmin.js <username>
//   node scripts/grant-superadmin.js <username> --revoke
//
// The app will not let the last superadmin step down, and nobody else can
// grant the rank — which is correct while somebody holds it, and a locked
// door the day nobody does. If the only holder leaves the company, this is
// the way back in: it runs on the server, as whoever can already read the
// database, so it grants nothing that person could not have taken anyway.
//
// It is also how a fresh database gets its first holder when the seeded name
// is not on it (a colleague's laptop, a test copy) — see seedSuperadmin in
// server/db.js.
import { initDb, all, get, run } from '../server/db.js'

const args = process.argv.slice(2)
const revoke = args.includes('--revoke')
const username = args.find((a) => !a.startsWith('-'))

if (!username) {
  console.error('Usage: node scripts/grant-superadmin.js <username> [--revoke]')
  process.exit(1)
}

await initDb()
const who = await get('SELECT id, name, username, role, superadmin FROM users WHERE username = ?', String(username).toLowerCase())
if (!who) {
  console.error(`No account called ${JSON.stringify(username)}.`)
  process.exit(1)
}
if (revoke && !who.superadmin) {
  console.log(`${who.name} does not hold it — nothing to do.`)
  process.exit(0)
}
if (!revoke && who.superadmin) {
  console.log(`${who.name} already holds it — nothing to do.`)
  process.exit(0)
}

await run('UPDATE users SET superadmin = ? WHERE id = ?', revoke ? 0 : 1, who.id)
const holders = await all('SELECT name, username FROM users WHERE superadmin = 1 ORDER BY name')
console.log(`${revoke ? 'Taken from' : 'Given to'} ${who.name} (${who.username}).`)
console.log(holders.length
  ? `The people board is now open to: ${holders.map((h) => `${h.name} (${h.username})`).join(', ')}`
  : 'Nobody holds it now — the people board is shut until this script is run again.')
process.exit(0)

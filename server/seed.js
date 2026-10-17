// Reset the local database to a fresh seeded state: `npm run seed`.
// Development only: it deletes the local file under DATA_DIR and seeds a new
// one. In GitHub-storage mode the next boot simply downloads the team's copy
// again, so this never touches the shared data.
import { rmSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbFile = join(process.env.DATA_DIR || join(__dirname, '..', 'data'), 'dashboard.db')
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const f = dbFile + suffix
  if (existsSync(f)) rmSync(f)
}

const { initDb, closeDb } = await import('./db.js')
await initDb()
closeDb()
console.log('✔ Database reset to a clean start: channels, pipeline stages, the campaign plan and the admin account.')

// ---- one video, posted again (TikTok and YouTube Shorts, October 2026) ------
//
// A reel finished for Instagram Main or Instagram Uzb used to reach TikTok and
// YouTube Shorts only if somebody remembered, downloaded it, found the caption
// and posted it — nothing on the board asked, and nothing showed whether it
// had happened. Now the person running the piece ticks "Also TikTok" and
// "Also Shorts" in the task window while it is being made, and publishing it
// makes one task per tick, in the SAME request:
//
//   on the repost channel, at Ready     nothing is filmed or cut again; its
//                                       one step is to post it (format
//                                       'repost': Ready -> Published)
//   "<title> (from Main)"               so the list says where it came from
//   the video LINKED, never copied      the source's finished cut (ready_link
//                                       — the Drive link or the channel
//                                       folder's file), the same string
//   the caption copied                  the source's description
//   Jahongir's, due the next day        found by name on every publish; with
//                                       nobody of that name, the repost
//                                       channel's head, then an admin on it
//
// Never twice. content_reposts holds one row per source and repost channel,
// UNIQUE on the pair, and the row is CLAIMED with insert-or-ignore before the
// task is made: publishing again, or undoing and publishing again, finds the
// claim and makes nothing. An undo of the publish (POST /content/:id/undo)
// takes back the repost tasks nobody has touched yet — no edit, comment, file
// or stage move (`touch`) — and their claims with them; a touched one is
// somebody's work and stays.
//
// The rules are all here and in content.js; the task window only draws what
// GET /content/:id says (`infoOf`) and sends the ticks to PUT /:id/reposts.
import { all, get, run, batch, dayISO, taskChildDeletes } from './db.js'
import { resolveGates } from './deadlines.js'
import { isAdminOn } from './auth.js'

// What is a video: the two kinds that are filmed and cut. A post is a picture,
// a target is an ad made for an ad set — neither is reposted.
export const VIDEO_TYPES = ['reel', 'video']

const listOf = (v) => {
  if (Array.isArray(v)) return v.map(String)
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : [] } catch { return [] }
}
export const ticksOf = (row) => listOf(row?.repost_to)

// The repost channels this task can tick, in sidebar order — or none. Only a
// video, only on a channel whose videos go on (`channels.video`), and never a
// channel the piece is already on: a repost task's own channel is a repost
// channel, so a repost is never reposted.
export async function offerOf(row) {
  if (!VIDEO_TYPES.includes(row?.type)) return []
  const chans = listOf(row.channels)
  if (!chans.length) return []
  const rows = await all('SELECT key, label, video, format FROM channels ORDER BY sort, id')
  if (!rows.some((c) => c.video && chans.includes(c.key))) return []
  if (rows.some((c) => c.format === 'repost' && chans.includes(c.key))) return []
  return rows.filter((c) => c.format === 'repost').map((c) => ({ key: c.key, label: c.label }))
}

// "Instagram Main" -> "Main": the word that tells two accounts of one platform
// apart, which is all the title needs. A one-word label is kept whole.
const fromWord = (label) => {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean)
  return words.length > 1 ? words[words.length - 1] : words[0] || ''
}

// Who posts a repost. Jahongir, found by the name on the account — looked up
// on every publish, so a renamed or new account is picked up without a deploy.
// With nobody of that name, the repost channel's head; then an admin whose
// writ covers it. `how` says which, for the window and the paper trail.
export async function posterFor(key) {
  const named = await get(`SELECT id, name FROM users WHERE LOWER(name) LIKE 'jahongir%'
    AND role <> 'ambassador' AND SUBSTR(username, 1, 8) <> 'removed_' ORDER BY id LIMIT 1`)
  if (named) return { id: named.id, name: named.name, how: 'named' }
  const ch = await get('SELECT head_id FROM channels WHERE key = ?', key)
  const head = ch?.head_id ? await get('SELECT id, name FROM users WHERE id = ?', ch.head_id) : null
  if (head) return { id: head.id, name: head.name, how: 'head' }
  for (const u of await all("SELECT id, name, role, admin_channels FROM users WHERE role = 'admin' ORDER BY id")) {
    if (isAdminOn({ ...u, admin_channels: listOf(u.admin_channels) }, [key])) return { id: u.id, name: u.name, how: 'admin' }
  }
  return { id: null, name: '', how: 'nobody' }
}

// The stage a repost is born on: Ready (the review gate), or the last working
// stage before Published on a board that has renamed it away.
async function readyStage() {
  const resolved = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  if (resolved.gates.review) return resolved.gates.review.id
  const fin = resolved.ordered.findIndex((s) => s.id === resolved.finalId)
  return fin > 0 ? resolved.ordered[fin - 1].id : null
}

// Make the repost tasks for a piece that has just been published. `src` is
// the row as it stands after the publish. Returns what was made — content.js
// writes the paper trail and rings the poster, as for any task it creates.
export async function makeReposts(user, src) {
  const offer = await offerOf(src)
  const keys = ticksOf(src).filter((k) => offer.some((o) => o.key === k))
  if (!keys.length) return []
  const chans = listOf(src.channels)
  const from = (await all('SELECT key, label FROM channels WHERE video = 1 ORDER BY sort, id')).find((c) => chans.includes(c.key))
  const title = `${src.title} (from ${fromWord(from?.label)})`.slice(0, 300)
  const status = await readyStage()
  const due = dayISO(1)
  const made = []
  for (const key of keys) {
    const now = new Date().toISOString()
    // The claim first. A second publish, an undo and a redo, two requests at
    // once — whichever comes second finds the pair taken and makes nothing.
    const claim = await run(`INSERT INTO content_reposts (source_id, target_channel, created_at) VALUES (?, ?, ?)
      ON CONFLICT(source_id, target_channel) DO NOTHING`, src.id, key, now)
    if (!claim.changes) continue
    try {
      const poster = await posterFor(key)
      const sort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m + 1
      // The cut arrives ACCEPTED: it is the one that just went out. Without
      // the yes the task window reads a cut at Ready as one to check, and the
      // poster would be asked to accept a video that is already on Instagram.
      // The source's own yes when it has one; otherwise whoever published it.
      const info = await run(`INSERT INTO content (title, channels, type, assignee_id, assignees, created_by, status_id,
          release_date, description, ready_link, approved_at, approved_by, approved_name, todo_sort, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title, JSON.stringify([key]), src.type, poster.id, JSON.stringify(poster.id ? [poster.id] : []), user.id, status,
      due, src.description || '', src.ready_link || null,
      src.approved_at || now, src.approved_at ? src.approved_by : user.id, src.approved_at ? src.approved_name || '' : user.name || '',
      sort, now)
      const id = Number(info.lastInsertRowid)
      await run('UPDATE content_reposts SET repost_id = ? WHERE source_id = ? AND target_channel = ?', id, src.id, key)
      made.push({ id, title, key, poster })
    } catch (e) {
      // A claim with no task behind it would block this repost for good.
      await run('DELETE FROM content_reposts WHERE source_id = ? AND target_channel = ? AND repost_id IS NULL', src.id, key)
      throw e
    }
  }
  return made
}

// The publish was taken back: the repost tasks nobody has touched go with it,
// and so do their claims, so publishing again makes them afresh. A touched
// one — or one already out — is somebody's work and stays, claim and all.
export async function dropUntouched(sourceId) {
  const rows = await all(`SELECT r.repost_id, c.title, c.done_at FROM content_reposts r
    JOIN content c ON c.id = r.repost_id WHERE r.source_id = ? AND r.touched = 0`, sourceId)
  const gone = rows.filter((r) => !r.done_at)
  if (gone.length) {
    await batch(gone.flatMap((r) => [...taskChildDeletes(r.repost_id), ['DELETE FROM content WHERE id = ?', r.repost_id]]))
  }
  return gone.map((r) => ({ id: r.repost_id, title: r.title }))
}

// Somebody did something on this task — an edit, a comment, a file, a stage
// move. If it is a repost nobody had touched, it is somebody's work now.
export async function touch(id) {
  if (await get('SELECT 1 AS x FROM content_reposts WHERE repost_id = ? AND touched = 0', Number(id)))
    await run('UPDATE content_reposts SET touched = 1 WHERE repost_id = ?', Number(id))
}

// Every repost task's id — the pay run reads them (routes/reports.js).
export const repostIds = async () =>
  new Set((await all('SELECT repost_id FROM content_reposts WHERE repost_id IS NOT NULL')).map((r) => Number(r.repost_id)))

// What the task window draws, for one task:
//   offer   the repost channels it can tick ([] = not a video on a video channel)
//   ticked  the keys ticked now
//   may     whether THIS person may change the ticks now (`may` comes from
//           content.js, which owns who runs a piece); false once it is out
//   made    the reposts it made: channel, task, who posts it, by when, out yet
//   from    for a repost task: the piece it came from
export async function infoOf(row, may) {
  const offer = await offerOf(row)
  const made = (await all(`SELECT r.target_channel AS channel, r.repost_id AS id, ch.label, c.title, c.done_at, c.post_link,
      c.release_date, c.assignee_id, u.name AS poster
    FROM content_reposts r
    LEFT JOIN content c ON c.id = r.repost_id
    LEFT JOIN channels ch ON ch.key = r.target_channel
    LEFT JOIN users u ON u.id = c.assignee_id
    WHERE r.source_id = ? AND r.repost_id IS NOT NULL ORDER BY ch.sort, r.id`, row.id))
    .filter((r) => r.title != null)
    .map((r) => ({
      channel: r.channel, label: r.label || r.channel, id: r.id, title: r.title,
      out: !!r.done_at, post_link: r.post_link || null, due: r.release_date || null,
      poster_id: r.assignee_id || null, poster: r.poster || null,
    }))
  const src = await get(`SELECT c.id, c.title, c.channels, c.ready_link FROM content_reposts r
    JOIN content c ON c.id = r.source_id WHERE r.repost_id = ?`, row.id)
  let from = null
  if (src) {
    const chans = listOf(src.channels)
    const ch = (await all('SELECT key, label FROM channels ORDER BY sort, id')).find((c) => chans.includes(c.key))
    from = { id: src.id, title: src.title, label: ch?.label || '', video: src.ready_link || null }
  }
  return {
    offer,
    // Who will be handed them — said under the ticks, before anybody presses.
    poster: offer.length && !row.done_at ? (await posterFor(offer[0].key)).name || null : null,
    ticked: ticksOf(row).filter((k) => offer.some((o) => o.key === k)),
    may: !!may && offer.length > 0 && !row.done_at,
    out: !!row.done_at,
    made,
    from,
  }
}

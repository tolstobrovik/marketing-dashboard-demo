import { Router } from 'express'
import { createHmac, randomBytes } from 'crypto'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { all, get, run, batch, CONTENT_TYPES, resyncStorage, mayLeaveStage, getTaskFields, fieldDemanded, getCrewNeeds, publicUser, dayISO, cleanStudyBlocks, taskChildDeletes, MEDIA_DIR, channelFormatsFor, charLimitFor, formatsAllowField, formatsAllowCrew, formatOf } from '../db.js'
import { bumpProjectOfCampaign } from '../pcmodel.js'
import { resolveGates, gatesUpTo, phasesOf, holderOf, phasePassed, STAMP_GATES, postLinkProblem } from '../deadlines.js'
import { makeReposts, dropUntouched, touch as touchRepost, offerOf, ticksOf, infoOf as repostsOf } from '../reposts.js'
import { readText, hasSubstance, hasLink, isSentence, clip, scriptKey, MIN_SENTENCE_WORDS } from '../text.js'
import { authRequired, canAccessDept, can, wrap, JWT_SECRET, isAdminOn, isFullAdmin } from '../auth.js'
import { tgMirror, tgOriginFrom, tgEsc, tgDate } from '../telegram.js'
import { tgWords } from '../tgcopy.js'
import { dropOf, dropsOf } from '../dropin.js'

const router = Router()

// ---- downloading a document under its own name -----------------------------
// The browser refuses to name a saved file «ТЗ ролик.docx» when the name only
// comes from an <a download> attribute — non-ASCII is dropped and the brief
// lands as "download", with no extension for Windows to open it by. So the
// SERVER names it, in a Content-Disposition header, which means the browser
// has to reach the bytes by plain navigation — without an Authorization
// header. A ticket stands in for it: a signed, single-file, two-minute
// permission the server can verify without keeping any state for it.
const TICKET_LIFE = 120_000
// A readable Latin spelling of a Cyrillic name, for the plain `filename=`
// half of the header. Every current browser reads the UTF-8 half and saves
// «ТЗ ролик.docx» exactly; anything that can't at least gets "TZ rolik.docx"
// with its extension intact, instead of a nameless "download".
const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}
const asciiName = (name) => {
  const out = [...String(name)].map((c) => {
    if (/[\x20-\x7e]/.test(c)) return /["\\]/.test(c) ? '' : c
    const low = c.toLowerCase()
    const t = CYR[low]
    if (t === undefined) return '_'
    return c === low ? t : t.charAt(0).toUpperCase() + t.slice(1)
  }).join('').trim()
  return (out.replace(/_+/g, '_') || 'document').slice(0, 100)
}
const sign = (id, exp) => createHmac('sha256', JWT_SECRET).update(`file:${id}:${exp}`).digest('hex').slice(0, 32)
const ticketFor = (id) => { const exp = Date.now() + TICKET_LIFE; return `/api/content/files/${id}/raw?e=${exp}&k=${sign(id, exp)}` }

// Registered BEFORE the guard below on purpose — the ticket is the credential.
router.get('/files/:fileId/raw', wrap(async (req, res) => {
  const { fileId } = req.params
  const exp = Number(req.query.e || 0)
  if (!(exp > Date.now()) || req.query.k !== sign(fileId, exp))
    return res.status(403).json({ error: 'That download link has expired — open the task again' })
  const doc = await get('SELECT * FROM attachments WHERE id = ?', fileId)
  if (!doc) return res.status(404).json({ error: 'Not found' })
  const body = Buffer.from(String(doc.data).split(',').pop(), 'base64')
  // Two spellings of the name: a readable Latin fallback, and the real one,
  // percent-encoded the way RFC 5987 asks.
  const ascii = asciiName(doc.name)
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream')
  res.setHeader('Content-Length', body.length)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`)
  res.end(body)
}))

router.use(authRequired)

const parse = (row) => row && {
  ...row,
  channels: JSON.parse(row.channels || '[]'),
  checklist: JSON.parse(row.checklist || '[]'),
  reference_links: parseLinks(row.reference_links),
  reference_photos: parsePhotos(row.reference_photos),
  assignees: assigneesOf(row),
}

// Reference example links: a small array of plain URLs (stored as JSON text).
function parseLinks(v) {
  if (Array.isArray(v)) return v
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
const cleanLinks = (v) => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : []
  return [...new Set(arr.map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, 12).map((s) => s.slice(0, 500))
}

// Reference PICTURES, as [{ photo, thumb }].
//
// One box for one screenshot was the shape of the brief nobody actually
// writes: the layout, the thing it must NOT look like, and the logo lockup
// are three answers to "what do you want", and a designer given the first of
// them guesses the other two. So the task carries a small album.
//
// `photo` and `photo_thumb` on the row remain the FIRST of these and are
// written in step with it everywhere below. A dozen places ask "is there a
// reference at all" — the shoot gate, the card's has_photo flag, the reference
// text's own rule about standing alone — and not one of them should have to
// learn what an array is.
function parsePhotos(v) {
  if (Array.isArray(v)) return v
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
// Eight is a brief; a hundred is somebody using the task as a photo album.
// The per-picture ceilings are the ones programs.js already applies, and they
// are not decoration: the store behind this is a git branch, and every byte
// here is pushed to it on the next flush.
const MAX_PHOTOS = 8
const cleanPhotos = (v) => {
  const out = []
  for (const p of Array.isArray(v) ? v : []) {
    const photo = typeof p?.photo === 'string' && p.photo.startsWith('data:image/') && p.photo.length <= 400_000 ? p.photo : null
    if (!photo) continue
    const thumb = typeof p?.thumb === 'string' && p.thumb.startsWith('data:image/') && p.thumb.length <= 60_000 ? p.thumb : null
    out.push({ photo, thumb })
    if (out.length >= MAX_PHOTOS) break
  }
  return out
}

// Every assignee of a row (works on raw and parsed rows alike); the legacy
// assignee_id mirrors the first entry so old clients keep working.
function assigneesOf(row) {
  let a = row.assignees
  if (typeof a === 'string') { try { a = JSON.parse(a || '[]') } catch { a = [] } }
  if (Array.isArray(a) && a.length) return a.map(Number)
  return row.assignee_id ? [row.assignee_id] : []
}
const finalStatus = () => get('SELECT * FROM statuses WHERE is_final = 1 ORDER BY sort')
// A stage id is a number, and every stage rule finds the stage by strict
// equality. Sent as the string "5" it matched no stage in any of them — an
// "idea" to the brief rules, no booking wall, no published-link wall, no
// handover clocks — and was then stored as 5 all the same.
const asStageId = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) ? n : -1
}

// Assignee lookup with one self-heal: the member may have been created
// seconds ago on another server instance, or this instance's copy may lag a
// few seconds — pull the freshest data once before declaring them missing.
async function userExists(id) {
  if (await get('SELECT 1 AS x FROM users WHERE id = ?', id)) return true
  await resyncStorage().catch(() => {})
  return !!(await get('SELECT 1 AS x FROM users WHERE id = ?', id))
}
// ---- one post, one task ----------------------------------------------------
// What makes two published addresses "the same post". Case, the www. prefix,
// a trailing slash and a #fragment are all the same page; the query string is
// NOT stripped, because on some hosts it IS the address (youtube.com/watch?v=).
// A string that is not parseable as a URL is compared as typed.
export const postKey = (url) => {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '') || ''
    return `${host}${path}${u.search}`.toLowerCase()
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '')
  }
}
// The other task already carrying this post, if any. Every recorded address
// is read and compared in JS rather than in SQL, because the comparison is
// the normalised one above and the set is small (one row per published piece).
const postLinkTwin = async (url, exceptId) => {
  const key = postKey(url)
  if (!key) return null
  const rows = await all('SELECT id, title, post_link FROM content WHERE post_link IS NOT NULL AND post_link != ?', '')
  return rows.find((r) => r.id !== Number(exceptId) && postKey(r.post_link) === key) || null
}

const isFinal = async (statusId) => !!(await get('SELECT 1 AS x FROM statuses WHERE id = ? AND is_final = 1', statusId))
// The Deleted stage: killed content that stays on the record. It counts for
// the planner/operator (their work happened) but never for the editor.

// The crew move their work with one tick — "shot" for the operator, "edited"
// or "designed" for the maker — which lands the task on the matching pipeline
// stage rather than letting them pick any stage freely.
//
// The operator's tick used to land on a stage of its own called Shot, where a
// filmed piece sat waiting for somebody to notice it and move it on. That was
// a step that existed only to be left: footage that is shot is footage the
// editor can start on, and the board now says so — the tick hands it straight
// to EDITING. Boards that still carry a Shot column (it is the admin's
// pipeline to arrange) are honoured, so nobody's stage disappears under them.
async function milestoneStatusId(kind) {
  const rows = await all('SELECT id, label, sort FROM statuses ORDER BY sort, id')
  const find = (re) => rows.find((s) => re.test(s.label))
  if (kind === 'shot') {
    return (find(/^shot$/i) || find(/^editing$|^edit$|montaj|монтаж/i) || find(/\bedit/i))?.id ?? null
  }
  // edited / designed both mean "the piece is ready"
  return (find(/^ready$/i) || find(/ready|final|approv|posted|got/i))?.id ?? null
}
// A ready-file link is a plain Google-Drive-style URL (or nothing).
const cleanLink = (v) => {
  const s = String(v ?? '').trim().slice(0, 1000)
  return s
}

// ---- the channel's shared folder -------------------------------------------
// Pasting a full Drive URL for every single cut is the same folder typed out
// forty times a week, and the one part that differs — which file — is the part
// people leave out. So a channel can carry the folder once, and a delivery
// then says only WHICH file it is: "1-3", "reel 14", "Bahrom final".
//
// The label is still required. The folder alone points at everything the
// channel has ever made, which is the same as pointing at nothing.
const FILE_LABEL_MAX = 120
const cleanFileLabel = (v) => String(v ?? '').trim().slice(0, FILE_LABEL_MAX)
// Where a delivery lands: the folder, and the file said in words. Kept as ONE
// stored string so everything that already reads these columns — the digest,
// the review row, the Files list — keeps working untouched.
export const deliveryValue = (folder, label) => (folder && label ? `${folder} · ${label}` : '')
// The folder for a task's channels, if they agree on one. A task on two
// channels with two different folders has no single answer, so it falls back
// to asking for the whole URL.
async function folderFor(chans) {
  const list = Array.isArray(chans) ? chans : []
  if (!list.length) return ''
  const rows = await all(
    `SELECT key, drive_url FROM channels WHERE key IN (${list.map(() => '?').join(',')})`, ...list)
  const set = [...new Set(rows.map((r) => (r.drive_url || '').trim()).filter(Boolean))]
  return set.length === 1 ? set[0] : ''
}

// Publishing (Ready → Published) is the SMM's call: an admin, or someone with
// the review_publish right who is actually on one of the task's channels — you
// can't publish to a channel you don't belong to.
// The channels a task lives on — rows arrive both parsed and raw depending on
// which query built them, so this asks once and both shapes answer.
// A deadline is a real calendar day, or empty. "next tuesday" and 2026-13-45
// were stored as given, and the calendars drew "Invalid Date" to everybody
// (the bug hunt, 14 Oct 2026).
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const badDayIn = (o) => Object.keys(o).find((k) => o[k] != null && o[k] !== '' && !isDay(String(o[k])))
const chansOf = (row) => (Array.isArray(row?.channels)
  ? row.channels
  : (() => { try { return JSON.parse(row?.channels || '[]') } catch { return [] } })())
// Does this person's admin writ cover this task?
const adminHere = (user, row) => isAdminOn(user, chansOf(row))
// The admins whose writ covers this task — the only ones who can answer an
// ask or a raised hand on it (decide and the two queues all check adminHere).
const adminsOn = async (row) => (await all("SELECT * FROM users WHERE role = 'admin'")).map(publicUser)
  .filter((u) => adminHere(u, row)).map((u) => u.id)

// ---- the admin is not made to fill in a form ------------------------------
// Every rule below this line exists to stop WORK going out half-briefed: a
// shoot with no shooter, a stage moved with nothing attached, a required field
// left empty. They are right for the people doing the work and wrong for the
// person who set them, who is usually correcting the board at speed — putting
// a name on a card somebody phoned in, fixing a date, dragging four pieces out
// of the wrong stage — and does not want to be asked for a reference photo
// each time.
//
// So the admin passes them all. Not "sees a nicer error", not "clicks through
// a warning": the requirement does not apply to them. What still applies is
// everything that is not a form to fill in — whose channel it is, whether a
// link is actually a link, whether a person exists — because those are not
// requirements, they are facts.
//
// An admin scoped to particular channels is an admin ON those channels, and
// this follows the same scope: they are unfettered where they are the admin
// and refused outright where they are not.
const unfettered = (user, chans) => isAdminOn(user, chans)

const canPublish = (user, row) => {
  if (adminHere(user, row)) return true
  if (!can(user, 'review_publish')) return false
  return JSON.parse(row.channels || '[]').some((ch) => (user.departments || []).includes(ch))
}

// Where a Pravki sends the task back to: a re-shoot returns it to "To shoot",
// an editor or designer fix to "Editing" — the earlier making stage.
async function revisionStageId(target) {
  const rows = await all('SELECT id, label, sort FROM statuses ORDER BY sort, id')
  const find = (re) => rows.find((s) => re.test(s.label))
  if (target === 'operator') return (find(/^to shoot$/i) || find(/shoot/i) || find(/^shot$/i))?.id ?? null
  return (find(/^editing$/i) || find(/edit/i) || find(/^shot$/i))?.id ?? null
}

// A member touches a task when it sits on one of their channels (or is theirs).
const canTouch = (user, row) =>
  adminHere(user, row) ||
  assigneesOf(row).includes(user.id) ||
  row.operator_id === user.id ||
  row.editor_id === user.id ||
  row.designer_id === user.id ||
  JSON.parse(row.channels || '[]').some((ch) => (user.departments || []).includes(ch))

const cleanChannels = async (v) => {
  const arr = [...new Set((Array.isArray(v) ? v : []).map(String))]
  if (arr.length === 0) return []
  const existing = new Set((await all(
    `SELECT key FROM channels WHERE key IN (${arr.map(() => '?').join(',')})`, ...arr)).map((r) => r.key))
  return arr.filter((ch) => existing.has(ch))
}

// Lists never carry the full-size photo (they can be megabytes as data URLs
// and the pages poll every few seconds) — the task modal fetches the original
// via GET /:id.
// The THUMBNAIL is heavy too, and only one view draws it: the kanban board.
// A photo is already-compressed bytes, so base64 of it survives gzip intact —
// twenty photographed tasks put a third of a megabyte into every answer, on
// every page, on every poll. So the list carries a flag by default and the
// picture only where a picture is shown (?thumbs=1).
// `media_count` is the reference photos and videos added one by one
// (reference_media): a video among them leaves no `photo` behind, and "has it
// a reference yet" (lib/coach.js, addLater) has to see it all the same.
const listColumns = (withThumbs) => `id, title, channels, type, assignee_id, assignees, created_by, status_id, campaign_id,
  operator_id, editor_id, designer_id, reviewer_id, reviewers, design_status_id,
  shot_at, edited_at, edit_due_revised, review_due_revised,
  miss_blame, miss_blame_note, miss_blame_by,
  views, views_at, views_by, approved_at, approved_name, telegram_type, is_guiding, with_media,
  face_id, faces, skip_rate, skip_rate_at,
  recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, ready_at, ready_link,
  shot_link, design_link, post_link, reference_text, reference_links, format, rubrika, script, tz, release_date, release_time, description,
  shoot_ack, shoot_ack_at, shoot_ack_by, shoot_ack_note,
  edit_ack, edit_ack_at, edit_ack_by, edit_ack_note,
  checklist, todo_sort, pinned, photo_media_id, color, ${withThumbs ? 'photo_thumb,' : ''}
  CASE WHEN photo_thumb IS NULL THEN 0 ELSE 1 END AS has_thumb,
  (SELECT COUNT(*) FROM comments WHERE comments.content_id = content.id) AS comment_count,
  (SELECT COUNT(*) FROM reference_media WHERE reference_media.content_id = content.id) AS media_count,
  (SELECT MAX(created_at) FROM activity WHERE activity.content_id = content.id) AS updated_at,
  (SELECT MAX(round) FROM revisions WHERE revisions.content_id = content.id AND revisions.resolved_at IS NULL) AS open_round,
  (SELECT target FROM revisions WHERE revisions.content_id = content.id AND revisions.resolved_at IS NULL ORDER BY round DESC, id DESC LIMIT 1) AS open_for,
  CASE WHEN photo IS NULL THEN 0 ELSE 1 END AS has_photo, done_at, created_at`
const LIST_COLUMNS = listColumns(true)

// ---- the paper trail --------------------------------------------------------
// One activity row per meaningful change — who, which field, from → to. People
// become names and stages become labels at write time, so the log still reads
// like a sentence after members leave, stages get renamed or the task is gone.
const actRow = (user, id, title, kind, field, oldV, newV, now) => [
  'INSERT INTO activity (content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  id, title, user.id, user.name || '', kind, field ?? null, oldV ?? null, newV ?? null, now,
]
const logEvent = (user, id, title, kind) =>
  run(...actRow(user, id, title, kind, null, null, null, new Date().toISOString()))

// ---- what a Telegram piece is ------------------------------------------------
// The Telegram copywriter is paid per item, at a different base rate for "Just
// a post", "Post plus" and "Webinar", and earns a bonus on top for a guiding
// (teaching) post. The type and the post format could not tell those apart, so
// the pay could not either. Asked of every task going to a WRITTEN channel
// (format 'text') — cross-posted counts, as it does for every other format
// rule — and nowhere else: off a written channel the server stores nothing,
// whatever was sent. The planner decides post or post plus; the CMO has the
// final say, which is a person, not a rule, so nothing here second-guesses it.
//
// Required the way the brief fields are: not of a thought jotted down (it is
// asked on the move out of the idea stage), and not of an admin catching the
// board up. The builder asks it of everybody, up front.
export const TELEGRAM_TYPES = ['just_post', 'post_plus', 'webinar']
const TELEGRAM_TYPE_LABELS = { just_post: 'Just a post', post_plus: 'Post plus', webinar: 'Webinar' }
const asTelegramType = (v) => (TELEGRAM_TYPES.includes(String(v ?? '')) ? String(v) : null)
const TELEGRAM_TYPE_NEEDED = '«Telegram Item Type» is required for a Telegram piece — pick Just a post, Post plus or Webinar'
const TELEGRAM_TYPE_UNKNOWN = '«Telegram Item Type» is one of Just a post, Post plus or Webinar'
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true'

// Paragraph-sized fields land as a quiet "updated the …" — no quoting essays.
const QUIET_FIELDS = ['description', 'script', 'tz', 'reference_text', 'reference_links', 'photo', 'checklist']
const PLAIN_FIELDS = ['title', 'type', 'recording_date', 'recording_time', 'recording_end', 'edit_ready_date',
  'design_ready_date', 'release_date', 'release_time', 'format', 'rubrika', 'ready_link', 'shot_link', 'design_link', 'post_link',
  // A re-promised deadline is the most disputable thing on the task: it is
  // always somebody moving their own goalposts after a late handover, so it
  // goes in the log by name.
  'edit_due_revised', 'review_due_revised']

// Everything a stage move can rewrite — the snapshot restores exactly these.
const UNDO_FIELDS = ['status_id', 'done_at', 'ready_at', 'shot_at', 'edited_at',
  'edit_due_revised', 'review_due_revised', 'operator_id', 'editor_id', 'designer_id', 'reviewer_id',
  'reviewers', 'shot_link', 'ready_link', 'design_link', 'post_link']
// How long a move stays regrettable.
const UNDO_SECONDS = 10

async function logPatch(user, row, patch) {
  const rows = []
  const now = new Date().toISOString()
  const title = patch.title !== undefined ? patch.title : row.title
  const push = (field, oldV, newV) => rows.push(actRow(user, row.id, title, 'updated', field, oldV, newV, now))

  // People fields → names, resolved in one query.
  const ids = new Set()
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id'])
    if (patch[f] !== undefined && patch[f] !== row[f]) { if (row[f]) ids.add(row[f]); if (patch[f]) ids.add(patch[f]) }
  let oldAss = null; let newAss = null
  if (patch.assignees !== undefined) {
    const o = assigneesOf(row); const n = JSON.parse(patch.assignees)
    if (JSON.stringify(o) !== JSON.stringify(n)) { oldAss = o; newAss = n; for (const id of [...o, ...n]) ids.add(id) }
  }
  const names = {}
  if (ids.size)
    for (const u of await all(`SELECT id, name FROM users WHERE id IN (${[...ids].map(() => '?').join(',')})`, ...ids))
      names[u.id] = u.name
  const nameOf = (id) => (id ? names[id] || `#${id}` : null)
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id'])
    if (patch[f] !== undefined && patch[f] !== row[f]) push(f.replace('_id', ''), nameOf(row[f]), nameOf(patch[f]))
  if (oldAss) push('owners', oldAss.map(nameOf).join(', ') || null, newAss.map(nameOf).join(', ') || null)

  if (patch.status_id !== undefined && patch.status_id !== row.status_id) {
    const two = await all('SELECT id, label FROM statuses WHERE id IN (?, ?)', row.status_id ?? 0, patch.status_id ?? 0)
    const lab = (id) => two.find((s) => s.id === id)?.label || null
    push('stage', lab(row.status_id), lab(patch.status_id))
  } else if (patch.done_at !== undefined && !!patch.done_at !== !!row.done_at) {
    // Only when no stage move tells the story already ("→ Published" covers it).
    push('done', null, patch.done_at ? 'yes' : 'no')
  }
  if (patch.pinned !== undefined && !!patch.pinned !== !!row.pinned) push('pinned', null, patch.pinned ? 'yes' : 'no')

  if (patch.channels !== undefined) {
    const o = JSON.parse(row.channels || '[]').join(', '); const n = JSON.parse(patch.channels).join(', ')
    if (o !== n) push('platforms', o || null, n || null)
  }
  for (const f of PLAIN_FIELDS) {
    if (patch[f] === undefined) continue
    if (String(row[f] ?? '') !== String(patch[f] ?? '')) push(f, row[f] ?? null, patch[f] ?? null)
  }
  for (const f of QUIET_FIELDS) {
    if (patch[f] === undefined) continue
    if (String(patch[f] ?? '') !== String(row[f] ?? '')) push(/^reference/.test(f) ? 'reference' : f, null, null)
  }
  if (patch.telegram_type !== undefined && (patch.telegram_type ?? null) !== (row.telegram_type ?? null))
    push('telegram_type', TELEGRAM_TYPE_LABELS[row.telegram_type] || null, TELEGRAM_TYPE_LABELS[patch.telegram_type] || null)
  if (patch.is_guiding !== undefined && !!patch.is_guiding !== !!row.is_guiding) push('guiding', null, patch.is_guiding ? 'yes' : 'no')
  if (patch.with_media !== undefined && !!patch.with_media !== !!row.with_media) push('with_media', null, patch.with_media ? 'yes' : 'no')
  if (rows.length) await batch(rows)
}

// New work rings its people: one bell row + the Telegram cut per person,
// naming the hat they just got. Whoever did the assigning hears nothing.
async function notifyAssigned(req, contentId, title, roleById, extra = '') {
  const now = new Date().toISOString()
  const ids = [...roleById.keys()].filter((id) => id && id !== req.user.id)
  if (!ids.length) return
  await batch(ids.map((id) => [
    'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
    id, 'assigned', `You're on «${title}» as ${roleById.get(id)} — by ${req.user.name}`, contentId, now,
  ]))
  // Every hand-off leaves at once — nobody's message waits in line behind
  // another person's Telegram round-trip.
  await Promise.allSettled(ids.map((id) =>
    tgMirror([id], `📌 New work for you — you're the ${roleById.get(id)}\n<b>«${tgEsc(title)}»</b>${extra}\nFrom ${tgEsc(req.user.name)}. Have a look and plan it in 👇`, contentId, tgOriginFrom(req),
      { kind: 'assigned', actor: req.user.id })))
}
// ---- booked time the crew answer for -----------------------------------
// A shoot day is not a fact until the person holding the camera has said they
// can be there, and an edit deadline is not a deadline until the editor has
// said it fits. The planner books; the crew ANSWERS. Until they do the slot
// reads as waiting, and once they accept it it is theirs — the planner cannot
// quietly move an afternoon somebody has already cleared.
//
// Two bookings, one shape. `shoot` is the operator and the recording day with
// its hours; `edit` is the editor and the day the cut is due. Anything else on
// the task — the release, the design date — is a plan, not a promise made to
// a person, and nobody is asked to confirm it.
const BOOKINGS = {
  shoot: {
    holder: 'operator_id', ack: 'shoot_ack', at: 'shoot_ack_at', by: 'shoot_ack_by', note: 'shoot_ack_note',
    day: 'recording_date', from: 'recording_time', to: 'recording_end',
    what: 'the shoot', role: 'operator',
  },
  edit: {
    holder: 'editor_id', ack: 'edit_ack', at: 'edit_ack_at', by: 'edit_ack_by', note: 'edit_ack_note',
    day: 'edit_ready_date', from: null, to: null,
    what: 'the edit deadline', role: 'editor',
  },
}
// A booking exists when somebody is holding it AND there is a day. One without
// the other is half a plan and owes nobody an answer.
const bookedOn = (row, k) => !!(row[BOOKINGS[k].holder] && row[BOOKINGS[k].day])
// How the slot reads in a sentence: "3 Sep, 14:00-16:00" or just "3 Sep".
const slotWords = (row, k) => {
  const b = BOOKINGS[k]
  const day = tgDate(row[b.day])
  const from = b.from && row[b.from]
  const to = b.to && row[b.to]
  if (!from) return day
  return `${day}, ${from}${to ? `-${to}` : ''}`
}

// A person can wear two hats on one task — the message names both.
const addRole = (map, id, role) => {
  if (!id) return
  map.set(id, map.has(id) ? `${map.get(id)} & ${role}` : role)
}
// The date worth mentioning when handing someone work: the shoot if one is
// booked, otherwise the release.
const dateBit = (rec, rel) => (rec ? ` · shoot ${tgDate(rec)}` : rel ? ` · release ${tgDate(rel)}` : '')

// Two questions, and they had been collapsed into one.
//
// MAY I SEE THIS ON THE SCHEDULE — everybody, now. The schedule is the one
// thing a marketing team has to be able to read whole. Scoped to your own
// channels, "who is shooting on Thursday" could only be answered by the people
// who already knew, and an operator booked on a channel they do not sit in
// vanished from everybody else's calendar, which is the opposite of what a
// shared calendar is for.
//
// AM I ON THIS — unchanged, and it has to be, because opening the first
// question opened everything that was resting on it. When this file had one
// predicate and it started returning true, it took with it: the task's
// ATTACHMENTS (list, upload, download, delete — the brief, the ТЗ, the deck),
// its VOICE NOTES, and three writes — commenting, raising a flag, and undoing
// somebody else's last move. round52-suite says a stranger to a task gets 404
// from its paperwork, and it was right to fail.
//
// So the schedule is shared and the paperwork is not. Seeing that Jaloliddin
// films on Thursday does not hand you the brief he is filming from, and it
// certainly does not let you undo his last move.
const canSee = () => true
const worksOn = (user, row) =>
  adminHere(user, row) ||
  assigneesOf(row).includes(user.id) ||
  row.operator_id === user.id || // crew see their work even outside their departments
  row.editor_id === user.id ||
  row.designer_id === user.id ||
  row.channels.some((ch) => (user.departments || []).includes(ch))

// Every write answers with the same slim shape the list uses — callers swap
// the row into their lists, so the full photo must never ride along.
const listRow = async (id) => parse(await get(`SELECT ${LIST_COLUMNS} FROM content WHERE id = ?`, id))

// ---- shoot scheduling guard -------------------------------------------------
// Recordings are booked in hours (from–to). Before saving, the operator's day
// is checked: another shoot at the same time on ANY channel, or hours outside
// their working schedule, comes back as a 409 warning. Only an admin may push
// through it (force: true).
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const DEFAULT_SHOOT_MIN = 60 // a shoot with no end time blocks one hour

async function shootProblems({ operatorId, date, start, end, excludeId }) {
  if (!operatorId || !date || !start) return null
  const s = toMin(start)
  const e = end ? toMin(end) : s + DEFAULT_SHOOT_MIN
  const out = { conflicts: [], schedule: null }

  // Other shoots the same operator already has that day — across all channels.
  // Not the ones in the Deleted graveyard. Moving a piece there clears done_at
  // (Deleted is not a final stage), so a shoot somebody killed went on holding
  // its hour: drawn as taken on the operator's day, and answered with a
  // double-booking warning naming a task nobody is making. The day counts
  // (capProblem, loadFor) already leave the graveyard out; this is that rule,
  // written as NOT EXISTS for the reason given at /revisions/mine: a task
  // whose stage was deleted has a null status_id, and NOT IN would drop it.
  const rows = await all(
    `SELECT id, title, channels, recording_time, recording_end FROM content c
     WHERE c.operator_id = ? AND c.recording_date = ? AND c.recording_time IS NOT NULL AND c.done_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')`,
    operatorId, date)
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue
    const rs = toMin(r.recording_time)
    const re = r.recording_end ? toMin(r.recording_end) : rs + DEFAULT_SHOOT_MIN
    if (s < re && rs < e) {
      out.conflicts.push({
        id: r.id, title: r.title, channels: JSON.parse(r.channels || '[]'),
        from: r.recording_time, to: r.recording_end || null,
      })
    }
  }

  // Their working schedule (if one is set on the account).
  const op = await get('SELECT name, work_start, work_end, work_days FROM users WHERE id = ?', operatorId)
  if (op) {
    let days = null
    try { days = JSON.parse(op.work_days || 'null') } catch { /* unset */ }
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    // Said twice: as the sentence every client already shows, and in parts
    // (`why`) so the booking window can say it in the reader's language.
    if (Array.isArray(days) && days.length > 0 && !days.includes(weekday)) {
      out.schedule = `${op.name} doesn’t work that day`
      out.why = { kind: 'day_off', name: op.name }
    } else if (op.work_start && op.work_end && (s < toMin(op.work_start) || e > toMin(op.work_end))) {
      out.schedule = `Outside ${op.name}’s working hours (${op.work_start}–${op.work_end})`
      out.why = { kind: 'hours', name: op.name, from: op.work_start, to: op.work_end }
    }
  }

  return out.conflicts.length || out.schedule ? out : null
}

// Answers a 409 unless the caller is an admin pushing through on purpose.
async function guardShoot(req, res, { operatorId, date, start, end, excludeId, chans }) {
  const problems = await shootProblems({ operatorId, date, start, end, excludeId })
  if (!problems) return false
  // Double-booking somebody is the channel owner's call to make, on their own
  // channels — not a power that belongs to whoever happens to be an admin.
  const mayForce = isAdminOn(req.user, chans || [])
  if (req.body?.force === true && mayForce) return false
  res.status(409).json({
    error: problems.schedule || 'That operator is already booked at this time',
    conflicts: problems.conflicts,
    schedule_issue: problems.schedule,
    schedule_why: problems.why || null,
    can_force: mayForce,
  })
  return true
}

router.get('/', wrap(async (req, res) => {
  const { department, mine, thumbs, design } = req.query
  let rows = (await all(`SELECT ${listColumns(thumbs === '1')} FROM content ORDER BY pinned DESC, todo_sort, created_at DESC`)).map(parse)
  if (!isFullAdmin(req.user)) rows = rows.filter((c) => canSee(req.user, c))
  if (department) rows = rows.filter((c) => c.channels.includes(department))
  if (mine === 'true') rows = rows.filter((c) => c.assignee_id === req.user.id)
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD — only the pieces with a day inside the span
  // a calendar is showing, plus every piece still open whose release day has
  // already passed (the late strip). The calendars used to take the whole
  // board every ten seconds; on the live data that is what froze (r11).
  const { from, to } = req.query
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '')) {
    const DAYS = ['release_date', 'recording_date', 'edit_ready_date', 'design_ready_date', 'edit_due_revised', 'review_due_revised']
    const inSpan = (d) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to
    rows = rows.filter((c) => DAYS.some((k) => inSpan(c[k])) || (!c.done_at && c.release_date && c.release_date.slice(0, 10) < from))
  }
  // The Design board's own list: work handed to a designer, carrying an
  // artwork day, or of a kind the crew rule says is designed. It polls with
  // pictures, so it asks for only what it draws.
  if (design === '1') {
    const designed = (await getCrewNeeds()).designer || []
    // …on a channel that has designers at all: a Telegram or X post is a post
    // by type and is typed, not drawn (the bug hunt, 14 Oct 2026).
    const fmt = Object.fromEntries((await all('SELECT key, format FROM channels')).map((r) => [r.key, formatOf(r)]))
    const drawn = (c) => formatsAllowCrew(chansOf(c).map((k) => fmt[k] || 'social').map((f) => (c.with_media && f === 'short' ? 'social' : f)), 'designer')
    rows = rows.filter((c) => c.designer_id || c.design_ready_date || (designed.includes(c.type) && drawn(c)))
  }
  res.json(rows)
}))

// The Pravki (revision requests) waiting on ME — the open ones on tasks where
// I hold the stage they were sent back to. Powers the crew's "Pravki" lane.
router.get('/revisions/mine', wrap(async (req, res) => {
  // Pravki on a task that was later killed (Deleted stage) die with it — the
  // fix is nobody's job anymore.
  const rows = await all(`
    SELECT r.id, r.content_id, r.round, r.requested_by, r.requested_name, r.target, r.note, r.created_at, r.sent_link,
      c.title, c.channels, c.type, c.reference_text, c.reference_links,
      c.shot_link, c.ready_link, c.design_link,
      c.format, c.rubrika, c.script,
      c.operator_id, c.editor_id, c.designer_id, c.assignee_id, c.assignees,
      c.recording_date, c.edit_ready_date, c.design_ready_date, c.release_date,
      -- …and the re-promises beside them: the card's "due" reads editDue /
      -- reviewDue (lib/due.js), which take a re-promise over the day it replaced.
      c.edit_due_revised, c.review_due_revised,
      CASE WHEN c.photo IS NULL THEN 0 ELSE 1 END AS has_photo
    FROM revisions r JOIN content c ON c.id = r.content_id
    WHERE r.resolved_at IS NULL
      -- NOT EXISTS rather than NOT IN: status_id is nullable (a stage deleted
      -- out from under a task sets it null), and NOT IN against a null left
      -- side is itself null, which would quietly drop that task from the
      -- queue — the same disappearance this filter exists to prevent.
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
    ORDER BY r.created_at DESC`)
  const mine = rows.filter((r) =>
    (r.target === 'operator' && r.operator_id === req.user.id) ||
    (r.target === 'editor' && r.editor_id === req.user.id) ||
    (r.target === 'designer' && r.designer_id === req.user.id) ||
    // A seat nobody holds — every written post — falls to the piece's owners.
    (!r[`${r.target}_id`] && assigneesOf(r).includes(req.user.id)))
  // The task's earlier rounds ride along, so the fixer sees the whole
  // conversation ("round 1 asked for X, round 2 now asks for Y") in place.
  const ids = [...new Set(mine.map((r) => r.content_id))]
  const history = ids.length ? await all(`
    SELECT content_id, round, note, requested_name, target, resolved_at, created_at
    FROM revisions WHERE content_id IN (${ids.map(() => '?').join(',')}) ORDER BY round, id`, ...ids) : []
  res.json(mine.map((r) => ({
    ...r,
    channels: JSON.parse(r.channels || '[]'),
    reference_links: parseLinks(r.reference_links),
    history: history.filter((h) => h.content_id === r.content_id),
  })))
}))

// Every OPEN Pravki across the team — the admin's view of who owes changes.
// Powers the "N pravki" chips on Post Production.
router.get('/open-revisions', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  // A channel admin sees the channels they run, and only those. Filtered
  // after the query rather than in it, because a task's channels are a JSON
  // array and every store this runs on spells that differently.
  const mine = (rows) => (isFullAdmin(req.user) ? rows : rows.filter((r) => isAdminOn(req.user, chansOf(r))))
  const rows = mine(await all(`
    SELECT r.id, r.content_id, r.target, r.note, r.created_at,
      c.title, c.channels, c.operator_id, c.editor_id, c.designer_id
    FROM revisions r JOIN content c ON c.id = r.content_id
    WHERE r.resolved_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
    ORDER BY r.created_at DESC`))
  res.json(rows.map((r) => ({
    id: r.id, content_id: r.content_id, target: r.target, note: r.note, created_at: r.created_at, title: r.title,
    person_id: r.target === 'operator' ? r.operator_id : r.target === 'designer' ? r.designer_id : r.editor_id,
  })))
}))

// The whole team's paper trail, newest first — the admin's History tab.
router.get('/activity/all', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  res.json(await all(
    'SELECT id, content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at FROM activity ORDER BY id DESC LIMIT 150'))
}))

// ---- documents on a task: the ТЗ in Word, the reference deck as PDF -------
// Anyone who can SEE the task can read and add its paperwork — the crew
// included, since they are usually the ones who need the brief. Removing a
// document is for the person who put it there (or an admin).
const DOC_MAX = 4 * 1024 * 1024 // 4 MB of real file — every byte is stored, synced and paid for
const DOC_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  rtf: 'application/rtf',
  csv: 'text/csv',
}
const DOC_COLUMNS = 'id, content_id, name, mime, size, uploaded_by, uploader, created_at'
const extOf = (name) => String(name || '').split('.').pop().toLowerCase()

// The task a document hangs on, or null when the caller has no business with
// it. `worksOn`, not `canSee`: a document attached to a task is the brief, the
// ТЗ or the deck, and reading somebody's shoot day off the calendar is not a
// reason to be handed the paperwork behind it.
const parentOf = async (user, contentId) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', contentId))
  return row && worksOn(user, row) ? row : null
}

// How full each person's day already is, for the pickers. Cheap, read-only,
// and asked with the day the work would land on.
//
// ABOVE /:id on purpose: this path is one segment, so a router that reaches
// '/:id' first reads it as a task called "load" and answers Not found.
// ---- what is late and what is in editing, per channel ------------------------------
// The sidebar's two numbers (round 8). A count of PIECES, not of steps: a piece
// late on its shoot and on its release is one. "Late" is the reading the
// admin's day uses for its overdue list (LATE_PHASE, lateDue, phasePassed), so
// the two cannot disagree; "in editing" is a piece standing on the edit stage.
// Only the channels the caller may open. Numbers only, no rows: cheap to ask
// once a minute.
router.get('/counts', wrap(async (req, res) => {
  const today = dayISO()
  const resolved = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const keys = (await all('SELECT key FROM channels')).map((c) => c.key).filter((k) => canAccessDept(req.user, k))
  const channels = Object.fromEntries(keys.map((k) => [k, { late: 0, editing: 0 }]))
  const rows = await all(`SELECT id, channels, status_id, shot_at, edited_at, ready_at, done_at, recording_date, edit_ready_date,
      design_ready_date, release_date, edit_due_revised, review_due_revised FROM content WHERE done_at IS NULL`)
  for (const r of rows) {
    if (resolved.deadIds.includes(r.status_id)) continue
    const late = Object.entries(LATE_PHASE).some(([phase, spec]) => {
      if (phase === 'edit') return false
      const due = lateDue(r, spec)
      return !!due && due < today && !phasePassed(r, spec.phase, resolved)
    })
    const editing = !!resolved.gates.edit && r.status_id === resolved.gates.edit.id
    if (!late && !editing) continue
    for (const k of chansOf(r)) {
      if (!channels[k]) continue
      if (late) channels[k].late += 1
      if (editing) channels[k].editing += 1
    }
  }
  res.json({ channels })
}))

router.get('/load', wrap(async (req, res) => {
  const hat = String(req.query.hat || '')
  if (!['operator_id', 'editor_id', 'designer_id'].includes(hat)) {
    return res.status(400).json({ error: 'Ask about a shooter, an editor or a designer' })
  }
  res.json(await loadFor(hat, String(req.query.day || '').slice(0, 10)))
}))

router.get('/:id/files', wrap(async (req, res) => {
  if (!(await parentOf(req.user, req.params.id))) return res.status(404).json({ error: 'Not found' })
  res.json(await all(`SELECT ${DOC_COLUMNS} FROM attachments WHERE content_id = ? ORDER BY id`, req.params.id))
}))

router.post('/:id/files', wrap(async (req, res) => {
  const row = await parentOf(req.user, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const name = String(req.body?.name || '').trim().slice(0, 200)
  const data = String(req.body?.data || '')
  if (!name) return res.status(400).json({ error: 'The document needs a name' })
  const ext = extOf(name)
  if (!DOC_TYPES[ext])
    return res.status(400).json({ error: `.${ext || '?'} isn’t a document — attach a PDF, Word, Excel, PowerPoint or text file` })
  const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
  if (!b64) return res.status(400).json({ error: 'That file came through empty' })
  const size = Math.floor(b64.replace(/=+$/, '').length * 3 / 4)
  if (size > DOC_MAX)
    return res.status(413).json({ error: `“${name}” is ${(size / 1048576).toFixed(1)} MB — documents are capped at 4 MB` })
  const mime = DOC_TYPES[ext]
  const now = new Date().toISOString()
  const info = await run(
    `INSERT INTO attachments (content_id, name, mime, size, data, uploaded_by, uploader, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, name, mime, size, `data:${mime};base64,${b64}`, req.user.id, req.user.name || '', now)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'document', null, name, now))
  await touchRepost(row.id)
  res.status(201).json(await get(`SELECT ${DOC_COLUMNS} FROM attachments WHERE id = ?`, info.lastInsertRowid))
}))

// Permission to fetch one document, for the next two minutes. This is the
// route that checks WHO is asking; /raw above only checks the ticket.
router.get('/files/:fileId', wrap(async (req, res) => {
  const doc = await get(`SELECT ${DOC_COLUMNS} FROM attachments WHERE id = ?`, req.params.fileId)
  if (!doc || !(await parentOf(req.user, doc.content_id))) return res.status(404).json({ error: 'Not found' })
  res.json({ ...doc, url: ticketFor(doc.id) })
}))

router.delete('/files/:fileId', wrap(async (req, res) => {
  const doc = await get(`SELECT ${DOC_COLUMNS} FROM attachments WHERE id = ?`, req.params.fileId)
  if (!doc) return res.status(404).json({ error: 'Not found' })
  const row = await parentOf(req.user, doc.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!adminHere(req.user, row) && doc.uploaded_by !== req.user.id)
    return res.status(403).json({ error: 'Only the person who attached this (or an admin) can remove it' })
  await run('DELETE FROM attachments WHERE id = ?', doc.id)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'document', doc.name, null, new Date().toISOString()))
  res.json({ ok: true })
}))

// A task's revision rounds, oldest first, each with the notes written under
// it. sent_link is the file the round sent back ('' for none, null on a round
// older than the column); fixed_link the one that closed it.
const revisionsOf = async (contentId) => {
  const revs = await all(
    `SELECT id, round, requested_by, requested_name, target, note, photo, photo_thumb, voice_id, voice_secs, created_at, resolved_at,
      sent_link, fixed_link, resolved_by, resolved_name
     FROM revisions WHERE content_id = ? ORDER BY round, id`, contentId)
  const notes = revs.length
    ? await all('SELECT id, revision_id, user_id, author, text, created_at FROM revision_notes WHERE content_id = ? ORDER BY id', contentId)
    : []
  return revs.map((r) => ({ ...r, notes: notes.filter((n) => n.revision_id === r.id) }))
}

// The file a round is answered against: the one it sent back, or — on a round
// opened before that was written down — whatever the task holds now.
const sentBack = (rev, row, field) => (rev && rev.sent_link != null ? rev.sent_link : row[field]) ?? ''
const LINK_OF = { operator: 'shot_link', editor: 'ready_link', designer: 'design_link' }

// One task in full — including the original photo, its revision history,
// the comment thread and its paper trail.
router.get('/:id', wrap(async (req, res) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', req.params.id))
  if (!row || !canSee(req.user, row)) return res.status(404).json({ error: 'Not found' })
  const revisions = await revisionsOf(row.id)
  const comments = await all(
    'SELECT id, user_id, author, text, voice_id, voice_secs, created_at FROM comments WHERE content_id = ? ORDER BY id',
    row.id)
  const activity = await all(
    'SELECT id, user_id, user_name, kind, field, old_value, new_value, created_at FROM activity WHERE content_id = ? ORDER BY id DESC LIMIT 80',
    row.id)
  // Names and sizes only — the bytes come one document at a time, on a click.
  const documents = worksOn(req.user, row)
    ? await all(`SELECT ${DOC_COLUMNS} FROM attachments WHERE content_id = ? ORDER BY id`, row.id) : []
  // The three accountable phases, derived fresh — the modal shows who owes
  // what, by when, and whether the clock has already run out on them.
  const date_requests = await openRequestsFor(row.id)
  const flags = await all(
    'SELECT id, kind, reason, raised_by, raised_name, created_at, cleared_at, cleared_name FROM task_flags WHERE content_id = ? ORDER BY id DESC', row.id)
  // With the stage list, as every other reader of the phases already passes
  // it. Without it phasePassed() cannot tell that a card is past a phase, so
  // the rule "passed with no stamp means done on time" never applied HERE —
  // the one screen people open to see who is late — while the warnings, the
  // missed list and the pay run all applied it. The modal alone called a
  // shoot nobody stamped "late", and counted the days up to today.
  const resolved = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const phases = phasesOf(row, undefined, resolved)
  const media = await mediaOf(row.id)
  const reposts = await repostsOf(row, mayRepost(req.user, row))
  // Drive drop-in (server/dropin.js): the name to give a file and the folder
  // its stage sends it to; and, for whoever works on it, what has arrived.
  const drop = await dropOf(row, resolved, revisions.some((r) => !r.resolved_at))
  const drive_drops = worksOn(req.user, row) ? await dropsOf(row.id) : []
  res.json({ ...row, revisions, comments, activity, documents, date_requests, flags, phases, media, reposts, drop, drive_drops, has_photo: row.photo ? 1 : 0, updated_at: activity[0]?.created_at || row.created_at })
}))

// ---- "Also TikTok", "Also Shorts" --------------------------------------------
// Where else a video goes once it is published (server/reposts.js). Said by
// whoever runs the piece or an admin on its channel, and only while it is
// being made: the reposts are made by the publish, so a tick changed after it
// would change nothing — the server says so rather than keeping a tick that
// lies. Answers with what the task window draws.
const mayRepost = (user, row) => adminHere(user, row) || assigneesOf(row).includes(user.id)
router.put('/:id/reposts', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  if (!mayRepost(req.user, row))
    return res.status(403).json({ error: 'Only whoever runs this piece, or an admin on its channel, says where else it goes' })
  if (row.done_at)
    return res.status(409).json({ error: 'It is out already — TikTok and Shorts are ticked before it is published, and the reposts were made then' })
  const offer = await offerOf(row)
  if (!offer.length)
    return res.status(400).json({ error: 'Only a video on a channel whose videos go on to TikTok and Shorts can be reposted' })
  const want = (Array.isArray(req.body?.to) ? req.body.to : []).map(String)
  const odd = want.find((k) => !offer.some((o) => o.key === k))
  if (odd) return res.status(400).json({ error: `«${odd}» is not a channel this video can be reposted on`, field: 'repost_to' })
  const next = offer.map((o) => o.key).filter((k) => want.includes(k))
  const was = ticksOf(row).filter((k) => offer.some((o) => o.key === k))
  if (next.join() !== was.join()) {
    const words = (keys) => keys.map((k) => offer.find((o) => o.key === k).label).join(', ') || null
    await run('UPDATE content SET repost_to = ? WHERE id = ?', JSON.stringify(next), row.id)
    await run(...actRow(req.user, row.id, row.title, 'updated', 'reposts', words(was), words(next), new Date().toISOString()))
  }
  res.json(await repostsOf({ ...row, repost_to: JSON.stringify(next) }, true))
}))

// One delivery, however it was given. With a folder on the channel the person
// names the file and the folder is remembered for them; without one they paste
// the whole address as before. Either way the answer has to point at a FILE —
// a folder on its own points at everything the channel has ever made.
async function buildDelivery(req, row, body, fileKey, what) {
  const folder = await folderFor(chansOf(row))
  // A file has to actually be NAMED to win. The key arriving empty is not a
  // naming — it is a form that carries every box it holds, filled or not — and
  // treating it as one meant an empty `shot_file` sitting beside a perfectly
  // good `shot_link` returned null and wiped the link on the way past. That is
  // what ate every delivery link pasted by anyone who was not the crew member
  // who owned the box: the value went up in the request and came back gone.
  const raw = body[fileKey]
  if (raw !== undefined && String(raw ?? '').trim()) {
    const label = cleanFileLabel(raw)
    if (!label) return { value: null }
    if (!folder)
      return { error: 'This channel has no shared folder yet — paste the whole link, or ask an admin to set the folder in Admin → Channels' }
    return { value: deliveryValue(folder, label) }
  }
  const link = cleanLink(body[fileKey === 'ready_file' ? 'ready_link' : fileKey === 'shot_file' ? 'shot_link' : 'design_link'])
  if (!link) return { value: null }
  if (!/^https?:\/\//i.test(link)) return { error: linkComplaint(link, what) }
  return { value: link }
}

// ---- naming somebody in the thread -----------------------------------------
// "@Dilnoza" in a comment should reach Dilnoza, whether or not she is on the
// task — naming somebody is how you pull them IN. Matched against the real
// roster rather than a username syntax, because this team writes first names
// in Cyrillic and nobody types an @handle they would have to look up.
// Longest names first, so "@Anvar Karimov" is one person and not Anvar.
export function mentionedIds(text, users) {
  const t = String(text ?? '')
  if (!t.includes('@')) return []
  const hits = []
  for (const u of [...users].sort((a, b) => (b.name || '').length - (a.name || '').length)) {
    const full = String(u.name || '').trim()
    if (!full) continue
    for (const label of [full, full.split(/\s+/)[0]]) {
      if (label.length < 2) continue
      // @ + the name, ending at a word boundary the Unicode way (\b does not
      // work on Cyrillic in every engine, so the next character is checked).
      const at = new RegExp(`@${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu')
      if (at.test(t)) { hits.push(u.id); break }
    }
  }
  return [...new Set(hits)]
}

// ---- voice notes -----------------------------------------------------------
// A Pravki that takes four minutes to type takes fifteen seconds to say, and
// half of what a reviewer means is in the tone. A clip is uploaded once and
// referred to by id: the bytes never ride along with a task, a list or a poll,
// and are fetched by the press that plays it.
const VOICE_MAX = 3 * 1024 * 1024        // ~3 minutes of opus, and a hard stop
const VOICE_SECS_MAX = 300
const VOICE_MIME = /^audio\/(webm|ogg|mp4|mpeg|wav|aac|x-m4a)(;|$)/i

async function saveVoice(req, row, body) {
  const data = String(body?.voice ?? '')
  if (!data) return { id: null, secs: 0 }
  const m = data.match(/^data:([^;,]+)[;,]/)
  if (!m || !VOICE_MIME.test(m[1])) return { error: 'That is not a voice recording' }
  // base64 is 4 chars per 3 bytes; near enough for a cap.
  const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75)
  if (size > VOICE_MAX) return { error: 'That recording is too long — keep a voice note under three minutes' }
  const secs = Math.max(0, Math.min(VOICE_SECS_MAX, Math.round(Number(body?.voice_secs) || 0)))
  const info = await run(
    'INSERT INTO voice_notes (content_id, user_id, author, mime, secs, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    row.id, req.user.id, req.user.name || '', m[1], secs, size, data, new Date().toISOString())
  return { id: info.lastInsertRowid, secs }
}

// Playing one. Same reach as the task it belongs to — if you can open the
// task you can hear what was said on it.
router.get('/voice/:vid', wrap(async (req, res) => {
  const v = await get('SELECT * FROM voice_notes WHERE id = ?', req.params.vid)
  if (!v) return res.status(404).json({ error: 'Not found' })
  const row = await get('SELECT * FROM content WHERE id = ?', v.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const parsed = { ...row, channels: JSON.parse(row.channels || '[]') }
  if (!worksOn(req.user, parsed)) return res.status(404).json({ error: 'Not found' })
  res.json({ id: v.id, mime: v.mime, secs: v.secs, author: v.author, data: v.data })
}))

// One line into the task's thread. Anyone who can SEE the task may speak —
// the crew included; that is the point. Everyone else on the task (and
// anyone who spoke before) hears it through the bell.
router.post('/:id/comments', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const parsed = { ...row, channels: JSON.parse(row.channels || '[]') }
  // Somebody NAMED in the thread was pulled in to answer, so they may.
  const namedHere = async () => mentionedIds(
    (await all('SELECT text FROM comments WHERE content_id = ?', row.id)).map((c) => c.text).join('\n'), [req.user]).length > 0
  if (!worksOn(req.user, parsed) && !(await namedHere())) return res.status(404).json({ error: 'Not found' })
  const text = String(req.body?.text ?? '').trim().slice(0, 2000)
  // A voice note IS the message; words beside it are optional.
  const voice = await saveVoice(req, row, req.body)
  if (voice.error) return res.status(400).json({ error: voice.error })
  if (!text && !voice.id) return res.status(400).json({ error: 'Write something first, or hold the mic and say it' })
  const now = new Date().toISOString()
  const info = await run(
    'INSERT INTO comments (content_id, user_id, author, text, voice_id, voice_secs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id, req.user.id, req.user.name || '', text, voice.id, voice.secs, now)
  await touchRepost(row.id)
  let assignees = []
  try { assignees = JSON.parse(row.assignees || '[]') } catch { assignees = [] }
  const spoke = (await all('SELECT DISTINCT user_id FROM comments WHERE content_id = ?', row.id)).map((r) => r.user_id)
  // Naming somebody reaches them even when the task is none of their business
  // — which is exactly when you name somebody. "@Дилноза, можешь снять?" was
  // reaching nobody, because she was not on the task yet.
  const named = mentionedIds(text, await all("SELECT id, name FROM users WHERE role <> 'ambassador'"))
    .filter((id) => id !== req.user.id)
  // A reminder ("Remind Eldor", the Coach look) is for the one person it
  // names: the line stays in the thread for anybody who opens the task, but
  // only they are rung. It can only ever ring fewer people, so it needs no
  // permission of its own.
  const remind = req.body?.remind === true
  const people = [...new Set((remind ? named : [...assignees, row.assignee_id, row.operator_id, row.editor_id, row.designer_id, ...spoke, ...named])
    .filter((id) => id && id !== req.user.id))]
  if (people.length) {
    const spoken = voice.id ? `🎤 a ${voice.secs}s voice note` : ''
    const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : spoken
    const line = `${req.user.name} on «${row.title}»: ${preview}`
    const namedLine = `${req.user.name} named you on «${row.title}»: ${preview}`
    await batch(people.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, named.includes(id) ? 'mention' : 'comment', named.includes(id) ? namedLine : line, row.id, now,
    ]))
    // Telegram gets the roomier cut: who spoke, on what, the words, the link.
    // The thread is the bell's; somebody NAMED in it is asked something, and
    // that is worth a buzz (the Telegram diet — see TG_KINDS).
    await tgMirror(named, `💬 ${tgEsc(req.user.name)} wrote on <b>«${tgEsc(row.title)}»</b>\n“${tgEsc(preview)}”\nAnswer where the task lives 👇`, row.id, tgOriginFrom(req),
      { kind: 'mention', actor: req.user.id })
  }
  res.status(201).json(await get('SELECT id, user_id, author, text, voice_id, voice_secs, created_at FROM comments WHERE id = ?', info.lastInsertRowid))
}))

// Times come from <input type="time"> as HH:MM — anything else becomes null.
const cleanTime = (v) => (v && /^\d{2}:\d{2}/.test(String(v)) ? String(v).slice(0, 5) : null)
// A shoot's hours sit on the quarter-hour grid the time band books on (round
// 8: "make each element 15 minutes"; it was half hours) — whatever sent them:
// the band, the sheet's time boxes, a bulk move, an API client. A start rounds
// down and an end rounds up, so a shoot is never made shorter. Rounded, not
// refused: a 10:10 that lands on 10:00 still meets every clash it would have.
const snapSlot = (t, up = false) => {
  if (!t) return t
  const m = toMin(t)
  // The day ends at 23:59, not "24:00", which no time box can hold.
  const s = up ? Math.min(23 * 60 + 59, Math.ceil(m / 15) * 15) : Math.min(23 * 60 + 45, Math.floor(m / 15) * 15)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// The briefing fields the admin can demand (Admin → Pipeline → The task
// form). A required field blocks creating a task of a scoped type without
// it — and blocks clearing it later.
const FIELD_LABELS = { format: 'Format', rubrika: 'Rubrika', script: 'Script', tz: 'ТЗ', reference: 'Reference', description: 'Description' }
const cleanShort = (v) => (v ? String(v).trim().slice(0, 120) : null) || null
const cleanScript = (v) => (v ? String(v).trim().slice(0, 20000) : null) || null

// What a value IS — a link, a sentence, a placeholder — lives in one place
// now (server/text.js), because the two questions this board asks are
// genuinely different and were being answered by the same blunt check. A
// reference has to POINT somewhere; a script has to SAY something; and a URL,
// which is three "words" once you split on spaces, is not a shot list.
// Junk in an OPTIONAL field is not worth an error — but it is not worth
// storing either, because it reaches the card and reads as content. It comes
// to rest as empty, which is what it means.
const orBlank = (v) => (hasSubstance(v) ? v : null)
// A delivery box wants a link and nothing else. Somebody who typed a sentence
// into it has misread the box, and "should be a URL" does not tell them that
// — so the complaint names what they actually wrote.
const linkComplaint = (v, what) => {
  const t = readText(v)
  if (t.links.length) return `${what} is a link on its own — paste just the address, with the https:// on the front`
  if (t.words.length >= MIN_SENTENCE_WORDS) return `${what} goes in this box, not a note — this reads like a sentence. Say it in the Talk thread instead.`
  return `${what} should be a URL — paste the full https://… address`
}
// A shoot is BOOKED the moment it reaches — or is created straight into — the
// "To shoot" gate: from there it needs whoever films it, the day, the hours
// and the script they film from. Earlier than that (the Idea stage, the
// quick-add box) a filmed piece is still just a title, and stays cheap to
// jot down; the demand lands the moment somebody actually books the shoot.
//
// Until October 2026 it also asked the day the edit was due and the release
// day ("all three dates"), and took a reference for a brief. The owner's rule
// since: a shoot is asked what a SHOOT needs, and nothing the edit needs.
// The reference, the ТЗ, the editor and the day to post are asked on the way
// into the stage after it (`editGaps`, below) — when there is footage, and
// the answers are real rather than guessed three weeks ahead.
//
// EVERY gap, in the order they are asked, and not just the first. The board's
// own window asks one question at a time and only ever wanted the first; the
// bulk window puts a box beside every one of them at once, and a booking that
// is short of a shooter, the day and the hours used to be four trips to the
// server and back to find that out — each one answering "and also…".
//
// `scriptAsked` / `tzAsked` / `referenceAsked`: a brief field the admin
// switched off for this type (`fieldOn`) is on nobody's form, so no wall asks
// for it.
const bookingGaps = ({ operatorId, recording, recordingTime, recordingEnd, script, scriptAsked = true }) => {
  const gaps = []
  if (!operatorId) gaps.push({ field: 'operator_id', error: 'Pick who is filming this — a shoot nobody is holding is nobody’s job' })
  if (!recording) gaps.push({ field: 'recording_date', error: 'Pick the shoot day — a shoot with no day is one nobody can turn up to' })
  // AND THE HOURS. A named operator with a day and no time is somebody told
  // "you are filming Thursday" and left to work out when — which is the whole
  // ambiguity the week view exists to remove, and the one that gets settled
  // by two people guessing differently. Their week is on the page; the answer
  // is one press away on it. The END is not a wall: the time band always sends
  // one, and a booking from an older form with none is still drawn an hour
  // long, as it always was — refusing it broke every form that asks a start.
  if (!recordingTime) gaps.push({ field: 'recording_time', error: 'Pick the hour as well — their week is right there, and a shoot day with no time is a day nobody can plan around' })
  // The script, written down before anybody is asked to turn up. An idea owes
  // nobody one; a booked shoot does. This is the difference between a crew
  // arriving to make something and a crew arriving to work out what to make,
  // and it is the one thing on this board that cannot be fixed afterwards —
  // the day happens either way. A reference does not stand in for it: a clip
  // to copy is what the EDIT is held against, not what is said to the camera.
  if (scriptAsked && !isSentence(script)) gaps.push({ field: 'script', error: 'Write the script before booking the shoot — a crew turning up without one is a day spent working out what to film' })
  return gaps
}
// …and what the stage after the shoot asks: what the editor works from (the
// reference to hold the edit against, the ТЗ that says what to do with the
// footage), who edits, and the day it goes out. In the order the owner asks
// them. The reference is words, a link, a picture or a video — any of them.
const editGaps = ({ referenceReady, tz, editorId, release, referenceAsked = true, tzAsked = true }) => {
  const gaps = []
  if (referenceAsked && !referenceReady) gaps.push({ field: 'reference_text', error: 'Add the reference before it goes to editing — a link, a few words on how it should look, or the picture or video it should look like' })
  if (tzAsked && !isSentence(tz)) gaps.push({ field: 'tz', error: 'Write the TZ before it goes to editing — what the editor must do with the footage' })
  // Filming done means the next pair of hands has a name. The footage
  // exists by now, so the editor is a real answer rather than a guess —
  // which is why this is asked HERE and never at creation.
  if (!editorId) gaps.push({ field: 'editor_id', error: 'Name who edits this — footage with no editor waiting is footage nobody is editing' })
  if (!release) gaps.push({ field: 'release_date', error: 'Pick the day to post — the edit is made for a day, and the editor works back from it' })
  return gaps
}
// Is this brief field on the form at all for this piece — the admin's switch
// (Admin → Pipeline → The task form: off, or on but not for this type) and
// the channel's format? The same reading the forms draw by.
const fieldOn = (rules, k, type, formats) => {
  const r = rules[k]
  return !!r && (fieldDemanded(r, type) || (r.state !== 'off' && r.types.includes(type))) && formatsAllowField(formats, k)
}
// A FILMED piece: the admin's crew rule names an operator for its type
// (Admin → Pipeline), on channels that film at all. Everything the owner
// settled for "a reel, a video, a target ad" is asked of this, and of nothing
// else — a post and a written piece are held to what they always were.
const filmedPiece = async (type, chans, withMedia = false) =>
  (await getCrewNeeds()).operator.includes(type) && formatsAllowCrew(await channelFormatsFor(chans, withMedia), 'operator')
const bookingGap = (a) => bookingGaps(a)[0] || null
const bookingProblem = (a) => bookingGap(a)?.error || null
// Which field on the task a brief rule is about. They are the same name but
// one: the admin's rule is «Reference», and what a person types it into is
// the reference text.
const briefField = (k) => (k === 'reference' ? 'reference_text' : k)
// Everything before the shooting gate is still an idea: a title and a maybe,
// which owes nobody a crew, a date or a brief. The gate itself is the admin's
// stage list, matched the way every other stage rule matches it.
const isIdea = (statusId, statuses) => {
  const { gates, ordered } = resolveGates(statuses)
  if (!gates.shoot) return false
  const at = ordered.findIndex((s) => s.id === statusId)
  return at >= 0 && at < gates.shoot.index
}
// The one stage where a filmed piece is BEING booked. A task created further
// along than this is not making a promise — it is recording work that already
// happened, and demanding a future shoot day of it would be nonsense. Nothing
// escapes that way: MOVING into or through the gate is what the wall in the
// PATCH handler watches, whichever stage the move aims at.
const isBooking = (statusId, statuses) => {
  const { gates, ordered } = resolveGates(statuses)
  if (!gates.shoot) return false
  return ordered.findIndex((s) => s.id === statusId) === gates.shoot.index
}
// ---- a booked shoot is not an idea ----------------------------------------
// The quick builder writes every new task at Idea, and a task stayed there
// however fully it had been booked — so the operator's day and the recording
// calendar said "Shoot" while the card said "Idea", and the board gave two
// answers to "is this happening?". A filmed piece that arrives with everything
// the shooting gate asks (who films it, the day and the hours, the script)
// and every brief field the admin demands from there on IS a booked
// shoot, and is created on that gate. Anything short of that stays an idea
// exactly as before — nothing here asks more of anybody than it used to.
//
// Only when the caller says the stage is the board's to choose
// (`auto_stage: true` — the builder, which never asks for one). A stage
// somebody picked on the full sheet, or an API client named, is theirs.
async function shootGateFor({
  type, formats, fieldRules, checks, pipeline,
  operatorId, recording, recordingTime, recordingEnd, script, referenceText, refCarried,
}) {
  const gate = pipeline.gates.shoot
  if (!gate) return null
  if (!(await getCrewNeeds()).operator.includes(type) || !formatsAllowCrew(formats, 'operator')) return null
  // From the gate on, a reference has to say something: a link or words (the
  // owner, 13 Oct: "a reference can be a link or text") — never a placeholder.
  if (referenceText && !refCarried && !hasSubstance(referenceText)) return null
  if (bookingProblem({
    operatorId, recording, recordingTime, recordingEnd, script, scriptAsked: fieldOn(fieldRules, 'script', type, formats),
  })) return null
  if (requiredProblem(fieldRules, type, checks, formats)) return null
  return gate.id
}

// Two scripts that read the same are one script wearing two titles — the
// crew ends up shooting the same thing twice. Compared loosely (case and
// whitespace folded away) so a re-typed copy still catches.
//
// The fingerprint is STORED on the row and indexed. Reading every script in
// the database to answer this — which is what it used to do — meant a board
// with a thousand tasks on it pulled megabytes of prose through on every
// single save, for a question that is one lookup.
const normScript = scriptKey
async function duplicateScript(script, excludeId) {
  const key = scriptKey(script)
  if (!key) return null
  return (await get(
    'SELECT id, title FROM content WHERE script_key = ? AND id <> ? LIMIT 1', key, excludeId ?? -1)) || null
}

// Where a thought is jotted. An idea is a name and a couple of sentences, and
// that is the whole point of having the stage: the brief the admin demands is
// asked at the stage where the work is actually going to be MADE, because
// demanding a script, a format and a reference of a thought is how ideas stop
// being written down at all. The demand does not vanish — it lands on the
// first move OUT of here (see the forward-move gate below).
//
// Anything BEFORE the shooting gate is still a thought: nothing has been
// committed to, nobody is holding a camera, and the columns a board puts in
// front of that gate (Backlog, Ideas, Parked) are all the same kind of place.
// This is the rule the cards already use for what they say is missing —
// `stageRankOf` in client/src/lib/gaps.js — and it is worth having ONE answer
// to "is this still an idea", not three that disagree at the edges.
//
// A board with no shooting stage at all has no such line, so only its first
// column counts, and a stage nobody recognises is treated as a thought.
const IDEA_LABEL = /^idea$|^ideas$|g'oya|идея/i
const isIdeaStage = (statusId, resolved) => {
  if (statusId === null || statusId === undefined) return true
  const ordered = resolved?.ordered || []
  const i = ordered.findIndex((s) => s.id === statusId)
  if (i < 0) return true
  const shootAt = resolved?.gates?.shoot?.index
  if (Number.isInteger(shootAt) && shootAt >= 0) return i < shootAt
  return i === 0 || IDEA_LABEL.test(String(ordered[i].label || ''))
}
// ---- the stretch where the schedule stops being editable ------------------
// From the moment a shoot is booked until the work is up for review, the days
// on a task are other people's plans: an operator has held a morning, an
// editor has been told when the cut is due, and a release is being counted on.
// So the deadlines freeze there for everyone but an admin — not "ask and it
// probably moves", but "this does not move, and an admin answers for it if it
// has to".
//
// Read off the gates rather than off labels, so it stays right when an admin
// renames a stage: it is the band from the shoot gate up to (not including)
// review — To shoot and Editing on the pipeline as it ships. A board with no
// shoot gate has no such band and nothing freezes.
const datesFrozenAt = (statusId, resolved) => {
  const ordered = resolved?.ordered || []
  const i = ordered.findIndex((s) => s.id === statusId)
  if (i < 0) return false
  const from = resolved?.gates?.shoot?.index
  if (!Number.isInteger(from)) return false
  const until = resolved?.gates?.review?.index
  return i >= from && (Number.isInteger(until) ? i < until : true)
}

// What an idea is still held to: the description, if the admin asked for one.
// A thought somebody cannot read back is not a thought that was written down.
const ideaRules = (rules) => ({ description: rules.description })

// The first unmet demand among the admin's required brief fields, as the
// sentence to show. Presence, substance and (for a reference) direction are
// three different failures and get three different sentences — "required"
// alone would send somebody back to a field they had already filled in.
// `formats` is the set of channel formats this task is going to. A field has
// to be wanted by the type AND by at least one of those surfaces: "«Reference»
// is required for this type of task" was being said to somebody writing a
// Telegram announcement, because the rule knew what the piece WAS and not
// where it was going. With no channels chosen yet the type rules stand alone,
// which is what a brand-new idea should be judged by.
//
// …and EVERY unmet demand, as `requiredProblems`, each with the field it is
// about. A task short of a script AND a ТЗ was told about the script, fixed
// it, and only then heard about the ТЗ — one field per round trip, which is
// exactly the conversation a window listing everything missing is meant to
// replace. The one-sentence answer below is still the first of these, so
// every place that asks "is anything missing?" hears what it always heard.
const requiredProblems = (rules, type, checks, formats = []) => {
  const problems = []
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    const r = rules[k]
    if (!fieldDemanded(r, type)) continue
    if (!formatsAllowField(formats, k)) continue
    const c = checks[k] || {}
    const say = (error) => problems.push({ field: briefField(k), error })
    if (!c.present) { say(`«${label}» is required for this type of task`); continue }
    // Three different failures, three different sentences: it is empty, it
    // says nothing, or it points nowhere. "Required" alone would send
    // somebody back to a field they had already filled in.
    if (c.thin) {
      const t = readText(c.raw)
      if (k === 'script' && t.kind === 'link')
        say(`«${label}» needs the words, not just the link — the crew films from this`)
      else if (t.kind === 'fragment')
        say(`«${label}» needs a real answer — “${clip(c.raw)}” is a note, not something anyone can work from`)
      else say(`«${label}» needs a real answer — “${clip(c.raw)}” is a placeholder, not a brief`)
      continue
    }
    // (A reference of words alone is a real reference — the owner, 13 Oct. Only a placeholder is refused, above.)
  }
  return problems
}
const requiredProblem = (...args) => requiredProblems(...args)[0]?.error || null

router.post('/', wrap(async (req, res) => {
  const {
    title, type = 'post', status_id: stageSent = null,
    recording_date = null, edit_ready_date = null, design_ready_date = null, release_date = null,
    description = '', photo = null, photo_thumb = null, checklist = [], reference_text = null,
  } = req.body || {}
  // …and a stage that does not exist is not a stage (the PATCH handler says
  // the same); taken on trust it reached the INSERT and came back a 500.
  const status_id = asStageId(stageSent)
  if (status_id !== null && !(await get('SELECT 1 AS x FROM statuses WHERE id = ?', status_id)))
    return res.status(400).json({ error: 'No such stage' })
  const referenceLinks = cleanLinks(req.body?.reference_links)
  // A task can be born with a whole album. An older client sending the single
  // photo still works and becomes an album of one — the pair below is written
  // from this list either way, so the two never disagree from the first row.
  const referencePhotos = req.body?.reference_photos !== undefined
    ? cleanPhotos(req.body.reference_photos)
    : cleanPhotos(photo ? [{ photo, thumb: photo_thumb }] : [])
  const recording_time = snapSlot(cleanTime(req.body?.recording_time))
  const recording_end = snapSlot(cleanTime(req.body?.recording_end), true)
  const release_time = cleanTime(req.body?.release_time)
  if (recording_time && recording_end && recording_end <= recording_time)
    return res.status(400).json({ error: 'The shoot ends before it starts' })
  const channels = await cleanChannels(req.body?.channels ?? (req.body?.channel ? [req.body.channel] : []))
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Give the task a title' })
  if (channels.length === 0) return res.status(400).json({ error: 'Pick at least one platform' })
  if (!channels.every((ch) => canAccessDept(req.user, ch))) return res.status(403).json({ error: 'Not your channel' })
  if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to add tasks' })
  const safeType = CONTENT_TYPES.includes(type) ? type : 'post'

  // The brief: format / rubrika / script, plus the required-field gate the
  // admin configured for this content type.
  const format = cleanShort(req.body?.format)
  const rubrika = cleanShort(req.body?.rubrika)
  const script = cleanScript(req.body?.script)
  const tzText = cleanScript(req.body?.tz)
  const fieldRules = await getTaskFields()
  // The admin is not made to fill in a form; see `unfettered` above.
  const free = unfettered(req.user, channels)
  const badDay = badDayIn({ recording_date, edit_ready_date, design_ready_date, release_date })
  if (badDay) return res.status(400).json({ error: 'Give the day as a date', field: badDay })
  // A piece does not go out before it is filmed — the board's own drag refuses
  // the same (the bug hunt, 14 Oct 2026: a quick "In 6 days" did it).
  if (!free && recording_date && release_date && String(release_date) < String(recording_date))
    return res.status(400).json({ error: 'It would go out before it is filmed — pick the shoot day or later', field: 'release_date' })
  // A reference can arrive as a link, a photo or an attached document; only
  // the text-only case has to prove that it points somewhere.
  const refCarried = referenceLinks.length > 0 || !!photo
  // An idea owes its name and, if the admin asks, its description. Everything
  // else the admin demands is asked when the piece leaves the idea stage.
  const pipeline = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const withMedia = truthy(req.body?.with_media)
  const formats = await channelFormatsFor(channels, withMedia)
  const briefChecks = {
    format: { present: !!format, thin: !hasSubstance(format), raw: format },
    rubrika: { present: !!rubrika, thin: !hasSubstance(rubrika), raw: rubrika },
    script: { present: !!script, thin: !isSentence(script), raw: script },
    tz: { present: !!tzText, thin: !isSentence(tzText), raw: tzText },
    description: {
      present: !!(description && String(description).trim()),
      thin: !hasSubstance(description), raw: description,
    },
    reference: {
      present: !!(reference_text || refCarried),
      thin: !refCarried && !hasSubstance(reference_text), raw: reference_text,
    },
  }
  // Fully booked on the way in: it starts on the shooting gate (see
  // `shootGateFor` above), and is held to that gate's rules from here down.
  const booked = req.body?.auto_stage === true && isIdeaStage(status_id, pipeline)
    ? await shootGateFor({
      type: safeType, formats, fieldRules, checks: briefChecks, pipeline,
      operatorId: req.body?.operator_id, recording: recording_date, recordingTime: recording_time,
      recordingEnd: recording_end, script, referenceText: reference_text, refCarried,
    })
    : null
  const bornAnIdea = !booked && isIdeaStage(status_id, pipeline)
  const askedNow = bornAnIdea ? ideaRules(fieldRules) : fieldRules
  const problem = requiredProblem(askedNow, safeType, briefChecks, formats)
  if (problem && !free) return res.status(400).json({ error: problem })

  // A written piece says what it is (see TELEGRAM_TYPES). Anything else
  // stores nothing, whatever was sent.
  const written = formats.includes('text')
  const tgSent = req.body?.telegram_type
  const telegramType = written ? asTelegramType(tgSent) : null
  if (written && tgSent != null && tgSent !== '' && !telegramType)
    return res.status(400).json({ error: TELEGRAM_TYPE_UNKNOWN, field: 'telegram_type' })
  if (written && !telegramType && !bornAnIdea && !free)
    return res.status(400).json({ error: TELEGRAM_TYPE_NEEDED, field: 'telegram_type' })
  const isGuiding = written && truthy(req.body?.is_guiding) ? 1 : 0

  // The two rules that hold whether or not the admin demanded the field,
  // because they are about what the words ARE, not about whether they were
  // required: a reference that is only prose points nowhere, and a reference
  // of "." is not one. Text standing ALONE carries the rule — links, a photo
  // or an attached document already point somewhere.
  // …and the same at the idea stage: a reference has to be a real answer —
  // a link, or words that say what it should look like (the owner, 13 Oct:
  // "a reference can be a link or text"). Only a placeholder is refused.
  if (reference_text && !refCarried && !free && !bornAnIdea) {
    if (!hasSubstance(reference_text))
      return res.status(400).json({ error: `«Reference» needs a real answer — “${clip(reference_text)}” is a placeholder, not a reference` })
  }
  // A script the crew already has is not a second script — it is the same
  // shoot booked twice, and both cards then wait for the same footage.
  // Duplicate carries the brief across ON PURPOSE, so it says so and passes.
  if (!req.body?.allow_duplicate_script && !free) {
    const twin = await duplicateScript(script)
    if (twin)
      return res.status(400).json({ error: `That script is already on «${twin.title}» — link to it or write what is different about this one` })
  }
  // Junk in a field nobody demanded is not worth an error, but it is not worth
  // storing either — it reaches the card and reads as content. It comes to
  // rest as empty, which is what it means.
  const briefText = {
    format: orBlank(format), rubrika: orBlank(rubrika), script: orBlank(script), tz: orBlank(tzText),
  }
  const cleanDescription = hasSubstance(description) ? description : ''

  // Admins may assign the task to any number of people (or leave it
  // unassigned for the whole channel); everyone else creates for themselves.
  // assignee_ids is the multi-select; a lone assignee_id still works.
  let assigneeList = [req.user.id]
  const rawIds = req.body?.assignee_ids !== undefined
    ? req.body.assignee_ids
    : req.body?.assignee_id !== undefined
      ? (req.body.assignee_id === null || req.body.assignee_id === '' ? [] : [req.body.assignee_id])
      : undefined
  if (rawIds !== undefined) {
    const ids = [...new Set((Array.isArray(rawIds) ? rawIds : [rawIds]).map(Number).filter(Boolean))]
    if ((ids.length !== 1 || ids[0] !== req.user.id) && !isAdminOn(req.user, channels))
      return res.status(403).json({ error: 'Only admins can assign tasks to others' })
    for (const id of ids) {
      if (!(await userExists(id)))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
    }
    assigneeList = ids
  }
  const assignee = assigneeList[0] ?? null

  // Optional campaign chip: one dropdown that lets campaign progress follow
  // the kanban instead of someone typing a percentage.
  let campaignId = null
  if (req.body?.campaign_id != null && req.body.campaign_id !== '') {
    campaignId = Number(req.body.campaign_id)
    if (!(await get('SELECT 1 AS x FROM campaigns WHERE id = ?', campaignId)))
      return res.status(400).json({ error: 'Campaign not found' })
  }

  // The crew hats: who shoots it and who cuts it (videos), who designs it
  // (posts), and who signs it off — all real team members.
  const crew = { operator_id: null, editor_id: null, designer_id: null, reviewer_id: null }
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id']) {
    if (req.body?.[f] != null && req.body[f] !== '') {
      crew[f] = Number(req.body[f])
      if (!Number.isFinite(crew[f])) return res.status(400).json({ error: 'Pick a person from the list', field: f })
      if (!(await userExists(crew[f])))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
    }
  }

  // Review can be shared from the start; a lone reviewer_id becomes a list of
  // one, so nothing downstream has to care which way it was given.
  const reviewerList = [...new Set((Array.isArray(req.body?.reviewer_ids) ? req.body.reviewer_ids : [])
    .map(Number).filter(Boolean))]
  for (const id of reviewerList) {
    if (!(await userExists(id)))
      return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
  }
  if (reviewerList.length) crew.reviewer_id = reviewerList[0]
  else if (crew.reviewer_id) reviewerList.push(crew.reviewer_id)

  // Who is in it — asked when the shoot is booked, which the builder now does
  // on the way in. The same list, and the same first-of-it mirror, as a save.
  const faceList = [...new Set((Array.isArray(req.body?.face_ids) ? req.body.face_ids : []).map(Number).filter(Boolean))]
  for (const id of faceList) {
    if (!(await userExists(id)))
      return res.status(400).json({ error: 'That person is no longer on the team — refresh the page and pick again' })
  }

  // A delivery given on the way in is held to the rule a save holds it to: a
  // link. Without it a card showed "Hand it back" beside artwork it had.
  const born = {}
  for (const [field, what] of [['ready_link', 'The edit'], ['shot_link', 'A delivery link'], ['design_link', 'A delivery link']]) {
    const link = cleanLink(req.body?.[field])
    if (link && !/^https?:\/\//i.test(link)) return res.status(400).json({ error: linkComplaint(link, what), field })
    born[field] = link || null
  }

  // Double-booking / working-hours guard — warns before the shoot is saved.
  if (await guardShoot(req, res, {
    operatorId: crew.operator_id, date: recording_date || null,
    start: recording_time, end: recording_end, chans: channels,
  })) return

  const status = booked || status_id || (await get('SELECT id FROM statuses ORDER BY sort, id'))?.id || null

  // A shoot is BOOKED, not sketched: whoever holds the camera, the day and the
  // hours, and the script they film from — all of it before the shoot exists,
  // because the day it was booked for passes whether or not anyone turns up or
  // knows what to film.
  //
  // But only from the "To shoot" gate onward. An IDEA is a title and a maybe;
  // demanding a crew and three dates of it killed the cheapest, most-used thing
  // on the board. So a filmed piece created straight INTO the shooting stage
  // carries the full booking, and one parked at Idea carries nothing — it is
  // asked when somebody actually books it, in the PATCH below.
  //
  // WHICH types count as filmed is the admin's crew rule (Admin → Pipeline),
  // the same list the gap counts read. Editing and design stay advisory: they
  // are named later, often after the footage exists.
  // Nobody is handed work on a channel they do not work on, or more for one
  // day than they can take. Checked here, where somebody can still change it.
  for (const f of ['operator_id', 'editor_id', 'designer_id']) {
    if (!crew[f]) continue
    const chanProblem = await crewChannelProblem(crew[f], channels)
    if (chanProblem) return res.status(400).json({ error: chanProblem, crew_field: f })
    const capDay = { operator_id: recording_date, editor_id: edit_ready_date, designer_id: design_ready_date }[f]
    const capped = await capProblem(f, crew[f], capDay)
    if (capped) return res.status(409).json({ error: capped, crew_field: f })
  }
  // And how many ads this channel is already running that day.
  const adFull = await adCapProblem(safeType, channels, release_date)
  if (adFull) return res.status(409).json({ error: adFull, crew_field: 'release_date' })

  const isFilmed = (await getCrewNeeds()).operator.includes(safeType) && formatsAllowCrew(formats, 'operator')
  if (isFilmed && isBooking(status, await all('SELECT id, label, sort, is_final FROM statuses'))) {
    const booking = bookingProblem({
      operatorId: crew.operator_id, recording: recording_date, recordingTime: recording_time,
      recordingEnd: recording_end, script: briefText.script, scriptAsked: fieldOn(fieldRules, 'script', safeType, formats),
    })
    if (booking && !free) return res.status(400).json({ error: booking })
  }
  // Publishing is the reviewer's call by whichever door (see the PATCH handler).
  if ((await isFinal(status)) && !isAdminOn(req.user, channels) && !can(req.user, 'review_publish'))
    return res.status(403).json({ error: 'Only the channel’s reviewer can publish — ask your SMM or an admin' })
  const maxSort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m
  // A piece created straight into the final stage is a piece that has already
  // gone out — somebody writing last month's work down. Moving a task there
  // stamps done_at (see the PATCH handler); creating one there did not, and
  // done_at is what the whole board reads to mean "finished". So the record
  // sat in every `WHERE done_at IS NULL` query there is: open on the channel
  // board, counted as work in hand on the Overview, chased by the gap views,
  // and never credited to the person whose name was on it. The same end state
  // reached two ways has to give the same record.
  const givenDone = Date.parse(req.body?.done_at)
  const bornDone = (await isFinal(status)) ? new Date(Number.isFinite(givenDone) ? givenDone : Date.now()).toISOString() : null
  const info = await run(`
    INSERT INTO content (title, channels, type, assignee_id, assignees, created_by, status_id, campaign_id, operator_id, editor_id, designer_id, reviewer_id, reviewers,
      recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, release_date, release_time, description, ready_link,
      shot_link, design_link, reference_text, reference_links, reference_photos, format, rubrika, script, tz, script_key, photo, photo_thumb, checklist, todo_sort, done_at, created_at,
      telegram_type, is_guiding, faces, face_id, with_media)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    String(title).trim(), JSON.stringify(channels), safeType, assignee, JSON.stringify(assigneeList), req.user.id, status, campaignId,
    crew.operator_id, crew.editor_id, crew.designer_id, crew.reviewer_id, JSON.stringify(reviewerList),
    recording_date || null, recording_time, recording_end, edit_ready_date || null, design_ready_date || null, release_date || null, release_time,
    cleanDescription, born.ready_link,
    born.shot_link, born.design_link,
    reference_text ? String(reference_text).slice(0, 4000) : null, JSON.stringify(referenceLinks), JSON.stringify(referencePhotos),
    briefText.format, briefText.rubrika, briefText.script, briefText.tz, scriptKey(briefText.script),
    referencePhotos[0]?.photo ?? null, referencePhotos[0]?.thumb ?? null, JSON.stringify(Array.isArray(checklist) ? checklist : []),
    maxSort + 1, bornDone, new Date().toISOString(),
    telegramType, isGuiding,
    JSON.stringify(faceList), faceList[0] ?? null,
    withMedia && (await channelFormatsFor(channels)).includes('short') ? 1 : 0,
  )
  if (campaignId) await bumpProjectOfCampaign(campaignId)
  await logEvent(req.user, info.lastInsertRowid, String(title).trim(), 'created')
  // Everyone handed a hat on the fresh task learns about it right away.
  const roles = new Map()
  for (const id of assigneeList) addRole(roles, id, 'owner')
  addRole(roles, crew.operator_id, 'operator')
  addRole(roles, crew.editor_id, 'editor')
  addRole(roles, crew.designer_id, 'designer')
  addRole(roles, crew.reviewer_id, 'reviewer')
  await notifyAssigned(req, info.lastInsertRowid, String(title).trim(), roles, dateBit(recording_date, release_date))
  // A new task raises each channel's plan: 15/16 → 15/17.
  res.status(201).json(await listRow(info.lastInsertRowid))
}))

// A real duplicate.
//
// This used to be done from the browser by POSTing a new task named
// "<title> (copy)" with every date left off — so the copy landed in
// Unassigned, nowhere near the board you were looking at, and all you saw was
// a toast saying it had worked. It looked like the button did nothing.
//
// A duplicate is the same task again: same brief, same crew, same dates, same
// column. Only the name changes, and only enough to tell them apart.
//
// Columns that belong to the original's own history rather than to a copy of
// it — when it was made, when it was finished, when each stage was handed
// over — start empty on the copy.
// …and so do the dates, the stage and the delivery. The button has always
// said "brief, crew and platforms kept — dates and stage cleared", and it was
// telling the truth until the copy was rebuilt from the row's own columns: a
// duplicate then arrived already booked for the shoot the original was booked
// for, already at Editing, with the original's cut hanging off it. What is
// being duplicated is the RECURRING PIECE, not the week it went out in.
const DUP_SKIP = new Set([
  'id', 'created_at', 'done_at', 'ready_at', 'shot_at', 'edited_at',
  'edit_due_revised', 'review_due_revised', 'todo_sort',
  // the week it was made in
  'recording_date', 'recording_time', 'recording_end',
  'edit_ready_date', 'design_ready_date', 'release_date', 'release_time',
  // where that week got to
  'status_id',
  // and what came out of it
  'ready_link', 'ready_file', 'shot_link', 'shot_file', 'design_link', 'design_file', 'post_link',
  'paid_month', 'paid_at', 'paid_by',
  // …and how THAT week performed. A duplicate has not been watched by anybody
  // yet; carrying the original's numbers across would put one piece's views
  // and skip rate — and so one piece's pay — on two.
  'views', 'views_at', 'views_by', 'skip_rate', 'skip_rate_at',
  'miss_blame', 'miss_blame_note', 'miss_blame_by',
  // …nor anybody's yes to it. A copy starts at the first stage with nothing
  // delivered; an approval carried across would have closed its pravka loop
  // before its first cut existed.
  'approved_at', 'approved_by', 'approved_name',
  // …nor the crew's yes to a day the copy does not have. Carried across, an
  // accepted slot locked the copy's EMPTY dates against everyone but an admin.
  'shoot_ack', 'shoot_ack_at', 'shoot_ack_by', 'shoot_ack_note',
  'edit_ack', 'edit_ack_at', 'edit_ack_by', 'edit_ack_note',
  // …nor where the artwork got to on the design board.
  'design_status_id',
])
// face_id is NOT in that list on purpose: whose face carries a recurring piece
// is part of its brief, like the crew and the platforms, and round 78 settled
// that a duplicate keeps the brief.

router.post('/:id/duplicate', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'No such task' })
  if (!can(req.user, 'manage_content')) {
    return res.status(403).json({ error: 'You don’t have permission to add tasks' })
  }
  const channels = JSON.parse(row.channels || '[]')
  if (!channels.every((ch) => canAccessDept(req.user, ch))) {
    return res.status(403).json({ error: 'Not your channel' })
  }

  // "Title Duplicate 1", then 2, then 3 — the next free number across every
  // copy that already exists, counted from the original's name so that
  // duplicating a duplicate does not give you "X Duplicate 1 Duplicate 1".
  const base = String(row.title).replace(/\s+Duplicate\s+\d+$/i, '').trim() || 'Task'
  const kin = await all('SELECT title FROM content WHERE title = ? OR title LIKE ?', base, `${base} Duplicate %`)
  let n = 0
  for (const k of kin) {
    const m = /\s+Duplicate\s+(\d+)$/i.exec(k.title || '')
    if (m) n = Math.max(n, Number(m[1]))
  }
  const title = `${base} Duplicate ${n + 1}`.slice(0, 300)

  // Built from the row's own columns, so a column added next year is copied
  // without anybody having to remember this place.
  const cols = Object.keys(row).filter((k) => !DUP_SKIP.has(k))
  // The card picture of a piece whose reference is in its media album belongs
  // to that album, which the copy does not get: copied, the card showed a
  // picture the copy's window could not (the bug hunt, 14 Oct 2026).
  const fromAlbum = (k) => row.photo_media_id && ['photo', 'photo_thumb', 'photo_media_id'].includes(k)
  const vals = cols.map((k) => (k === 'title' ? title : k === 'created_by' ? req.user.id : fromAlbum(k) ? null : row[k]))
  const maxSort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m
  cols.push('todo_sort', 'created_at')
  vals.push(maxSort + 1, new Date().toISOString())
  // A copy starts at the beginning of the pipeline. The first stage is
  // whatever the board's first stage is called, not a hard-coded "idea".
  const first = await get('SELECT id FROM statuses ORDER BY sort, id LIMIT 1')
  if (first) { cols.push('status_id'); vals.push(first.id) }

  const info = await run(
    `INSERT INTO content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals)
  await logEvent(req.user, info.lastInsertRowid, title, 'created')
  // The brief's documents travel with it ("brief, crew and platforms kept"),
  // copied inside the database rather than through this process's memory.
  await run(`INSERT INTO attachments (content_id, name, mime, size, data, uploaded_by, uploader, created_at)
    SELECT ?, name, mime, size, data, uploaded_by, uploader, ? FROM attachments WHERE content_id = ?`,
  info.lastInsertRowid, new Date().toISOString(), row.id)
  // …and its reference album, pointing at the same files, and the card picture
  // made from it — or the copy was stopped on its way to editing for a
  // reference it had (the review, 14 Oct 2026).
  await run(`INSERT INTO reference_media (content_id, kind, name, mime, size, file, link, uploaded_by, uploader, created_at)
    SELECT ?, kind, name, mime, size, file, link, uploaded_by, uploader, created_at FROM reference_media WHERE content_id = ? ORDER BY id`,
  info.lastInsertRowid, row.id)
  await mirrorFirstPhoto(info.lastInsertRowid)

  // The crew carried across are holding the copy too, so they are told the
  // same way they would be told about any other task handed to them.
  const roles = new Map()
  for (const id of JSON.parse(row.assignees || '[]')) addRole(roles, id, 'owner')
  addRole(roles, row.operator_id, 'operator')
  addRole(roles, row.editor_id, 'editor')
  addRole(roles, row.designer_id, 'designer')
  addRole(roles, row.reviewer_id, 'reviewer')
  await notifyAssigned(req, info.lastInsertRowid, title, roles, dateBit(null, null))

  res.status(201).json(await listRow(info.lastInsertRowid))
}))

// Reorder the to-do list (drag): ids in display order.
router.post('/todo-reorder', wrap(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' })
  const rows = await all(`SELECT * FROM content WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = ids.map((id) => byId.get(Number(id))).filter((r) => r && canTouch(req.user, r))
  await batch(ordered.map((r, i) => ['UPDATE content SET todo_sort = ? WHERE id = ?', i, r.id]))
  res.json({ ok: true })
}))

// ---- Pravka 2.0: three deliveries, then it is done ---------------------------
// Perfectionism is how a cut goes round the loop a fifth time while its
// release day passes. So a piece is delivered at most three times: the first
// cut, and one after each of at most TWO pravka rounds. The cycle a delivery
// belongs to is simply how many rounds were asked for, plus one — counted
// from the revisions table, never stored, so nothing can drift out of step.
// Once two rounds exist the third delivery is approved as it stands and the
// server refuses a third round — a 403 for everyone but an admin on the
// channel, who may push one through on purpose (`force`, the sheet's "Force
// Pravka (Override)"), and is written down as having done so.
export const PRAVKA_ROUNDS = 2
const revCount = async (id) =>
  Number((await get('SELECT COUNT(*) AS n FROM revisions WHERE content_id = ?', id))?.n || 0)
const PRAVKA_LIMIT_ERROR = 'Pravka limit reached. Task auto-approved.'

// Who reviews on this task's channel, as the reviewer's gate reads it.
const reviewsHere = (user, row) => {
  const onChannel = adminHere(user, row) || chansOf(row).some((ch) => (user.departments || []).includes(ch))
  return onChannel && (can(user, 'request_changes') || can(user, 'review_publish'))
}

// Who a finished cut is FOR. The reviewers named on the task when it has any:
// the cue is meant for the person who will actually watch it, and a channel's
// every admin hearing every cut is how nobody feels it is theirs. A task with
// nobody named falls back to what it always did — the channel's admins and
// the SMMs who may publish there.
async function reviewersOf(row, exceptId) {
  const users = (await all('SELECT * FROM users')).map(publicUser)
  let named = []
  try { named = JSON.parse(row.reviewers || '[]') } catch { named = [] }
  if (row.reviewer_id) named.push(row.reviewer_id)
  const ids = new Set(users.map((u) => u.id))
  named = [...new Set(named.map(Number))].filter((id) => ids.has(id))
  if (named.length) return named.filter((id) => id !== exceptId)
  const chans = chansOf(row)
  return users.filter((u) => u.id !== exceptId &&
    (isAdminOn(u, chans) || (!!u.permissions.review_publish && chans.some((ch) => u.departments.includes(ch)))))
    .map((u) => u.id)
}

// A cut has just landed on Ready — by a hand-in, a fixed pravka or a move on
// the board. The reviewers hear it as THEIR cue (the bell's `review` kind is
// what makes an open dashboard ding), the rest of the crew as the stage move
// it is for them.
//
// Telegram only when work was actually DELIVERED — a hand-in, a fix — and
// only to the reviewers, in their own language, saying which delivery this is
// so "one pravka left" is known before the notes are written. A card dragged
// onto Ready is a stage move like any other: the bell, not the phone.
// Answers with everybody it told, so a caller with news of its own for one of
// them does not say it twice.
async function announceReady(req, after, people, { delivered = false } = {}) {
  const reviewers = await reviewersOf(after, req.user.id)
  const crew = people.filter((id) => id !== req.user.id && !reviewers.includes(id))
  const rounds = await revCount(after.id)
  const now = new Date().toISOString()
  const line = `«${after.title}» → Ready — by ${req.user.name}`
  const rows = [
    ...reviewers.map((id) => ['INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)', id, 'review', line, after.id, now]),
    ...crew.map((id) => ['INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)', id, 'status', line, after.id, now]),
  ]
  if (!rows.length) return []
  await batch(rows)
  if (delivered) {
    const cut = after.ready_link || after.design_link
    const of = PRAVKA_ROUNDS + 1
    const n = rounds + 1
    await tgMirror(reviewers, (lang) => {
      const w = tgWords(lang)
      const watch = cut && /^https?:\/\//i.test(cut) ? `\n▶️ <a href="${tgEsc(cut)}">${w.watch}</a>` : ''
      const rel = after.release_date ? ` · ${tgDate(after.release_date)}` : ''
      const cycle = rounds >= PRAVKA_ROUNDS ? w.limit(n, of)
        : `${w.delivery(n, of)}${rounds === PRAVKA_ROUNDS - 1 ? ` — ${w.oneLeft}` : ''}`
      return `${w.ready(`<b>«${tgEsc(after.title)}»</b>`)}\n${w.by(tgEsc(req.user.name))}${rel}${watch}\n${cycle}`
    }, after.id, tgOriginFrom(req), { kind: 'delivered', actor: req.user.id })
  }
  return [...reviewers, ...crew]
}

// Everyone holding a part of the task, bar whoever just acted.
const crewOf = (row, exceptId) => {
  let assignees = []
  try { assignees = JSON.parse(row.assignees || '[]') } catch { assignees = [] }
  return [...new Set([...assignees, row.assignee_id, row.operator_id, row.editor_id, row.designer_id]
    .filter((id) => id && id !== exceptId))]
}

// A pravka note is Markdown for its pictures and files — `![image](url)` and
// `[name](url)`. Telegram gets words, not addresses nobody can open there.
const plainPravka = (note) => String(note || '')
  .replace(/!\[[^\]]*\]\([^)\s]*\)/g, '🖼')
  .replace(/\[([^\]]*)\]\([^)\s]*\)/g, '📎 $1')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

// Request changes (Pravki): the SMM reviews a Ready task and sends it back to
// the crew with one note. Records a revision round and returns the stage to
// the correct earlier stage (To shoot for a re-shoot, Editing for a cut/design
// fix). One block of text, submitted once.
router.post('/:id/revisions', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  const onChannel = adminHere(req.user, row) ||
    chansOf(row).some((ch) => (req.user.departments || []).includes(ch))
  if (!can(req.user, 'request_changes') || !onChannel)
    return res.status(403).json({ error: 'Only the channel’s reviewer can request changes' })
  // The lock is the server's, not the button's: a stale sheet, a second tab
  // or a script all meet the same wall the vanished button stands for. Two
  // things close the loop — the limit, and an approval, which closes it for
  // good. Only an admin on the channel gets past either, and only by saying
  // so (`force`); without it they are told the override exists.
  const rounds = await revCount(row.id)
  const limited = rounds >= PRAVKA_ROUNDS
  const override = (limited || !!row.approved_at) && req.body?.force === true
  if (limited || row.approved_at) {
    const lock = {
      error: limited
        ? PRAVKA_LIMIT_ERROR
        : `${row.approved_name || 'The reviewer'} approved this edit — the pravka loop is closed`,
      pravka_limit: limited, approved: !!row.approved_at, rounds,
    }
    if (!adminHere(req.user, row)) return res.status(403).json(lock)
    if (!override) return res.status(409).json({ ...lock, can_force: true })
  }
  const note = String(req.body?.note ?? '').trim().slice(0, 4000)
  if (!note) return res.status(400).json({ error: 'Write what needs changing' })
  // Deliberately still required in writing even when a clip is attached: a
  // voice note cannot be skimmed a week later, and the editor coming back to
  // this on Friday needs a line they can read at a glance.
  // Who fixes it: the picked stage, defaulting to whoever holds a hat.
  let target = ['operator', 'editor', 'designer'].includes(req.body?.target) ? req.body.target : null
  if (!target) target = row.editor_id ? 'editor' : row.designer_id ? 'designer' : row.operator_id ? 'operator' : 'editor'
  const round = (await get('SELECT COALESCE(MAX(round), 0) AS m FROM revisions WHERE content_id = ?', row.id)).m + 1
  // A Pravki note is usually about a frame, so it may carry the screenshot
  // that shows it — pasted straight from the clipboard, downscaled in the
  // browser exactly like the reference photo.
  const shot = typeof req.body?.photo === 'string' && req.body.photo.startsWith('data:image/') ? req.body.photo : null
  const shotThumb = shot && typeof req.body?.photo_thumb === 'string' ? req.body.photo_thumb : null
  // Said out loud is the fastest way to explain what is wrong with a cut, and
  // the tone carries half the meaning.
  const voice = await saveVoice(req, row, req.body)
  if (voice.error) return res.status(400).json({ error: voice.error })
  await run(`
    INSERT INTO revisions (content_id, round, requested_by, requested_name, target, note, photo, photo_thumb, voice_id, voice_secs, created_at, sent_link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, row.id, round, req.user.id, req.user.name || '', target, note, shot, shotThumb, voice.id, voice.secs, new Date().toISOString(),
    row[LINK_OF[target]] || '')
  // Send the stage back — leaving the final stage undoes done_at and its plan.
  const sid = await revisionStageId(target)
  // BACK, never forward: a piece that has not reached that stage yet stays put,
  // or this is a way through the booking wall the PATCH handler keeps.
  const live = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses')).ordered.map((s) => s.id)
  // A card with no stage at all is an idea (isIdeaStage), so it is behind too.
  const at = row.status_id == null ? -1 : live.indexOf(row.status_id)
  const ahead = (row.status_id == null || at >= 0) && at < live.indexOf(sid)
  if (sid && sid !== row.status_id && !ahead) {
    await run('UPDATE content SET status_id = ?, done_at = NULL WHERE id = ?', sid, row.id)
    await logPatch(req.user, row, { status_id: sid })
  }
  await run(...actRow(req.user, row.id, row.title, 'updated', 'pravki', null, target, new Date().toISOString()))
  // An override is on the record by name, and the cut it sends back is no
  // longer the approved one.
  if (override) {
    await run(...actRow(req.user, row.id, row.title, 'updated', 'pravka_override', null, target, new Date().toISOString()))
    if (row.approved_at) await run("UPDATE content SET approved_at = NULL, approved_by = NULL, approved_name = '' WHERE id = ?", row.id)
  }
  // The person who owes the fix hears the actual note — in the bell and in
  // Telegram — not just a stage move.
  // …or, when nobody holds that seat, the owners of the piece.
  const seat = row[`${target}_id`]
  for (const fixerId of (seat ? [seat] : assigneesOf(row)).filter((id) => id && id !== req.user.id)) {
    const plain = plainPravka(note)
    const preview = plain.length > 120 ? `${plain.slice(0, 120)}…` : plain
    const pics = (note.match(/!\[[^\]]*\]\([^)\s]*\)/g) || []).length
    const files = (note.match(/(^|[^!])\[[^\]]*\]\([^)\s]*\)/g) || []).length
    await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      fixerId, 'pravki', `Pravki from ${req.user.name} on «${row.title}»: ${preview}`, row.id, new Date().toISOString())
    // One message, to the one hat that fixes it — never the operator for a
    // cut's pravka — in their own language. The last round says so: the next
    // delivery is the one that goes out.
    await tgMirror([fixerId], (lang) => {
      const w = tgWords(lang)
      const tail = override ? w.override(tgEsc(req.user.name)) : rounds + 1 >= PRAVKA_ROUNDS ? w.lastPravka : ''
      return `${w.pravka(`<b>«${tgEsc(row.title)}»</b>`)}\n${tgEsc(req.user.name)}: “${tgEsc(preview)}”`
        + `${pics + files ? `\n📎 ${pics ? `🖼 ×${pics}` : ''}${pics && files ? ' · ' : ''}${files ? `📄 ×${files}` : ''}` : ''}`
        + `${tail ? `\n${tail}` : ''}`
    }, row.id, tgOriginFrom(req), { kind: 'pravka', actor: req.user.id })
  }
  res.status(201).json(await listRow(row.id))
}))

// "Approve": the reviewer's yes on the delivered cut. The piece stays at Ready
// — Ready is where finished work waits to go out — but it is now cleared for
// Published and the pravka loop is closed for good: moving the card about
// does not reopen it, only an admin's override does. Whoever made it hears
// that there is nothing left to fix, which is the other half of the loop.
// r11 · a piece's colour: one of its maker's ten (0–9), or none. It means
// whatever the maker decided (More → My colours), so it is the maker's to
// set — whoever the task belongs to, whoever made it, or an admin who runs the
// channel. Nobody's work depends on it, so it moves no stage and asks nothing.
router.post('/:id/color', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  const mine = assigneesOf(row).includes(req.user.id) || row.created_by === req.user.id || unfettered(req.user, chansOf(row))
  if (!mine) return res.status(403).json({ error: 'Only the person the task belongs to picks its colour' })
  const v = req.body?.color
  const color = v === null || v === undefined || v === '' ? null : Number(v)
  if (color !== null && !(Number.isInteger(color) && color >= 0 && color <= 9)) return res.status(400).json({ error: 'Pick one of the ten colours' })
  await run('UPDATE content SET color = ? WHERE id = ?', color, row.id)
  res.json(await listRow(row.id))
}))

// Add to the reference (the owner, 13 Oct: "there should be reference add or
// paste the link" — for everybody on the task, the operator included). A link
// or a few words, added on a new line under what is there; never a rewrite of
// somebody else's words, so it needs no right to edit the task. Anybody who
// works on the piece may add, like the photos and videos of RefMedia.
router.post('/:id/reference', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  const text = String(req.body?.text ?? '').trim().slice(0, 1000)
  if (!text) return res.status(400).json({ error: 'Write a link or a few words' })
  if (!hasSubstance(text)) return res.status(400).json({ error: `«${clip(text)}» is a placeholder, not a reference — paste a link or say how it should look` })
  const was = String(row.reference_text || '').trim()
  const next = (was ? `${was}\n${text}` : text).slice(0, 4000)
  await run('UPDATE content SET reference_text = ? WHERE id = ?', next, row.id)
  await run('INSERT INTO activity (content_id, content_title, user_id, user_name, kind, field, old_value, new_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id, row.title, req.user.id, req.user.name || '', 'updated', 'reference_text', was || null, next, new Date().toISOString())
  res.json(await listRow(row.id))
}))

router.post('/:id/approve', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  if (!reviewsHere(req.user, row))
    return res.status(403).json({ error: 'Only the channel’s reviewer can approve the edit' })
  const readyId = await milestoneStatusId('ready')
  if (!readyId || row.status_id !== readyId)
    return res.status(409).json({ error: 'Only a delivered piece waiting at Ready can be approved' })
  if (row.approved_at) return res.json(await listRow(row.id))
  const now = new Date().toISOString()
  await run('UPDATE content SET approved_at = ?, approved_by = ?, approved_name = ? WHERE id = ?',
    now, req.user.id, req.user.name || '', row.id)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'approved', null, req.user.name || '', now))
  const makers = [...new Set([row.editor_id, row.designer_id].filter((id) => id && id !== req.user.id))]
  if (makers.length) {
    const line = `«${row.title}» approved by ${req.user.name} — nothing more to fix`
    await batch(makers.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'status', line, row.id, now,
    ]))
    // The bell only: good news, but nothing anybody has to act on (the
    // Telegram diet — see TG_KINDS).
  }
  res.json(await listRow(row.id))
}))

// ---- reference photos and videos -------------------------------------------
// A brief is mostly pictures: a frame to copy, the look to avoid, a clip of the
// pacing. Twenty a task — the old album's photos count towards it. A photo is
// downscaled in the browser and kept as two files on the server's disk (the
// picture and its thumbnail), outside the database that is pushed to GitHub on
// every change; a video goes to the task's Google Drive folder first (any size,
// resumable — lib/uploads.js) and is noted here by its link. Whoever works on
// the task adds; whoever added one, or plans the channel, removes it.
export const MEDIA_MAX = 20
const MEDIA_PHOTO_MAX = 3 * 1024 * 1024
const MEDIA_THUMB_MAX = 200 * 1024
const MEDIA_IMAGES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MEDIA_COLUMNS = 'id, content_id, kind, name, mime, size, link, uploaded_by, uploader, created_at'
const mediaOf = (id) => all(`SELECT ${MEDIA_COLUMNS} FROM reference_media WHERE content_id = ? ORDER BY id`, id)
const imageData = (v, max) => {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''))
  if (!m || !MEDIA_IMAGES[m[1]]) return null
  const buf = Buffer.from(m[2], 'base64')
  return buf.length && buf.length <= max ? { mime: m[1], buf } : null
}
// A file name of our own making — never the uploader's — so a name can never
// point anywhere but this folder.
const mediaPath = (file, thumb = false) => {
  if (!/^m[0-9a-f]{24}\.(png|jpg|webp|gif)$/.test(String(file || ''))) return null
  return join(MEDIA_DIR, thumb ? file.replace(/\.(\w+)$/, '.t.$1') : file)
}
// A file is dropped with the last album row that points at it: a duplicate's
// album shares its original's files.
async function dropMediaFiles(file) {
  if (await get('SELECT 1 AS x FROM reference_media WHERE file = ? LIMIT 1', file)) return
  for (const p of [mediaPath(file), mediaPath(file, true)]) { try { if (p && existsSync(p)) unlinkSync(p) } catch { /* already gone */ } }
}
const plansHere = (user, row) => adminHere(user, row)
  || (can(user, 'manage_content') && chansOf(row).some((ch) => (user.departments || []).includes(ch)))

// The card's picture (photo / photo_thumb) is what the boards, the gates and
// the old sheet read as "there is a reference". The old album keeps it while
// it has photos, and so does a picture somebody set before there were albums;
// otherwise it is a copy of the first reference photo — and nothing once
// there are none.
async function mirrorFirstPhoto(id) {
  const row = await get('SELECT photo, photo_media_id, reference_photos FROM content WHERE id = ?', id)
  if (!row || parsePhotos(row.reference_photos).length || (row.photo && !row.photo_media_id)) return
  const first = await get("SELECT id, mime, file FROM reference_media WHERE content_id = ? AND kind = 'image' ORDER BY id LIMIT 1", id)
  if ((first?.id ?? null) === (row.photo_media_id ?? null) && (first ? !!row.photo : !row.photo)) return
  let thumb = null
  try { if (first) thumb = `data:${first.mime};base64,${readFileSync(mediaPath(first.file, true)).toString('base64')}` } catch { thumb = null }
  await run('UPDATE content SET photo = ?, photo_thumb = ?, photo_media_id = ? WHERE id = ?', thumb, thumb, thumb ? first.id : null, id)
}

router.get('/:id/media', wrap(async (req, res) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', req.params.id))
  if (!row || !worksOn(req.user, row)) return res.status(404).json({ error: 'Not found' })
  res.json(await mediaOf(row.id))
}))

router.post('/:id/media', wrap(async (req, res) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', req.params.id))
  if (!row || !worksOn(req.user, row)) return res.status(404).json({ error: 'Not found' })
  const held = parsePhotos(row.reference_photos).length
    + (await get('SELECT COUNT(*) AS n FROM reference_media WHERE content_id = ?', row.id)).n
  if (held >= MEDIA_MAX)
    return res.status(400).json({ error: `That is as many photos and videos as one task carries — ${MEDIA_MAX}`, full: true })
  const name = String(req.body?.name || '').replace(/[\r\n]/g, ' ').trim().slice(0, 200)
  const now = new Date().toISOString()
  if (req.body?.kind === 'video') {
    // The file is already in the task's Drive folder (routes/drive.js); what
    // arrives here is where it landed.
    const link = String(req.body?.link || '').trim()
    if (!/^https:\/\/(drive|docs)\.google\.com\//i.test(link))
      return res.status(400).json({ error: 'A video is added by its Google Drive link' })
    const info = await run(
      `INSERT INTO reference_media (content_id, kind, name, mime, size, link, uploaded_by, uploader, created_at)
       VALUES (?, 'video', ?, ?, ?, ?, ?, ?, ?)`,
      row.id, name || 'video', String(req.body?.mime || '').slice(0, 80), Math.max(0, Number(req.body?.size) || 0), link,
      req.user.id, req.user.name || '', now)
    await run(...actRow(req.user, row.id, row.title, 'updated', 'reference', null, `${name || 'video'} (video)`, now))
    await touchRepost(row.id)
    return res.status(201).json({ media: await mediaOf(row.id), added: Number(info.lastInsertRowid) })
  }
  const photo = imageData(req.body?.photo, MEDIA_PHOTO_MAX)
  const thumb = imageData(req.body?.thumb, MEDIA_THUMB_MAX)
  if (!photo || !thumb) return res.status(400).json({ error: 'That is not a picture this can keep — a PNG, JPG, WebP or GIF' })
  const file = `m${randomBytes(12).toString('hex')}.${MEDIA_IMAGES[photo.mime]}`
  mkdirSync(MEDIA_DIR, { recursive: true })
  writeFileSync(mediaPath(file), photo.buf)
  writeFileSync(mediaPath(file, true), thumb.buf)
  const info = await run(
    `INSERT INTO reference_media (content_id, kind, name, mime, size, file, uploaded_by, uploader, created_at)
     VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?)`,
    row.id, name || 'photo', photo.mime, photo.buf.length, file, req.user.id, req.user.name || '', now)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'reference', null, name || 'photo', now))
  await touchRepost(row.id)
  await mirrorFirstPhoto(row.id)
  res.status(201).json({ media: await mediaOf(row.id), added: Number(info.lastInsertRowid) })
}))

// The picture, for the people who work on the task — fetched with the token
// and drawn, like a pravka's screenshot. ?thumb=1 for the small one.
router.get('/media/:mid', wrap(async (req, res) => {
  const m = await get('SELECT * FROM reference_media WHERE id = ?', req.params.mid)
  if (!m || m.kind !== 'image') return res.status(404).json({ error: 'Not found' })
  const row = parse(await get('SELECT * FROM content WHERE id = ?', m.content_id))
  if (!row || !worksOn(req.user, row)) return res.status(404).json({ error: 'Not found' })
  const p = mediaPath(m.file, req.query.thumb === '1')
  if (!p || !existsSync(p)) return res.status(404).json({ error: 'That picture is no longer on the server' })
  const body = readFileSync(p)
  res.setHeader('Content-Type', m.mime || 'image/jpeg')
  res.setHeader('Content-Length', body.length)
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(body)
}))

router.delete('/media/:mid', wrap(async (req, res) => {
  const m = await get('SELECT * FROM reference_media WHERE id = ?', req.params.mid)
  if (!m) return res.status(404).json({ error: 'Not found' })
  const row = parse(await get('SELECT * FROM content WHERE id = ?', m.content_id))
  if (!row || !worksOn(req.user, row)) return res.status(404).json({ error: 'Not found' })
  if (m.uploaded_by !== req.user.id && !plansHere(req.user, row))
    return res.status(403).json({ error: 'Only whoever added it, or whoever plans the channel, can remove it' })
  await run('DELETE FROM reference_media WHERE id = ?', m.id)
  if (m.file) await dropMediaFiles(m.file)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'reference', m.name, null, new Date().toISOString()))
  await mirrorFirstPhoto(row.id)
  res.json({ media: await mediaOf(row.id) })
}))

// ---- what a pravka points at -------------------------------------------------
// A screenshot pasted into the note, or a file dropped on it, is uploaded the
// moment it arrives and comes back as the Markdown the note carries. Images
// are downscaled in the browser first; documents are the same kinds (and the
// same 4 MB) the task's own paperwork takes. No SVG: a picture that can carry
// a script is not a picture.
const PRAVKA_FILE_MAX = 4 * 1024 * 1024
const PRAVKA_IMAGES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
router.post('/:id/pravka-files', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  const onChannel = adminHere(req.user, row) ||
    chansOf(row).some((ch) => (req.user.departments || []).includes(ch))
  if (!can(req.user, 'request_changes') || !onChannel)
    return res.status(403).json({ error: 'Only the channel’s reviewer can request changes' })
  // Past the lock only an admin can write a pravka (by override), so only an
  // admin can put a picture in one.
  if ((await revCount(row.id) >= PRAVKA_ROUNDS || row.approved_at) && !adminHere(req.user, row))
    return res.status(403).json({ error: PRAVKA_LIMIT_ERROR, pravka_limit: true })
  const name = String(req.body?.name || '').trim().replace(/[\r\n]/g, ' ').slice(0, 200)
  if (!name) return res.status(400).json({ error: 'The file needs a name' })
  const ext = extOf(name)
  const mime = PRAVKA_IMAGES[ext] || DOC_TYPES[ext]
  if (!mime)
    return res.status(400).json({ error: `.${ext || '?'} can’t go on a pravka — paste a screenshot, or attach a PDF, Word, Excel, PowerPoint or text file` })
  const data = String(req.body?.data || '')
  const head = data.match(/^data:([^;,]*)(;base64)?,/)
  if (mime.startsWith('image/') && !(head && /^image\//.test(head[1])))
    return res.status(400).json({ error: 'That is not a picture' })
  const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
  if (!b64) return res.status(400).json({ error: 'That file came through empty' })
  const size = Math.floor(b64.replace(/=+$/, '').length * 3 / 4)
  if (size > PRAVKA_FILE_MAX)
    return res.status(413).json({ error: `“${name}” is ${(size / 1048576).toFixed(1)} MB — a pravka file is capped at 4 MB` })
  const info = await run(
    `INSERT INTO pravka_files (content_id, name, mime, size, data, uploaded_by, uploader, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, name, mime, size, `data:${mime};base64,${b64}`, req.user.id, req.user.name || '', new Date().toISOString())
  const id = Number(info.lastInsertRowid)
  const url = `/api/content/pravka-files/${id}`
  const label = name.replace(/[[\]()]/g, '').trim() || 'file'
  res.status(201).json({ id, name, mime, size, url, md: mime.startsWith('image/') ? `![image](${url})` : `[${label}](${url})` })
}))

// The bytes, for the people who work on the task — the reach a voice note on
// the same pravka has (worksOn), not everybody who can read the calendar.
// Behind the ordinary sign-in, so the sheet fetches it with the token and
// draws it; an address copied out of a note opens nothing.
router.get('/pravka-files/:fid', wrap(async (req, res) => {
  const f = await get('SELECT * FROM pravka_files WHERE id = ?', req.params.fid)
  if (!f) return res.status(404).json({ error: 'Not found' })
  const row = parse(await get('SELECT * FROM content WHERE id = ?', f.content_id))
  if (!row || !worksOn(req.user, row)) return res.status(404).json({ error: 'Not found' })
  const body = Buffer.from(String(f.data).split(',').pop(), 'base64')
  res.setHeader('Content-Type', f.mime || 'application/octet-stream')
  res.setHeader('Content-Length', body.length)
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition',
    `${String(f.mime).startsWith('image/') ? 'inline' : 'attachment'}; filename="${asciiName(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`)
  res.end(body)
}))

// "Fixed": the crew member who owns the stage delivers the fix (optionally with
// a fresh file link), which closes the revision and returns the task to Ready
// for the SMM to review again.
router.post('/revisions/:rid/resolve', wrap(async (req, res) => {
  const rev = await get('SELECT * FROM revisions WHERE id = ?', req.params.rid)
  if (!rev) return res.status(404).json({ error: 'Not found' })
  const row = await get('SELECT * FROM content WHERE id = ?', rev.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  // A second "Fixed" on a closed round used to move the task back to Ready
  // again, over whatever had happened since.
  if (rev.resolved_at) return res.status(409).json({ error: 'This round is already closed' })
  const hatHolder =
    (rev.target === 'operator' && row.operator_id === req.user.id) ||
    (rev.target === 'editor' && row.editor_id === req.user.id) ||
    (rev.target === 'designer' && row.designer_id === req.user.id)
  if (!hatHolder && !adminHere(req.user, row) && !(can(req.user, 'deliver_work') && canTouch(req.user, row)))
    return res.status(403).json({ error: 'This isn’t your fix to deliver' })
  const patch = {}
  const field = { operator: 'shot_link', editor: 'ready_link', designer: 'design_link' }[rev.target]
  if (req.body?.link !== undefined) {
    const link = cleanLink(req.body.link)
    if (link && !/^https?:\/\//i.test(link))
      return res.status(400).json({ error: linkComplaint(link, 'The fixed file') })
    patch[field] = link || null
  }
  // Sending it back with the SAME file is not a fix. It is the commonest way
  // a revision round evaporates: the note is read, the tick is pressed, the
  // reviewer opens the identical cut and the whole round has cost a day for
  // nothing. Whoever is delivering has to say what they are delivering.
  // "The same file" is the one the round sent back — not the one in the box,
  // which the fixer may already have replaced with the new version.
  const next = patch[field] !== undefined ? patch[field] : row[field]
  if (!next)
    return res.status(400).json({
      error: 'Attach the fixed file — a fix with nothing on it is the same piece coming back',
      needs_link: field,
    })
  if (String(next) === String(sentBack(rev, row, field)))
    return res.status(400).json({
      error: 'That is the same file that was sent back. Upload the new one and paste its link.',
      needs_link: field,
    })
  const now = new Date().toISOString()
  await run('UPDATE revisions SET resolved_at = ?, fixed_link = ?, resolved_by = ?, resolved_name = ? WHERE id = ?',
    now, next, req.user.id, req.user.name || '', rev.id)
  const readyId = await milestoneStatusId('ready')
  if (readyId) patch.status_id = readyId
  const keys = Object.keys(patch)
  if (keys.length) {
    await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), row.id)
    await logPatch(req.user, row, patch)
  }
  // The fix is a delivery like any other, and it used to arrive in silence:
  // the reviewer found out by opening the task. Now it rings them exactly as
  // the first cut did — with which delivery this is.
  const told = readyId && row.status_id !== readyId
    ? await announceReady(req, { ...row, ...patch }, crewOf(row, req.user.id), { delivered: true })
    : []
  // …and whoever asked for this round hears that it was answered — unless the
  // delivery cue above already reached them, which says the same thing.
  if (rev.requested_by && rev.requested_by !== req.user.id && !told.includes(rev.requested_by)) {
    await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      rev.requested_by, 'pravki', `${req.user.name} fixed round ${rev.round} on «${row.title}» — have a look`, row.id, now)
    await tgMirror([rev.requested_by], (lang) => `${tgWords(lang).ready(`<b>«${tgEsc(row.title)}»</b>`)} · ${rev.round}\n${tgWords(lang).by(tgEsc(req.user.name))}`,
      row.id, tgOriginFrom(req), { kind: 'delivered', actor: req.user.id })
  }
  res.json({ ok: true, task: await listRow(row.id) })
}))

// A task's rounds on their own, for the screens that refresh them after a
// note, a hand-in or a fix without reloading the whole task.
router.get('/:id/revisions', wrap(async (req, res) => {
  const row = parse(await get('SELECT * FROM content WHERE id = ?', req.params.id))
  if (!row || !canSee(req.user, row)) return res.status(404).json({ error: 'Not found' })
  res.json(await revisionsOf(row.id))
}))

// A note under an open round: the reviewer saying what is still wrong, the
// crew asking what was meant. Anyone who works on the task may write; the
// seat holder, whoever asked, and everyone who wrote under the round before
// hear it — and anyone named with @.
router.post('/revisions/:rid/notes', wrap(async (req, res) => {
  const rev = await get('SELECT * FROM revisions WHERE id = ?', req.params.rid)
  if (!rev) return res.status(404).json({ error: 'Not found' })
  const row = await get('SELECT * FROM content WHERE id = ?', rev.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!worksOn(req.user, { ...row, channels: JSON.parse(row.channels || '[]') })) return res.status(404).json({ error: 'Not found' })
  if (rev.resolved_at) return res.status(409).json({ error: 'This round is closed — a new note starts a new round' })
  const text = String(req.body?.text ?? '').trim().slice(0, 2000)
  if (!text) return res.status(400).json({ error: 'Write the note first' })
  const now = new Date().toISOString()
  const info = await run(
    'INSERT INTO revision_notes (revision_id, content_id, user_id, author, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    rev.id, row.id, req.user.id, req.user.name || '', text, now)
  const wrote = (await all('SELECT DISTINCT user_id FROM revision_notes WHERE revision_id = ?', rev.id)).map((r) => r.user_id)
  const named = mentionedIds(text, await all("SELECT id, name FROM users WHERE role <> 'ambassador'"))
  const people = [...new Set([row[`${rev.target}_id`], rev.requested_by, ...wrote, ...named]
    .filter((id) => id && id !== req.user.id))]
  if (people.length) {
    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text
    await batch(people.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'pravki', `Round ${rev.round} · ${req.user.name} on «${row.title}»: ${preview}`, row.id, now,
    ]))
    // On Telegram: the hat that owes the fix, when somebody else adds to what
    // is wrong (a pravka, in more words), and anybody named with @. The rest
    // of the round's readers have it in the bell.
    const msg = `📝 Round ${rev.round} on <b>«${tgEsc(row.title)}»</b>\n${tgEsc(req.user.name)}: “${tgEsc(preview)}”\nAnswer under the round 👇`
    const fixer = row[`${rev.target}_id`]
    if (fixer && !named.includes(fixer))
      await tgMirror([fixer], msg, row.id, tgOriginFrom(req), { kind: 'pravka', actor: req.user.id })
    await tgMirror(named, msg, row.id, tgOriginFrom(req), { kind: 'mention', actor: req.user.id })
  }
  res.status(201).json(await get('SELECT id, revision_id, user_id, author, text, created_at FROM revision_notes WHERE id = ?', info.lastInsertRowid))
}))

// ---- how much one person can be given ---------------------------------------
// A content head could hand an editor eleven cuts for a Tuesday, and nothing
// on the board said otherwise until Tuesday came and nine of them were late.
// The ceiling is a property of the PERSON — some editors take four a day and
// some take one — and it is checked when the work is handed over, which is
// the only moment anybody can still do something about it.
//
// 0 means no ceiling, which is what everyone was before this existed.
//
// The day counted is the day the work is DUE from them: an editor's cut day,
// an operator's shoot day, a designer's artwork day. Not the release, which
// is somebody else's promise.
const CAP_DATE = { editor_id: 'edit_ready_date', operator_id: 'recording_date', designer_id: 'design_ready_date' }
export async function capProblem(hatField, personId, day, excludeId) {
  if (!personId || !day) return null
  const u = await get('SELECT name, daily_cap FROM users WHERE id = ?', personId)
  const cap = u?.daily_cap || 0
  if (!cap) return null
  const dateCol = CAP_DATE[hatField]
  const dead = (await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id)
  const rows = await all(
    `SELECT id FROM content WHERE ${hatField} = ? AND ${dateCol} = ? AND done_at IS NULL
     ${dead.length ? `AND (status_id IS NULL OR status_id NOT IN (${dead.map(() => '?').join(',')}))` : ''}`,
    personId, day, ...dead)
  const already = rows.filter((r) => r.id !== excludeId).length
  if (already < cap) return null
  const what = { editor_id: 'edits', operator_id: 'shoots', designer_id: 'pieces of artwork' }[hatField]
  return `${u.name} already has ${already} ${what} due on ${day}, which is their day's limit of ${cap}. `
    + 'Give it another day, another person, or raise their limit in Admin → People.'
}

// ---- what everybody's day already looks like --------------------------------
// The cap refuses an over-assignment at save time, which is correct and, on
// its own, rude: a content head picks a name from a list of nine, presses
// save, and is told the person's Tuesday was already full. They could not
// have known — the list was just names.
//
// So the same arithmetic is offered up front. One question, one answer for
// the whole team, so the picker can grey out a full day instead of letting
// somebody walk into it.
export async function loadFor(hatField, day) {
  const dateCol = { operator_id: 'recording_date', editor_id: 'edit_ready_date', designer_id: 'design_ready_date' }[hatField]
  if (!dateCol || !day) return {}
  const dead = (await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(String(st.label || ''))).map((st) => st.id)
  const rows = await all(
    `SELECT ${hatField} AS person FROM content
     WHERE ${hatField} IS NOT NULL AND ${dateCol} = ? AND done_at IS NULL
     ${dead.length ? `AND (status_id IS NULL OR status_id NOT IN (${dead.map(() => '?').join(',')}))` : ''}`,
    day, ...dead)
  const busy = {}
  for (const r of rows) busy[r.person] = (busy[r.person] || 0) + 1
  const out = {}
  for (const u of await all('SELECT id, daily_cap FROM users')) {
    out[u.id] = { taken: busy[u.id] || 0, cap: u.daily_cap || 0 }
  }
  return out
}

// ---- how many ads a channel runs in a day -----------------------------------
// The per-person cap answers "can this editor take another cut on Tuesday".
// This answers a different question the same day: "should this CHANNEL be
// running a fifth ad on Tuesday". Ads are bought a month at a time and burn
// their audience if they land in a heap, so the ceiling belongs to the
// channel and is checked when the release day is set, which is the only
// moment anybody can still spread them out.
export async function adCapProblem(type, chans, day, excludeId) {
  if (type !== 'target' || !day) return null
  const dead = (await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(String(st.label || ''))).map((st) => st.id)
  for (const key of (Array.isArray(chans) ? chans : [])) {
    const ch = await get('SELECT label, daily_ad_cap FROM channels WHERE key = ?', key)
    const cap = ch?.daily_ad_cap || 0
    if (!cap) continue
    const rows = await all(
      `SELECT id, channels FROM content WHERE type = 'target' AND release_date = ?
       ${dead.length ? `AND (status_id IS NULL OR status_id NOT IN (${dead.map(() => '?').join(',')}))` : ''}`,
      day, ...dead)
    const already = rows.filter((r) => {
      if (r.id === excludeId) return false
      let list = []
      try { list = JSON.parse(r.channels || '[]') } catch { list = [] }
      return list.includes(key)
    }).length
    if (already >= cap) {
      return `${ch.label} already has ${already} video ${already === 1 ? 'ad' : 'ads'} going out on ${day}, `
        + `which is its limit of ${cap} a day. Pick another day, or raise the limit in Admin → Channels.`
    }
  }
  return null
}

// The channels a crew member works on. Empty means all of them.
export async function crewChannelProblem(personId, chans) {
  if (!personId) return null
  const u = await get('SELECT name, crew_channels FROM users WHERE id = ?', personId)
  let mine = []
  try { mine = JSON.parse(u?.crew_channels || '[]') } catch { mine = [] }
  if (!mine.length) return null
  const list = Array.isArray(chans) ? chans : []
  if (list.some((ch) => mine.includes(ch))) return null
  return `${u.name} doesn’t work on this channel. Pick somebody who does, or add the channel to them in Admin → People.`
}

// ---- late work chases its own owner ----------------------------------------
// Fifty overdue pieces piled into one strip for an admin to drag back onto the
// calendar, one at a time. That is the wrong person doing the wrong job: the
// people who know why a piece slipped are the ones holding it, and every one
// of those fifty had a reason nobody ever wrote down.
//
// So late work is dealt out to whoever is carrying it. Each phase has an owner
// and a promised day (server/deadlines.js), and a day that has gone by with
// the work still in somebody's hands is theirs to answer for: give it a new
// day (which, for a promised one, means asking), say what is in the way, or
// finish it.
const LATE_PHASE = {
  shoot: { field: 'recording_date', owner: 'operator_id', what: 'the shoot', phase: 'shoot' },
  edit: { field: 'edit_ready_date', revised: 'edit_due_revised', owner: 'editor_id', what: 'the edit', phase: 'edit' },
  design: { field: 'design_ready_date', owner: 'designer_id', what: 'the artwork', phase: 'design' },
  release: { field: 'release_date', revised: 'review_due_revised', owner: null, what: 'the release', phase: 'review' },
}
// The day a phase is late AGAINST: the re-promise when a late handover wrote
// one, the original otherwise — `revised || promised`, which is what
// deadlines.js has always said and what every report is built on.
//
// These two lists read the original alone, and disagreed with the rest of the
// server as a result. An editor handed work late and given a new day was told
// "you are late" by the strip on their own page while the warnings, the pay
// run and the missed list all had them on time; and three days on, the
// auto-flag below would put a hand up on the planners' queue about a piece
// that was exactly where it had been agreed to be.
const lateDue = (row, spec) => (spec.revised && row[spec.revised]) || row[spec.field] || null
// "Is this phase behind us?" lives in ONE place — deadlines.js — because every
// part of the board was answering it slightly differently and finished work
// went on being called late for weeks as a result.
// Everything this person is personally late on, newest first — the list they
// are asked to deal with, not the whole board's backlog.
async function lateForUser(user) {
  const today = dayISO()
  const gates = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const dead = new Set((await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = await all(`SELECT id, title, channels, type, status_id, assignee_id, assignees,
      operator_id, editor_id, designer_id, ready_at, shot_at, edited_at, done_at,
      recording_date, edit_ready_date, design_ready_date, release_date,
      edit_due_revised, review_due_revised FROM content WHERE done_at IS NULL`)
  const out = []
  for (const row of rows) {
    if (dead.has(row.status_id)) continue
    if (!canSee(user, { ...row, channels: chansOf(row) })) continue
    for (const [phase, spec] of Object.entries(LATE_PHASE)) {
      const due = lateDue(row, spec)
      if (!due || due >= today) continue
      // Work that has already left this phase is not late in it any more.
      if (phasePassed(row, spec.phase, gates)) continue
      // Whose is it? The hat that owns the phase, or the person the whole
      // task belongs to when the phase has no hat of its own.
      const owners = spec.owner ? [row[spec.owner]] : [row.assignee_id, ...assigneesOf(row)]
      if (!owners.filter(Boolean).includes(user.id)) continue
      const openAsk = await get(
        "SELECT id FROM date_requests WHERE content_id = ? AND field = ? AND state = 'open'", row.id, spec.field)
      // ANY hand up on the piece, not only this person's: the board raises one
      // itself when work goes silently late, and being nagged to say something
      // about a piece that already has a hand up is the nagging being wrong.
      const openFlag = await get(
        'SELECT id FROM task_flags WHERE content_id = ? AND cleared_at IS NULL', row.id)
      out.push({
        id: `${row.id}:${phase}`,
        content_id: row.id,
        title: row.title,
        type: row.type,
        channels: chansOf(row),
        phase,
        what: spec.what,
        field: spec.field,
        due,
        days_late: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000),
        // Already answered for? Then it is not still asking anything of them.
        asked: !!openAsk,
        flagged: !!openFlag,
      })
    }
  }
  return out.sort((a, b) => b.days_late - a.days_late || a.title.localeCompare(b.title))
}

// ---- the admin's day: the team's deadlines, and who is where ----------------
// An admin opens My Day to answer two questions: what is late or due across
// the team, and who is shooting when. So this is the whole team at once:
//
//   overdue    every step past its day and not done — whose step, how late
//   dueToday   every step whose day is today — a shoot or a post with its hour
//   editAsap   footage is in and the cut is late or due within a day (cuts
//              live here only, so the same piece is not said twice)
//   timeline   for a chosen day, one row per person with something on it:
//              each shoot on the row of everyone in it (maker, operator,
//              people in it), the editor's cuts due and the posts going out,
//              and their study timetable as busy time
//
// The same rules as everywhere else: lateDue (a re-promise wins) and
// phasePassed (deadlines.js) decide what is late and what is done.
router.get('/day/team', wrap(async (req, res) => {
  if (req.user.role !== 'admin' && !isFullAdmin(req.user)) return res.status(403).json({ error: 'This is the admin’s view of the team' })
  const today = dayISO()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : today
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)
  const gates = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const dead = new Set((await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = (await all(`SELECT id, title, type, channels, status_id, assignee_id, assignees, faces,
      operator_id, editor_id, designer_id, shot_at, edited_at, ready_at, done_at,
      recording_date, recording_time, recording_end, edit_ready_date, design_ready_date, release_date, release_time,
      edit_due_revised, review_due_revised FROM content`)).filter((r) => !dead.has(r.status_id))
  const ownersOfRow = (r) => [...new Set([r.assignee_id, ...assigneesOf(r)].filter(Boolean))]
  const brief = (r) => ({ content_id: r.id, title: r.title, type: r.type, channels: chansOf(r) })

  const overdue = []
  const dueToday = []
  const editAsap = []
  for (const r of rows) {
    if (r.done_at) continue
    for (const [phase, spec] of Object.entries(LATE_PHASE)) {
      if (phase === 'edit') continue
      const due = lateDue(r, spec)
      if (!due || due > today || phasePassed(r, spec.phase, gates)) continue
      const owners = spec.owner ? [r[spec.owner]].filter(Boolean) : ownersOfRow(r)
      const time = phase === 'shoot' ? r.recording_time : phase === 'release' ? r.release_time : null
      const item = { ...brief(r), phase, what: spec.what, due, owners, time: time || null }
      if (due < today) overdue.push({ ...item, days_late: daysBetween(due, today) })
      else dueToday.push(item)
    }
    // The cut: footage in, the cut not, and its day gone or within a day.
    const cutDue = lateDue(r, LATE_PHASE.edit) || lateDue(r, LATE_PHASE.release)
    const footageIn = !!r.shot_at || phasePassed(r, 'shoot', gates)
    if ((r.type === 'reel' || r.type === 'video') && footageIn && cutDue && cutDue <= tomorrow && !phasePassed(r, 'edit', gates))
      editAsap.push({ ...brief(r), due: cutDue, owners: [r.editor_id].filter(Boolean), days_late: daysBetween(cutDue, today) })
  }
  overdue.sort((a, b) => b.days_late - a.days_late || a.title.localeCompare(b.title))
  dueToday.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')) || a.title.localeCompare(b.title))
  editAsap.sort((a, b) => b.days_late - a.days_late || a.title.localeCompare(b.title))

  // ---- the timeline for the chosen day ----
  const rowsOf = new Map()
  const put = (id, item) => { if (!id) return; if (!rowsOf.has(id)) rowsOf.set(id, []); rowsOf.get(id).push(item) }
  for (const r of rows) {
    if (r.recording_date === day) {
      let faces = []
      try { faces = JSON.parse(r.faces || '[]').map(Number) } catch { faces = [] }
      const shoot = { kind: 'shoot', ...brief(r), from: r.recording_time || null, to: r.recording_end || null,
        operator_id: r.operator_id || null, owners: ownersOfRow(r), done: !!r.shot_at || phasePassed(r, 'shoot', gates) }
      for (const id of new Set([r.operator_id, ...ownersOfRow(r), ...faces].filter(Boolean))) put(id, shoot)
    }
    const cutDue = lateDue(r, LATE_PHASE.edit)
    if (cutDue === day && r.editor_id)
      put(r.editor_id, { kind: 'cut', ...brief(r), done: phasePassed(r, 'edit', gates) })
    if (r.design_ready_date === day && r.designer_id)
      put(r.designer_id, { kind: 'art', ...brief(r), done: phasePassed(r, 'design', gates) })
    if (r.release_date === day)
      for (const id of ownersOfRow(r)) put(id, { kind: 'post', ...brief(r), from: r.release_time || null, done: !!r.done_at })
  }
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  const people = []
  // `everyone=1` (round 14, the admin's schedule): a row for every member, free
  // ones too — who can film at 15:00 is the white space under 15:00.
  const everyone = req.query.everyone === '1'
  for (const u of await all('SELECT id, name, role, crew_roles, work_start, work_end, work_days, study_blocks FROM users')) {
    const items = rowsOf.get(u.id)
    if (!items && !(everyone && u.role !== 'ambassador')) continue
    let workDays = null
    try { workDays = JSON.parse(u.work_days || 'null') } catch { workDays = null }
    let crew = []
    try { crew = JSON.parse(u.crew_roles || '[]') } catch { crew = [] }
    people.push({
      id: u.id, name: u.name, role: u.role, crew_roles: Array.isArray(crew) ? crew : [],
      working: !Array.isArray(workDays) || !workDays.length || workDays.includes(weekday),
      work_start: u.work_start || null, work_end: u.work_end || null,
      busy: cleanStudyBlocks(u.study_blocks).filter((b) => b.d === weekday).map(({ from, to, label }) => ({ from, to, label })),
      items: (items || []).sort((a, b) => String(a.from || '99').localeCompare(String(b.from || '99'))),
    })
  }
  people.sort((a, b) => String(a.items.find((i) => i.from)?.from || '99').localeCompare(String(b.items.find((i) => i.from)?.from || '99')) || a.name.localeCompare(b.name))
  res.json({ today, day, overdue, dueToday, editAsap, timeline: people })
}))

// ---- statistics: who is late, and how late ---------------------------------
// One month, one row a person: how many of their steps were on time and how
// many late, and the late ones themselves. The rules the owner set:
//
//   - Each person is judged on their own step: the operator on the shoot, the
//     editor on the cut, the designer on the artwork, the content maker on
//     posting it.
//   - Their own clock: a step whose work arrived after its day (footage after
//     the cut's day, the cut or artwork after the release) gets one day from
//     when it arrived instead — the lateness before that is upstream's.
//   - Posted is the real Instagram time, read off the post's link (the board's
//     Published press is often days after the post); the press itself where
//     there is no Instagram link.
//   - A late post whose cut (or artwork) has no recorded arrival — or one
//     recorded only after the post went up — is "unclear", charged to nobody.
//   - A step counts in the month it was due (a re-promised day wins). A step
//     not done whose day has not come is not counted yet.
//
// An admin sees everybody; anybody else, their own row.
const IG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
// Instagram's media id is the post's creation time in milliseconds since its
// own epoch, shifted left 23 bits; the link's shortcode is that id in base 64.
export const postedAtFromLink = (url) => {
  const m = /instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]{6,})/.exec(String(url || ''))
  if (!m) return null
  let id = 0n
  for (const c of m[1].slice(0, 11)) id = id * 64n + BigInt(IG_ALPHABET.indexOf(c))
  const ms = Number(id >> 23n) + 1314220021721
  return ms > Date.parse('2016-01-01') && ms < Date.now() + 864e5 ? ms : null
}
const tashDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date(ms))
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const daysFrom = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)

router.get('/stats/people', wrap(async (req, res) => {
  const today = dayISO()
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : today.slice(0, 7)
  const everyone = req.user.role === 'admin' || isFullAdmin(req.user)
  const gates = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const dead = new Set((await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = (await all(`SELECT id, title, type, channels, status_id, assignee_id, assignees,
      operator_id, editor_id, designer_id, shot_at, edited_at, ready_at, done_at, post_link,
      recording_date, edit_ready_date, design_ready_date, release_date, edit_due_revised, review_due_revised
      FROM content`)).filter((r) => !dead.has(r.status_id))
  // When the cut and the artwork first reached the board.
  const firstLink = new Map()
  for (const a of await all(`SELECT content_id, field, MIN(created_at) AS at FROM activity
      WHERE field IN ('ready_link', 'design_link') AND new_value IS NOT NULL AND new_value <> ''
      GROUP BY content_id, field`)) firstLink.set(`${a.content_id}:${a.field}`, Date.parse(a.at))

  const out = new Map()
  const add = (uid, item) => {
    if (!uid || (!everyone && uid !== req.user.id)) return
    if (!out.has(uid)) out.set(uid, [])
    out.get(uid).push(item)
  }
  // One step: its owners, its day, when it was done (ms or null), whether the
  // board has it as passed with no stamp, and the day its work arrived.
  const judge = (r, { step, owners, due, doneMs, passed, arrivedDay = null, needsArrival = false }) => {
    if (!due || due.slice(0, 7) !== month) return
    const base = { content_id: r.id, title: r.title, channels: chansOf(r), step, due }
    // Its own clock: work that arrived after its day buys one day from arrival.
    const dayOwed = arrivedDay && arrivedDay > due ? plusDays(arrivedDay, 1) : due
    let item
    if (doneMs != null) {
      const doneDay = tashDay(doneMs)
      if (doneDay <= due) item = { ...base, state: 'ok', done: doneDay }
      else if (needsArrival && (!arrivedDay || arrivedDay > doneDay)) item = { ...base, state: 'unclear', done: doneDay }
      else if (doneDay <= dayOwed) item = { ...base, state: 'ok', done: doneDay }
      else item = { ...base, state: 'late', done: doneDay, days_late: daysFrom(dayOwed, doneDay) }
    } else if (passed) {
      item = { ...base, state: 'ok', done: null }
    } else {
      if (needsArrival && !arrivedDay) return       // its work is not here yet: upstream's lateness
      if (dayOwed >= today) return                  // its day has not come
      item = { ...base, state: 'late', done: null, days_late: daysFrom(dayOwed, today) }
    }
    for (const uid of new Set(owners.filter(Boolean))) add(uid, item)
  }
  for (const r of rows) {
    const filmed = r.type === 'reel' || r.type === 'video'
    const shotPassed = phasePassed(r, 'shoot', gates)
    const footageDay = r.shot_at ? tashDay(Date.parse(r.shot_at)) : (shotPassed ? r.recording_date : null)
    const cutMs = firstLink.get(`${r.id}:ready_link`) ?? (r.edited_at ? Date.parse(r.edited_at) : null)
    const artMs = firstLink.get(`${r.id}:design_link`) ?? null
    if (filmed && r.operator_id)
      judge(r, { step: 'shoot', owners: [r.operator_id], due: r.recording_date, doneMs: r.shot_at ? Date.parse(r.shot_at) : null, passed: shotPassed })
    if (filmed && r.editor_id)
      judge(r, { step: 'cut', owners: [r.editor_id], due: r.edit_due_revised || r.edit_ready_date, doneMs: cutMs,
        passed: phasePassed(r, 'edit', gates), arrivedDay: footageDay })
    if (r.designer_id)
      judge(r, { step: 'artwork', owners: [r.designer_id], due: r.design_ready_date, doneMs: artMs, passed: phasePassed(r, 'design', gates) })
    // Posting: the maker's, against the release day, from when the cut (or
    // the artwork) arrived.
    const upstream = filmed ? cutMs : r.designer_id ? artMs : null
    const posted = postedAtFromLink(r.post_link) ?? (r.done_at ? Date.parse(r.done_at) : null)
    judge(r, { step: 'posting', owners: [r.assignee_id, ...assigneesOf(r)], due: r.review_due_revised || r.release_date,
      doneMs: posted, passed: false,
      arrivedDay: upstream != null ? tashDay(upstream) : null, needsArrival: filmed || !!r.designer_id })
  }
  const users = await all('SELECT id, name FROM users')
  const people = [...out.entries()].map(([id, items]) => ({
    id, name: users.find((u) => u.id === id)?.name || '?',
    items: items.sort((a, b) => (b.days_late || 0) - (a.days_late || 0) || a.due.localeCompare(b.due)),
  })).sort((a, b) => b.items.filter((i) => i.state === 'late').length - a.items.filter((i) => i.state === 'late').length || a.name.localeCompare(b.name))
  if (!everyone && !people.length) people.push({ id: req.user.id, name: req.user.name || '', items: [] })
  res.json({ month, today, everyone, people })
}))

// "What am I late on?" — the question the strip was answering for the wrong
// person. Cheap enough to ask on every page load.
router.get('/late/mine', wrap(async (req, res) => {
  res.json(await lateForUser(req.user))
}))

// Work that has been late for days without anybody saying anything raises its
// own hand. Silence is the failure mode this whole round is about: a piece
// three days past its day, with no new date asked for and nothing said about
// why, is invisible to everyone except the strip nobody reads.
//
// Once per piece, never again — this puts a thing on the planners' queue, and
// a queue that refills itself every night is one people stop looking at.
export const AUTO_FLAG_DAYS = 3
// ---- r11 · reminders, and clearing the overdue (the research report, upgrade 7)
//
// "Editing runs late; 65 overdue items in the review." Two small jobs, both
// asked as the team works (app.js wakes them every few minutes, like the
// admin's own scheduled nudges) and both able to run any number of times:
//
//  1. The editor hears about their own edit twice: the evening before it is
//     due (from 18:00) and the morning it is due (from 9:00). Once each, never
//     for work already handed in, and the board says nothing else — the team
//     asked for a board that does not speak every day.
//  2. Pieces long past the day they were promised for — more than the
//     admin's number of days, 14 to start with — leave the board on Mondays,
//     unless an admin kept them. They go to the Deleted stage, which every
//     board, list and calendar already leaves out, and the run is written
//     down so it can be taken back whole ("Bring them back").
const metaGet = async (key, fallback) => {
  const row = await get('SELECT value FROM meta WHERE key = ?', key)
  if (!row) return fallback
  try { return JSON.parse(row.value) } catch { return fallback }
}
const metaSet = async (key, value) => {
  const v = JSON.stringify(value)
  if (await get('SELECT 1 AS x FROM meta WHERE key = ?', key)) await run('UPDATE meta SET value = ? WHERE key = ?', v, key)
  else await run('INSERT INTO meta (key, value) VALUES (?, ?)', key, v)
}
export const housekeepingSettings = async () => ({
  edit_reminders: (await metaGet('edit_reminders', true)) !== false,
  archive_days: Number(await metaGet('archive_days', 14)) || 0,
})
const tashkentNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]))
  return { hour: Number(p.hour), monday: p.weekday === 'Mon' }
}

export async function remindEditors() {
  if (!(await housekeepingSettings()).edit_reminders) return 0
  const { hour } = tashkentNow()
  const today = dayISO(), tomorrow = dayISO(1)
  const dead = new Set((await all('SELECT id, label FROM statuses')).filter((s) => /^deleted$/i.test(s.label)).map((s) => s.id))
  const rows = await all(`SELECT id, title, status_id, editor_id, edit_ready_date, edit_due_revised, edited_at, ready_at
    FROM content WHERE done_at IS NULL AND editor_id IS NOT NULL AND edited_at IS NULL AND ready_at IS NULL`)
  let sent = 0
  for (const r of rows) {
    if (dead.has(r.status_id)) continue
    const due = String(r.edit_due_revised || r.edit_ready_date || '').slice(0, 10)
    const slot = due === tomorrow && hour >= 18 ? 'eve' : due === today && hour >= 9 ? 'morn' : null
    if (!slot) continue
    const key = `reminded:${r.id}:${slot}:${due}`
    if (await get('SELECT 1 AS x FROM meta WHERE key = ?', key)) continue
    await metaSet(key, new Date().toISOString())
    const text = slot === 'eve' ? `Reminder: the edit of «${r.title}» is due tomorrow.` : `Reminder: the edit of «${r.title}» is due today.`
    await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      r.editor_id, 'reminder', text, r.id, new Date().toISOString())
    try { await tgMirror([r.editor_id], tgEsc(text), r.id, '', { kind: 'reminder' }) } catch { /* the bell has it */ }
    sent++
  }
  return sent
}

// Every open piece past its promised day, with how late it is. The promised
// day is the release; a piece with none yet is measured by its shoot.
async function overdueRows() {
  const today = dayISO()
  const dead = new Set((await all('SELECT id, label FROM statuses')).filter((s) => /^deleted$/i.test(s.label)).map((s) => s.id))
  const rows = await all(`SELECT id, title, channels, status_id, assignee_id, assignees, release_date, recording_date
    FROM content WHERE done_at IS NULL`)
  return rows.filter((r) => !dead.has(r.status_id)).map((r) => {
    const day = String(r.release_date || r.recording_date || '').slice(0, 10)
    const late = day && day < today ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000) : 0
    return { ...parse(r), day, late }
  }).filter((r) => r.late > 0).sort((a, b) => b.late - a.late)
}
async function archiveCandidates() {
  const { archive_days: days } = await housekeepingSettings()
  if (!days) return []
  const keep = new Set(await metaGet('archive_keep', []))
  return (await overdueRows()).filter((r) => r.late > days && !keep.has(r.id))
}
async function archiveNow(user, list) {
  const deadId = (await all('SELECT id, label FROM statuses')).find((s) => /^deleted$/i.test(s.label))?.id
  if (!deadId || !list.length) return 0
  const now = new Date().toISOString()
  for (const r of list) {
    await run('UPDATE content SET status_id = ? WHERE id = ?', deadId, r.id)
    await run(...actRow(user, r.id, r.title, 'updated', 'archived', String(r.status_id), String(deadId), now))
  }
  await metaSet('archive_batch', { at: now, by: user.id || null, items: list.map((r) => ({ id: r.id, from: r.status_id })) })
  return list.length
}
const SYSTEM = { id: null, name: 'The board' }
// Mondays, once: whatever is past the line and not kept goes.
export async function runWeeklyArchive() {
  const { monday } = tashkentNow()
  if (!monday) return 0
  const today = dayISO()
  if ((await metaGet('archive_last_run', '')) === today) return 0
  await metaSet('archive_last_run', today)
  return archiveNow(SYSTEM, await archiveCandidates())
}

// The admin's panel: how much is late, split by how late, and what goes next.
// Two segments, so the task route GET /:id above never takes it for a task.
router.get('/housekeeping/summary', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const s = await housekeepingSettings()
  const rows = await overdueRows()
  const keep = new Set(await metaGet('archive_keep', []))
  const cut = s.archive_days || 14
  const batch = await metaGet('archive_batch', null)
  res.json({
    ...s,
    overdue: rows.length,
    buckets: { over: rows.filter((r) => r.late > cut).length, mid: rows.filter((r) => r.late > 7 && r.late <= cut).length, week: rows.filter((r) => r.late <= 7).length },
    candidates: s.archive_days ? rows.filter((r) => r.late > s.archive_days && !keep.has(r.id)) : [],
    kept: rows.filter((r) => keep.has(r.id)).length,
    next_run: (() => { const d = new Date(`${dayISO()}T12:00:00Z`); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10) })(),
    last_batch: batch && batch.items?.length ? { at: batch.at, count: batch.items.length } : null,
  })
}))
router.post('/housekeeping/settings', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  if (req.body?.edit_reminders !== undefined) await metaSet('edit_reminders', !!req.body.edit_reminders)
  if (req.body?.archive_days !== undefined) {
    const n = Number(req.body.archive_days)
    if (![0, 7, 14, 30].includes(n)) return res.status(400).json({ error: 'Pick 7, 14 or 30 days, or off' })
    await metaSet('archive_days', n)
  }
  res.json(await housekeepingSettings())
}))
router.post('/housekeeping/keep/:id', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const keep = new Set(await metaGet('archive_keep', []))
  keep.add(Number(req.params.id))
  await metaSet('archive_keep', [...keep])
  res.json({ ok: true })
}))
router.post('/housekeeping/archive', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const n = await archiveNow(req.user, await archiveCandidates())
  res.json({ ok: true, archived: n })
}))
// Taking the last run back, whole: every piece to the stage it left — unless
// somebody has moved it since, which is their decision and stays.
router.post('/housekeeping/undo', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' })
  const batch = await metaGet('archive_batch', null)
  if (!batch?.items?.length) return res.status(409).json({ error: 'Nothing to bring back' })
  const deadId = (await all('SELECT id, label FROM statuses')).find((s) => /^deleted$/i.test(s.label))?.id
  const now = new Date().toISOString()
  let back = 0
  for (const it of batch.items) {
    const row = await get('SELECT id, title, status_id FROM content WHERE id = ?', it.id)
    if (!row || row.status_id !== deadId) continue
    await run('UPDATE content SET status_id = ? WHERE id = ?', it.from, it.id)
    await run(...actRow(req.user, it.id, row.title, 'updated', 'archived', String(deadId), String(it.from), now))
    back++
  }
  await metaSet('archive_batch', null)
  res.json({ ok: true, back })
}))

export async function autoFlagSilentlyLate() {
  const today = dayISO()
  const gates = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const dead = new Set((await all('SELECT id, label FROM statuses'))
    .filter((st) => /^deleted$/i.test(st.label)).map((st) => st.id))
  const rows = await all(`SELECT id, title, channels, status_id, assignee_id, assignees,
      operator_id, editor_id, designer_id, shot_at, edited_at, ready_at, done_at,
      recording_date, edit_ready_date, design_ready_date, release_date,
      edit_due_revised, review_due_revised FROM content WHERE done_at IS NULL`)
  let raised = 0
  for (const row of rows) {
    if (dead.has(row.status_id)) continue
    for (const [phase, spec] of Object.entries(LATE_PHASE)) {
      const due = lateDue(row, spec)
      if (!due) continue
      const daysLate = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000)
      if (daysLate < AUTO_FLAG_DAYS) continue
      if (phasePassed(row, spec.phase, gates)) continue
      // Somebody has already spoken for this piece — an ask in flight, or a
      // hand already up. Nothing to add.
      const spoken = await get(
        `SELECT 1 AS x FROM date_requests WHERE content_id = ? AND state = 'open'
         UNION SELECT 1 AS x FROM task_flags WHERE content_id = ? AND cleared_at IS NULL`, row.id, row.id)
      if (spoken) continue
      // And never twice for the same piece, however long it goes on.
      const before = await get(
        "SELECT 1 AS x FROM task_flags WHERE content_id = ? AND raised_by IS NULL", row.id)
      if (before) continue
      const owner = spec.owner ? row[spec.owner] : row.assignee_id
      const now = new Date().toISOString()
      await run(
        'INSERT INTO task_flags (content_id, kind, reason, raised_by, raised_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        row.id, 'at_risk',
        `${spec.what} was due ${due} and is ${daysLate} days past it, with nothing said about why.`,
        null, 'The board', now)
      raised++
      // The person holding it hears first — this is a nudge before it is a
      // report, and they still have the ask and the hand to answer with.
      if (owner) {
        await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
          owner, 'flag', `«${row.title}» — ${spec.what} is ${daysLate} days late. Give it a day, or say what is in the way.`, row.id, now)
      }
      // On Telegram it is a LATE warning — one of the four things worth a buzz —
      // to the hat that owes it and to the admins who run the channel.
      const admins = (await all('SELECT * FROM users')).map(publicUser)
        .filter((u) => isAdminOn(u, chansOf(row))).map((u) => u.id)
      await tgMirror([owner, ...admins], (lang) => {
        const w = tgWords(lang)
        return `${w.late(`<b>«${tgEsc(row.title)}»</b>`)}\n${w.lateLine(w.what[phase], daysLate)}`
      }, row.id, null, { kind: 'late' })
      break   // one hand per piece, not one per phase
    }
  }
  return raised
}

// ---- raising a hand --------------------------------------------------------
// The crew could always deliver late. They had no way to say so in advance,
// so the first anyone knew was the deadline passing — and by then the only
// options are bad ones. A flag is the cheap early word, on the task, where
// the plan is made: "this will be late", or "I cannot take this at all",
// with the reason. Anybody holding a hat on the piece can raise one; the
// people who plan hear it at once.
const FLAG_WORDS = {
  at_risk: 'says this will be late',
  cant_take: 'cannot take this on',
}
router.post('/:id/flags', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const parsed = { ...row, channels: JSON.parse(row.channels || '[]') }
  if (!worksOn(req.user, parsed)) return res.status(404).json({ error: 'Not found' })
  const kind = FLAG_WORDS[req.body?.kind] ? req.body.kind : 'at_risk'
  // The reason IS the flag. "It will be late" without one tells the planner
  // nothing they can act on, which is the same as not being told.
  const reason = String(req.body?.reason ?? '').trim().slice(0, 2000)
  if (!isSentence(reason))
    return res.status(400).json({ error: 'Say what is in the way — a heads-up with no reason leaves the same guessing as no heads-up' })
  // Whoever is actually carrying it, or whoever plans it.
  const onIt = [row.operator_id, row.editor_id, row.designer_id, row.assignee_id, ...assigneesOf(row)].includes(req.user.id)
  if (!onIt && !can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
    return res.status(403).json({ error: 'Only somebody on this task can raise a hand about it' })
  const already = await get('SELECT id FROM task_flags WHERE content_id = ? AND raised_by = ? AND cleared_at IS NULL', row.id, req.user.id)
  if (already) return res.status(409).json({ error: 'You already have a hand up on this — say the rest in the thread' })

  const now = new Date().toISOString()
  const info = await run(
    'INSERT INTO task_flags (content_id, kind, reason, raised_by, raised_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id, kind, reason, req.user.id, req.user.name || '', now)
  // The people who can do something about it: the admins, and whoever owns
  // the task. Hearing this late is the whole problem being solved.
  const admins = await adminsOn(row)
  const people = [...new Set([...admins, row.assignee_id, ...assigneesOf(row)].filter((id) => id && id !== req.user.id))]
  if (people.length) {
    const line = `${req.user.name} ${FLAG_WORDS[kind]} — «${row.title}»: ${clip(reason)}`
    await batch(people.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'flag', line, row.id, now,
    ]))
    await tgMirror(people, `${kind === 'cant_take' ? '🙅' : '⏳'} <b>${tgEsc(req.user.name)}</b> ${tgEsc(FLAG_WORDS[kind])}\n<b>«${tgEsc(row.title)}»</b>\n“${tgEsc(clip(reason))}”\nSort it while there is still time 👇`, row.id, tgOriginFrom(req),
      { kind: kind === 'cant_take' ? 'assigned' : 'late', actor: req.user.id })
  }
  await run(...actRow(req.user, row.id, row.title, 'updated', 'flag', null, kind, now))
  res.status(201).json(await get('SELECT * FROM task_flags WHERE id = ?', info.lastInsertRowid))
}))

// Putting the hand down — by whoever raised it, or by whoever sorted it out.
router.post('/flags/:fid/clear', wrap(async (req, res) => {
  const f = await get('SELECT * FROM task_flags WHERE id = ?', req.params.fid)
  if (!f) return res.status(404).json({ error: 'Not found' })
  if (f.cleared_at) return res.status(409).json({ error: 'That hand is already down' })
  // "Can act on it" is the task's own reach (canTouch), not the bare right:
  // manage_content is a default every member holds, on every channel.
  const task = await get('SELECT * FROM content WHERE id = ?', f.content_id)
  if (f.raised_by !== req.user.id && !adminHere(req.user, task) && !(task && can(req.user, 'manage_content') && canTouch(req.user, task)))
    return res.status(403).json({ error: 'Only whoever raised it, or somebody who can act on it, puts it down' })
  await run('UPDATE task_flags SET cleared_at = ?, cleared_by = ?, cleared_name = ? WHERE id = ?',
    new Date().toISOString(), req.user.id, req.user.name || '', f.id)
  res.json(await get('SELECT * FROM task_flags WHERE id = ?', f.id))
}))

// Every hand currently up, for the people who plan. Same shape as the
// day-move queue, and on the same Overview, because they are the same job:
// something needs deciding before a deadline decides it for you.
router.get('/flags/open', wrap(async (req, res) => {
  if (!can(req.user, 'manage_content') && !can(req.user, 'move_tasks') && req.user.role !== 'admin')
    return res.json([])
  const rows = await all(`
    SELECT f.id, f.content_id, f.kind, f.reason, f.raised_name, f.created_at, c.title, c.channels,
           c.recording_date, c.edit_ready_date, c.release_date
    FROM task_flags f JOIN content c ON c.id = f.content_id
    WHERE f.cleared_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
    ORDER BY f.id`)
  // A channel admin is shown the channels they run; everyone else who can see
  // this queue sees what they could already see on the board.
  res.json(req.user.role === 'admin'
    ? rows.filter((r) => isAdminOn(req.user, chansOf(r)))
    : rows.filter((r) => chansOf(r).some((ch) => (req.user.departments || []).includes(ch))))
}))

// ---- moving a promised day -------------------------------------------------
// A deadline with a date on it is a promise, and only an admin moves one.
// Everyone else ASKS — which day, to which day, and why — and the ask is the
// record. The date moves on an admin's yes and not a moment before, so the
// reason a deadline slipped is written down at the time instead of being
// remembered differently by two people a fortnight later.
const DATE_LABELS = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the edit is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}
// Where an ask about a deadline actually LANDS. A request is always filed
// against the deadline as people know it — "the day the cut is due" — but once
// a late handover has re-promised that day, the re-promise is the live one,
// and approving a move by writing the original underneath it changed a day
// nobody was working to. The editor asked, the admin said yes, and their desk
// did not move.
//
// The cut only. The release day is also the day the piece goes OUT, on every
// calendar the team reads, so "move the release day" means exactly that and is
// left alone; its re-promise is a review deadline, which is a different thing
// to be asking about.
const liveDateField = (row, field) =>
  (field === 'edit_ready_date' && row.edit_due_revised ? 'edit_due_revised' : field)
const openRequestsFor = (contentId) => all(
  `SELECT id, field, from_date, to_date, to_time, to_end, reason, state, asked_by, asked_name, created_at,
          decided_by, decided_name, decided_at, decided_note
   FROM date_requests WHERE content_id = ? ORDER BY id DESC`, contentId)

// Everything waiting on an admin's yes, in one place. Without this the whole
// asking mechanism depends on an admin happening to open the right task: the
// bell scrolls away, and a deadline nobody answered is a deadline that quietly
// stays wrong. Cheap enough to sit on the Overview and be right every time.
router.get('/date-requests/open', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.json([])
  const rows = await all(`
    SELECT d.id, d.content_id, d.field, d.from_date, d.to_date, d.to_time, d.to_end, d.reason, d.asked_name, d.created_at,
           c.title, c.channels
    FROM date_requests d JOIN content c ON c.id = d.content_id
    WHERE d.state = 'open'
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')
    ORDER BY d.id`)
  // Only the channels this admin runs — a queue you cannot act on is noise.
  res.json(rows.filter((r) => isAdminOn(req.user, chansOf(r))))
}))

router.post('/:id/date-requests', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })
  const field = String(req.body?.field || '')
  if (!DATE_LABELS[field]) return res.status(400).json({ error: 'That is not a deadline' })
  // The person the deadline belongs to may always ASK about it. This used to
  // want a planner's right to move dates, which no crew account holds — so an
  // editor late on a cut pressed "New day" on their own page and was told
  // they had no permission, for a request that moves nothing until an admin
  // says yes. Asking is not moving.
  const holder = { recording_date: row.operator_id, edit_ready_date: row.editor_id, design_ready_date: row.designer_id }[field]
  if (holder !== req.user.id && !can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
    return res.status(403).json({ error: 'You don’t have permission to move dates' })
  // r11 · "Let people edit their own tasks" (the research report): two people
  // had to ask the owner to change a date, and the owner became the bottleneck.
  // A day that is YOURS — your shoot, your edit, your artwork, or the release
  // of a piece you own — moves on your word: the ask is filed and answered at
  // once, through every check an admin's yes goes through (decideDate).
  // Anybody else's day is still an ask.
  const ownDay = holder ? holder === req.user.id : field === 'release_date' && assigneesOf(row).includes(req.user.id)
  // Filed under the name people know, measured against the day that is live.
  const live = liveDateField(row, field)
  if (!row[live]) return res.status(400).json({ error: 'That day is not set yet — you can simply fill it in' })
  const to = req.body?.to_date ? String(req.body.to_date).slice(0, 10) : null
  if (to && !isDay(to)) return res.status(400).json({ error: 'Give the new day as a date' })
  // Not out before it is filmed — as POST and PATCH refuse it — unless an admin
  // over the channel moves it (the review, 14 Oct 2026).
  if (to && !unfettered(req.user, chansOf(row))
    && ((field === 'release_date' && row.recording_date && to < row.recording_date)
      || (field === 'recording_date' && row.release_date && to > row.release_date)))
    return res.status(400).json({ error: 'It would go out before it is filmed — pick the shoot day or later', field: 'to_date' })
  if (String(to ?? '') === String(row[live]))
    return res.status(400).json({ error: 'That is the day it already has' })
  // Your own day moves at once, so it has to move TO a day: cleared, a late
  // job fell off every late count and its holder could not set it again
  // (the bug hunt, 14 Oct 2026).
  if (ownDay && !to) return res.status(400).json({ error: 'Pick the new day', field: 'to_date' })
  // The reason is the whole point of asking, so it has to BE one. A dot or an
  // "N/A" here would leave the record saying a date moved for no reason.
  const reason = String(req.body?.reason ?? '').trim().slice(0, 2000)
  if (!isSentence(reason))
    return res.status(400).json({ error: 'Say what happened — a day moves on a reason, and “—” is not one' })
  // One open ask per deadline: a second is the same conversation, not a new one.
  const already = await get(
    "SELECT id FROM date_requests WHERE content_id = ? AND field = ? AND state = 'open'", row.id, field)
  if (already) return res.status(409).json({ error: 'That day already has a request waiting on an admin' })

  const now = new Date().toISOString()
  const info = await run(`
    INSERT INTO date_requests (content_id, field, from_date, to_date, reason, state, asked_by, asked_name, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `, row.id, field, row[live], to, reason, req.user.id, req.user.name || '', now)

  // Every admin who runs this channel hears it, because any of THEM can
  // answer it — a channel admin elsewhere is refused by decide below.
  const admins = (await adminsOn(row))
    .filter((id) => id !== req.user.id)
  if (ownDay) {
    // The move first: a full day, the operator's other shoot or the ad ceiling
    // refuses it, and then nothing was asked — the row goes, nobody hears of a
    // move that did not happen, and the next try is not blocked by it.
    const dr = await get('SELECT * FROM date_requests WHERE id = ?', info.lastInsertRowid)
    await decideDate(req, res, dr, row, true, 'moved by the person whose day it is')
    if (res.statusCode >= 400) { await run('DELETE FROM date_requests WHERE id = ?', dr.id); return }
    // Whoever else is on the piece hears that their own plans may need to move
    // with it: the piece's owner(s) and anybody holding a seat on it.
    const others = [...new Set([...assigneesOf(row), row.operator_id, row.editor_id, row.designer_id])]
      .filter((id) => id && id !== req.user.id)
    const told = [...new Set([...others, ...admins])]
    if (told.length) {
      const line = `${req.user.name} moved ${DATE_LABELS[field]} on «${row.title}» — ${row[live]} → ${to || 'cleared'}: ${reason}`
      await batch(told.map((id) => [
        'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
        id, 'date_request', line, row.id, now,
      ]))
    }
    await run(...actRow(req.user, row.id, row.title, 'updated', 'date_request', row[live], to, now))
    return
  }
  if (admins.length) {
    const line = `${req.user.name} asks to move ${DATE_LABELS[field]} on «${row.title}» — ${row[live]} → ${to || 'cleared'}`
    await batch(admins.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'date_request', line, row.id, now,
    ]))
    // The bell only — the Telegram diet (TG_KINDS) keeps date asks off phones.
  }
  await run(...actRow(req.user, row.id, row.title, 'updated', 'date_request', row[live], to, now))
  res.status(201).json(await get('SELECT * FROM date_requests WHERE id = ?', info.lastInsertRowid))
}))

// The admin's answer. Yes moves the day; no leaves it exactly where it was.
// Either way the asker hears back, because an unanswered ask is worse than a
// refusal — it leaves somebody planning around a date nobody has agreed to.
router.post('/date-requests/:rid/decide', wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin answers a date request' })
  const dr = await get('SELECT * FROM date_requests WHERE id = ?', req.params.rid)
  if (!dr) return res.status(404).json({ error: 'Not found' })
  if (dr.state !== 'open') return res.status(409).json({ error: 'That request has already been answered' })
  const row = await get('SELECT * FROM content WHERE id = ?', dr.content_id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  // An admin answers for the channels they run. Somebody else's channel is
  // somebody else's promise to move.
  if (!adminHere(req.user, row))
    return res.status(403).json({ error: 'That day belongs to a channel you don’t run — its own admin answers this' })
  return decideDate(req, res, dr, row, !!req.body?.approve, String(req.body?.note ?? '').trim().slice(0, 2000))
}))

// The answer itself, every check included. An admin reaches it through
// /decide; since r11 the person whose own deadline it is reaches it straight
// from their ask (see /:id/date-requests) — the same ceilings, the same
// double-booking warning, the same re-ask of whoever had agreed to the old day.
async function decideDate(req, res, dr, row, approve, note) {
  const now = new Date().toISOString()

  // The day may have moved under the request while it waited. Approving then
  // would apply an answer to a question nobody asked, so it is refused and the
  // asker can ask again against what the task actually says now.
  //
  // "The day" is the live one. A request filed before a late handover
  // re-promised the cut was asked against the original; the re-promise has
  // moved it since, so it comes back stale here — which is true, and is the
  // same answer as any other day that moved while an ask waited.
  const live = liveDateField(row, dr.field)
  if (approve && String(row[live] ?? '') !== String(dr.from_date ?? '')) {
    await run("UPDATE date_requests SET state = 'stale', decided_by = ?, decided_name = ?, decided_at = ?, decided_note = ? WHERE id = ?",
      req.user.id, req.user.name || '', now, 'the day changed while this was waiting', dr.id)
    // "Either way the asker hears back" — and this is the third way.
    if (dr.asked_by && dr.asked_by !== req.user.id)
      await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
        dr.asked_by, 'date_request',
        `Your ask to move ${DATE_LABELS[dr.field]} on «${row.title}» lapsed — the day changed while it waited. Ask again against the day it has now.`, row.id, now)
    return res.status(409).json({ error: 'That day has changed since the request was made — ask again against the day it has now' })
  }
  // The two ceilings every other door checks — how much one person can be
  // given for a day, and how many ads a channel runs in one — are checked at
  // this door too. A day the form would refuse is not one a yes can book.
  if (approve && dr.to_date && live === dr.field) {
    const hat = Object.keys(CAP_DATE).find((k) => CAP_DATE[k] === dr.field)
    const full = (hat && await capProblem(hat, row[hat], dr.to_date, row.id))
      || (dr.field === 'release_date' && await adCapProblem(row.type, chansOf(row), dr.to_date, row.id))
    if (full) return res.status(409).json({ error: full })
  }
  // Moving a shoot to another day is booking its operator on that day, and
  // the day asked for can already hold another shoot of theirs at the same
  // hour. It used to be approved without a look, so an answer to "can I do it
  // Friday instead?" could double-book the person who asked. It is checked
  // like any other booking: a warning first, and the admin — the only person
  // who reaches this — may answer again with `force` to book it anyway.
  // The hours too, when the ask carries its own (an operator's "I can do it
  // another time" offers a slot, not only a day — the bug hunt, 14 Oct 2026).
  const toFrom = live === 'recording_date' && dr.to_time ? dr.to_time : null
  if (approve && live === 'recording_date' && dr.to_date && await guardShoot(req, res, {
    operatorId: row.operator_id, date: dr.to_date, start: toFrom || row.recording_time, end: toFrom ? (dr.to_end || null) : row.recording_end,
    excludeId: row.id, chans: chansOf(row),
  })) return
  if (approve) {
    // An approved move re-books the slot exactly as an admin's own edit does
    // (the ack lock in PATCH): the holder's answer was about the old day and
    // does not carry over, and they are asked again about the new one.
    const which = Object.keys(BOOKINGS).find((k) => BOOKINGS[k].day === dr.field)
    const b = which && row[BOOKINGS[which].ack] ? BOOKINGS[which] : null
    // The slot the holder offered themselves is a slot they said yes to.
    const theirs = b && dr.asked_by && dr.asked_by === row[b.holder]
    const hours = toFrom ? { recording_time: toFrom, recording_end: dr.to_end || null } : {}
    await run(`UPDATE content SET ${live} = ?${Object.keys(hours).map((k) => `, ${k} = ?`).join('')}${b ? `, ${b.ack} = ?, ${b.at} = ?, ${b.by} = ?, ${b.note} = NULL` : ''} WHERE id = ?`,
      dr.to_date || null, ...Object.values(hours), ...(b ? (theirs ? ['yes', now, dr.asked_by] : ['', null, null]) : []), row.id)
    await logPatch(req.user, row, { [live]: dr.to_date || null, ...hours })
    const who = b && dr.to_date && !theirs ? row[b.holder] : null
    if (who && who !== req.user.id && who !== dr.asked_by)
      await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
        who, 'confirm', `Can you make ${b.what} on ${slotWords({ ...row, [b.day]: dr.to_date }, which)}? · «${row.title}»`, row.id, now)
  }
  await run("UPDATE date_requests SET state = ?, decided_by = ?, decided_name = ?, decided_at = ?, decided_note = ? WHERE id = ?",
    approve ? 'approved' : 'declined', req.user.id, req.user.name || '', now, note, dr.id)

  if (dr.asked_by && dr.asked_by !== req.user.id) {
    const line = approve
      ? `${req.user.name} moved ${DATE_LABELS[dr.field]} on «${row.title}» to ${dr.to_date || 'nothing'} — as you asked`
      : `${req.user.name} kept ${DATE_LABELS[dr.field]} on «${row.title}» at ${dr.from_date}${note ? ` — ${note}` : ''}`
    await run('INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      dr.asked_by, 'date_request', line, row.id, now)
  }
  res.json({ ok: true, request: await get('SELECT * FROM date_requests WHERE id = ?', dr.id), task: await listRow(row.id) })
}

router.patch('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canTouch(req.user, row)) return res.status(403).json({ error: 'Not your channel' })

  const body = req.body || {}
  if (body.status_id !== undefined && body.status_id !== null) body.status_id = asStageId(body.status_id) ?? -1

  // ---- a box nobody touched is not an edit ---------------------------------
  // A form sends every box it holds, whether or not the hand on it moved. Each
  // gated field below asks its own permission — and a field you may not write
  // used to refuse the WHOLE save even when the value you sent was the one
  // already stored. That is a wall in front of the wrong person: a crew member
  // opening a task, writing one line, and being told they may not set who is
  // in it, a reference they never saw, or a link that is exactly what it was.
  //
  // So before any of it is read, the values that did not change are dropped.
  // `status_id` has always worked this way (see below); this is the same rule
  // applied to every field that has a gate, once and in one place. Anything
  // genuinely different still goes past its full check.
  const asText = (v) => (v === null || v === undefined ? '' : String(v).trim())
  const asNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  const untouched = {
    // …unless the same save moves what the text LEANS ON. A bare sentence is
    // allowed to stand beside a photo or a link; take those away in the same
    // breath and the sentence has to answer for itself again.
    reference_text: () => asText(body.reference_text) === asText(row.reference_text)
      && body.photo === undefined && body.reference_links === undefined,
    reference_links: () => JSON.stringify(cleanLinks(body.reference_links)) === (row.reference_links || '[]'),
    format: () => asText(body.format) === asText(row.format),
    rubrika: () => asText(body.rubrika) === asText(row.rubrika),
    script: () => asText(body.script) === asText(row.script),
    tz: () => asText(body.tz) === asText(row.tz),
    title: () => asText(body.title) === asText(row.title),
    description: () => asText(body.description) === asText(row.description),
    post_link: () => asText(body.post_link) === asText(row.post_link),
    face_id: () => asNum(body.face_id) === asNum(row.face_id),
    face_ids: () => JSON.stringify((Array.isArray(body.face_ids) ? body.face_ids : []).map(Number).filter(Boolean)) === String(row.faces || '[]'),
    views: () => asNum(body.views) === asNum(row.views),
    skip_rate: () => asNum(body.skip_rate) === asNum(row.skip_rate),
    // A delivery link and the NAME of the file it stands for are written
    // together, so an unchanged link only counts as untouched when no new
    // name came with it.
    ready_link: () => body.ready_file === undefined && asText(body.ready_link) === asText(row.ready_link),
    shot_link: () => body.shot_file === undefined && asText(body.shot_link) === asText(row.shot_link),
    design_link: () => body.design_file === undefined && asText(body.design_link) === asText(row.design_link),
    telegram_type: () => asText(body.telegram_type) === asText(row.telegram_type),
    is_guiding: () => truthy(body.is_guiding) === !!row.is_guiding,
    with_media: () => truthy(body.with_media) === !!row.with_media,
    // The sheet sends the platforms with every save. The same set — order
    // means nothing here — is not a move to another channel, and a
    // cross-posted piece was refused to its own owner over the platform they
    // do not run, every time they fixed a typo in it.
    channels: () => JSON.stringify([...new Set(body.channels.map(String))].sort()) === JSON.stringify([...chansOf(row)].map(String).sort()),
  }
  for (const [field, same] of Object.entries(untouched)) {
    if (body[field] === undefined) continue
    let quiet = false
    try { quiet = same() } catch { quiet = false }
    if (quiet) delete body[field]
  }

  // Where this task stands after the save: a thought still being jotted, or
  // work being made. Nothing in the brief is demanded of a thought — the
  // demands land on the move that leaves the idea stage. Read once here so
  // every rule below gives the same answer.
  const pipeline = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses'))
  const stillAnIdea = isIdeaStage(
    req.body?.status_id !== undefined ? req.body.status_id : row.status_id, pipeline)
  // Where it stands RIGHT NOW, which is a different question and the one the
  // move rules ask: an idea may be shoved along by anybody, and the schedule
  // is frozen from the shoot booking until review.
  // The graveyard is a stage the board knows, not a thought: leaving it is a
  // move like any other (move_tasks, the stage rules, the promised days).
  const wasAnIdea = isIdeaStage(row.status_id, pipeline) && !pipeline.deadIds.includes(row.status_id)
  const datesFrozen = datesFrozenAt(row.status_id, pipeline)
  const isAssignee = assigneesOf(row).includes(req.user.id)
  // The task's crew move it through the pipeline themselves — filming,
  // editing and designing ARE stage changes — even with no granular rights.
  const isCrew = row.operator_id === req.user.id || row.editor_id === req.user.id || row.designer_id === req.user.id
  const oldChannels = JSON.parse(row.channels || '[]')
  // The admin is not made to fill in a form; see `unfettered` above. Scoped
  // to the channels this piece is actually on, so a channel admin is free on
  // their own board and nowhere else.
  const free = unfettered(req.user, oldChannels)
  const patch = {}
  // A short written post that carries a video or a picture (content.with_media):
  // the switch as it stands AFTER this save, read by every format question
  // below so the brief, the shoot walls and the gates agree on what it owes.
  const mediaNow = body.with_media !== undefined ? truthy(body.with_media) : !!row.with_media

  // Who holds which hat on this task — the milestone tick each may mark.
  const isOperator = row.operator_id === req.user.id
  const isEditor = row.editor_id === req.user.id
  const isDesigner = row.designer_id === req.user.id
  const canOverride = can(req.user, 'move_tasks')

  // The crew move their own work with a single tick — not a free stage picker.
  // "shot" (operator) hands it to Editing; "edited"/"designed" (editor and
  // designer) land it on Ready. Anyone with move_tasks may tick on their
  // behalf.
  let coverHeld = false
  if (body.milestone) {
    const m = body.milestone
    // Marking work finished is a claim, and for the two stages that produce a
    // FILE the claim is checkable: a cut exists as a link or it does not
    // exist. "Edited" with nothing attached sends the piece to review with
    // nothing to review, and the reviewer discovers that instead of the
    // editor.
    //
    // The shoot is deliberately exempt. Footage is handed over on a hard
    // drive as often as not, and refusing the tick would not create the file
    // — it would just leave the board saying the shoot has not happened.
    const NEEDS_FILE = {
      edited: { field: 'ready_link', what: 'the edit' },
      designed: { field: 'design_link', what: 'the artwork' },
    }
    // The admin ticking a milestone is catching the board up on work that
    // already happened somewhere else, and has no file to paste for it.
    const proof = free ? null : NEEDS_FILE[m]
    if (proof) {
      const fileKey = { ready_link: 'ready_file', design_link: 'design_file' }[proof.field]
      const named = body[fileKey] !== undefined ? cleanFileLabel(body[fileKey]) : ''
      const link = named || (body[proof.field] !== undefined ? cleanLink(body[proof.field]) : row[proof.field])
      const hasFile = await get('SELECT 1 AS x FROM attachments WHERE content_id = ?', row.id)
      if (!link && !hasFile)
        return res.status(400).json({
          error: `Paste ${proof.what} before marking it done — a stage that says finished with nothing attached is a stage the reviewer has to chase`,
          needs_link: proof.field,
        })
    }
    // A tick hands work ON. A card already at or past the stage the tick
    // lands on — published, say — is not handed anywhere by it: pulling a
    // piece back out of Published is un-publishing, and that is not the
    // crew's to do (they may not set a stage at all, see below).
    const stageAt = (sid) => pipeline.ordered.findIndex((s) => s.id === sid)
    const ahead = (sid) => stageAt(sid) > stageAt(row.status_id)
    if (m === 'shot' && (isOperator || canOverride)) {
      const sid = await milestoneStatusId('shot')
      if (sid && ahead(sid)) patch.status_id = sid
    } else if ((m === 'edited' || m === 'designed') && (isEditor || isDesigner || canOverride)) {
      // A reel's cover handed in before its cut does not finish the reel: the
      // piece waits on Editing for the edit, and the editor keeps the job (the
      // bug hunt, 14 Oct 2026 — it went to Ready with nothing edited).
      const editRound = m === 'designed' && row.editor_id
        ? await get("SELECT 1 AS x FROM revisions WHERE content_id = ? AND target = 'editor' AND resolved_at IS NULL", row.id) : null
      const cutIn = !editRound && !!(row.ready_link || cleanLink(body.ready_link ?? '') || body.ready_file)
      const sid = await milestoneStatusId('ready')
      if (sid && ahead(sid) && !(m === 'designed' && row.editor_id && !cutIn)) patch.status_id = sid
      else if (sid && ahead(sid) && m === 'designed') coverHeld = true
    } else {
      return res.status(403).json({ error: 'That isn’t your milestone to mark' })
    }
  }

  // ---- whose miss was it ----------------------------------------------
  // The board works this out from the work itself (see deadlines.js), and it
  // is right most of the time. Where it cannot be — a script that arrived late
  // but is sitting there now, an agreement made in a corridor — somebody with
  // the whole picture says so, and their answer wins over the derivation for
  // good. Only an admin on the channel: this is the number people are paid
  // and judged against.
  if (body.miss_blame !== undefined) {
    if (!adminHere(req.user, row))
      return res.status(403).json({ error: 'Only an admin on this channel decides whose delay it was' })
    const v = body.miss_blame === null || body.miss_blame === '' ? null : String(body.miss_blame)
    if (v !== null && v !== 'production' && v !== 'make')
      return res.status(400).json({ error: 'A delay belongs to production or to content — or to neither, which is the board working it out' })
    patch.miss_blame = v
    patch.miss_blame_by = v ? req.user.id : null
    // A verdict with no reason is the thing this replaces. Clearing it back to
    // the derived answer needs none — that is undoing, not deciding.
    if (v) {
      const note = String(body.miss_blame_note ?? '').trim().slice(0, 600)
      if (!note) return res.status(400).json({ error: 'Say why — a verdict nobody can read back is worse than the board’s guess' })
      patch.miss_blame_note = note
    } else {
      patch.miss_blame_note = null
    }
  }

  // ---- what it actually got ------------------------------------------------
  // The number is entered by hand because the board is not plugged into
  // Instagram, YouTube and Telegram — and pretending otherwise would put a
  // made-up figure next to somebody's pay. Whoever the piece is FOR may write
  // it, and so may an admin on the channel: the content maker is the one who
  // opens the app and reads the count off it.
  //
  // NULL is not zero. Clearing the box means "nobody has written it down",
  // which is what an unmeasured piece honestly is; 0 means it was measured and
  // got none. The sums and the KPI depend on being able to tell them apart.
  if (body.views !== undefined) {
    const madeIt = [row.assignee_id, ...assigneesOf(row)].filter(Boolean).includes(req.user.id)
    if (!adminHere(req.user, row) && !madeIt)
      return res.status(403).json({ error: 'Only an admin on this channel, or somebody the piece is for, records its views' })
    if (body.views === null || body.views === '') {
      patch.views = null
      patch.views_at = null
      patch.views_by = null
    } else {
      const n = Number(body.views)
      if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n)
        return res.status(400).json({ error: 'Views is a whole number of views, or empty for “nobody has counted yet”' })
      // A billion views on a school's Instagram is a typo, and a typo that
      // reaches the payroll is worse than a refusal.
      if (n > 1e10) return res.status(400).json({ error: 'That is more views than the internet has — check the number' })
      patch.views = n
      patch.views_at = new Date().toISOString()
      patch.views_by = req.user.id
    }
  }

  // How much of it people skipped, from the same place and the same hands as
  // the view count. Empty means nobody has measured it — which is NOT the same
  // as nought, and the pay tiers depend on being able to tell them apart.
  if (body.skip_rate !== undefined) {
    const madeIt = [row.assignee_id, ...assigneesOf(row)].filter(Boolean).includes(req.user.id)
    if (!adminHere(req.user, row) && !madeIt)
      return res.status(403).json({ error: 'Only an admin on this channel, or somebody the piece is for, records its skip rate' })
    if (body.skip_rate === null || body.skip_rate === '') {
      patch.skip_rate = null
      patch.skip_rate_at = null
    } else {
      const n = Number(body.skip_rate)
      if (!Number.isFinite(n) || n < 0 || n > 100)
        return res.status(400).json({ error: 'A skip rate is a percentage between 0 and 100, or empty for “nobody has measured it”' })
      patch.skip_rate = n
      patch.skip_rate_at = new Date().toISOString()
    }
  }

  // Whose face carries the piece. Part of the brief — it is decided when the
  // piece is planned, not when it is delivered — so it is set by whoever may
  // edit the task, and it is checked against a real person the same way the
  // crew seats are.
  if (body.face_id !== undefined) {
    if (!can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You can’t set who is in this' })
    if (body.face_id === null || body.face_id === '') { patch.face_id = null; patch.faces = '[]' }
    else {
      const id = Number(body.face_id)
      if (!Number.isFinite(id) || !(await userExists(id)))
        return res.status(400).json({ error: 'That person is no longer on the team — refresh the page and pick again' })
      patch.face_id = id
      patch.faces = JSON.stringify([id])
    }
  }
  // A paid creative is often shot with two or three of them in it, and the
  // single seat could only ever name one — so the question is asked as a list
  // wherever it is asked at all. `face_id` stays as the first of them, the way
  // assignee_id and reviewer_id mirror their lists, so every report, filter
  // and old client that reads the single column keeps working untouched.
  if (body.face_ids !== undefined) {
    if (!can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You can’t set who is in this' })
    const list = [...new Set((Array.isArray(body.face_ids) ? body.face_ids : []).map(Number).filter(Boolean))]
    for (const id of list) {
      if (!(await userExists(id)))
        return res.status(400).json({ error: 'That person is no longer on the team — refresh the page and pick again' })
    }
    patch.faces = JSON.stringify(list)
    patch.face_id = list[0] ?? null
  }

  // Setting the stage directly still needs move_tasks — the crew no longer get
  // a free hand here; their ticks above are the sanctioned path. The one
  // exception is the reviewer publishing: review_publish alone unlocks the
  // Ready → Published move even without move_tasks.
  if (body.status_id !== undefined && body.status_id !== row.status_id) {
    // A stage that does not exist is not a stage. Taken on trust, it put the
    // task in a column no board draws — gone from the workspace without ever
    // being deleted, which is the worst way for a task to disappear. Null is
    // allowed on purpose: a task between stages is a real state.
    if (body.status_id !== null && !(await get('SELECT 1 AS x FROM statuses WHERE id = ?', body.status_id)))
      return res.status(400).json({ error: 'No such stage' })
    const intoFinal = await isFinal(body.status_id)
    // Leaving IDEA needs no ticket. An idea is a thought nobody has promised
    // anything about, and a column you need a permission to empty is a column
    // that fills up. Everything past it still needs move_tasks or a tick.
    if (!canOverride && !wasAnIdea && !(intoFinal && canPublish(req.user, row)))
      return res.status(403).json({ error: 'You can see the stage but can’t move it — use your Shot / Edited tick, or ask an admin' })
    patch.status_id = body.status_id
  }

  // The finished-file link: the crew (or an editor of the task) drops in a
  // Google-Drive URL; admins with manage_content may set it too.
  if (body.ready_link !== undefined || body.ready_file !== undefined) {
    if (!isCrew && !can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You can’t set the ready link on this task' })
    const built = await buildDelivery(req, row, body, 'ready_file', 'The edit')
    // Named for the same reason as the brief below: the bulk window asks for
    // the cut, and a link it cannot take has to come back to that same box.
    if (built.error) return res.status(400).json({ error: built.error, field: 'ready_link' })
    patch.ready_link = built.value
  }

  // Per-stage delivery links: the operator drops raw footage (shot_link) and
  // the designer the artwork (design_link) — the editor's finished cut is the
  // existing ready_link ("Edit ready"), handled above. Each is owned by the
  // person who holds that hat (or manage_content) and never overwrites another.
  for (const { field, hat } of [
    { field: 'shot_link', hat: isOperator },
    { field: 'design_link', hat: isDesigner },
  ]) {
    const fileKey = field === 'shot_link' ? 'shot_file' : 'design_file'
    if (body[field] === undefined && body[fileKey] === undefined) continue
    if (!hat && !can(req.user, 'manage_content') && !can(req.user, 'deliver_work'))
      return res.status(403).json({ error: 'You can’t set that delivery link' })
    const built = await buildDelivery(req, row, body, fileKey, 'A delivery link')
    if (built.error) return res.status(400).json({ error: built.error, field })
    patch[field] = built.value
  }

  // Where the piece went live. Not a crew delivery — nobody holds a "posted"
  // hat — and not a promise either: it is the address of a thing that already
  // exists. So it is not gated on a right at all. Anybody who can open the
  // task may write down where it went, because the person who knows is very
  // often the editor who uploaded it, and they hold no granular right. The
  // wall it feeds (a card cannot reach Published without one) is still there;
  // this only makes sure everyone who meets that wall has a pen.
  //
  // But one post is one task. The same address on two cards means two
  // "published" rows for one piece — double-counted views, a person paid twice
  // for one reel, a report that lies — so a link already recorded on another
  // task is refused, and the refusal names the task so the twin can be found.
  // Compared after normalising (see postKey): instagram.com/p/x, its www.
  // form, its trailing slash and its #fragment are one address.
  if (body.post_link !== undefined) {
    const posted = String(body.post_link ?? '').trim().slice(0, 500)
    if (posted && !hasLink(posted))
      return res.status(400).json({ error: 'That is not a link — it has to start with http:// or https://', needs: 'post_link' })
    if (posted) {
      const twin = await postLinkTwin(posted, row.id)
      if (twin) return res.status(400).json({
        error: `That link is already on «${twin.title}» — one post lives on one task. Open that one, or paste this piece’s own address.`,
        needs: 'post_link',
        twin: { id: twin.id, title: twin.title },
      })
    }
    patch.post_link = posted || null
  }

  // The Reference block (style / mood / format text and example URLs) — part
  // of the brief, so editing it needs manage_content. Crew see it, never set it.
  if (body.reference_text !== undefined) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const next = body.reference_text ? String(body.reference_text).slice(0, 4000) : null
    // The same rule the creation form applies: a task edited into a
    // placeholder is exactly as unhelpful as one created that way. Only text
    // standing ALONE has to carry a link — links, a photo or an attached
    // document already point somewhere, so text beside them is a caption.
    const links = body.reference_links !== undefined
      ? cleanLinks(body.reference_links)
      : (() => { try { return JSON.parse(row.reference_links || '[]') } catch { return [] } })()
    const carried = links.length > 0 || !!(body.photo !== undefined ? body.photo : row.photo)
    // …and, like the creation form, nothing is asked of a thought: a reference
    // has to point somewhere from the working stages on, where a crew reads it.
    //
    // Named, like the walls further down: the bulk window puts its box back on
    // the field a refusal is about, and a refusal with no field there is a row
    // left red with nowhere to type — the answer somebody just gave, gone, and
    // "open the task" the only way on. The same holds for every brief field
    // below.
    // A link or words that say how it should look are both a real reference
    // (the owner, 13 Oct); only a placeholder is refused.
    if (next && !carried && !free && !stillAnIdea) {
      if (!hasSubstance(next))
        return res.status(400).json({ error: `«Reference» needs a real answer — “${clip(next)}” is a placeholder, not a reference`, field: 'reference_text' })
    }
    patch.reference_text = next
  }
  if (body.reference_links !== undefined) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    patch.reference_links = JSON.stringify(cleanLinks(body.reference_links))
  }

  // The brief fields (format / rubrika / script / ТЗ) — manage_content, like the
  // Reference. Clearing one the admin made required for this type is refused.
  if (['format', 'rubrika', 'script', 'tz'].some((f) => body[f] !== undefined)) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const fieldRules = await getTaskFields()
    const nextType = body.type !== undefined && CONTENT_TYPES.includes(body.type) ? body.type : row.type
    // Where it is going has its say too, as it does at the gate: a Telegram
    // post is a post, and nobody there is owed a ТЗ.
    const briefFormats = await channelFormatsFor(chansOf({ channels: patch.channels !== undefined ? patch.channels : row.channels }), mediaNow)
    for (const f of ['format', 'rubrika', 'script', 'tz']) {
      if (body[f] === undefined) continue
      const v = f === 'script' || f === 'tz' ? cleanScript(body[f]) : cleanShort(body[f])
      const r = fieldRules[f]
      // …and an idea is not held to it either, for the same reason it was not
      // asked in the first place: there is no work in flight to protect.
      const demanded = !free && !stillAnIdea && fieldDemanded(r, nextType) && formatsAllowField(briefFormats, f)
      if (!v && row[f] && demanded)
        return res.status(400).json({ error: `«${FIELD_LABELS[f]}» is required for this type of task — it can’t be cleared`, field: f })
      // Emptying a demanded field is refused above; filling it with a dot is
      // the same act wearing a disguise, so it is refused too. Where the field
      // is NOT demanded, a placeholder simply comes to rest as empty rather
      // than reaching the card and reading as content. A demanded SCRIPT is
      // held to the higher bar the crew actually films from — one careless
      // word has letters in it and is still not a shot list.
      const answered = free || ((f === 'script' || f === 'tz') && demanded ? isSentence(v) : hasSubstance(v))
      if (v && !answered) {
        // A Google Docs link pasted where the script goes is the commonest
        // way in here, and "a placeholder" is the wrong thing to call it: the
        // words exist, they are just somewhere else. Said the way the gate
        // says it, so the two never disagree about what is wrong.
        if (demanded && f === 'script' && readText(v).kind === 'link')
          return res.status(400).json({ error: `«${FIELD_LABELS[f]}» needs the words, not just the link — the crew films from this`, field: f })
        if (demanded)
          return res.status(400).json({ error: `«${FIELD_LABELS[f]}» needs a real answer — “${clip(v)}” is a placeholder, not a brief`, field: f })
        patch[f] = null
        if (f === 'script') patch.script_key = null
        continue
      }
      // The same script on two cards is one shoot booked twice. A task
      // KEEPING its own script is not repeating anything, though — an
      // ordinary save sends every field back, and a twin made on purpose
      // (Duplicate) would otherwise make the original unsaveable ever after.
      if (f === 'script' && v && !free && !body.allow_duplicate_script && normScript(v) !== normScript(row.script)) {
        const twin = await duplicateScript(v, row.id)
        if (twin)
          return res.status(400).json({ error: `That script is already on «${twin.title}» — link to it or write what is different about this one`, field: 'script' })
      }
      patch[f] = v
      if (f === 'script') patch.script_key = scriptKey(v)
    }
  }

  // Editing details needs manage_content.
  const detailFields = ['title', 'type', 'recording_time', 'recording_end', 'release_time', 'description', 'photo', 'photo_thumb']
  const wantsDetails = detailFields.some((f) => body[f] !== undefined) || body.channels !== undefined
  if (wantsDetails && !can(req.user, 'manage_content'))
    return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
  for (const f of detailFields) if (body[f] !== undefined) patch[f] = body[f]
  if (patch.title !== undefined && !String(patch.title ?? '').trim()) return res.status(400).json({ error: 'Give the task a title', field: 'title' })
  // An unknown kind keeps the one it has: turned into a post, a reel lost its crew.
  if (patch.type !== undefined && !CONTENT_TYPES.includes(patch.type)) delete patch.type

  // The reference album, and the single `photo` pair kept in step with it.
  //
  // Whichever arrives is the truth and the other follows, so the two can never
  // drift into disagreeing about whether a brief has a picture in it. An album
  // sent by the task modal sets `photo` from its first picture; a lone photo
  // sent by an older client or the Pravki screenshot path becomes an album of
  // one. Clearing either clears both.
  if (body.reference_photos !== undefined) {
    if (!can(req.user, 'manage_content')) return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const pics = cleanPhotos(body.reference_photos)
    patch.reference_photos = JSON.stringify(pics)
    patch.photo = pics[0]?.photo ?? null
    patch.photo_thumb = pics[0]?.thumb ?? null
    // The album owns the card's picture now — or, emptied, hands it back to
    // the first reference photo (mirrorFirstPhoto, after the save).
    patch.photo_media_id = null
  } else if (patch.photo !== undefined) {
    patch.photo_media_id = null
    const thumb = patch.photo_thumb !== undefined ? patch.photo_thumb : row.photo_thumb
    patch.reference_photos = JSON.stringify(patch.photo ? cleanPhotos([{ photo: patch.photo, thumb }]) : [])
  }

  // Which column this stands in on the design board. No gate and no wall:
  // moving artwork between «In progress» and «Manager review» is one person
  // describing their own work, not a handover anybody has to answer for. It
  // is guarded by canTouch alone — the same reach that already lets somebody
  // open the task and change it.
  if (body.design_status_id !== undefined) {
    if (!canTouch(req.user, row)) return res.status(403).json({ error: 'This task is not on your board' })
    const id = body.design_status_id == null ? null : Number(body.design_status_id)
    if (id != null && !(await get('SELECT 1 AS x FROM design_statuses WHERE id = ?', id)))
      return res.status(400).json({ error: 'That design stage no longer exists' })
    patch.design_status_id = id
  }

  // The description, held to the same standard on edit as on creation: a
  // demanded one may not become a placeholder, and an optional one comes to
  // rest as empty rather than putting "." on the card.
  if (patch.description !== undefined) {
    const nType = patch.type !== undefined ? patch.type : row.type
    const dr = (await getTaskFields()).description
    const demanded = !free && dr?.state === 'required' && dr.types.includes(nType)
    const d = String(patch.description ?? '').trim()
    if (d && !hasSubstance(d) && !free) {
      if (demanded)
        return res.status(400).json({ error: `«Description» needs a real answer — “${clip(d)}” is a placeholder, not a brief`, field: 'description' })
      patch.description = ''
    }
    if (!d && demanded && row.description)
      return res.status(400).json({ error: '«Description» is required for this type of task — it can’t be cleared', field: 'description' })
  }

  // A BOOKED shoot keeps its operator. Without this the demand made at the
  // shooting gate lasts exactly until somebody opens the task and clears the
  // field, or retypes a post as a video after the fact.
  //
  // Only when the edit TOUCHES the operator or the type, and only once the
  // shoot is actually booked — an idea has no crew to lose, and a guard on
  // every patch would make every pre-rule task unmovable, so dragging one to
  // another day would fail for a reason that has nothing to do with the drag.
  //
  // Two things it must not do, both found by trying to type a view count into
  // a published reel. It fired for the ADMIN, who walks through every other
  // wall on this board since round 80 — and it fired on work that is already
  // OUT, where there is no shoot left to protect and no crew left to lose.
  // The task form sends the whole form on every save, `type` included, so
  // "touches the type" meant "was saved at all": a published reel filmed on
  // somebody's phone, with no operator ever named, could not be edited again
  // by anybody, for any reason.
  if (!free && !row.done_at
      && ((body.operator_id !== undefined && asNum(body.operator_id) !== asNum(row.operator_id))
        || (body.type !== undefined && body.type !== row.type))
      && !isIdea(row.status_id, await all('SELECT id, label, sort, is_final FROM statuses'))) {
    const nType = patch.type !== undefined ? patch.type : row.type
    const nOperator = body.operator_id !== undefined
      ? (body.operator_id === null || body.operator_id === '' ? null : Number(body.operator_id))
      : row.operator_id
    const nFormats = await channelFormatsFor(chansOf({ channels: patch.channels !== undefined ? patch.channels : row.channels }), mediaNow)
    if ((await getCrewNeeds()).operator.includes(nType) && formatsAllowCrew(nFormats, 'operator') && !nOperator)
      return res.status(400).json({ error: 'Pick who is filming this — a shoot nobody is holding is nobody’s job' })
  }
  for (const f of ['recording_time', 'recording_end', 'release_time'])
    if (patch[f] !== undefined) patch[f] = cleanTime(patch[f])
  // …and a shoot's hours onto the quarter-hour grid — when they are CHANGING. The
  // sheet sends back the stored hours on every save, and quietly rewriting an
  // older 10:15 would read as moving an accepted slot (the ack lock below).
  for (const [f, up] of [['recording_time', false], ['recording_end', true]])
    if (patch[f] && patch[f] !== cleanTime(row[f])) patch[f] = snapSlot(patch[f], up)

  if (body.channels !== undefined) {
    const next = await cleanChannels(body.channels)
    if (next.length === 0) return res.status(400).json({ error: 'Pick at least one platform' })
    if (!next.every((ch) => canAccessDept(req.user, ch))) return res.status(403).json({ error: 'Not your channel' })
    patch.channels = JSON.stringify(next)
  }

  // ---- what a Telegram piece is (see TELEGRAM_TYPES) ----
  // Read against where the task is going AFTER this save. Off a written
  // channel nothing is kept — moved from Telegram to Instagram, the type and
  // the guiding flag are cleared rather than left to be counted by mistake.
  {
    const chansNow = (c) => chansOf({ channels: c })
    const written = (await channelFormatsFor(chansNow(patch.channels !== undefined ? patch.channels : row.channels))).includes('text')
    if (!written) {
      if (row.telegram_type) patch.telegram_type = null
      if (row.is_guiding) patch.is_guiding = 0
    } else {
      if ((body.telegram_type !== undefined || body.is_guiding !== undefined) && !can(req.user, 'manage_content'))
        return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
      if (body.telegram_type !== undefined) {
        const v = asTelegramType(body.telegram_type)
        if (body.telegram_type !== null && body.telegram_type !== '' && !v)
          return res.status(400).json({ error: TELEGRAM_TYPE_UNKNOWN, field: 'telegram_type' })
        if (!v && row.telegram_type && !stillAnIdea && !free)
          return res.status(400).json({ error: '«Telegram Item Type» is required for a Telegram piece — it can’t be cleared', field: 'telegram_type' })
        patch.telegram_type = v
      }
      if (body.is_guiding !== undefined) patch.is_guiding = truthy(body.is_guiding) ? 1 : 0
      // A piece already in the works that is now ALSO going to Telegram owes
      // the answer on this save, the way a piece leaving the idea stage does.
      if (patch.channels !== undefined && !stillAnIdea && !free
        && !(patch.telegram_type !== undefined ? patch.telegram_type : row.telegram_type)
        && !(await channelFormatsFor(chansNow(row.channels))).includes('text'))
        return res.status(400).json({ error: TELEGRAM_TYPE_NEEDED, field: 'telegram_type' })
    }
  }

  // ---- "it has a video or a picture" (with_media) ----
  // Only a task going to a short written channel can carry it; anywhere else
  // it is cleared, the way the Telegram type is. Writing it is editing the
  // task (manage_content), like the brief.
  {
    const short = (await channelFormatsFor(chansOf({ channels: patch.channels !== undefined ? patch.channels : row.channels }))).includes('short')
    if (!short) {
      if (row.with_media) patch.with_media = 0
    } else if (body.with_media !== undefined) {
      if (!can(req.user, 'manage_content') && !isAssignee)
        return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
      patch.with_media = mediaNow ? 1 : 0
    }
  }

  // Calendar drags send only a date → allowed with move_tasks too. The two
  // revised dates are the re-promise made when a handover lands late; they
  // ride the same right, because the person making the promise is the person
  // moving the card.
  //
  // But a deadline that ALREADY HAS a day is a promise, and a promise the
  // person who made it can quietly move is not one. Changing a date that is
  // set is the admin's alone; filling one that is empty still belongs to
  // whoever may move tasks, so unscheduled work can still be scheduled and an
  // idea can still be given its first day. Clearing counts as changing.
  //
  // The two *_revised dates are exempt: they exist precisely to record a
  // re-promise when a handover lands late, and are already written beside the
  // original rather than over it.
  //
  // And once the work is IN PRODUCTION — from the shoot booking until it is up
  // for review — the days do not move at all for anyone but an admin. Not the
  // set ones (that was already true) and not the empty ones either: bolting a
  // fresh deadline onto a piece somebody is already filming or cutting is the
  // same disruption as moving one, and until now it was the one way round the
  // rule. An admin still moves them, and the ask below still reaches an admin,
  // so the work is never actually stuck.
  //
  // None of which is true of an IDEA. A day on a thought nobody has promised
  // anything about is not a promise: no operator's morning is held by it, no
  // editor has been told when the cut is due, and nothing downstream moves
  // when it does. The board has always said so about an idea's STAGE — "an
  // idea may be shoved along by anybody", the same `wasAnIdea` read a few
  // hundred lines up — and said the opposite about its DAYS, which is how a
  // member dragging a thought from one square of the calendar to another got
  // told to go and ask an admin. Both rules step aside while it is an idea,
  // and both come back the moment it stops being one.
  //
  // One day is asked for LATE, and so can be given late: a filmed piece's day
  // to post. The owner moved that question from the booking to the way into
  // editing (`editGaps`), and footage can carry a piece into editing before
  // anybody has answered it — so an EMPTY one may be filled while the piece is
  // being made, by whoever may set its days. Once it holds a day it is a
  // promise like any other, and moves by asking.
  const LOCKED_DATES = ['recording_date', 'edit_ready_date', 'design_ready_date', 'release_date']
  for (const f of [...LOCKED_DATES, 'edit_due_revised', 'review_due_revised']) {
    if (body[f] !== undefined) {
      if (body[f] && badDayIn({ [f]: body[f] })) return res.status(400).json({ error: 'Give the day as a date', field: f })
      if (!wasAnIdea && !can(req.user, 'manage_content') && !can(req.user, 'move_tasks'))
        return res.status(403).json({ error: 'You don’t have permission to move dates' })
      const next = body[f] || null
      const askedLate = f === 'release_date' && !row[f] && (await filmedPiece(
        patch.type !== undefined ? patch.type : row.type, chansOf({ channels: patch.channels !== undefined ? patch.channels : row.channels }), mediaNow))
      if (LOCKED_DATES.includes(f) && datesFrozen && !askedLate && String(next ?? '') !== String(row[f] ?? '') && !adminHere(req.user, row))
        return res.status(403).json({
          error: 'This is being made — the days on it are settled until it is up for review. Ask an admin, and say what happened.',
          // Only a day that EXISTS can be asked about: the request flow moves
          // a promise, it does not make one. An empty deadline here is simply
          // refused, and the form says why rather than offering a dead end.
          ...(row[f] ? { ask_to_move: { field: f, from: row[f], to: next } } : {}),
        })
      if (LOCKED_DATES.includes(f) && !wasAnIdea && row[f] && String(next ?? '') !== String(row[f]) && !adminHere(req.user, row))
        return res.status(403).json({
          error: `That day is already promised — ask an admin to move it, and say what happened.`,
          // What the form needs to offer the ask instead of just refusing:
          // which deadline, the day it holds, and the day that was wanted.
          ask_to_move: { field: f, from: row[f], to: next },
        })
      patch[f] = next
    }
  }

  // Assignees may always tick their own checklist.
  if (body.checklist !== undefined) {
    if (!can(req.user, 'manage_content') && !isAssignee)
      return res.status(403).json({ error: 'Only the assignee can edit this checklist' })
    patch.checklist = JSON.stringify(Array.isArray(body.checklist) ? body.checklist : [])
  }

  // Taking a THOUGHT into production. Leaving Idea needs no ticket — that is
  // `wasAnIdea`, decided far above and applied at every gate between here and
  // the bottom of this handler — but the handover gate makes naming the crew a
  // CONDITION of the move: drag a thought onto the shooting stage and the board
  // asks "who is shooting this?".
  //
  // Those two rules used to contradict each other, and the contradiction was
  // invisible from either side. The move was allowed; the answer to the
  // question it asked was refused as an editing right. So a content maker
  // picked the shooter, pressed "Hand over and move", got a 403 the gate read
  // as one more missing field, and was handed the same question again — for
  // ever. From the outside that is simply "ideas cannot be moved", which is
  // what it was reported as.
  //
  // So whoever may make the move may answer what the move asks. Narrow on
  // purpose: only while the task IS still an idea, and only in the same patch
  // that takes it off the idea stage. It grants nothing on a task already in
  // production, and nothing to somebody who is not moving anything.
  const bookingAnIdea = wasAnIdea && body.status_id !== undefined && body.status_id !== row.status_id

  // Not out before it is filmed, when either day changes in this save (the
  // bug hunt, 14 Oct 2026). A piece already stored that way can still be saved.
  const recDay = patch.recording_date !== undefined ? patch.recording_date : row.recording_date
  const relDay = patch.release_date !== undefined ? patch.release_date : row.release_date
  const dayMoved = (f) => patch[f] !== undefined && String(patch[f] ?? '') !== String(row[f] ?? '')
  if (!free && (dayMoved('recording_date') || dayMoved('release_date')) && recDay && relDay && String(relDay) < String(recDay))
    return res.status(400).json({ error: 'It would go out before it is filmed — pick the shoot day or later', field: dayMoved('release_date') ? 'release_date' : 'recording_date' })

  // Crew hats (operator / editor / designer) — an editing right, linked to
  // real members.
  for (const f of ['operator_id', 'editor_id', 'designer_id', 'reviewer_id']) {
    if (body[f] !== undefined) {
      if (!can(req.user, 'manage_content') && !bookingAnIdea)
        return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
      const next = body[f] == null || body[f] === '' ? null : Number(body[f])
      if (next !== null && !Number.isFinite(next)) return res.status(400).json({ error: 'Pick a person from the list', field: f })
      if (next !== null && !(await userExists(next)))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
      patch[f] = next
      // Setting the single reviewer replaces the whole list — the two must
      // never disagree about who is on the hook.
      if (f === 'reviewer_id') patch.reviewers = JSON.stringify(next ? [next] : [])
    }
  }

  // ---- an accepted slot is not moved behind somebody's back ----------------
  // Once the operator has said they can be there, the shoot day and its hours
  // belong to them as much as to the board: they have cleared an afternoon for
  // it. The same for an editor who has accepted a deadline. Moving it is the
  // admin's to do — and doing it puts the question back to the crew rather
  // than leaving a "confirmed" tick standing over a time nobody agreed to.
  for (const which of Object.keys(BOOKINGS)) {
    const b = BOOKINGS[which]
    const touched = [b.day, b.from, b.to, b.holder].filter(Boolean)
      .filter((f) => patch[f] !== undefined && String(patch[f] ?? '') !== String(row[f] ?? ''))
    if (!touched.length) continue
    if (row[b.ack] === 'yes' && !free) {
      const who = await get('SELECT name FROM users WHERE id = ?', row[b.holder])
      return res.status(409).json({
        error: `${who?.name || 'The ' + b.role} has already agreed to ${b.what} — ${slotWords(row, which)}. An admin can move it; they will be asked again.`,
        booking: which,
      })
    }
    // Re-booked: the answer is about the old time and does not carry over.
    if (row[b.ack]) {
      patch[b.ack] = ''
      patch[b.at] = null
      patch[b.by] = null
      patch[b.note] = null
    }
  }

  // The same two questions on an edit — whether the hat changed, or the day it
  // is due did. Moving three cuts onto one Tuesday is the same act as handing
  // somebody three cuts for Tuesday.
  {
    const nextChans = patch.channels !== undefined ? chansOf({ channels: patch.channels }) : chansOf(row)
    for (const f of ['operator_id', 'editor_id', 'designer_id']) {
      const dateCol = CAP_DATE[f]
      const hatChanged = patch[f] !== undefined && patch[f] !== row[f]
      const dayChanged = patch[dateCol] !== undefined && patch[dateCol] !== row[dateCol]
      const chansChanged = patch.channels !== undefined
      if (!hatChanged && !dayChanged && !chansChanged) continue
      const person = patch[f] !== undefined ? patch[f] : row[f]
      if (!person) continue
      if (hatChanged || chansChanged) {
        const chanProblem = await crewChannelProblem(person, nextChans)
        if (chanProblem) return res.status(400).json({ error: chanProblem, crew_field: f })
      }
      const day = patch[dateCol] !== undefined ? patch[dateCol] : row[dateCol]
      const capped = await capProblem(f, person, day, row.id)
      if (capped) return res.status(409).json({ error: capped, crew_field: f })
    }
  }

  // Moving an ad onto a day the channel has already filled is the same
  // over-booking as creating one there, and reaches this line by a different
  // door — a drag on the release calendar rather than a form.
  {
    const nextType = patch.type !== undefined ? patch.type : row.type
    const nextDay = patch.release_date !== undefined ? patch.release_date : row.release_date
    let nextChans2 = []
    try { nextChans2 = patch.channels !== undefined ? JSON.parse(patch.channels) : JSON.parse(row.channels || '[]') }
    catch { nextChans2 = [] }
    const typeChanged = patch.type !== undefined && patch.type !== row.type
    const dayChanged2 = patch.release_date !== undefined && patch.release_date !== row.release_date
    const chansChanged2 = patch.channels !== undefined && patch.channels !== row.channels
    if (typeChanged || dayChanged2 || chansChanged2) {
      const adFull = await adCapProblem(nextType, nextChans2, nextDay, row.id)
      if (adFull) return res.status(409).json({ error: adFull, crew_field: 'release_date' })
    }
  }

  // Review can be shared: the list is the truth, reviewer_id mirrors its head
  // so everything that reads one name keeps working.
  if (body.reviewer_ids !== undefined) {
    // Shared review is named the same way a shooter is, and by the same person
    // — the gate sends this field when the stage it is asking about shares its
    // review. See `bookingAnIdea` above for why it is allowed here.
    if (!can(req.user, 'manage_content') && !bookingAnIdea)
      return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const list = [...new Set((Array.isArray(body.reviewer_ids) ? body.reviewer_ids : [])
      .map(Number).filter(Boolean))]
    for (const id of list) {
      if (!(await userExists(id)))
        return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
    }
    patch.reviewers = JSON.stringify(list)
    patch.reviewer_id = list[0] ?? null
  }

  // Retag to another campaign (or none) — an editing right.
  if (body.campaign_id !== undefined) {
    if (!can(req.user, 'manage_content'))
      return res.status(403).json({ error: 'You don’t have permission to edit tasks' })
    const nextCamp = body.campaign_id == null || body.campaign_id === '' ? null : Number(body.campaign_id)
    if (nextCamp !== null && !(await get('SELECT 1 AS x FROM campaigns WHERE id = ?', nextCamp)))
      return res.status(400).json({ error: 'Campaign not found' })
    patch.campaign_id = nextCamp
  }

  // Pinning to the top of the to-do lists — same right as completing.
  if (body.pinned !== undefined) {
    if (!isAssignee && !can(req.user, 'move_tasks'))
      return res.status(403).json({ error: 'You don’t have permission to pin this' })
    patch.pinned = body.pinned ? 1 : 0
  }

  // Reassigning — admins only. assignee_ids is the multi-select; a lone
  // assignee_id still works for older clients.
  const reassign = body.assignee_ids !== undefined
    ? (Array.isArray(body.assignee_ids) ? body.assignee_ids : [body.assignee_ids])
    : body.assignee_id !== undefined && Number(body.assignee_id) !== row.assignee_id
      ? (body.assignee_id === null || body.assignee_id === '' ? [] : [body.assignee_id])
      : undefined
  if (reassign !== undefined) {
    const ids = [...new Set(reassign.map(Number).filter(Boolean))]
    const same = JSON.stringify(ids) === JSON.stringify(assigneesOf(row))
    if (!same) {
      if (!adminHere(req.user, row)) return res.status(403).json({ error: 'Only admins can reassign tasks' })
      for (const id of ids) {
        if (!(await userExists(id)))
          return res.status(400).json({ error: 'That member is no longer on the team — refresh the page and pick again' })
      }
      patch.assignee_id = ids[0] ?? null
      patch.assignees = JSON.stringify(ids)
    }
  }

  // done: true/false — the to-do checkbox / final stage. The crew do NOT
  // publish; their reach ends at their Shot / Edited tick, so completing is
  // left to the assignee or someone with move_tasks.
  if (body.done !== undefined) {
    if (!isAssignee && !can(req.user, 'move_tasks'))
      return res.status(403).json({ error: 'You don’t have permission to complete this' })
    const fin = await finalStatus()
    if (body.done) {
      if (fin) patch.status_id = fin.id
      patch.done_at = row.done_at || new Date().toISOString()
    } else {
      patch.done_at = null
      if (fin && (patch.status_id ?? row.status_id) === fin.id) {
        // Un-completing steps back to the last working stage — never to the
        // Deleted graveyard, even though it sorts after Published.
        const nonFinal = await all('SELECT id, label FROM statuses WHERE is_final = 0 ORDER BY sort, id')
        const lastNonFinal = nonFinal.filter((s) => !/^deleted$/i.test(s.label)).at(-1)
        if (lastNonFinal) patch.status_id = lastNonFinal.id
      }
    }
  }

  // ---- footage in, and nobody to hand it to ----------------------------------
  // The operator's tick sends a filmed piece on to the editor by itself — when
  // there is an editor, and a ТЗ telling them what to make of the footage.
  // Without those it used to go on all the same, and stood in Editing with
  // nobody to edit it or nothing to edit it by. Now it WAITS on the shooting
  // stage: the shoot is stamped done and the footage kept (so the operator's
  // part is over, and on time), the answer says what it is waiting for
  // (`held`), and its owners are told once, further down. Sending it on is
  // then their step (lib/nextStep.js: "Send to editing"), through the same
  // wall as any other move into that stage.
  //
  // Only the two things the editor cannot start without. The reference and the
  // day to post are asked of a person making the move, and wait for nobody's
  // footage. The admin's tick is catching the board up, and is not held.
  // (A reel's cover handed in before its cut is held too — the milestone above
  // keeps it on Editing; `coverHeld` says so in the answer, and lets it be undone.)
  //
  // A hand-in over a change request needs the new version — checked BEFORE a
  // held hand-in answers early, or a re-shoot "succeeded" with nothing new and
  // the round stayed open (the bug hunt, 14 Oct 2026). The round itself is
  // closed further down, once the save is sure to land.
  const roundHat = body.milestone ? { shot: ['operator', 'shot_link'], edited: ['editor', 'ready_link'], designed: ['designer', 'design_link'] }[body.milestone] : null
  const openRounds = roundHat
    ? await all('SELECT id, round, requested_by, sent_link FROM revisions WHERE content_id = ? AND target = ? AND resolved_at IS NULL ORDER BY round, id', row.id, roundHat[0])
    : []
  const roundLink = openRounds.length ? (patch[roundHat[1]] !== undefined ? patch[roundHat[1]] : row[roundHat[1]]) : null
  const roundFresh = !!roundLink && String(roundLink) !== String(sentBack(openRounds[openRounds.length - 1], row, roundHat?.[1]))
  if (openRounds.length && !roundFresh && !free)
    return res.status(400).json({
      error: 'Changes were asked for — paste the link to the new version. The one in the box is the version that was sent back.',
      needs_link: roundHat[1],
    })
  const heldFor = coverHeld ? ['ready_link'] : []
  if (body.milestone === 'shot' && patch.status_id !== undefined && !free) {
    const type = patch.type !== undefined ? patch.type : row.type
    const chans = chansOf({ channels: patch.channels !== undefined ? patch.channels : row.channels })
    if (await filmedPiece(type, chans, mediaNow)) {
      const now = (f) => (patch[f] !== undefined ? patch[f] : row[f])
      if (fieldOn(await getTaskFields(), 'tz', type, await channelFormatsFor(chans, mediaNow)) && !isSentence(now('tz'))) heldFor.push('tz')
      if (!now('editor_id')) heldFor.push('editor_id')
      if (heldFor.length) {
        delete patch.status_id
        if (!row.shot_at) patch.shot_at = new Date().toISOString()
      }
    }
  }
  // Every answer to this save: the row, and what a hand-in is waiting for.
  const answer = async () => ({ ...(await listRow(row.id)), ...(heldFor.length ? { held: heldFor } : {}) })

  if (Object.keys(patch).length === 0) return res.json(await answer())

  // Rescheduling the shoot (who, when, from, to) re-checks the operator's day —
  // when it actually MOVES. The task sheet sends every box it holds on every
  // save, these four included, so "mentioned" used to count as "moved": once an
  // admin had booked a shoot over another one on purpose ("Book anyway"), the
  // next person to fix a typo on that sheet was told the operator was
  // double-booked and could not save at all, with no way through but an admin.
  // The same person, day and hours is not a new booking.
  const sameShoot = (f) => {
    const was = f === 'recording_time' || f === 'recording_end' ? cleanTime(row[f]) : row[f]
    return String(patch[f] ?? '') === String(was ?? '')
  }
  // …and when a shoot that had left the plan comes back into it. Finished or
  // in the Deleted graveyard it held no hour, so its operator may have been
  // booked into that hour since; reopening it would otherwise double-book them
  // without a word. Only a shoot still AHEAD and not yet filmed: reopening a
  // piece whose shoot is behind it ("Mark as not done" on last month's reel)
  // books nobody, and must not be stopped over an hour long gone.
  const outOfPlan = async (statusId, doneAt) => !!doneAt
    || /^deleted$/i.test(String((await get('SELECT label FROM statuses WHERE id = ?', statusId))?.label || ''))
  const comesBack = patch.status_id !== undefined && patch.status_id !== row.status_id
    && !!row.recording_date && row.recording_date >= dayISO() && !row.shot_at
    && (await outOfPlan(row.status_id, row.done_at))
    && !(await outOfPlan(patch.status_id, (await isFinal(patch.status_id)) ? 'final' : null))
  if (comesBack || ['operator_id', 'recording_date', 'recording_time', 'recording_end'].some((f) => patch[f] !== undefined && !sameShoot(f))) {
    const nx = (f) => (patch[f] !== undefined ? patch[f] : row[f])
    if (nx('recording_time') && nx('recording_end') && nx('recording_end') <= nx('recording_time'))
      return res.status(400).json({ error: 'The shoot ends before it starts' })
    if (await guardShoot(req, res, {
      operatorId: nx('operator_id'), date: nx('recording_date'),
      start: nx('recording_time'), end: nx('recording_end'), excludeId: row.id,
      chans: patch.channels !== undefined ? chansOf({ channels: patch.channels }) : chansOf(row),
    })) return
  }

  // Derive done_at from status moves into/out of the final stage.
  const nextStatus = patch.status_id ?? row.status_id
  if (patch.done_at === undefined) {
    if ((await isFinal(nextStatus)) && !row.done_at) patch.done_at = new Date().toISOString()
    if (!(await isFinal(nextStatus)) && row.done_at) patch.done_at = null
  }

  // Publishing is the reviewer's call: moving a task into the final Published
  // stage — whether by the stage picker or the done tick — needs review_publish
  // and being on the channel. The crew's milestone lands on Ready, never final,
  // so they never trip this.
  if ((await isFinal(nextStatus)) && !(await isFinal(row.status_id)) && !canPublish(req.user, row))
    return res.status(403).json({ error: 'Only the channel’s reviewer can publish — ask your SMM or an admin' })

  // A piece with changes still outstanding is not finished, whoever presses
  // the button. Publishing over an open Pravki is how a round gets lost: the
  // note was written, the fix was never delivered, and the piece went out
  // anyway with the reviewer assuming somebody had dealt with it.
  if ((await isFinal(nextStatus)) && !(await isFinal(row.status_id))) {
    const openFix = await get('SELECT id, note, target FROM revisions WHERE content_id = ? AND resolved_at IS NULL ORDER BY id', row.id)
    if (openFix)
      return res.status(409).json({
        error: `Changes are still outstanding — “${clip(openFix.note)}” went to the ${openFix.target} and has not come back. Close it, or drop it, before this goes out.`,
        open_revision: openFix.id,
      })
  }

  // Stage rules: the admin regulates which kind of actor moves work OUT of
  // which stage (Admin → Pipeline). Applies to moves among working stages —
  // publishing keeps its own key above, un-publishing stays as it was, and
  // admins pass everything. Rules only ever narrow the existing tickets
  // (crew milestones, a member's move_tasks); they never grant new ones.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && !adminHere(req.user, row) &&
      !wasAnIdea && !(await isFinal(row.status_id)) && !(await isFinal(nextStatus))) {
    const kinds = [
      row.operator_id === req.user.id && 'operator',
      row.editor_id === req.user.id && 'editor',
      row.designer_id === req.user.id && 'designer',
      req.user.role === 'member' && 'member',
    ].filter(Boolean)
    let allowed = false
    for (const k of kinds) {
      if (await mayLeaveStage(k, row.status_id)) { allowed = true; break }
    }
    if (!allowed) return res.status(403).json({ error: 'Moving work out of this stage isn’t your step — see the stage rules in Admin' })
  }

  // ---- the task belongs to whoever is holding it --------------------------
  // Once work has been handed on, it is out of the previous owner's hands: the
  // person the stage belongs to moves it, and nobody else but an admin. A
  // stage with no owner yet is nobody's property — the gates below will insist
  // on one before it goes any further.
  // A milestone tick is exempt for the same reason as the gates below: the
  // tick already proved the person holds the hat they are closing. Without
  // this an editor could not mark a cut finished while the card still sat in
  // the shooter's phase — which is exactly when they finish it.
  // …but nobody HOLDS an idea. The shooter named on a thought has not been
  // handed anything yet, so they are not somebody the rest of the team has to
  // go through to move it along.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && !adminHere(req.user, row) &&
      !wasAnIdea && !body.milestone) {
    const held = holderOf(row, pipeline)
    // Whoever the task itself was handed to holds it as well. A stage owner is
    // the crew hat working it right now; an ASSIGNEE is the person the whole
    // task belongs to, and has been able to move their own work since long
    // before stages had owners. Counting only the hats locked the task's own
    // people out of it.
    const mine = held.owner_ids.includes(req.user.id) || assigneesOf(row).includes(req.user.id)
    // …and a shoot whose footage is in is not "with" its operator any more.
    // It stands on the shooting stage only until somebody adds what editing
    // asks (see "footage in, and nobody to hand it to"), and "this is with
    // Jasur now" would be said of a man who handed it in yesterday. Unless it
    // is back with him: sent to be filmed again.
    const letGo = held.phase === 'shoot' && !!row.shot_at
      && !(await get("SELECT 1 AS x FROM revisions WHERE content_id = ? AND target = 'operator' AND resolved_at IS NULL", row.id))
    if (held.owner_ids.length && !mine && !letGo) {
      const names = await all(
        `SELECT name FROM users WHERE id IN (${held.owner_ids.map(() => '?').join(',')})`, ...held.owner_ids)
      const who = names.map((u) => u.name).join(' or ') || 'somebody else'
      return res.status(403).json({
        error: `This is with ${who} now — only they (or an admin) can move it on`,
        held_by: held.owner_ids, phase: held.phase,
      })
    }
  }

  // ---- the handover gates -------------------------------------------------
  // Moving a card forward is a claim that the stage behind it is finished, so
  // each gate makes the claim provable before the move lands: the next owner
  // is named, and the file that proves the work exists is attached. Gates are
  // cumulative — dragging a card straight from Idea to Ready does not skip the
  // shooter and the editor on the way past. Sending work BACK for fixes is
  // never gated, and a crew member closing THEIR OWN stage is not gated either:
  // the milestone tick has already refused anyone who does not hold the hat, so
  // reaching here means the person who did the work is saying it is done, and
  // that one tap is the most-used action in the product.
  //
  // Admins ARE gated. They were exempt, and the first thing that happened live
  // was an admin walking a card through every stage with nobody named and
  // nothing attached — which is the exact hole this was built to close.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id && !body.milestone) {
    const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
    const resolved = resolveGates(statuses)
    const at = (id) => resolved.ordered.findIndex((s) => s.id === id)
    const forward = at(patch.status_id) > at(row.status_id) && at(patch.status_id) >= 0

    if (forward) {
      const val = (f) => (patch[f] !== undefined ? patch[f] : row[f])
      const hasFile = async () =>
        !!(await get('SELECT 1 AS x FROM attachments WHERE content_id = ?', row.id))

      // What each gate demands: the owner it hands the work to, and the
      // delivery that proves the stage before it really happened.
      const NEEDS = {
        shoot:  { owner: 'operator_id', who: 'a shooter', link: null },
        edit:   { owner: 'editor_id', who: 'an editor', link: 'shot_link', what: 'the footage' },
        // Review already has owners, and they are not a field on the task:
        // a cut landing on Ready rings the channel's SMMs and the admins, and
        // always has. reviewer_id is an optional override — "this named person
        // answers for the review deadline" — so demanding one before the
        // EDITOR may finish would stop every crew tick until an admin filled
        // in a field that no existing task has. The proof still stands: the
        // cut itself must be attached.
        review: { owner: null, link: 'ready_link', what: 'the edit' },
      }
      // The gates ADVISE; they do not refuse. A wall here stopped ordinary
      // work: a written post has no cut to attach and no editor to name, and
      // footage handed over on a hard drive never becomes a link — yet both
      // were refused. What the stage is missing is still worked out, still
      // shown on the card by the StageGate panel (/api/warnings computes the
      // same list), and still counted against the handover deadlines below.
      // The move itself goes through.
      //
      // To make any of them a wall again, refuse here on `shortfalls`.
      const shortfalls = []
      // ---- is anybody actually on this? ------------------------------------
      // Every gate below asks who does the NEXT step. None of them asked the
      // plainer question: whose piece is this at all. A task can cross the
      // whole board with no name on it — the shooter names an operator, the
      // edit names an editor, and the piece itself belongs to nobody, which is
      // how work arrives at Published with an empty owner column and no reason
      // anyone can reconstruct. An idea owes nobody an owner; anything past it
      // does.
      const ownedBy = (() => {
        const raw = patch.assignees !== undefined ? patch.assignees : row.assignees
        let list = []
        try { list = JSON.parse(raw || '[]') } catch { list = [] }
        const one = patch.assignee_id !== undefined ? patch.assignee_id : row.assignee_id
        return list.filter(Boolean).length > 0 || !!one
      })()
      const leavingIdea = isIdeaStage(row.status_id, resolved)
      if (!ownedBy && !leavingIdea) shortfalls.push({ gate: 'own', missing: 'assignee_id' })

      // ---- the walls, all of them before any answers -------------------------
      // Each wall below used to answer the moment it found something, so a
      // move short of a ТЗ, a shoot day and the hour was refused three times
      // over, one field a trip. They are all asked now and gathered here —
      // what each one wants, and the exact reply it always gave — and the
      // answer is sent once, at the bottom, when every one has had its say.
      const walls = []
      const wall = (field, error, reply = { error, field }) => walls.push({ field, error, reply })

      // ---- the brief the admin demanded ------------------------------------
      // Nothing is asked of an idea, so the admin's required fields are asked
      // HERE, on the way out of it — otherwise switching a field to "required"
      // would mean nothing at all for anything jotted down first, which is how
      // most work starts. Asked once, on the move that leaves the idea behind.
      if (leavingIdea && !free) {
        const rules = await getTaskFields()
        const gateFormats = await channelFormatsFor(chansOf({ channels: patch.channels !== undefined ? patch.channels : row.channels }), mediaNow)
        const links = (() => { try { return JSON.parse(val('reference_links') || '[]') } catch { return [] } })()
        const carried = links.length > 0 || !!val('photo')
        const briefGaps = requiredProblems(rules, val('type'), {
          format: { present: !!val('format'), thin: !hasSubstance(val('format')), raw: val('format') },
          rubrika: { present: !!val('rubrika'), thin: !hasSubstance(val('rubrika')), raw: val('rubrika') },
          script: { present: !!val('script'), thin: !isSentence(val('script')), raw: val('script') },
          tz: { present: !!val('tz'), thin: !isSentence(val('tz')), raw: val('tz') },
          description: {
            present: !!(val('description') && String(val('description')).trim()),
            thin: !hasSubstance(val('description')), raw: val('description'),
          },
          reference: {
            present: !!(val('reference_text') || carried),
            thin: !carried && !hasSubstance(val('reference_text')), raw: val('reference_text'),
          },
        }, gateFormats)
        for (const gap of briefGaps) wall(gap.field, gap.error)
        // …and a written piece says what it is, for the copywriter's pay.
        if (gateFormats.includes('text') && !val('telegram_type')) wall('telegram_type', TELEGRAM_TYPE_NEEDED)
      }

      for (const gate of gatesUpTo(patch.status_id, resolved)) {
        // Only the gates this move actually CROSSES — a stage already behind
        // the card was passed under whatever rules applied at the time.
        if (at(row.status_id) >= gate.index) continue
        const need = NEEDS[gate.key]
        if (!need) continue
        if (need.owner && !val(need.owner)) shortfalls.push({ gate: gate.key, missing: need.owner })
        else if (need.link && !val(need.link) && !(await hasFile())) shortfalls.push({ gate: gate.key, missing: need.link })
      }

      // The shortfall above stays ADVISORY for everything that is written
      // rather than filmed: a text post has no cut to attach and no editor to
      // name, and refusing the move would not create either. It is shown on
      // the card by the StageGate panel (/api/warnings computes the same list)
      // and counted against the handover deadlines below.
      //
      // FILMED work is different, and this is where the two walls are. A shoot
      // is the one thing on this board that cannot be sorted out afterwards:
      // the day passes whether or not a camera, a crew and a brief turned up.
      //
      // Each wall stands at the stage it is ABOUT, and refuses a move that
      // LANDS there — booking a shoot when the card is put on the shooting
      // stage, briefing the edit when it is put on the one after. A card thrown
      // further along than that is not making either promise: it is a record
      // of work that happened elsewhere — shot on a phone last week, cut on
      // somebody's laptop, dragged onto Ready to catch the board up — and
      // demanding a future shoot day of it would be asking about a day that
      // has been and gone. That is the same reason creating one there is left
      // alone, and the walls stay where a person actually stands.
      // …and the admin walks through both walls. They are the person who
      // put the walls there, and they are usually the one catching the board
      // up on work that already happened.
      // ---- the published link ----------------------------------------------
      // A WALL, and one the admin does not walk through either.
      //
      // Every other rule on this board is about a promise somebody is making,
      // and round 80 stopped asking the admin to fill those in. This one is
      // not a promise: it is the address of a thing that already exists. A
      // piece cannot reach Published without having been published, so there
      // is always a link to paste, and thirty seconds of pasting it is what
      // makes every report downstream possible — where the work went, how many
      // views it got, what a person actually made this month. A board that
      // records "published" and not "published WHERE" cannot answer any of it,
      // and the admin is usually the one doing the publishing.
      if (at(patch.status_id) >= 0 && resolved.finalId != null && patch.status_id === resolved.finalId) {
        const posted = String(val('post_link') || '').trim()
        const say = (error) => wall('post_link', error, { error, needs: 'post_link' })
        if (!posted) say('Paste the link to the published post before moving it here')
        else if (!hasLink(posted)) say('That is not a link — it has to start with http:// or https://')
        else {
          // …and a repost goes out where it says: a TikTok piece at a TikTok
          // address (deadlines.js, postLinkProblem).
          const elsewhere = postLinkProblem(chansOf({ channels: val('channels') ?? row.channels }), posted)
          if (elsewhere) say(elsewhere)
        }
      }

      // ---- the post fits the platform (`tooLong`) ---------------------------
      // A WALL, and the admin does not walk through it either: X takes 280
      // characters and not one more, so a post past its channel's char_limit
      // cannot be ready, whoever says it is. Asked on any move that lands on
      // Ready or past it — a written piece goes from Writing straight out, and
      // that move is the one that has to stop. The text is the description;
      // across several channels the tightest limit is the one that holds.
      {
        const reviewAt = resolved.gates.review?.index ?? resolved.ordered.findIndex((s) => s.id === resolved.finalId)
        const lim = reviewAt >= 0 && at(patch.status_id) >= reviewAt
          ? await charLimitFor(chansOf({ channels: val('channels') ?? row.channels })) : null
        const len = [...String(val('description') || '')].length
        if (lim && len > lim.char_limit)
          wall('description', `Too long for ${lim.label}: ${len} characters, the limit is ${lim.char_limit} — shorten it to ${lim.char_limit} or fewer`)
      }

      // What each of the two asks is `bookingGaps` and `editGaps`, above. An
      // idea sent STRAIGHT to the stage after the shoot is making both
      // promises in one move, and is asked both.
      const wallFormats = await channelFormatsFor(chansOf({ channels: val('channels') ?? row.channels }), mediaNow)
      const wallType = val('type') ?? row.type
      const filmedNow = !free && (await getCrewNeeds()).operator.includes(wallType) && formatsAllowCrew(wallFormats, 'operator')
      const g = resolved.gates.shoot
      const lands = at(patch.status_id)
      if (filmedNow && g && (lands === g.index || lands === g.index + 1)) {
        const rules = await getTaskFields()
        const on = (k) => fieldOn(rules, k, wallType, wallFormats)
        // …unless the footage is already in hand: the shoot happened, and a
        // booking for it would be a day and an hour invented after the fact.
        if (at(row.status_id) < g.index && !val('shot_link') && !row.shot_at) {
          for (const gap of bookingGaps({
            operatorId: val('operator_id'),
            recording: val('recording_date'), recordingTime: val('recording_time'), recordingEnd: val('recording_end'),
            script: val('script'), scriptAsked: on('script'),
          })) wall(gap.field, gap.error, gap)
        }
        if (lands === g.index + 1) {
          let links = []
          try { links = JSON.parse(val('reference_links') || '[]') } catch { links = [] }
          const referenceReady = hasSubstance(val('reference_text')) || links.length > 0 || !!val('photo')
            || !!(await get('SELECT 1 AS x FROM reference_media WHERE content_id = ?', row.id))
          for (const gap of editGaps({
            referenceReady, tz: val('tz'), editorId: val('editor_id'), release: val('release_date'),
            referenceAsked: on('reference'), tzAsked: on('tz'),
          })) wall(gap.field, gap.error, gap)
        }
      }

      // And the third wall: a piece does not go OUT with nobody's name on it.
      // Everywhere else the ownership check advises, because a task can be
      // moved along while the owner is still being decided. Publishing is the
      // one move after which nobody decides anything: it lands in the reports,
      // in the pay run and in the statistics, and an empty owner column there
      // is a hole nobody can reconstruct a month later. The admin walks
      // through, as they do through every wall — they are usually the one
      // catching the board up on work that already happened.
      if (!free && !ownedBy && (await isFinal(patch.status_id)))
        wall('assignee_ids', 'Give this an owner before it goes out — a published piece with nobody’s name on it is a hole in every report')

      // ---- …and the answer, once ----------------------------------------------
      // The reply is the FIRST wall's, word for word and field for field — the
      // same status, the same `error`, the same `field` or `needs` — because
      // that is what every window on the board reads, and asks about next.
      //
      // The full list rides on a DRY RUN only, as `missing`: one { field,
      // error } per field, in the order the walls ask. A field two walls want
      // — the script the admin demands and the script a booked shoot needs —
      // is one entry, in the words of the first to ask: one box answers both.
      // The dry run is the bulk window's question, and that window is the one
      // place that puts a box beside every answer at once. A real save does
      // not carry it, because the channel board's handover window (StageGate)
      // already reads a key of that name on a refusal — as the ONE field an
      // older refusal named, to reopen on that step — and a list where it
      // expects a name would change what the board does after a refusal. The
      // board is left answering exactly as it always has.
      //
      // An entry about a field that already HOLDS something says so, as
      // `wrong`: the wall is refusing what is there — a script that is only a
      // Docs link, a published link that is not a link — not asking for what
      // is not. The bulk window asks for an empty field in the reader's own
      // words ("Needs «Script»"), and beside a script the task already has,
      // those words would be the one thing on the row that is not true.
      if (walls.length) {
        const holding = (f) => { const v = val(f); return v != null && String(v).trim() !== '' }
        const missing = walls.filter((w, i) => walls.findIndex((x) => x.field === w.field) === i)
          .map(({ field, error }) => ({ field, error, ...(holding(field) ? { wrong: true } : {}) }))
        return res.status(400).json({ ...walls[0].reply, ...(req.query.dry === '1' ? { missing } : {}) })
      }
    }
  }

  // The handover clocks. Crossing a gate stops the previous stage's clock for
  // good — stamped once, never rewritten, so a card dragged back and forth
  // keeps the moment the work actually arrived.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id) {
    const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
    const resolved = resolveGates(statuses)
    const at = (id) => resolved.ordered.findIndex((s) => s.id === id)
    const target = at(patch.status_id)
    const from = at(row.status_id)
    for (const [gateKey, stamp] of STAMP_GATES) {
      const g = resolved.gates[gateKey]
      // Only a move that CROSSES the gate writes its clock. A card that was
      // already past it when it lost (or never had) its stamp is not handing
      // anything over now — stamping it would date the shoot with the moment
      // the editor finished, or the cut with the moment somebody published.
      // Left empty, the phase reads as done on time (phaseState), and the
      // report credits it on the day it was due — which is the truth as far
      // as anybody wrote it down. See STAMP_GATES in deadlines.js.
      if (g && from < g.index && target >= g.index && !row[stamp]) patch[stamp] = new Date().toISOString()
    }

    // The re-promise. When the stage being handed over finished after its
    // own deadline, the next owner cannot inherit a date that is already
    // gone. Rather than stand in the way, the re-promise writes itself: the
    // work reached the next person TODAY. The original deadline is untouched
    // beside it, and the change goes into the paper trail like any other.
    // Naming a date by hand still wins.
    //
    // Here, beside the clocks, because it is the same event — a gate being
    // crossed — and it used to sit inside the handover gates, which the
    // crew's own tick skips: the commonest handover on the board (the
    // operator's «Shot») was the one that never wrote it.
    //
    // And only when the day the next owner inherits really IS gone. A shoot
    // handed over a day late with the cut due next week leaves the editor's
    // promise standing; writing today over it pulled their deadline EARLIER.
    const today = dayISO()
    const val = (f) => (patch[f] !== undefined ? patch[f] : row[f])
    for (const h of [
      { gate: 'edit', ran: 'recording_date', owes: 'edit_ready_date', revise: 'edit_due_revised' },
      { gate: 'review', ran: 'edit_ready_date', owes: 'release_date', revise: 'review_due_revised' },
    ]) {
      const g = resolved.gates[h.gate]
      if (!g || !(from < g.index && target >= g.index)) continue   // not crossing this gate
      if (!val(h.ran) || today <= val(h.ran)) continue             // the handover is on time
      if (!val(h.revise) && val(h.owes) && val(h.owes) < today) patch[h.revise] = today
    }
  }

  // The videographer's clock: the first time the cut reaches a ready-or-later
  // stage (or the task completes), stamp ready_at — the proof the edit was
  // (or wasn't) ready by its edit_ready_date deadline.
  if (!row.ready_at && (patch.status_id !== undefined || patch.done_at)) {
    const st = await get('SELECT label, is_final FROM statuses WHERE id = ?', nextStatus)
    if (patch.done_at || (st && (st.is_final || /ready|approv|posted|got/i.test(st.label))))
      patch.ready_at = new Date().toISOString()
  }

  // ---- a dry run stops here ----------------------------------------------
  // Everything above is a check or a calculation; everything below writes.
  // `?dry=1` answers "would this save go through?" with the same refusals
  // a real save gets, and changes nothing — the bulk stage mover asks it
  // about every task before moving any, so the rules are never guessed at in
  // the browser. (A hand-in's milestone is not dry-run: its last check sits
  // beside the write that resolves the change request.)
  if (req.query.dry === '1' && !body.milestone) return res.json({ ok: true, dry: true })

  // ---- handing in over a change request ----
  // When changes were asked of this hat, handing the work in again IS the
  // fix — that is what the person pressing it means. The tick used to move the
  // piece to Ready and leave the request open, and the reviewer then found
  // Publish refused over "changes still outstanding" for a fix that was sitting
  // right there. So the hand-in closes the round it answers, exactly as the
  // fix button does — and, exactly like it, not with the file that was sent
  // back. "The file that was sent back" is the one the newest open round
  // recorded, so a designer who saved the new link first and pressed the
  // button second is handing in, not refused. An admin catching the board up
  // without a new file is left alone, as with the file rule; with one, the
  // round is answered like anybody's.
  let closedRounds = null   // { ids, at }: what Undo opens again
  if (openRounds.length && roundFresh) {
    closedRounds = { ids: openRounds.map((r) => r.id), at: new Date().toISOString() }
    await run(`UPDATE revisions SET resolved_at = ?, fixed_link = ?, resolved_by = ?, resolved_name = ? WHERE id IN (${closedRounds.ids.map(() => '?').join(', ')})`,
      closedRounds.at, roundLink, req.user.id, req.user.name || '', ...closedRounds.ids)
  }

  // The ten-second regret. Before a stage move lands, photograph what the task
  // was: everything the move is about to rewrite, plus the channels and type
  // the plan counters were keyed on. One row per task — a second move makes
  // the first unundoable, which is the honest behaviour.
  // …and before a hand-in that is HELD lands, too: nothing moved, but the
  // shoot was stamped and the footage written, and the person who pressed it
  // has the same ten seconds to take it back.
  if ((patch.status_id !== undefined && patch.status_id !== row.status_id) || heldFor.length) {
    const before = {}
    for (const f of UNDO_FIELDS) before[f] = row[f] ?? null
    before.channels = row.channels
    before.type = row.type
    // The change round this hand-in closed: taken back, the fix is owed again.
    if (closedRounds) before.reopen = closedRounds
    await run(
      `INSERT INTO undo_moves (content_id, user_id, before, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(content_id) DO UPDATE SET user_id = excluded.user_id, before = excluded.before, created_at = excluded.created_at`,
      row.id, req.user.id, JSON.stringify(before), new Date().toISOString())
  }

  const keys = Object.keys(patch)
  await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...keys.map((k) => patch[k]), row.id)
  await logPatch(req.user, row, patch)
  // A repost somebody has edited or moved is theirs now (server/reposts.js).
  await touchRepost(row.id)

  // ---- published: "Also TikTok", "Also Shorts" ----
  // The repost tasks the piece was ticked for, made in this same request —
  // claimed first, so a second publish finds them and makes none. Each is a
  // new task like any other: on the paper trail, and its poster is told.
  if (!row.done_at && patch.done_at) {
    for (const r of await makeReposts(req.user, { ...row, ...patch })) {
      await logEvent(req.user, r.id, r.title, 'created')
      if (r.poster.id) await notifyAssigned(req, r.id, r.title, new Map([[r.poster.id, 'owner']]), dateBit(null, dayISO(1)))
    }
  }

  // ---- finishing the work puts the hand down ----
  // A hand says "this will be late" or "I cannot take this on". Publishing the
  // piece answers both, and nothing was answering them: the board raised its
  // own hand on work that had gone quiet, the work then went out, and the hand
  // stayed up — a finished piece reading "The board says this will be late"
  // on its own card, and sitting in the planners' queue of problems for ever.
  //
  // Every hand, not only the board's: a person's "I cannot take this on" is
  // just as answered by the thing being done. Cleared by the board rather than
  // by whoever happened to press Publish, because it is the completion that
  // answers it, not them.
  if (!row.done_at && patch.done_at) {
    await run(
      `UPDATE task_flags SET cleared_at = ?, cleared_by = NULL, cleared_name = ?
       WHERE content_id = ? AND cleared_at IS NULL`,
      patch.done_at, 'The board — finished', row.id)
    // And the same for a day nobody ever answered about. "Can we move the
    // release to Friday?" is a question the piece going out has answered —
    // and left open it is an admin being asked for ever to decide a date on
    // work that is finished. Dropped rather than approved: nothing moves, the
    // ask keeps its reason, and the task shows why it was never decided.
    await run(
      `UPDATE date_requests SET state = 'stale', decided_by = NULL, decided_name = ?, decided_at = ?, decided_note = ?
       WHERE content_id = ? AND state = 'open'`,
      'The board — finished', patch.done_at, 'the piece went out before this was answered', row.id)
  }

  // People just handed a hat hear about it — only the NEW names, never the
  // ones already on the task, never the assigner.
  {
    const roles = new Map()
    for (const { f, role } of [
      { f: 'operator_id', role: 'operator' }, { f: 'editor_id', role: 'editor' }, { f: 'designer_id', role: 'designer' },
    ]) if (patch[f] !== undefined && patch[f] && patch[f] !== row[f]) addRole(roles, patch[f], role)
    if (patch.assignees !== undefined) {
      const before = new Set(assigneesOf(row))
      for (const id of JSON.parse(patch.assignees)) if (!before.has(id)) addRole(roles, id, 'owner')
    }
    if (roles.size) {
      const rec = patch.recording_date !== undefined ? patch.recording_date : row.recording_date
      const rel = patch.release_date !== undefined ? patch.release_date : row.release_date
      await notifyAssigned(req, row.id, row.title, roles, dateBit(rec, rel))
    }
  }

  // ---- and the booking asks its question ----
  // A slot that is now complete and unanswered goes to whoever has to answer
  // it. Sent when the booking actually CHANGED, not on every save, or a
  // person would be asked the same question every time somebody edited the
  // title of a task they are on.
  {
    const after = { ...row, ...patch }
    for (const which of Object.keys(BOOKINGS)) {
      const b = BOOKINGS[which]
      const moved = [b.day, b.from, b.to, b.holder].filter(Boolean)
        .some((f) => patch[f] !== undefined && String(patch[f] ?? '') !== String(row[f] ?? ''))
      if (!moved || !bookedOn(after, which) || after[b.ack]) continue
      const who = after[b.holder]
      if (!who || who === req.user.id) continue
      const line = `Can you make ${b.what} on ${slotWords(after, which)}?`
      await run(
        'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
        who, 'confirm', `${line} · «${after.title}»`, row.id, new Date().toISOString())
      await tgMirror([who],
        `🗓 <b>«${tgEsc(after.title)}»</b>\n${tgEsc(line)}\nOpen the task and say yes or no 👇`,
        row.id, tgOriginFrom(req), { kind: 'assigned', actor: req.user.id }).catch(() => {})
    }
  }

  // The bell rings for everyone on the task except whoever moved it: a
  // status change is news to the rest of the crew, not to its author. A move
  // onto Ready is ALSO the reviewers' cue — the reviewers named on the task
  // (or, with none named, the channel's admins and publishing SMMs) hear it
  // too, cut link in hand, so "the edit is done" never has to be discovered
  // by accident.
  //
  // Telegram is not the bell (the diet — see TG_KINDS in telegram.js). A card
  // dragged from stage to stage, one at a time or ten in a bulk move, is
  // silent there. What reaches a phone is a HAND-IN: the crew's milestone, or
  // a delivery link arriving with the move — the cut or artwork to the
  // reviewers (announceReady), the footage to the editor who cuts it.
  if (patch.status_id !== undefined && patch.status_id !== row.status_id) {
    const newSt = await get('SELECT label, is_final FROM statuses WHERE id = ?', patch.status_id)
    const people = crewOf(row, req.user.id)
    const isReady = !!newSt && /^ready$/i.test(newSt.label)
    const handedIn = !!body.milestone || ['ready_link', 'design_link', 'shot_link']
      .some((f) => patch[f] && String(patch[f]) !== String(row[f] ?? ''))
    // Onto Ready: the reviewers' cue, said by the one voice every road to
    // Ready shares (announceReady).
    if (isReady) await announceReady(req, { ...row, ...patch }, people, { delivered: handedIn })
    const recipients = isReady ? [] : people
    if (recipients.length && newSt) {
      const now = new Date().toISOString()
      const line = `«${row.title}» → ${newSt.label} — by ${req.user.name}`
      await batch(recipients.map((id) => [
        'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
        id, 'status', line, row.id, now,
      ]))
    }
    // Footage handed in: the editor is the one who starts from it.
    const footage = patch.shot_link !== undefined ? patch.shot_link : row.shot_link
    const cutter = patch.editor_id !== undefined ? patch.editor_id : row.editor_id
    if (handedIn && !isReady && newSt && !newSt.is_final && cutter
      && (body.milestone === 'shot' || (patch.shot_link && String(patch.shot_link) !== String(row.shot_link ?? '')))) {
      await tgMirror([cutter], (lang) => {
        const w = tgWords(lang)
        const watch = footage && /^https?:\/\//i.test(footage) ? `\n▶️ <a href="${tgEsc(footage)}">${w.watch}</a>` : ''
        return `${w.footage(`<b>«${tgEsc(row.title)}»</b>`)}\n${w.by(tgEsc(req.user.name))}${watch}\n${w.footageNext}`
      }, row.id, tgOriginFrom(req), { kind: 'delivered', actor: req.user.id })
    }
  }

  // ---- footage is in, and it waits for its owner ----
  // Said once, when the shoot is first stamped — a second press of the same
  // hand-in tells nobody again. The bell says what to add; the phone gets it
  // too, because this hand-in is waiting on a person (the diet: `delivered`).
  if (heldFor.length && patch.shot_at) {
    const owners = [...new Set([...assigneesOf(row), row.assignee_id].filter((id) => id && id !== req.user.id))]
    const need = heldFor.length === 2 ? 'the TZ and who edits' : heldFor[0] === 'tz' ? 'the TZ' : 'who edits'
    const footage = patch.shot_link !== undefined ? patch.shot_link : row.shot_link
    const now = new Date().toISOString()
    if (owners.length) await batch(owners.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, 'status', `Footage is in — add ${need} · «${row.title}»`, row.id, now,
    ]))
    await tgMirror(owners, (lang) => {
      const w = tgWords(lang)
      const watch = footage && /^https?:\/\//i.test(footage) ? `\n▶️ <a href="${tgEsc(footage)}">${w.watch}</a>` : ''
      return `${w.footage(`<b>«${tgEsc(row.title)}»</b>`)}\n${w.by(tgEsc(req.user.name))}${watch}\n${w.footageHeld}`
    }, row.id, tgOriginFrom(req), { kind: 'delivered', actor: req.user.id })
  }

  // A card moving on the kanban counts as activity for its campaign's project.
  const activityCampaign = patch.campaign_id !== undefined ? patch.campaign_id : row.campaign_id
  if (activityCampaign && (patch.status_id !== undefined || patch.done_at !== undefined || patch.campaign_id !== undefined))
    await bumpProjectOfCampaign(activityCampaign)
  if (patch.photo_media_id !== undefined && !patch.photo) await mirrorFirstPhoto(row.id)

  res.json(await answer())
}))

// ---- what a move is going to ask for ---------------------------------------
// The board asks this BEFORE it moves anything, so the handover window can
// open on the move itself rather than after a refusal. It answers with the
// gates the move crosses, who is eligible to take each one — the editing
// stage offers editors, not the whole company — and whether the handover is
// running late enough to need a fresh promise. The rules live here, once.
// ---- answering a booking ---------------------------------------------------
// The operator says whether they can be there; the editor says whether the
// deadline fits. Only the person actually holding it may answer — an admin
// answering on their behalf would put the board back exactly where it was,
// with a date nobody had agreed to.
//
// "No" is not a refusal to work: it is the earliest possible warning that the
// plan needs another look, and it carries a reason so the planner can re-book
// rather than guess.
router.post('/:id/confirm', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const which = String(req.body?.which || '')
  const b = BOOKINGS[which]
  if (!b) return res.status(400).json({ error: 'Answer about the shoot or the edit' })
  if (!bookedOn(row, which)) {
    return res.status(400).json({ error: `Nothing is booked yet — ${b.what} needs its ${b.role} and a day first` })
  }
  if (row[b.holder] !== req.user.id) {
    return res.status(403).json({ error: `Only the ${b.role} on this task can answer for ${b.what}` })
  }
  const ok = req.body?.ok !== false
  const note = String(req.body?.note ?? '').trim().slice(0, 400)
  if (!ok && !note) return res.status(400).json({ error: 'Say what is in the way — a no with no reason cannot be planned around' })
  // A "no" is not the end of a sentence any more. It says what happens next:
  // either another time this person CAN do — which becomes a request the
  // planner answers with one press, like any other moved day — or that they
  // cannot take this one at all, in which case the seat is emptied on the
  // spot and the task is back in the pool for somebody else, rather than
  // sitting under a name that has already said no.
  const suggest = !ok && req.body?.suggest && typeof req.body.suggest === 'object' ? req.body.suggest : null
  const release = !ok && req.body?.release === true
  const suggestDay = suggest ? String(suggest.day || '').slice(0, 10) : null
  if (suggest && !isDay(suggestDay || '')) return res.status(400).json({ error: 'Suggest a day, or hand the task back' })
  // The slot offered is booked by a yes (decideDate), so it is checked like any
  // booking: real times on the quarter-hour grid, an end after the start, and
  // with no end, the length the shoot has now (the review, 14 Oct 2026).
  const realTime = (t) => !!t && Number(t.slice(0, 2)) < 24 && Number(t.slice(3, 5)) < 60
  const offered = (v) => { const t = cleanTime(String(v || '')); return realTime(t) ? t : null }
  const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const suggestFrom = suggest && b.from ? snapSlot(offered(suggest.from)) : null
  let suggestTo = suggestFrom && b.to ? snapSlot(offered(suggest.to), true) : null
  const lengthNow = row.recording_time && row.recording_end ? toMin(cleanTime(row.recording_end)) - toMin(cleanTime(row.recording_time)) : 0
  if (suggestFrom && !suggestTo && lengthNow > 0) suggestTo = snapSlot(clock(Math.min(23 * 60 + 59, toMin(suggestFrom) + lengthNow)), true)
  if (suggestFrom && suggestTo && suggestTo <= suggestFrom) return res.status(400).json({ error: 'The time you offer ends before it starts' })
  // Measured against the day that is LIVE — the re-promise when a late
  // handover wrote one (liveDateField), exactly as POST /:id/date-requests
  // files it. Filed against the original, the admin's yes came back "stale".
  const liveDay = row[liveDateField(row, b.day)]
  if (suggest && suggestDay === liveDay && !suggestFrom) return res.status(400).json({ error: 'That is the day it already has — suggest another, or hand it back' })
  if (suggest && suggestDay === liveDay && suggestFrom === cleanTime(row.recording_time) && (!suggestTo || suggestTo === cleanTime(row.recording_end)))
    return res.status(400).json({ error: 'That is the time it already has — suggest another, or hand it back' })

  const now = new Date().toISOString()
  if (release) {
    // The seat is emptied; the reason stays on the record so the next
    // planner reading the task knows why it came back.
    await run(
      `UPDATE content SET ${b.holder} = NULL, ${b.ack} = '', ${b.at} = NULL, ${b.by} = NULL, ${b.note} = ? WHERE id = ?`,
      note, row.id)
    await run(...actRow(req.user, row.id, row.title, 'updated', b.holder, req.user.name, null, now))
  } else {
    await run(
      `UPDATE content SET ${b.ack} = ?, ${b.at} = ?, ${b.by} = ?, ${b.note} = ? WHERE id = ?`,
      ok ? 'yes' : 'no', now, req.user.id, ok ? null : note, row.id)
    await run(...actRow(req.user, row.id, row.title, 'confirmed', which, row[b.ack] || 'waiting', ok ? 'yes' : 'no', now))
  }
  let askedId = null
  if (suggest) {
    // One open ask per deadline: a second is the same conversation.
    const open = await get("SELECT id FROM date_requests WHERE content_id = ? AND field = ? AND state = 'open'", row.id, b.day)
    if (!open) {
      // The hours offered are kept as hours, so a yes books them (decideDate).
      const info = await run(`
        INSERT INTO date_requests (content_id, field, from_date, to_date, to_time, to_end, reason, state, asked_by, asked_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
      `, row.id, b.day, liveDay, suggestDay, suggestFrom, suggestTo, note, req.user.id, req.user.name || '', now)
      askedId = info.lastInsertRowid
      await run(...actRow(req.user, row.id, row.title, 'updated', 'date_request', liveDay, suggestDay, now))
    }
  }

  // Whoever booked it hears back — and on a hand-back or a suggested day,
  // every admin too, because any of them can fill the seat or move the day.
  const admins = (release || suggest) ? await adminsOn(row) : []
  const tell = [...new Set([row.created_by, ...assigneesOf(row), ...admins])].filter((id) => id && id !== req.user.id)
  if (tell.length) {
    const line = ok
      ? `${req.user.name} confirmed ${b.what} — ${slotWords(row, which)}`
      : release
        ? `${req.user.name} handed back ${b.what} (${slotWords(row, which)}) — it needs a new ${b.role} — “${note}”`
        : suggest
          ? `${req.user.name} can't make ${b.what} (${slotWords(row, which)}) and asks for ${tgDate(suggestDay)}${suggestFrom ? `, ${suggestFrom}${suggestTo ? `-${suggestTo}` : ''}` : ''} — “${note}”`
          : `${req.user.name} can't make ${b.what} (${slotWords(row, which)}) — “${note}”`
    const kind = ok ? 'confirmed' : suggest ? 'date_request' : 'declined'
    await batch(tell.map((id) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      id, kind, `${line} · «${row.title}»`, row.id, now,
    ]))
    // On Telegram the answer goes to the task's OWNER — the person planning
    // around it (spec: booking acknowledgements are critical for scheduling).
    // The creator and the admins have it in the bell.
    const owners = [...new Set([...assigneesOf(row), row.assignee_id].filter(Boolean))]
    await tgMirror(owners,
      `${ok ? '✅' : release ? '↩️' : suggest ? '📅' : '⚠️'} <b>«${tgEsc(row.title)}»</b>\n${tgEsc(line)}${suggest ? '\nSay yes or no on the task 👇' : ''}`,
      row.id, tgOriginFrom(req), { kind: 'assigned', actor: req.user.id })
  }
  res.json({ ...(await listRow(row.id)), ...(askedId ? { date_request_id: askedId } : {}), ...(release ? { released: b.holder } : {}) })
}))

router.get('/:id/handover', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (!canSee(req.user, { ...row, channels: JSON.parse(row.channels || '[]') }))
    return res.status(403).json({ error: 'Not your channel' })

  const to = Number(req.query.to)
  const statuses = await all('SELECT id, label, sort, is_final FROM statuses')
  const resolved = resolveGates(statuses)
  const at = (id) => resolved.ordered.findIndex((s) => s.id === id)
  const forward = at(to) > at(row.status_id) && at(to) >= 0
  if (!forward) return res.json({ gates: [] })
  // The admin is not stopped at a handover gate. Answering "who is cutting
  // this and where is the footage" is the point of the gate for the crew and
  // an interruption for the person dragging four finished pieces onto Ready.
  // Empty gates means the board simply moves the card; see `unfettered`.
  if (unfettered(req.user, JSON.parse(row.channels || '[]'))) return res.json({ gates: [] })

  const team = (await all('SELECT * FROM users')).map(publicUser)
  // Who may wear each hat. The crew hats are declared on the person; review is
  // a permission, because signing work off is an SMM's job, not a craft.
  const eligible = (role) => (role === 'reviewer'
    ? team.filter((u) => u.role === 'admin' || !!u.permissions?.review_publish)
    : team.filter((u) => (u.crew_roles || []).includes(role)))

  const NEEDS = {
    shoot: { owner: 'operator_id', role: 'operator', label: 'shooter', link: null },
    edit: { owner: 'editor_id', role: 'editor', label: 'editor', link: 'shot_link', what: 'the footage' },
    review: { owner: 'reviewer_id', role: 'reviewer', label: 'reviewer', link: 'ready_link', what: 'the edit', many: true },
  }
  const hasFile = !!(await get('SELECT 1 AS x FROM attachments WHERE content_id = ?', row.id))
  const today = dayISO()
  const LATE = {
    edit: { ran: 'recording_date', revise: 'edit_due_revised' },
    review: { ran: 'edit_ready_date', revise: 'review_due_revised' },
  }

  const gates = []
  // Whose piece it is is NOT asked here. Only an admin on the channel may name
  // an owner (PATCH refuses everybody else), and the admin never reaches this
  // line (`unfettered` above) — so an owner step was only ever put to people
  // who would be refused for answering it, and the window looped on the
  // refusal. The one move that needs an owner, publishing, still refuses an
  // ownerless piece in PATCH, with its own sentence.
  for (const g of gatesUpTo(to, resolved)) {
    if (at(row.status_id) >= g.index) continue     // already behind us
    const need = NEEDS[g.key]
    if (!need) continue
    const short = eligible(need.role)
    const late = LATE[g.key]
    const ran = late ? row[late.ran] : null
    gates.push({
      key: g.key,
      stage: g.label,
      role: need.role,
      what: need.label,
      owner_field: need.owner,
      many: !!need.many,
      current: need.many
        ? (() => { try { return JSON.parse(row.reviewers || '[]') } catch { return [] } })()
        : (row[need.owner] ? [row[need.owner]] : []),
      // Strictly the people who hold the hat, and everyone else as a fallback
      // so an empty roster never becomes a dead end.
      candidates: short.map((u) => ({ id: u.id, name: u.name, color: u.color, position: u.position })),
      others: team.filter((u) => !short.some((s) => s.id === u.id))
        .map((u) => ({ id: u.id, name: u.name, color: u.color, position: u.position })),
      link_field: need.link,
      link_ok: need.link ? (!!row[need.link] || hasFile) : true,
      what_link: need.what || null,
      late: late && ran && today > ran ? { was_due: ran, revise_field: late.revise, already: row[late.revise] || null } : null,
    })
  }
  res.json({ gates, to, stage: resolved.ordered.find((s) => s.id === to)?.label || '' })
}))

// ---- undoing the last move -------------------------------------------------
// Ten seconds to take a move back. It restores the stage AND everything the
// move stamped on the way — the handover clocks, the hats it forced you to
// name, the deadline it made you re-promise. The undo itself is logged: taking
// a move back is a move, and the paper trail is the whole point of this.
router.post('/:id/undo', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  // Taking back somebody else's move is a write, and one of the loudest —
  // it restores a stage, the handover clocks and the hats the move forced.
  // worksOn reads channels as a list, and this row came straight off the table.
  if (!worksOn(req.user, { ...row, channels: JSON.parse(row.channels || '[]') }))
    return res.status(403).json({ error: 'Not your channel' })

  // The move being taken back may have been written through another copy of
  // the data a second ago, and this process's copy can lag behind it.
  // Saying "nothing to undo" from a stale copy would eat the very ten seconds
  // this feature promises, so pull the freshest data once before believing it.
  let snap = await get('SELECT * FROM undo_moves WHERE content_id = ?', row.id)
  if (!snap) {
    await resyncStorage().catch(() => {})
    snap = await get('SELECT * FROM undo_moves WHERE content_id = ?', row.id)
  }
  if (!snap) return res.status(404).json({ error: 'There is nothing to undo on this task' })

  const age = (Date.now() - Date.parse(snap.created_at)) / 1000
  if (age > UNDO_SECONDS) {
    await run('DELETE FROM undo_moves WHERE content_id = ?', row.id)
    return res.status(409).json({ error: 'Too late to undo that — the move is on the record now' })
  }
  // Your own regret, or an admin's. Undoing somebody else's move would be a
  // way to move their work without it looking like a move.
  if (snap.user_id !== req.user.id && !adminHere(req.user, await get('SELECT channels FROM content WHERE id = ?', snap.content_id)))
    return res.status(403).json({ error: 'Only whoever made that move can take it back' })

  let before
  try { before = JSON.parse(snap.before) } catch { before = null }
  if (!before) return res.status(409).json({ error: 'That move can no longer be read back' })

  // The move MADE this task — an ambassador's video handed to an editor
  // (ambassadorEditTask, below). Taking it back takes the task away whole,
  // and the video reads as new again on the Ambassadors calendar.
  if (before.born) {
    await logEvent(req.user, row.id, row.title, 'deleted')
    await batch(taskChildDeletes(row.id))
    await run('DELETE FROM content WHERE id = ?', row.id)
    return res.json({ ok: true, id: row.id, gone: true })
  }

  const keys = UNDO_FIELDS.filter((f) => f in before)
  await run(`UPDATE content SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`,
    ...keys.map((k) => before[k]), row.id)
  // A hand-in that answered a change request closed its round; taking the
  // hand-in back opens it again — the rejected cut cannot slip back through
  // (the bug hunt, 14 Oct 2026). Only a round still closed by that very press.
  if (before.reopen?.ids?.length)
    await run(`UPDATE revisions SET resolved_at = NULL, fixed_link = NULL, resolved_by = NULL, resolved_name = '' WHERE content_id = ? AND resolved_at = ? AND id IN (${before.reopen.ids.map(() => '?').join(', ')})`,
      row.id, before.reopen.at, ...before.reopen.ids)

  const two = await all('SELECT id, label FROM statuses WHERE id IN (?, ?)', row.status_id ?? 0, before.status_id ?? 0)
  const lab = (id) => two.find((s) => s.id === id)?.label || null
  await run(...actRow(req.user, row.id, row.title, 'updated', 'stage undone',
    lab(row.status_id), lab(before.status_id), new Date().toISOString()))

  // The move being taken back may have FINISHED the piece, and finishing put
  // every hand down and dropped every open ask (see "finishing the work puts
  // the hand down"). Un-finishing brings back exactly those — the ones the
  // board closed at that very moment, never one a person answered.
  if (row.done_at && !before.done_at) {
    await run("UPDATE task_flags SET cleared_at = NULL, cleared_name = '' WHERE content_id = ? AND cleared_by IS NULL AND cleared_at = ?",
      row.id, row.done_at)
    await run("UPDATE date_requests SET state = 'open', decided_name = '', decided_at = NULL, decided_note = '' WHERE content_id = ? AND state = 'stale' AND decided_by IS NULL AND decided_at = ?",
      row.id, row.done_at)
    // …and the repost tasks the publish made, the ones nobody has touched yet.
    // A touched one is somebody's work and stays (server/reposts.js).
    for (const r of await dropUntouched(row.id)) await logEvent(req.user, r.id, r.title, 'deleted')
  }

  await run('DELETE FROM undo_moves WHERE content_id = ?', row.id)
  if (row.campaign_id) await bumpProjectOfCampaign(row.campaign_id)
  res.json(await listRow(row.id))
}))

router.delete('/:id', wrap(async (req, res) => {
  const row = await get('SELECT * FROM content WHERE id = ?', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const allowed = adminHere(req.user, row) || (can(req.user, 'manage_content') && canTouch(req.user, row))
  if (!allowed) return res.status(403).json({ error: 'You don’t have permission to delete this' })
  await logEvent(req.user, row.id, row.title, 'deleted')
  // Everything the task was carrying goes with it. This used to take only the
  // attachments, which left the heaviest rows in the database behind for good:
  // a voice note and a Pravki screenshot are base64 blobs, and they were
  // surviving the task they belonged to with nothing left to reach them by.
  //
  // The paper trail is the deliberate exception. Activity rows write down
  // names and titles at the moment of the change precisely so the log still
  // reads like a sentence after the task is gone.
  const files = await all('SELECT file FROM reference_media WHERE content_id = ? AND file IS NOT NULL', row.id)
  await batch(taskChildDeletes(row.id))
  await run('DELETE FROM content WHERE id = ?', row.id)
  for (const f of files) await dropMediaFiles(f.file)
  res.json({ ok: true })
}))

// ---- the ambassador's window onto the board ----------------------------------
// An ambassador is not staff: the gate in auth.js keeps them off every route
// in this file, and that does not change. But a task can be GIVEN to one — an
// admin adds them as its owner — and then they have to be able to read what
// to film and say when the footage is in. These three functions are that, and
// nothing more; the ambassador's own router (routes/ambassadors.js) calls
// them, so the content table is still only ever touched from here.
//
// "Theirs" is ownership: assignee_id, or a seat in `assignees`. Not Deleted,
// and not finished.
const ownedBy = (row, userId) => row.assignee_id === userId || assigneesOf(row).includes(userId)
// One task, by the same rule the list is built with: theirs, not finished,
// and not in the Deleted graveyard.
const stillTheirs = async (row, userId) => !!row && ownedBy(row, userId) && !row.done_at
  && !(await get("SELECT 1 AS x FROM statuses WHERE id = ? AND LOWER(label) = 'deleted'", row.status_id))

export async function ambassadorTasks(userId) {
  const rows = (await all(`
    SELECT c.id, c.title, c.type, c.channels, c.assignee_id, c.assignees, c.editor_id, c.status_id,
      c.recording_date, c.recording_time, c.edit_ready_date, c.release_date, c.shot_link,
      c.tz, c.script, c.reference_text, c.reference_links,
      CASE WHEN c.photo IS NULL THEN 0 ELSE 1 END AS has_photo
    FROM content c
    WHERE c.done_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.id = c.status_id AND LOWER(s.label) = 'deleted')`))
    .filter((r) => ownedBy(r, userId))
  const editors = new Map((await all('SELECT id, name FROM users')).map((u) => [u.id, u.name]))
  return rows.map((r) => ({
    id: r.id, title: r.title, type: r.type,
    recording_date: r.recording_date || null, recording_time: r.recording_time || null,
    // The cut's day means something once somebody is cutting. With no editor
    // on the task it is a wish, and the page says TBD rather than a date
    // nobody has agreed to.
    editor: r.editor_id ? (editors.get(r.editor_id) || null) : null,
    edit_ready_date: r.editor_id ? (r.edit_ready_date || null) : null,
    shot_link: r.shot_link || '',
    has_brief: !!(r.tz || r.script || r.reference_text || parseLinks(r.reference_links).length || r.has_photo),
  })).sort((a, b) => String(a.recording_date || '9999').localeCompare(String(b.recording_date || '9999')) || a.id - b.id)
}

// The brief, and only the brief: what to film (ТЗ, script) and what it should
// look like (the reference in words, links and pictures). No stage, no crew
// pickers, no pipeline — and nothing here can be written back.
export async function ambassadorBrief(userId, id) {
  const row = await get('SELECT * FROM content WHERE id = ?', id)
  if (!(await stillTheirs(row, userId))) return null
  const album = parsePhotos(row.reference_photos)
  const editor = row.editor_id ? (await get('SELECT name FROM users WHERE id = ?', row.editor_id))?.name || null : null
  return {
    id: row.id, title: row.title, type: row.type,
    recording_date: row.recording_date || null, recording_time: row.recording_time || null,
    editor, edit_ready_date: row.editor_id ? (row.edit_ready_date || null) : null,
    tz: row.tz || '', script: row.script || '', reference_text: row.reference_text || '',
    reference_links: parseLinks(row.reference_links),
    reference_photos: album.length ? album : (row.photo ? [{ photo: row.photo, thumb: row.photo_thumb || null }] : []),
    shot_link: row.shot_link || '',
  }
}

// The ambassador's hand-in: where the footage is, saved as they wrote it.
//
// THE BYPASS, on purpose. The crew's hand-in (PATCH /:id with a milestone) is
// held to the stage gates, wants a real link, and moves the card. None of
// that is asked here: a student is not made to argue with a pipeline they
// cannot see, so a file name is taken as readily as a URL — the editor or the
// reviewer chases it if it is not enough — and the stage does not move,
// because moving stages is not an ambassador's to do. Staff are held exactly
// as strictly as before; this is reachable only from the ambassador's router,
// and only for a task that is theirs.
export async function ambassadorFootage(req, id, link) {
  const row = await get('SELECT * FROM content WHERE id = ?', id)
  if (!(await stillTheirs(row, req.user.id))) return { status: 404, error: 'Not found' }
  const text = String(link ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!text) return { status: 400, error: 'Paste the link to your footage, or the name of the file' }
  const now = new Date().toISOString()
  await run('UPDATE content SET shot_link = ? WHERE id = ?', text, row.id)
  await run(...actRow(req.user, row.id, row.title, 'updated', 'shot_link', row.shot_link ?? null, text, now))
  // The bell for everybody else holding the task; the phone for the editor,
  // who is the one that starts from it (the Telegram diet: footage → editor).
  const others = crewOf(row, req.user.id)
  if (others.length) {
    await batch(others.map((uid) => [
      'INSERT INTO notifications (user_id, kind, text, content_id, created_at) VALUES (?, ?, ?, ?, ?)',
      uid, 'status', `${req.user.name} handed in the footage for «${row.title}»`, row.id, now,
    ]))
  }
  if (row.editor_id) {
    await tgMirror([row.editor_id], (lang) => {
      const w = tgWords(lang)
      const watch = /^https?:\/\//i.test(text) ? `\n▶️ <a href="${tgEsc(text)}">${w.watch}</a>` : `\n${tgEsc(text)}`
      return `${w.footage(`<b>«${tgEsc(row.title)}»</b>`)}\n${w.by(tgEsc(req.user.name))}${watch}\n${w.footageNext}`
    }, row.id, tgOriginFrom(req), { kind: 'delivered', actor: req.user.id })
  }
  return { status: 200, task: (await ambassadorTasks(req.user.id)).find((t) => t.id === row.id) || null }
}

// ---- an ambassador's video, handed to an editor (the Ambassadors calendar) -----
// Two presses on the calendar make an ORDINARY task: on the channel the admin
// picked, at Editing, the editor seated, the video as its footage (the link as
// the ambassador sent it — never downloaded), the cut due two days out (the
// task builder's rule for a cut whose footage is in and whose release is not
// set yet), and the admin who pressed as its owner, as for any task an admin
// makes. Everything after that is the board's: the editor's bell and Telegram,
// their day, the late warnings, pay and the reports.
//
// The ambassador is named in the title and the description and is NOT seated
// in a hat. Every hat is paid by the pay run, and an ambassador is paid the
// card's agreed amount by the programme: a seat would pay them twice.
//
// Ten seconds to take it back, through the board's own POST /:id/undo: the
// snapshot says this move MADE the task (`born`), so the undo deletes it.

// Who can cut on which channel: the channels a video is edited for, each with
// the people who wear the editor's hat and work on it (crew_channels empty =
// every channel). The calendar draws one button per name; the press is held to
// the same list.
export async function ambassadorEditors() {
  const team = (await all("SELECT * FROM users WHERE role <> 'ambassador' ORDER BY name")).map(publicUser)
    .filter((u) => u.crew_roles.includes('editor'))
  return (await all('SELECT key, label, format FROM channels ORDER BY sort, id'))
    .filter((c) => formatsAllowCrew([formatOf(c)], 'editor'))
    .map((c) => ({
      key: c.key, label: c.label,
      editors: team.filter((u) => !u.crew_channels.length || u.crew_channels.includes(c.key)).map((u) => ({ id: u.id, name: u.name })),
    }))
}

// What became of the tasks made from videos, by id — the calendar's card reads
// its state here (with an editor, or out) and nothing is kept beside it. A
// task that is gone, or in the Deleted graveyard, is no task.
export async function ambassadorVideoTasks(ids) {
  const list = [...new Set(ids.map(Number).filter((n) => n > 0))]
  if (!list.length) return new Map()
  const rows = await all(`SELECT c.id, c.title, c.channels, c.done_at, c.created_at, s.label AS stage, u.name AS editor
    FROM content c LEFT JOIN statuses s ON s.id = c.status_id LEFT JOIN users u ON u.id = c.editor_id
    WHERE c.id IN (${list.map(() => '?').join(',')})`, ...list)
  const label = new Map((await all('SELECT key, label FROM channels')).map((c) => [c.key, c.label]))
  return new Map(rows.filter((r) => !/^deleted$/i.test(String(r.stage || ''))).map((r) => [r.id, {
    id: r.id, title: r.title, editor: r.editor || '', channel: label.get(chansOf(r)[0]) || '', stage: r.stage || '',
    done: !!r.done_at, created_at: r.created_at,
  }]))
}

const VIDEO_TYPE = { video: 'video', ads: 'target' }   // a social channel's video is a reel
export async function ambassadorEditTask(req, { channel, editorId, title, link, description }) {
  const chans = await ambassadorEditors()
  const ch = chans.find((c) => c.key === channel)
  if (!ch) return { status: 400, error: 'Pick a channel whose videos are edited' }
  if (!isAdminOn(req.user, [ch.key])) return { status: 403, error: `Only an admin of ${ch.label} can hand work out on it` }
  const ed = ch.editors.find((u) => u.id === Number(editorId))
  if (!ed) return { status: 400, error: `Pick somebody who edits on ${ch.label}` }
  const edit = resolveGates(await all('SELECT id, label, sort, is_final FROM statuses')).gates.edit
  if (!edit) return { status: 409, error: 'The board has no Editing stage to put it on' }
  const due = dayISO(2)
  const capped = await capProblem('editor_id', ed.id, due)
  if (capped) return { status: 409, error: capped }
  const now = new Date().toISOString()
  const fmt = formatOf((await get('SELECT format FROM channels WHERE key = ?', ch.key)))
  const sort = (await get('SELECT COALESCE(MAX(todo_sort), -1) AS m FROM content')).m + 1
  const info = await run(`INSERT INTO content (title, channels, type, assignee_id, assignees, created_by, status_id, editor_id,
      edit_ready_date, shot_link, shot_at, description, todo_sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  title, JSON.stringify([ch.key]), VIDEO_TYPE[fmt] || 'reel', req.user.id, JSON.stringify([req.user.id]), req.user.id,
  edit.id, ed.id, due, link, now, description, sort, now)
  const id = Number(info.lastInsertRowid)
  await run(`INSERT INTO undo_moves (content_id, user_id, before, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(content_id) DO UPDATE SET user_id = excluded.user_id, before = excluded.before, created_at = excluded.created_at`,
  id, req.user.id, JSON.stringify({ born: true }), now)
  await logEvent(req.user, id, title, 'created')
  await notifyAssigned(req, id, title, new Map([[ed.id, 'editor']]), ` · edit due ${tgDate(due)}`)
  return { status: 201, id, editor: ed.name, channel: ch.label }
}

export default router

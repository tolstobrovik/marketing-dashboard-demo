import { Router } from 'express'
import { randomBytes } from 'crypto'
import { all, get, run, dayISO } from '../db.js'
import { authRequired, wrap } from '../auth.js'
import { tgPublicUrl } from '../telegram.js'

// ---- a person's work in their phone's calendar (the owner, 13 Oct: "members'
// tasks go to Apple Calendar, automatically") ---------------------------------
//
// One private address per person, an iCalendar feed. Apple Calendar (iPhone,
// iPad, Mac) subscribes to it once and asks again by itself every so often, so
// a shoot booked or moved on the board turns up on the phone with nobody
// copying anything. Google Calendar and Outlook take the same address.
//
// The address IS the key: a calendar app cannot sign in, so whoever holds the
// link can read the titles and days of that person's work — nothing else, and
// nothing about anybody else. A new link (the button under Profile) kills the
// old one. The token is in its own table so it never rides along with a user
// row (publicUser, the Team page, the data exports).
//
// What lands in it, for the person asking:
//   a shoot      they film it (operator) or it is their piece — its hours, or
//                the whole day when no hours were set; a request nobody has
//                said yes to yet is "tentative"
//   an edit      they edit it — the day it is due
//   a design     they design it — the day it is due
//   goes out     their piece (or a review they share) — the release day/hour
// A finished part stays, marked ✓, so the calendar still tells the week as
// it was. Deleted pieces leave; anything older than two months is not sent.

const router = Router()

const TZ_OFFSET_H = 5 // Asia/Tashkent: UTC+5 all year, no summer time
const KEEP_DAYS = 60

const WORDS = {
  en: { shoot: 'Shoot', edit: 'Edit due', design: 'Design due', out: 'Goes out', cant: 'you said you can’t', ask: 'not confirmed yet', open: 'Open on the board', cal: 'SATashkent tasks' },
  ru: { shoot: 'Съёмка', edit: 'Монтаж до', design: 'Дизайн до', out: 'Публикация', cant: 'вы ответили, что не можете', ask: 'ещё не подтверждено', open: 'Открыть на доске', cal: 'Задачи SATashkent' },
  uz: { shoot: 'Syomka', edit: 'Montaj muddati', design: 'Dizayn muddati', out: 'Chiqish kuni', cant: 'siz qila olmasligingizni aytdingiz', ask: 'hali tasdiqlanmagan', open: 'Doskada ochish', cal: 'SATashkent vazifalari' },
}

const newToken = () => randomBytes(24).toString('base64url')
const feedPath = (token) => `/api/calendar/feed/${token}.ics`

// ---- iCalendar text ----------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
// Lines longer than 75 octets are folded (RFC 5545 §3.1) — on characters, so a
// Cyrillic or Uzbek letter is never cut in half.
function fold(line) {
  const out = []
  let cur = '', bytes = 0
  for (const ch of line) {
    const b = Buffer.byteLength(ch)
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch; bytes += b
  }
  out.push(cur)
  return out.join('\r\n ')
}
const ymd = (d) => d.replace(/-/g, '')
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const stampOf = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const HHMM = /^(\d{1,2}):(\d{2})/
// A Tashkent wall-clock time as UTC, which every calendar app reads the same.
function utcOf(day, hhmm) {
  const m = HHMM.exec(String(hhmm || ''))
  if (!m) return null
  return new Date(Date.parse(`${day}T00:00:00Z`) + ((+m[1] - TZ_OFFSET_H) * 60 + +m[2]) * 60000)
}
const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null)
const ids = (json) => { try { return (JSON.parse(json || '[]') || []).map(Number).filter(Boolean) } catch { return [] } }

export function buildFeed({ user, rows, channelLabels, origin, now = new Date(), today = dayISO() }) {
  const w = WORDS[user.lang] || WORDS.en
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * 86400000).toISOString().slice(0, 10)
  const me = Number(user.id)
  const stamp = stampOf(now)
  const events = []
  const add = (r, kind, title, day, { start, end, tentative, done, note } = {}) => {
    if (!day || day < from) return
    let chans = []
    try { chans = JSON.parse(r.channels || '[]') || [] } catch { /* no channel line */ }
    const where = chans.map((k) => channelLabels[k] || k).join(', ')
    const link = origin ? `${origin}/brief?task=${r.id}` : ''
    const desc = [note, where, link && `${w.open}: ${link}`].filter(Boolean).join('\n')
    const ev = ['BEGIN:VEVENT', `UID:task-${r.id}-${kind}@satashkent-dashboard`, `DTSTAMP:${stamp}`]
    if (start) {
      ev.push(`DTSTART:${stampOf(start)}`, `DTEND:${stampOf(end && end > start ? end : new Date(+start + 3600000))}`)
    } else {
      ev.push(`DTSTART;VALUE=DATE:${ymd(day)}`, `DTEND;VALUE=DATE:${ymd(nextDay(day))}`)
    }
    ev.push(`SUMMARY:${esc(`${done ? '✓ ' : ''}${title} · ${r.title}`)}`)
    if (desc) ev.push(`DESCRIPTION:${esc(desc)}`)
    if (link) ev.push(`URL:${esc(link)}`)
    ev.push(`STATUS:${tentative ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:' + (start ? 'OPAQUE' : 'TRANSPARENT'))
    // A shoot rings an hour before; days with no hour stay quiet.
    if (start && !done) ev.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${title} · ${r.title}`)}`, 'TRIGGER:-PT1H', 'END:VALARM')
    ev.push('END:VEVENT')
    events.push(...ev)
  }

  for (const r of rows) {
    const makers = new Set([Number(r.assignee_id), ...ids(r.assignees)].filter(Boolean))
    const reviewers = new Set([Number(r.reviewer_id), ...ids(r.reviewers)].filter(Boolean))
    const mine = makers.has(me)
    const shootDay = dayOf(r.recording_date)
    if (shootDay && (Number(r.operator_id) === me || mine)) {
      const start = utcOf(shootDay, r.recording_time)
      const ack = String(r.shoot_ack || '')
      const filmer = Number(r.operator_id) === me
      add(r, 'shoot', w.shoot, shootDay, {
        start, end: start && utcOf(shootDay, r.recording_end),
        tentative: ack !== 'yes', done: !!r.shot_at,
        note: ack === 'no' && filmer ? w.cant : (ack !== 'yes' && !r.shot_at ? w.ask : ''),
      })
    }
    if (Number(r.editor_id) === me) {
      add(r, 'edit', w.edit, dayOf(r.edit_due_revised) || dayOf(r.edit_ready_date), { done: !!(r.edited_at || r.ready_at) })
    }
    if (Number(r.designer_id) === me) {
      add(r, 'design', w.design, dayOf(r.design_ready_date), { done: !!r.design_link })
    }
    const outDay = dayOf(r.release_date)
    if (outDay && (mine || reviewers.has(me))) {
      const start = utcOf(outDay, r.release_time)
      add(r, 'out', w.out, outDay, { start, end: start && new Date(+start + 30 * 60000), done: !!r.done_at })
    }
  }

  const name = user.name || user.username || ''
  const head = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SATashkent//Marketing Dashboard//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name ? `${w.cal} · ${name}` : w.cal)}`, 'X-WR-TIMEZONE:Asia/Tashkent',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ]
  return [...head, ...events, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n'
}

// ---- the feed itself: no sign-in, the token is the key -----------------------
router.get('/feed/:file', wrap(async (req, res) => {
  const token = String(req.params.file || '').replace(/\.ics$/i, '')
  const feed = /^[\w-]{20,}$/.test(token) ? await get('SELECT user_id FROM cal_feeds WHERE token = ?', token) : null
  const user = feed && await get('SELECT id, username, name, lang, role FROM users WHERE id = ?', feed.user_id)
  if (!user || String(user.username || '').startsWith('removed_')) return res.status(404).type('text/plain').send('No such calendar')
  const dead = (await all('SELECT id, label FROM statuses')).filter((s) => /^deleted$/i.test(s.label)).map((s) => s.id)
  const me = Number(user.id)
  const rows = (await all(`SELECT id, title, channels, status_id, assignee_id, assignees, operator_id, editor_id, designer_id,
      reviewer_id, reviewers, recording_date, recording_time, recording_end, shoot_ack, shot_at,
      edit_ready_date, edit_due_revised, edited_at, ready_at, design_ready_date, design_link,
      release_date, release_time, done_at
    FROM content
    WHERE operator_id = ? OR editor_id = ? OR designer_id = ? OR assignee_id = ? OR reviewer_id = ?
      OR assignees LIKE ? OR reviewers LIKE ?`, me, me, me, me, me, `%${me}%`, `%${me}%`))
    .filter((r) => !dead.includes(r.status_id))
  const channelLabels = Object.fromEntries((await all('SELECT key, label FROM channels')).map((c) => [c.key, c.label]))
  const origin = (process.env.PUBLIC_URL || (await tgPublicUrl()) || `${String(req.get('x-forwarded-proto') || req.protocol).split(',')[0]}://${req.get('host')}`).replace(/\/+$/, '')
  res.set('Cache-Control', 'private, max-age=300')
  res.set('Content-Disposition', 'inline; filename="satashkent.ics"')
  res.type('text/calendar; charset=utf-8').send(buildFeed({ user, rows, channelLabels, origin }))
}))

// ---- the person's own link ---------------------------------------------------
router.use(authRequired)

router.get('/link', wrap(async (req, res) => {
  const row = await get('SELECT token FROM cal_feeds WHERE user_id = ?', req.user.id)
  res.json({ path: row ? feedPath(row.token) : null })
}))

// Turn it on, or make a new link (the old one stops working at once).
router.post('/link', wrap(async (req, res) => {
  const token = newToken()
  await run('DELETE FROM cal_feeds WHERE user_id = ?', req.user.id)
  await run('INSERT INTO cal_feeds (user_id, token, created_at) VALUES (?, ?, ?)', req.user.id, token, new Date().toISOString())
  res.json({ path: feedPath(token) })
}))

router.delete('/link', wrap(async (req, res) => {
  await run('DELETE FROM cal_feeds WHERE user_id = ?', req.user.id)
  res.json({ path: null })
}))

export default router

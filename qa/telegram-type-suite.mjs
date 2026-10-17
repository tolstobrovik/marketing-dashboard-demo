// What a Telegram piece is: its item type and the guiding flag.
//
// The Telegram copywriter is paid per item — a base rate for "Just a post",
// "Post plus" and "Webinar" — and a bonus on top for a guiding (teaching)
// post. The board knew a piece's type (post, reel) and its format, and neither
// could tell a post from a post plus, so the pay could not either.
//
// THE DATA. content.telegram_type (just_post | post_plus | webinar) and
// content.is_guiding. Kept only for a task going to a WRITTEN channel (format
// 'text') — cross-posted counts — and cleared the moment it stops going to
// one. Sent for a YouTube piece, it is ignored.
//
// ASKED LIKE THE BRIEF. The builder asks everybody, up front. The server asks
// a task that is being made (not a thought jotted down) and asks an idea on
// its way out of the idea stage — the same rule every required brief field
// follows, with the same exception: an admin catching the board up.
//
//   node qa/telegram-type-suite.mjs        (expects a server on :4090)
import { readFileSync } from 'fs'
import { join } from 'path'

const BASE = process.env.BASE || 'http://localhost:4090'
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const login = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json()).token
const T = await login('admin', 'admin123')
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const statuses = (await req('/statuses')).data
const sid = (re) => statuses.find((s) => re.test(s.label))?.id
const IDEA = sid(/^idea$/i)
const EDITING = sid(/^editing$/i)
const chans = (await req('/channels')).data
const TG = chans.find((c) => c.format === 'text')?.key
const IG = chans.find((c) => c.format === 'social')?.key
const YT = chans.find((c) => c.format === 'video')?.key
ok('there is a written channel, a social one and a video one to try', !!TG && !!IG && !!YT, JSON.stringify(chans.map((c) => [c.key, c.format])))

// A channel planner who is NOT an admin: held to the rules an admin is not.
const sfx = Date.now().toString(36).slice(-5)
await req('/users', 'POST', { name: 'Tamila Planner', username: 'tg' + sfx, password: 'pw123456', role: 'member', departments: [TG, IG, YT] })
const MT = await login('tg' + sfx, 'pw123456')
const make = (body, tok = MT) => req('/content', 'POST', { type: 'post', description: 'Weekly SAT tips for the channel', ...body }, tok)

// ===================== making one =====================
let r = await make({ title: 'TG: planned, no type', channels: [TG], status_id: EDITING })
ok('a Telegram piece being MADE has to say what it is', r.status === 400 && r.data.field === 'telegram_type', `${r.status} ${JSON.stringify(r.data)}`)
r = await make({ title: 'TG: planned, nonsense type', channels: [TG], status_id: EDITING, telegram_type: 'essay' })
ok('…and it is one of the three', r.status === 400 && r.data.field === 'telegram_type', `${r.status} ${JSON.stringify(r.data)}`)
r = await make({ title: 'TG: post plus, guiding', channels: [TG], status_id: EDITING, telegram_type: 'post_plus', is_guiding: true })
const plus = r.data
ok('Post plus + Guiding is saved', r.status === 201 && plus.telegram_type === 'post_plus' && plus.is_guiding === 1, `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
let full = (await req(`/content/${plus.id}`)).data
ok('…and read back with the task (the Brief tab reads this)', full.telegram_type === 'post_plus' && full.is_guiding === 1)
const listed = (await req('/content')).data.find((x) => x.id === plus.id)
ok('…and on the board’s list rows too', listed?.telegram_type === 'post_plus' && listed?.is_guiding === 1)
r = await make({ title: 'TG: webinar, not guiding', channels: [TG], status_id: EDITING, telegram_type: 'webinar' })
ok('the guiding flag is its own answer — off unless it is switched on', r.status === 201 && r.data.telegram_type === 'webinar' && r.data.is_guiding === 0)

// Going on Instagram as well, it is a designed post and carries its ТЗ — so
// that what is being asked here is the Telegram type and nothing else.
const IG_TZ = 'Square 1080, three slides, the deadline date set large on the first one.'
r = await make({ title: 'TG+IG: cross-posted, no type', channels: [IG, TG], status_id: EDITING, tz: IG_TZ })
ok('cross-posted to Instagram AND Telegram it is still asked', r.status === 400 && r.data.field === 'telegram_type', `${r.status} ${JSON.stringify(r.data)}`)
r = await make({ title: 'TG+IG: cross-posted', channels: [IG, TG], status_id: EDITING, telegram_type: 'just_post', tz: IG_TZ })
ok('…and kept when answered', r.status === 201 && r.data.telegram_type === 'just_post', `${r.status} ${r.data.error || ''}`)

r = await make({ title: 'YT: nothing to do with Telegram', channels: [YT], type: 'video', status_id: IDEA, telegram_type: 'webinar', is_guiding: true })
ok('on a YouTube piece both are ignored — nothing is stored', r.status === 201 && r.data.telegram_type == null && r.data.is_guiding === 0, `${r.status} ${JSON.stringify([r.data.telegram_type, r.data.is_guiding])}`)

// ===================== an idea, and its way out =====================
r = await make({ title: 'TG: an idea', channels: [TG], status_id: IDEA })
const idea = r.data
ok('a thought jotted onto the Telegram board owes nothing yet (the board’s quick add stays quick)', r.status === 201 && idea.telegram_type == null, `${r.status} ${r.data.error || ''}`)
r = await req(`/content/${idea.id}?dry=1`, 'PATCH', { status_id: EDITING }, MT)
ok('moving it on asks for the type — named, for the bulk window', r.status === 400 && r.data.field === 'telegram_type'
  && (r.data.missing || []).some((m) => m.field === 'telegram_type'), `${r.status} ${JSON.stringify(r.data)}`)
r = await req(`/content/${idea.id}`, 'PATCH', { status_id: EDITING }, MT)
ok('…and the move itself is refused until it is answered', r.status === 400 && r.data.field === 'telegram_type')
r = await req(`/content/${idea.id}`, 'PATCH', { status_id: EDITING, telegram_type: 'just_post' }, MT)
ok('…answered in the same save, it moves', r.status === 200 && r.data.status_id === EDITING && r.data.telegram_type === 'just_post', `${r.status} ${r.data.error || ''}`)

// ===================== editing =====================
r = await req(`/content/${plus.id}`, 'PATCH', { is_guiding: false }, MT)
ok('Guiding switches off on its own', r.status === 200 && r.data.is_guiding === 0 && r.data.telegram_type === 'post_plus')
r = await req(`/content/${plus.id}`, 'PATCH', { is_guiding: true }, MT)
ok('…and back on, the type untouched', r.status === 200 && r.data.is_guiding === 1 && r.data.telegram_type === 'post_plus')
r = await req(`/content/${plus.id}`, 'PATCH', { telegram_type: 'webinar' }, MT)
ok('the type changes', r.status === 200 && r.data.telegram_type === 'webinar')
ok('a nonsense type is refused', (await req(`/content/${plus.id}`, 'PATCH', { telegram_type: 'thread' }, MT)).status === 400)
r = await req(`/content/${plus.id}`, 'PATCH', { telegram_type: null }, MT)
ok('a piece in the works cannot have its type cleared', r.status === 400 && r.data.field === 'telegram_type', `${r.status} ${JSON.stringify(r.data)}`)
full = (await req(`/content/${plus.id}`)).data
ok('every change is on the record', (full.activity || []).some((a) => a.field === 'telegram_type' && a.old_value === 'Post plus' && a.new_value === 'Webinar')
  && (full.activity || []).some((a) => a.field === 'guiding'), JSON.stringify((full.activity || []).slice(0, 5).map((a) => [a.field, a.old_value, a.new_value])))

// Sent unchanged by somebody who may not edit — the sheet sends every box — it
// is not an edit and not a refusal.
await req('/users', 'POST', { name: 'Nodir NoEdit', username: 'tn' + sfx, password: 'pw123456', role: 'member', departments: [TG], permissions: { manage_content: false } })
const NT = await login('tn' + sfx, 'pw123456')
r = await req(`/content/${plus.id}`, 'PATCH', { telegram_type: 'webinar', is_guiding: true }, NT)
ok('the same values sent back by somebody without edit rights pass quietly', r.status === 200, `${r.status} ${r.data.error || ''}`)
ok('…but changing them is theirs to ask for, not do', (await req(`/content/${plus.id}`, 'PATCH', { telegram_type: 'just_post' }, NT)).status === 403)

// Moved off Telegram: nothing is left behind to be counted by mistake.
r = await req(`/content/${plus.id}`, 'PATCH', { channels: [IG] }, MT)
ok('moved from Telegram to Instagram, the type and the guiding flag are cleared', r.status === 200 && r.data.telegram_type == null && r.data.is_guiding === 0,
  `${r.status} ${JSON.stringify([r.data.telegram_type, r.data.is_guiding])}`)
r = await req(`/content/${plus.id}`, 'PATCH', { telegram_type: 'webinar', is_guiding: true }, MT)
ok('…and on Instagram they cannot be set at all', r.status === 200 && r.data.telegram_type == null && r.data.is_guiding === 0)
r = await req(`/content/${plus.id}`, 'PATCH', { channels: [IG, TG] }, MT)
ok('put back on Telegram mid-work, it owes the answer on that save', r.status === 400 && r.data.field === 'telegram_type', `${r.status} ${JSON.stringify(r.data)}`)
r = await req(`/content/${plus.id}`, 'PATCH', { channels: [IG, TG], telegram_type: 'post_plus' }, MT)
ok('…given it, it goes', r.status === 200 && r.data.telegram_type === 'post_plus')

// ===================== the admin catching the board up =====================
r = await make({ title: 'TG: admin catch-up', channels: [TG], status_id: EDITING }, T)
ok('an admin catching the board up is not stopped (the rule every brief field follows)', r.status === 201, `${r.status} ${r.data.error || ''}`)

// ===================== a copy =====================
const webinar = (await make({ title: 'TG: webinar to copy', channels: [TG], status_id: EDITING, telegram_type: 'webinar', is_guiding: true })).data
const dup = (await req(`/content/${webinar.id}/duplicate`, 'POST', {})).data
ok('a duplicate keeps what the piece is — it is part of the brief', dup.telegram_type === 'webinar' && dup.is_guiding === 1, JSON.stringify([dup.telegram_type, dup.is_guiding]))

// …and a duplicate never carries anybody's approval (a Pravka 2.0 hole).
await req(`/content/${webinar.id}`, 'PATCH', { status_id: sid(/^ready$/i) })
await req(`/content/${webinar.id}/approve`, 'POST', {})
const approvedCopy = (await req(`/content/${webinar.id}/duplicate`, 'POST', {})).data
ok('a copy of an approved piece starts unapproved', !!(await req(`/content/${webinar.id}`)).data.approved_at && approvedCopy.approved_at == null,
  JSON.stringify(approvedCopy.approved_at))

// ===================== the page =====================
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const builder = read('client/src/components/builder/TaskBuilder.jsx')
const more = read('client/src/components/builder/StepMore.jsx')
ok('the builder’s Extras step draws the Telegram fields for a written channel', /asked\.formats\.includes\('text'\)/.test(builder) && /<TelegramFields/.test(more))
ok('…and will not create a Telegram task without a type', /written && !d\.telegram_type/.test(builder) && /tx\('Pick the Telegram Item Type\.'\)/.test(builder))
const sheet = read('client/src/components/ContentModal.jsx')
ok('the Brief tab shows them only for a written channel', /const tgOn = asked\.formats\.includes\('text'\)/.test(sheet) && /\{tgOn && \(/.test(sheet) && /<TelegramFields/.test(sheet))
const fields = read('client/src/components/TelegramFields.jsx')
ok('the dropdown offers the three, with the Guiding switch beneath it',
  /tx\('Just a post'\)/.test(fields) && /tx\('Post plus'\)/.test(fields) && /tx\('Webinar'\)/.test(fields) && /role="switch"/.test(fields) && /tx\('Guiding post \(teaches\)'\)/.test(fields))
const i18n = read('client/src/lib/i18n.jsx')
for (const [en, ru, uz] of [
  ['Telegram Item Type', 'Тип поста Telegram', 'Telegram post turi'],
  ['Just a post', 'Просто пост', 'Oddiy post'],
  ['Post plus', 'Пост плюс', 'Post plyus'],
  ['Webinar', 'Вебинар', 'Vebinar'],
  ['Guiding post (teaches)', 'Обучающий пост', 'Oʻrgatuvchi post'],
]) ok(`“${en}” reads as the spec wrote it`, i18n.includes(`"${en}": "${ru}"`) && i18n.includes(`"${en}": "${uz}"`))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

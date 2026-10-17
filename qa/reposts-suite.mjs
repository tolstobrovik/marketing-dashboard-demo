// TikTok and YouTube Shorts: a finished Instagram video, posted again.
//
//   A  THE CHANNELS EXIST, ONCE. TikTok and YouTube Shorts are added by a
//      migration (addRepostChannels), format 'repost'; Instagram Main and Uzb
//      carry the `video` flag. Booted twice, and two copies at once, there is
//      still one of each.
//   B  THE TICKS. "Also TikTok" and "Also Shorts" are offered on a video on a
//      video channel and nowhere else; the maker and an admin set them, a
//      colleague on the channel does not; after Published the server refuses.
//   C  PUBLISH MAKES THEM, IN THE SAME REQUEST. One repost per tick, at Ready,
//      "<title> (from Main)", the video LINKED (the source's own link, nothing
//      copied), the caption copied, Jahongir's, due the next day — and each
//      end links to the other.
//   D  NEVER TWICE. Published again, or undone and published again: one each.
//   E  UNDO TAKES BACK THE UNTOUCHED ONES. A repost somebody commented on, or
//      edited, stays.
//   F  A REPOST GOES OUT AT ITS OWN ADDRESS. Publishing it on TikTok needs the
//      TikTok link — an Instagram one is refused, for the admin too, and the
//      refusal names the field.
//   G  PAY. A repost counts for the person who posts it, on the day it goes
//      out, and never as editing work — even with an editor put on it.
//   H  NOBODY NAMED JAHONGIR: the repost channel's head posts it.
//
// Self-contained: port 4148.
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = fileURLToPath(new URL('.', import.meta.url))
const PORT = 4148

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })
const boot = (dir) => {
  const p = spawn(process.execPath, [ROOT + '/server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: String(PORT) }, stdio: 'ignore' })
  procs.push(p)
  return p
}
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
const B = `http://localhost:${PORT}/api`
const login = async (u, p) => (await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
let T = null
const req = async (path, method = 'GET', body, tok = T) => {
  const r = await fetch(B + path, { method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}
const day = (n) => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) } // Tashkent, like the server
const KEYS = ['tiktok', 'youtube_shorts']
const count = (list) => KEYS.map((k) => list.filter((c) => c.key === k).length).join()

console.log('\n=== A. the channels, once ===')
const dir = SP + 'rep-' + Date.now()
let srv = boot(dir)
ok('the stack is up', await up())
T = await login('admin', 'admin123')
let chans = (await req('/channels')).data
ok('TikTok and YouTube Shorts are there, one of each', count(chans) === '1,1', count(chans))
const by = Object.fromEntries(chans.map((c) => [c.key, c]))
ok('…named for the platforms', by.tiktok?.label === 'TikTok' && by.youtube_shorts?.label === 'YouTube Shorts')
ok('…their kind is Reposts: the path is Ready -> Published', KEYS.every((k) => by[k]?.format === 'repost'))
ok('Instagram Main and Instagram Uzb carry the video flag, nothing else does',
  by.instagram_main?.video === 1 && by.instagram_uzb?.video === 1
  && chans.filter((c) => c.video).length === 2, chans.filter((c) => c.video).map((c) => c.key).join())
const fields = (await req('/fields')).data
ok('the Reposts kind asks for no crew at all', Array.isArray(fields.channel_formats?.repost?.crew) && fields.channel_formats.repost.crew.length === 0)
srv.kill('SIGKILL')
await new Promise((r) => setTimeout(r, 800))
srv = boot(dir)
await up()
T = await login('admin', 'admin123')
ok('booted again, still one of each', count((await req('/channels')).data) === '1,1')
{
  // Two copies booting at once (pm2 has run two): both read "no flag, no
  // channel" before either writes, and the unique key keeps it to one each.
  process.env.DATA_DIR = SP + 'rep2-' + Date.now()
  const db = await import(pathToFileURL(ROOT + '/server/db.js').href)
  await db.initDb()
  await db.run("DELETE FROM meta WHERE key = 'repost_channels_2026_10'")
  await db.run("DELETE FROM channels WHERE key IN ('tiktok', 'youtube_shorts')")
  await Promise.all([db.addRepostChannels(), db.addRepostChannels()])
  ok('two copies running the migration at once leave one of each', count(await db.all('SELECT key FROM channels')) === '1,1')

  console.log('\n=== H. nobody named Jahongir: the channel head posts it ===')
  const rp = await import(pathToFileURL(ROOT + '/server/reposts.js').href)
  const lead = await db.run("INSERT INTO users (name, username, password_hash, role, created_at) VALUES ('Lola Lead', 'lola_t', 'x', 'member', '2026-10-06')")
  await db.run("UPDATE channels SET head_id = ? WHERE key = 'tiktok'", Number(lead.lastInsertRowid))
  const p1 = await rp.posterFor('tiktok')
  ok('with no Jahongir the TikTok head is the poster', p1.id === Number(lead.lastInsertRowid) && p1.how === 'head', JSON.stringify(p1))
  const p2 = await rp.posterFor('youtube_shorts')
  ok('…and with no head either, an admin on the channel', p2.how === 'admin' && !!p2.id, JSON.stringify(p2))
  const jah = await db.run("INSERT INTO users (name, username, password_hash, role, created_at) VALUES ('Jahongir Test', 'jah_t', 'x', 'member', '2026-10-06')")
  ok('a Jahongir account wins over the head', (await rp.posterFor('tiktok')).id === Number(jah.lastInsertRowid))
}

console.log('\n=== B. the ticks ===')
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label))?.id
const EDIT = sid(/editing/i), READY = sid(/^ready$/i), OUT = stages.find((s) => s.is_final)?.id
const sfx = Date.now().toString(36).slice(-5)
const mkUser = async (name, u, extra = {}) => (await req('/users', 'POST', { name, username: u + sfx, password: 'pw123456', role: 'member', ...extra })).data
const jah = await mkUser('Jahongir Posts', 'jah', { departments: ['tiktok', 'youtube_shorts', 'instagram_main'] })
const maker = await mkUser('Mira Maker', 'mira', { departments: ['instagram_main', 'instagram_uzb'] })
const other = await mkUser('Odil Other', 'odil', { departments: ['instagram_main'] })
const editor = await mkUser('Eldor Editor', 'eldor', { crew_roles: ['editor'], departments: ['instagram_main'] })
const M = await login('mira' + sfx, 'pw123456')
const O = await login('odil' + sfx, 'pw123456')
const J = await login('jah' + sfx, 'pw123456')
ok('the people are made', !!(jah.id && maker.id && other.id && editor.id && M && O && J))

const FILE = 'https://drive.google.com/file/d/finalcut123/view'
const mkReel = async (title, over = {}) => (await req('/content', 'POST', {
  title, channels: ['instagram_main'], type: 'reel', status_id: EDIT, assignee_ids: [maker.id], editor_id: editor.id,
  description: 'Five words that sell the course. #satashkent', edit_ready_date: day(0), release_date: day(0), ...over,
})).data
const src = await mkReel('Admissions reel')
ok('a reel on Instagram Main is made', !!src.id, JSON.stringify(src).slice(0, 200))
let full = (await req(`/content/${src.id}`)).data
ok('it is offered TikTok and Shorts', full.reposts?.offer?.map((o) => o.key).join() === 'tiktok,youtube_shorts', JSON.stringify(full.reposts))
ok('…unticked to begin with', full.reposts?.ticked?.length === 0)
const post = (await req('/content', 'POST', { title: 'A picture post', channels: ['instagram_main'], type: 'post', status_id: EDIT, assignee_ids: [maker.id] })).data
ok('a picture post is offered nothing', (await req(`/content/${post.id}`)).data.reposts?.offer?.length === 0)
const tg = (await req('/content', 'POST', { title: 'A Telegram video', channels: ['telegram_main'], type: 'video', status_id: EDIT, assignee_ids: [maker.id] })).data
ok('a video on a channel without the flag is offered nothing', (await req(`/content/${tg.id}`)).data.reposts?.offer?.length === 0)
ok('…and ticking it is refused, in words', (await req(`/content/${tg.id}/reposts`, 'PUT', { to: ['tiktok'] })).status === 400)

ok('the maker sees that they may tick', (await req(`/content/${src.id}`, 'GET', null, M)).data.reposts?.may === true)
ok('a colleague on the channel sees that they may not', (await req(`/content/${src.id}`, 'GET', null, O)).data.reposts?.may === false)
ok('…and is refused if they try', (await req(`/content/${src.id}/reposts`, 'PUT', { to: ['tiktok'] }, O)).status === 403)
ok('an unknown channel is refused', (await req(`/content/${src.id}/reposts`, 'PUT', { to: ['vimeo'] }, M)).status === 400)
let r = await req(`/content/${src.id}/reposts`, 'PUT', { to: ['youtube_shorts', 'tiktok'] }, M)
ok('the maker ticks both', r.status === 200 && r.data.ticked?.join() === 'tiktok,youtube_shorts', JSON.stringify(r.data))
ok('…and the paper trail says so', (await req(`/content/${src.id}`)).data.activity?.some((a) => a.field === 'reposts' && /TikTok/.test(a.new_value || '')))

console.log('\n=== C. publishing makes them, in the same request ===')
r = await req(`/content/${src.id}`, 'PATCH', { status_id: READY, ready_link: FILE })
ok('the cut is handed in (Ready)', r.status === 200, JSON.stringify(r.data))
r = await req(`/content/${src.id}`, 'PATCH', { status_id: OUT, post_link: `https://instagram.com/reel/${sfx}` }, M)
ok('the maker publishes it', r.status === 200 && !!r.data.done_at, JSON.stringify(r.data))
full = (await req(`/content/${src.id}`)).data
const made = full.reposts?.made || []
ok('two reposts were made at once', made.length === 2 && made.map((m) => m.channel).join() === 'tiktok,youtube_shorts', JSON.stringify(made))
const tik = (await req(`/content/${made[0]?.id}`)).data
const sho = (await req(`/content/${made[1]?.id}`)).data
ok('the TikTok one is on TikTok alone, at Ready', tik.channels?.join() === 'tiktok' && tik.status_id === READY, JSON.stringify({ c: tik.channels, s: tik.status_id }))
ok('…called "<title> (from Main)"', tik.title === 'Admissions reel (from Main)', tik.title)
ok('…the video LINKED: the source’s own link, the same string', tik.ready_link === FILE && sho.ready_link === FILE, tik.ready_link)
ok('…no file was copied: no documents, no photos or videos of its own',
  (tik.documents || []).length === 0 && (tik.media || []).length === 0)
ok('…the caption copied', tik.description === 'Five words that sell the course. #satashkent')
ok('…Jahongir’s', tik.assignee_id === jah.id && sho.assignee_id === jah.id, `${tik.assignee_id} vs ${jah.id}`)
ok('…due the next day', tik.release_date === day(1) && sho.release_date === day(1), tik.release_date)
ok('…nobody is put on it to film or cut it', !tik.operator_id && !tik.editor_id && !tik.designer_id)
ok('…a video, like the source', tik.type === 'reel')
ok('…its cut already accepted — it is the one that went out — so its step is to post it, not to check it',
  !!tik.approved_at && tik.approved_name === 'Mira Maker', `${tik.approved_at} ${tik.approved_name}`)
ok('the repost links back to its source', tik.reposts?.from?.id === src.id && tik.reposts?.from?.label === 'Instagram Main', JSON.stringify(tik.reposts?.from))
ok('…and is not offered reposts of its own', tik.reposts?.offer?.length === 0)
ok('the source says where they are: ready, not out yet', made.every((m) => m.out === false && m.poster === 'Jahongir Posts'), JSON.stringify(made))
const bell = (await req('/notifications', 'GET', null, J)).data
ok('Jahongir is told there is new work', (bell.events || []).some((n) => n.content_id === tik.id && n.kind === 'assigned'), JSON.stringify(bell).slice(0, 300))
ok('the ticks are refused once it is out', (await req(`/content/${src.id}/reposts`, 'PUT', { to: [] }, M)).status === 409)
ok('…and the maker is told they can no longer change them', (await req(`/content/${src.id}`, 'GET', null, M)).data.reposts?.may === false)

console.log('\n=== D. never twice ===')
const repostCount = async (id) => (await req(`/content/${id}`)).data.reposts?.made?.length
const titled = async (t) => (await req('/content')).data.filter((c) => c.title === t).length
r = await req(`/content/${src.id}`, 'PATCH', { status_id: READY })
ok('an admin takes it back to Ready', r.status === 200 && !r.data.done_at, JSON.stringify(r.data).slice(0, 200))
r = await req(`/content/${src.id}`, 'PATCH', { status_id: OUT })
ok('…and publishes it again', r.status === 200 && !!r.data.done_at, JSON.stringify(r.data).slice(0, 200))
ok('still one repost on each channel', await repostCount(src.id) === 2 && await titled('Admissions reel (from Main)') === 2)

console.log('\n=== E. undo takes back the untouched ones ===')
const src2 = await mkReel('Campus tour', { status_id: READY, ready_link: FILE, channels: ['instagram_uzb'] })
await req(`/content/${src2.id}/reposts`, 'PUT', { to: ['tiktok', 'youtube_shorts'] }, M)
r = await req(`/content/${src2.id}`, 'PATCH', { status_id: OUT, post_link: `https://instagram.com/reel/u${sfx}` }, M)
ok('the maker publishes a reel on Instagram Uzb', r.status === 200 && !!r.data.done_at, JSON.stringify(r.data).slice(0, 200))
let m2 = (await req(`/content/${src2.id}`)).data.reposts?.made || []
ok('published from Uzb: two reposts, "(from Uzb)"', m2.length === 2 && m2.every((m) => / \(from Uzb\)$/.test(m.title)), JSON.stringify(m2.map((m) => m.title)))
const kept = m2.find((m) => m.channel === 'tiktok').id
const dropped = m2.find((m) => m.channel === 'youtube_shorts').id
ok('Jahongir comments on the TikTok one', (await req(`/content/${kept}/comments`, 'POST', { text: 'On it, posting at 18:00' }, J)).status === 201)
r = await req(`/content/${src2.id}/undo`, 'POST', null, M)
ok('the maker undoes the publish', r.status === 200 && !r.data.done_at, JSON.stringify(r.data).slice(0, 200))
ok('the Shorts repost nobody touched is gone', (await req(`/content/${dropped}`)).status === 404)
ok('the TikTok one somebody commented on stays', (await req(`/content/${kept}`)).status === 200)
m2 = (await req(`/content/${src2.id}`)).data.reposts?.made || []
ok('…and the source still points at it', m2.length === 1 && m2[0].id === kept, JSON.stringify(m2))
ok('the paper trail says the untouched one went', (await req('/content/activity/all')).data.some((a) => a.content_id === dropped && a.kind === 'deleted'))
// The undo took the link back with the stage, so the publish asks for it again.
r = await req(`/content/${src2.id}`, 'PATCH', { status_id: OUT, post_link: `https://instagram.com/reel/u${sfx}` }, M)
m2 = (await req(`/content/${src2.id}`)).data.reposts?.made || []
ok('published again: Shorts is made afresh, TikTok is not made twice',
  r.status === 200 && m2.length === 2 && await titled('Campus tour (from Uzb)') === 2, JSON.stringify(m2.map((m) => [m.channel, m.id])))
// An edit counts as a touch too, and so does a stage move.
const src3 = await mkReel('Teacher Q&A', { status_id: READY, ready_link: FILE })
await req(`/content/${src3.id}/reposts`, 'PUT', { to: ['tiktok', 'youtube_shorts'] })
await req(`/content/${src3.id}`, 'PATCH', { status_id: OUT, post_link: `https://instagram.com/reel/q${sfx}` })
const m3 = (await req(`/content/${src3.id}`)).data.reposts?.made || []
const edited = m3.find((m) => m.channel === 'youtube_shorts').id
ok('an admin edits the Shorts caption', (await req(`/content/${edited}`, 'PATCH', { description: 'Shorter caption for Shorts' })).status === 200)
r = await req(`/content/${src3.id}/undo`, 'POST')
ok('undone: the edited one stays, the untouched one goes',
  r.status === 200 && (await req(`/content/${edited}`)).status === 200 && (await req(`/content/${m3.find((m) => m.channel === 'tiktok').id}`)).status === 404)

console.log('\n=== F. a repost goes out at its own address ===')
r = await req(`/content/${tik.id}?dry=1`, 'PATCH', { status_id: OUT }, J)
ok('publishing the TikTok repost asks for the link first', r.status === 400 && r.data.needs === 'post_link', JSON.stringify(r.data))
r = await req(`/content/${tik.id}`, 'PATCH', { status_id: OUT, post_link: `https://www.instagram.com/reel/${sfx}x` }, J)
ok('…an Instagram link is refused, and the field is named', r.status === 400 && r.data.needs === 'post_link' && /TikTok/.test(r.data.error), JSON.stringify(r.data))
r = await req(`/content/${tik.id}`, 'PATCH', { status_id: OUT, post_link: `https://www.instagram.com/reel/${sfx}y` })
ok('…for the admin too', r.status === 400 && r.data.needs === 'post_link', JSON.stringify(r.data))
r = await req(`/content/${tik.id}`, 'PATCH', { status_id: OUT, post_link: `https://www.tiktok.com/@satashkent/video/${Date.now()}` }, J)
ok('…a TikTok link and it is out', r.status === 200 && !!r.data.done_at, JSON.stringify(r.data).slice(0, 300))
r = await req(`/content/${sho.id}`, 'PATCH', { status_id: OUT, post_link: `https://youtube.com/shorts/${sfx}z` }, J)
ok('the Shorts one goes out with a YouTube link', r.status === 200 && !!r.data.done_at, JSON.stringify(r.data).slice(0, 300))
const madeOut = (await req(`/content/${src.id}`)).data.reposts?.made || []
ok('the source now says both are out, with their links', madeOut.every((m) => m.out && /^https:\/\/(www\.)?(tiktok|youtube)\.com/.test(m.post_link || '')), JSON.stringify(madeOut))

console.log('\n=== G. pay: the poster, never the editor ===')
// An editor put on a repost by hand is still not paid for it: it is the same
// video, already cut and already credited on its source.
await req(`/content/${sho.id}`, 'PATCH', { editor_id: editor.id })
const month = day(0).slice(0, 7)
const blocks = async (id) => (await req(`/reports/delivery/person/${id}?month=${month}`)).data.blocks || []
const ids = (bs, hat) => (bs.find((b) => b.hat === hat)?.rows || []).flatMap((x) => x.items.map((i) => i.id))
const eb = await blocks(editor.id)
ok('the editor is credited for cutting the source', ids(eb, 'editor').includes(src.id), JSON.stringify(eb))
ok('…and never for a repost, even one they were put on', !ids(eb, 'editor').includes(tik.id) && !ids(eb, 'editor').includes(sho.id))
const jb = await blocks(jah.id)
ok('the reposts count for Jahongir, who posted them', ids(jb, 'assignee').includes(tik.id) && ids(jb, 'assignee').includes(sho.id), JSON.stringify(jb))
const mb = await blocks(maker.id)
ok('…not for the maker of the source', !ids(mb, 'assignee').includes(tik.id) && ids(mb, 'assignee').includes(src.id), JSON.stringify(mb))
const left = (await req('/content')).data.find((c) => c.id === m2.find((m) => m.channel === 'youtube_shorts')?.id)
const jb2 = ids(await blocks(jah.id), 'assignee')
ok('a repost not posted yet is not counted', !!left && !left.done_at && !jb2.includes(left.id))

console.log('\n=== deleting a repost leaves its source clean ===')
ok('an admin deletes a repost', (await req(`/content/${edited}`, 'DELETE')).status === 200)
ok('…the source no longer lists it', !((await req(`/content/${src3.id}`)).data.reposts?.made || []).some((m) => m.id === edited))

srv.kill('SIGKILL')
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)

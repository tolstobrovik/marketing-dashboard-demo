// X (Twitter), LinkedIn and Threads: three written channels with a length limit.
//
//   A  THEY EXIST, ONCE. Added by a migration in initDb (addTextChannels), not
//      by seedIfEmpty — which only ever runs on an empty database, so the live
//      board would never have got them. Booted twice, and booted as two copies
//      at the same moment (pm2 has run two), there is still one of each.
//   B  THE PATH SKIPS THE SHOOT AND THE EDIT. They are format 'short': nobody
//      films or designs, so a reel written for X is not walled for a booking,
//      and a piece goes from Idea through Writing straight out.
//   C  THE LIMIT IS A WALL. Over the channel's char_limit (data: X 280,
//      Threads 500, LinkedIn 3000) a move to Ready or past it is refused, for
//      the admin too, in words that name the limit. At the limit it goes, and
//      Published still asks for the link like every other channel.
//   D  ONE SWITCH BRINGS THE CREW BACK. with_media on a post that carries a
//      video or a picture: the same reel is now walled for its shoot, as on
//      Instagram. Off a short channel the switch is cleared.
//
// Self-contained: port 4144.
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const SP = fileURLToPath(new URL('.', import.meta.url))

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const procs = []
process.on('exit', () => { for (const p of procs) { try { p.kill('SIGKILL') } catch { /* gone */ } } })
const boot = (dir, port) => {
  const p = spawn(process.execPath, [ROOT + '/server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: String(port) }, stdio: 'ignore' })
  procs.push(p)
  return p
}
const up = async (port) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return true } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
const client = async (port) => {
  const B = `http://localhost:${port}/api`
  const login = async (u, p) => (await (await fetch(B + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json()).token
  const T = await login('admin', 'admin123')
  const req = async (path, method = 'GET', body, tok = T) => {
    const r = await fetch(B + path, { method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  }
  return { req, login }
}
const KEYS = ['x_twitter', 'linkedin', 'threads']
const count = (list) => KEYS.map((k) => list.filter((c) => c.key === k).length)

console.log('\n=== A. three channels, once ===')
const dir = SP + 'txt-' + Date.now()
let srv = boot(dir, 4144)
ok('the stack is up', await up(4144))
let { req, login } = await client(4144)
let chans = (await req('/channels')).data
ok('X, LinkedIn and Threads are there, one of each', count(chans).join() === '1,1,1', count(chans).join())
const by = Object.fromEntries(chans.map((c) => [c.key, c]))
ok('named for the platforms', by.x_twitter?.label === 'X (Twitter)' && by.linkedin?.label === 'LinkedIn' && by.threads?.label === 'Threads')
ok('…written channels with a length limit', KEYS.every((k) => by[k]?.format === 'short'))
ok('the limits are data: X 280, Threads 500, LinkedIn 3000',
  by.x_twitter?.char_limit === 280 && by.threads?.char_limit === 500 && by.linkedin?.char_limit === 3000)
ok('the icons are from the board’s own set, no platform logos', KEYS.every((k) => ['pen', 'globe', 'megaphone'].includes(by[k]?.icon)))
ok('the channels that were there are untouched', by.instagram_main?.format === 'social' && by.telegram_main?.format === 'text' && by.instagram_main?.char_limit == null)
srv.kill('SIGKILL')
await new Promise((r) => setTimeout(r, 800))
srv = boot(dir, 4144)
await up(4144);
({ req, login } = await client(4144))
ok('booted again, still one of each', count((await req('/channels')).data).join() === '1,1,1')

// An admin's own choice stands: a channel deleted stays deleted.
const gone = (await req('/channels')).data.find((c) => c.key === 'threads')
await req(`/channels/${gone.id}`, 'DELETE')
srv.kill('SIGKILL')
await new Promise((r) => setTimeout(r, 800))
srv = boot(dir, 4144)
await up(4144);
({ req, login } = await client(4144))
ok('…and a channel the admin deleted is not put back on the next boot', !(await req('/channels')).data.some((c) => c.key === 'threads'))

// Two copies booting at once (pm2 has run two). Both read "no flag, no X"
// before either writes — two calls in one process interleave at every await
// exactly that way — and the unique key keeps it to one row each.
{
  process.env.DATA_DIR = SP + 'txt2-' + Date.now()
  const db = await import(pathToFileURL(ROOT + '/server/db.js').href)
  await db.initDb()
  await db.run("DELETE FROM meta WHERE key = 'text_channels_2026_10'")
  await db.run("DELETE FROM channels WHERE key IN ('x_twitter', 'linkedin', 'threads')")
  await Promise.all([db.addTextChannels(), db.addTextChannels()])
  const rows = await db.all('SELECT key FROM channels')
  ok('two copies running the migration at once leave one of each, not two', count(rows).join() === '1,1,1', count(rows).join())
  const jah = await db.run(`INSERT INTO users (name, username, password_hash, role, created_at) VALUES ('Jahongir Test', 'jah_t', 'x', 'member', '2026-10-05')`)
  await db.run("DELETE FROM meta WHERE key = 'text_channels_2026_10'")
  await db.run("DELETE FROM channels WHERE key IN ('x_twitter', 'linkedin', 'threads')")
  await db.addTextChannels()
  const heads = (await db.all("SELECT head_id FROM channels WHERE key IN ('x_twitter', 'linkedin', 'threads')")).map((c) => Number(c.head_id))
  ok('Jahongir heads the three channels when he has an account', heads.length === 3 && heads.every((h) => h === Number(jah.lastInsertRowid)), heads.join())
}

// The admin may change a limit; it is data, not a constant.
const x = (await req('/channels')).data.find((c) => c.key === 'x_twitter')
ok('an admin can change a limit', (await req(`/channels/${x.id}`, 'PATCH', { char_limit: 300 })).data.char_limit === 300)
await req(`/channels/${x.id}`, 'PATCH', { char_limit: 280 })

console.log('\n=== B. the path skips the shoot and the edit ===')
const stages = (await req('/statuses')).data
const sid = (re) => stages.find((s) => re.test(s.label))?.id
const IDEA = sid(/^idea$/i), SHOOT = sid(/to shoot/i), EDIT = sid(/editing/i), READY = sid(/^ready$/i), OUT = stages.find((s) => s.is_final)?.id
const sfx = Date.now().toString(36).slice(-5)
const maker = (await req('/users', 'POST', { name: 'Xena Writer', username: 'xw' + sfx, password: 'pw123456', role: 'member', departments: ['x_twitter'] })).data
const M = await login('xw' + sfx, 'pw123456')
ok('a member is added to X like to any channel', Array.isArray(maker.departments) && maker.departments.includes('x_twitter'))

const reel = (await req('/content', 'POST', { title: 'Reel idea for X', channels: ['x_twitter'], type: 'reel', status_id: IDEA }, M)).data
ok('a member creates a piece on X', !!reel.id, JSON.stringify(reel).slice(0, 160))
let r = await req(`/content/${reel.id}?dry=1`, 'PATCH', { status_id: SHOOT }, M)
ok('even a reel on X is not walled for a shoot — nobody films here', r.status === 200, JSON.stringify(r.data).slice(0, 200))
r = await req(`/content/${reel.id}?dry=1`, 'PATCH', { status_id: EDIT }, M)
ok('…nor asked for an editor on the way to Writing', r.status === 200 && !(r.data.missing || []).some((m) => /operator_id|editor_id|designer_id/.test(m.field)), JSON.stringify(r.data).slice(0, 200))

console.log('\n=== C. the limit is a wall ===')
const long = 'x'.repeat(300)
const post = (await req('/content', 'POST', { title: 'A post for X', channels: ['x_twitter'], type: 'post', status_id: IDEA, description: long }, M)).data
r = await req(`/content/${post.id}`, 'PATCH', { status_id: EDIT }, M)
ok('300 characters may still be written — Writing is where it is cut', r.status === 200, JSON.stringify(r.data).slice(0, 200))
r = await req(`/content/${post.id}`, 'PATCH', { status_id: READY }, M)
ok('300 characters cannot go to Ready on X', r.status === 400 && r.data.field === 'description', JSON.stringify(r.data))
ok('…and the refusal names the limit', /280/.test(r.data.error || '') && /300/.test(r.data.error || ''), r.data.error)
r = await req(`/content/${post.id}?dry=1`, 'PATCH', { status_id: OUT, post_link: 'https://x.com/satashkent/status/1' }, M)
ok('…nor straight out, which is the move a written piece makes', r.status === 400 && (r.data.missing || []).some((m) => m.field === 'description' && m.wrong), JSON.stringify(r.data))
r = await req(`/content/${post.id}`, 'PATCH', { status_id: OUT, post_link: 'https://x.com/satashkent/status/1' })
ok('…not even for the admin', r.status === 400 && /280/.test(r.data.error || ''), JSON.stringify(r.data))
ok('emoji count as one character each, the way the platforms count them',
  (await req(`/content/${post.id}?dry=1`, 'PATCH', { status_id: READY, description: '😀'.repeat(280) }, M)).status === 200)
r = await req(`/content/${post.id}`, 'PATCH', { status_id: READY, description: 'y'.repeat(280) }, M)
ok('cut to 280, it goes to Ready', r.status === 200 && r.data.status_id === READY, JSON.stringify(r.data).slice(0, 200))
r = await req(`/content/${post.id}`, 'PATCH', { status_id: OUT })
ok('Published asks for the post link, as on every channel', r.status === 400 && r.data.needs === 'post_link', JSON.stringify(r.data))
r = await req(`/content/${post.id}`, 'PATCH', { status_id: OUT, post_link: 'https://x.com/satashkent/status/2' })
ok('…and with the link it is out', r.status === 200 && !!r.data.done_at && r.data.post_link === 'https://x.com/satashkent/status/2', JSON.stringify(r.data).slice(0, 200))
const li = (await req('/content', 'POST', { title: 'LinkedIn article', channels: ['linkedin'], type: 'post', status_id: EDIT, description: 'z'.repeat(2999) })).data
ok('LinkedIn takes 2999 where X would not', (await req(`/content/${li.id}?dry=1`, 'PATCH', { status_id: READY })).status === 200)
const cross = (await req('/content', 'POST', { title: 'On X and LinkedIn', channels: ['linkedin', 'x_twitter'], type: 'post', status_id: EDIT, description: 'z'.repeat(400) })).data
r = await req(`/content/${cross.id}?dry=1`, 'PATCH', { status_id: READY })
ok('across two channels the tightest limit holds', r.status === 400 && /X \(Twitter\)/.test(r.data.error || '') && /280/.test(r.data.error || ''), r.data.error)
const ig = (await req('/content', 'POST', { title: 'Long caption on Instagram', channels: ['instagram_main'], type: 'post', status_id: EDIT, description: 'z'.repeat(5000), designer_id: null })).data
r = await req(`/content/${ig.id}?dry=1`, 'PATCH', { status_id: READY })
ok('a channel with no limit is not asked about length', !(r.data.missing || []).some((m) => m.field === 'description') && r.data.field !== 'description', JSON.stringify(r.data).slice(0, 200))

console.log('\n=== D. one switch brings the crew back ===')
const vid = (await req('/content', 'POST', { title: 'Video post for X', channels: ['x_twitter'], type: 'reel', status_id: IDEA }, M)).data
r = await req(`/content/${vid.id}`, 'PATCH', { with_media: true }, M)
ok('the piece’s own member switches it on', r.status === 200 && r.data.with_media === 1, JSON.stringify(r.data).slice(0, 200))
r = await req(`/content/${vid.id}?dry=1`, 'PATCH', { status_id: SHOOT }, M)
ok('now the reel is asked for its shoot, as on Instagram', r.status === 400 && (r.data.missing || []).some((m) => m.field === 'operator_id'), JSON.stringify(r.data).slice(0, 240))
r = await req(`/content/${vid.id}`, 'PATCH', { with_media: false }, M)
ok('…and switched off, it is a written post again', r.status === 200 && r.data.with_media === 0
  && (await req(`/content/${vid.id}?dry=1`, 'PATCH', { status_id: SHOOT }, M)).status === 200)
const born = (await req('/content', 'POST', { title: 'Born with a picture', channels: ['x_twitter'], type: 'post', status_id: IDEA, with_media: true })).data
ok('it can be switched on when the task is made', born.with_media === 1)
r = await req(`/content/${born.id}`, 'PATCH', { channels: ['instagram_main'] })
ok('moved off a short channel the switch is cleared — it means nothing elsewhere', r.status === 200 && r.data.with_media === 0, JSON.stringify(r.data).slice(0, 200))
const tg = (await req('/content', 'POST', { title: 'Telegram with a picture?', channels: ['telegram_main'], type: 'post', status_id: IDEA, with_media: true })).data
ok('…and Telegram never keeps it', tg.with_media === 0)

console.log(fails ? `\n✘ ${fails} failed` : '\n✔ all passed')
process.exit(fails ? 1 : 0)

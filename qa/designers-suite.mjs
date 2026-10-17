// Designers 2.0: revision rounds a designer and a reviewer can talk under,
// and that a new file closes.
//
// THE ROUND REMEMBERS WHAT IT SENT BACK. "Changes were asked for — paste the
// link to the new version" was said to the designer who had just pasted it:
// the sheet saves the link first and the hand-in compared the link with the
// one it had just saved. A round now records the file it sent back
// (`sent_link`), and "the same file" means that one — so saving first and
// handing in second is a hand-in. A round opened before that was written down
// (sent_link NULL) still compares with the task's link, as it always did.
//
// THE TALK UNDER A ROUND. POST /content/revisions/:rid/notes — under
// /content/revisions/, because the client reads any answer from under
// /content/:id/… as the task itself. Whoever works on the task may write
// while the round is open; the seat holder, whoever asked and whoever wrote
// before hear it.
//
// WHO CLOSES A ROUND. The seat holder's hand-in with a new file; "Fixed" with
// a new file (once — a second press is refused, it used to move the task back
// to Ready over whatever had happened since, and it now tells the reviewer);
// and an admin's hand-in WITH a new file. An admin ticking a milestone to
// catch the board up, with no new file, leaves the round open.
//
//   node qa/designers-suite.mjs           (expects a server on :4090)
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
const day = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })
  .format(new Date(Date.now() + off * 86400000))
const statuses = (await req('/statuses')).data
const finalId = statuses.find((s) => s.is_final)?.id
const me = (await req('/auth/me')).data.user
const bell = async (t = T) => ((await req('/notifications', 'GET', null, t)).data.events || [])

const sfx = Date.now().toString(36).slice(-5)
const ch = 'instagram_main'
const ds = (await req('/users', 'POST', { name: 'Dina Designer', username: 'dd' + sfx, password: 'pw123456', role: 'designer', departments: [ch] })).data
const out = (await req('/users', 'POST', { name: 'Olim Outsider', username: 'ou' + sfx, password: 'pw123456', role: 'designer', departments: [] })).data
const DT = await login('dd' + sfx, 'pw123456')
const OT = await login('ou' + sfx, 'pw123456')
ok('(a designer on the channel, and one who is not)', !!ds.id && !!out.id && !!DT && !!OT)

const A = 'https://drive.google.com/file/d/designers-A-0000000000/view'
const B = 'https://drive.google.com/file/d/designers-B-0000000000/view'
const C = 'https://drive.google.com/file/d/designers-C-0000000000/view'
const task = (await req('/content', 'POST', {
  title: 'Designers: the poster', channels: [ch], type: 'post',
  designer_id: ds.id, design_ready_date: day(1), release_date: day(3),
})).data
ok('(a post with a designer on it)', !!task.id && task.designer_id === ds.id, JSON.stringify(task).slice(0, 120))

const first = await req(`/content/${task.id}`, 'PATCH', { milestone: 'designed', design_link: A }, DT)
ok('the designer hands the artwork in', first.status === 200, `${first.status} ${first.data.error || ''}`)

// ===================== round 1 =====================
const sent = await req(`/content/${task.id}/revisions`, 'POST', { note: 'The logo is too small', target: 'designer' })
ok('the reviewer sends it back to the designer', sent.status === 201, `${sent.status} ${sent.data.error || ''}`)
ok('…and the row the lists read says round 1 is open, with the designer', sent.data.open_round === 1 && sent.data.open_for === 'designer',
  `${sent.data.open_round} ${sent.data.open_for}`)
let full = (await req(`/content/${task.id}`)).data
const r1 = full.revisions?.[0]
ok('the round remembers the file it sent back', r1?.sent_link === A && Array.isArray(r1.notes) && r1.notes.length === 0, JSON.stringify(r1 || {}).slice(0, 160))
const mine = (await req('/content/revisions/mine', 'GET', null, DT)).data
ok('…and so does the designer\'s lane', mine.some((r) => r.id === r1.id && r.sent_link === A))

// the talk under it
const n1 = await req(`/content/revisions/${r1.id}/notes`, 'POST', { text: 'How much bigger — double?' }, DT)
ok('the designer asks under the round', n1.status === 201 && n1.data.revision_id === r1.id && n1.data.author === 'Dina Designer',
  `${n1.status} ${JSON.stringify(n1.data).slice(0, 120)}`)
ok('…and whoever asked for the change hears it', (await bell()).some((e) => e.content_id === task.id && e.kind === 'pravki' && /Round 1/.test(e.text) && /double/.test(e.text)))
const n2 = await req(`/content/revisions/${r1.id}/notes`, 'POST', { text: 'Yes, and keep it top left' })
ok('the reviewer answers', n2.status === 201, String(n2.status))
ok('…and the designer hears it', (await bell(DT)).some((e) => e.content_id === task.id && /top left/.test(e.text)))
ok('an empty note is refused', (await req(`/content/revisions/${r1.id}/notes`, 'POST', { text: '   ' }, DT)).status === 400)
ok('somebody with no part in the task cannot write under it', (await req(`/content/revisions/${r1.id}/notes`, 'POST', { text: 'hi there' }, OT)).status === 404)
ok('…and a round that does not exist is not found', (await req('/content/revisions/99999999/notes', 'POST', { text: 'hi there' })).status === 404)
const revs = (await req(`/content/${task.id}/revisions`)).data
ok('the rounds read back on their own, the thread in order', Array.isArray(revs) && revs[0].notes.map((n) => n.text).join('|') === 'How much bigger — double?|Yes, and keep it top left',
  JSON.stringify(revs).slice(0, 160))

// save first, hand in second
const same = await req(`/content/${task.id}`, 'PATCH', { milestone: 'designed', design_link: A }, DT)
ok('handing in the very file that was sent back is refused', same.status === 400 && same.data.needs_link === 'design_link',
  `${same.status} ${JSON.stringify(same.data).slice(0, 100)}`)
const saved = await req(`/content/${task.id}`, 'PATCH', { design_link: B }, DT)
ok('the designer saves the new link', saved.status === 200 && saved.data.design_link === B, `${saved.status} ${saved.data.error || ''}`)
ok('…which on its own closes nothing', (await req(`/content/${task.id}`)).data.revisions[0].resolved_at == null)
const handed = await req(`/content/${task.id}`, 'PATCH', { milestone: 'designed' }, DT)
ok('…then hands it in — and is not told it is the file that was sent back', handed.status === 200,
  `${handed.status} ${JSON.stringify(handed.data).slice(0, 110)}`)
full = (await req(`/content/${task.id}`)).data
ok('round 1 is closed, by the designer, with the new file', !!full.revisions[0].resolved_at && full.revisions[0].fixed_link === B
  && full.revisions[0].resolved_by === ds.id && full.revisions[0].resolved_name === 'Dina Designer', JSON.stringify(full.revisions[0]).slice(0, 200))
ok('…the lists no longer carry an open round', handed.data.open_round == null && handed.data.open_for == null, `${handed.data.open_round}`)
ok('…a closed round takes no more notes', (await req(`/content/revisions/${r1.id}/notes`, 'POST', { text: 'one more thing' })).status === 409)
ok('…and "Fixed" on it again is refused rather than moving the task a second time',
  (await req(`/content/revisions/${r1.id}/resolve`, 'POST', { link: C }, DT)).status === 409)

// ===================== round 2 =====================
const sent2 = await req(`/content/${task.id}/revisions`, 'POST', { note: 'Now the date is wrong', target: 'designer' })
ok('a second round is round 2', sent2.status === 201 && sent2.data.open_round === 2, `${sent2.status} ${sent2.data.open_round}`)
const r2 = (await req(`/content/${task.id}`)).data.revisions.find((r) => r.round === 2)
ok('…and it sent back the fixed file of round 1', r2?.sent_link === B, r2?.sent_link)
const catchUp = await req(`/content/${task.id}`, 'PATCH', { milestone: 'designed' })
ok('an admin catching the board up with no new file is let through', catchUp.status === 200, `${catchUp.status} ${catchUp.data.error || ''}`)
ok('…and leaves the round open — nobody delivered anything', (await req(`/content/${task.id}`)).data.revisions.find((r) => r.round === 2).resolved_at == null)
const sameFix = await req(`/content/revisions/${r2.id}/resolve`, 'POST', { link: B }, DT)
ok('"Fixed" with the file that was sent back is refused', sameFix.status === 400 && sameFix.data.needs_link === 'design_link', String(sameFix.status))
ok('an outsider cannot press "Fixed"', (await req(`/content/revisions/${r2.id}/resolve`, 'POST', { link: C }, OT)).status === 403)
const fix2 = await req(`/content/revisions/${r2.id}/resolve`, 'POST', { link: C }, DT)
ok('"Fixed" with a new file closes round 2', fix2.status === 200 && fix2.data.task?.design_link === C, `${fix2.status} ${fix2.data.error || ''}`)
ok('…and tells the reviewer it is back', (await bell()).some((e) => e.content_id === task.id && /fixed round 2/.test(e.text)))
const r2b = (await req(`/content/${task.id}`)).data.revisions.find((r) => r.round === 2)
ok('…on the record: who, and with what', r2b.resolved_name === 'Dina Designer' && r2b.fixed_link === C)

// ===================== an admin's hand-in with a new file =====================
// Two rounds is the Pravka 2.0 limit, so a third is an admin's override
// (`force`) — which is exactly who is asking here.
const r3ask = await req(`/content/${task.id}/revisions`, 'POST', { note: 'Swap the photo', target: 'designer', force: true })
ok('(a third round, past the limit, by the admin’s override)', r3ask.status === 201, `${r3ask.status} ${r3ask.data.error || ''}`)
const D = 'https://drive.google.com/file/d/designers-D-0000000000/view'
const adminFix = await req(`/content/${task.id}`, 'PATCH', { milestone: 'designed', design_link: D })
ok('an admin handing in a new file answers the round like anybody', adminFix.status === 200 && adminFix.data.open_round == null,
  `${adminFix.status} ${adminFix.data.open_round}`)
const r3 = (await req(`/content/${task.id}`)).data.revisions.find((r) => r.round === 3)
ok('…closed in the admin\'s name', !!r3?.resolved_at && r3.resolved_by === me.id && r3.fixed_link === D)
const pub = await req(`/content/${task.id}`, 'PATCH', { status_id: finalId, post_link: 'https://instagram.com/p/designers' })
ok('with every round answered it publishes', pub.status === 200, `${pub.status} ${JSON.stringify(pub.data).slice(0, 110)}`)

// ===================== the page, read from the source =====================
const src = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const rounds = src('client/src/components/RevisionRounds.jsx')
ok('the notes are posted under /content/revisions/, never /content/:id/…',
  /api\.post\(`\/content\/revisions\/\$\{r\.id\}\/notes`/.test(rounds) && !/`\/content\/\$\{taskId\}\/revisions\/\$\{/.test(rounds))
ok('each round is "Round N", open or fixed, with "Add revision note" under an open one',
  /tx\('Round \{n\}'/.test(rounds) && /tx\('To fix'\)/.test(rounds) && /tx\('Fixed'\)/.test(rounds) && /tx\('Add revision note'\)/.test(rounds))
const cm = src('client/src/components/ContentModal.jsx')
// 13 Oct 2026: the rounds moved from the tabbed sheet into the task window's record.
ok('the task window shows the rounds, and reads the task again after a note',
  /<RevisionRounds taskId=\{t\.id\} revisions=\{revisions\} onChange=\{\(\) => onChanged\(\)\}/.test(src('client/src/components/TaskMore.jsx')))
const i18n = src('client/src/lib/i18n.jsx')
ok('"Add revision note" in Russian and Uzbek, as the brief words it',
  i18n.includes('"Add revision note": "Добавить правку",') && i18n.includes('"Add revision note": "Tahrir qoʻshish",'))
for (const [f, name] of [['client/src/components/CrewDay.jsx', 'the crew\'s change card'], ['client/src/pages/Brief.jsx', 'the Pravki card']])
  ok(`${name} compares with the file the round sent back`, /rev\.sent_link != null \? rev\.sent_link :/.test(src(f)))

// ===================== giving a design, on the way in =====================
// The builder's Design step and the Design board's "Give a design" put the
// designer, the artwork's day and who is in the shoot on the task as it is
// made — what only a later save could do before.
const given = await req('/content', 'POST', {
  title: 'Designers: given with its crew', channels: [ch], type: 'post',
  designer_id: ds.id, design_ready_date: day(2), release_date: day(3), face_ids: [ds.id, me.id],
})
ok('a task is born with its designer, artwork day and the people in it', given.status === 201
  && given.data.designer_id === ds.id && given.data.design_ready_date === day(2)
  && String(given.data.faces) === JSON.stringify([ds.id, me.id]) && given.data.face_id === ds.id,
  JSON.stringify([given.status, given.data.designer_id, given.data.design_ready_date, given.data.faces, given.data.face_id]))
ok('…and somebody no longer on the team is refused by name', (await req('/content', 'POST', {
  title: 'Designers: a ghost in it', channels: [ch], type: 'post', face_ids: [99999999] })).status === 400)
const bare = await req('/content', 'POST', { title: 'Designers: a bare link', channels: [ch], type: 'post', design_link: 'poster on my laptop' })
ok('a delivery given on the way in has to be a link', bare.status === 400 && bare.data.field === 'design_link', `${bare.status}`)
const board = (await req('/content?design=1')).data
ok('the Design board\'s own list holds the design work and not the rest',
  board.some((c) => c.id === given.data.id) && board.every((c) => c.designer_id || c.design_ready_date || c.type === 'post'))
// A draft from a kanban column lands in that column.
const column = statuses.find((s) => !s.is_final && !/^idea$|deleted/i.test(s.label))
const drafted = await req('/content', 'POST', { title: 'Designers: drafted into a column', channels: [ch], type: 'post', status_id: column.id, description: '' })
ok(`a draft added in «${column.label}» stays there`, drafted.status === 201 && drafted.data.status_id === column.id, `${drafted.status} ${drafted.data.error || ''}`)

// ===================== the link on a card =====================
const { pathToFileURL } = await import('url')
const { parseAsset, thumbOf } = await import(pathToFileURL(join(ROOT, 'client/src/lib/assetLink.js')).href)
const fid = '1AbCdEfGhIjKlMnOp'
const kinds = [
  [`https://drive.google.com/file/d/${fid}/view?usp=sharing`, 'drive'],
  [`https://drive.google.com/file/u/1/d/${fid}/view`, 'drive'],
  [`https://drive.google.com/open?id=${fid}`, 'drive'],
  [`https://drive.google.com/drive/u/0/folders/${fid} · poster 3`, 'folder'],
  [`https://docs.google.com/presentation/d/${fid}/edit`, 'doc'],
  ['https://example.com/a/b.PNG?x=1', 'image'],
  ['https://example.com/page', 'link'],
  ['poster 3', 'none'],
]
const wrongKind = kinds.filter(([v, k]) => parseAsset(v).kind !== k)
ok('a delivered link is read as a Drive file, a folder, a document, a picture or a page', !wrongKind.length, JSON.stringify(wrongKind))
ok('a Drive file draws Drive\'s own thumbnail, a folder none — it carries its label instead',
  thumbOf(parseAsset(kinds[0][0])) === `https://drive.google.com/thumbnail?id=${fid}&sz=w640`
    && thumbOf(parseAsset(kinds[3][0])) === '' && parseAsset(kinds[3][0]).label === 'poster 3')

// ===================== the pages, read from the source =====================
const thumb = src('client/src/components/AssetThumb.jsx')
ok('the thumbnail is 16:9 and centre-cropped, and falls back to an icon when Drive will not show it',
  /onError=\{\(\) => setBroken\(true\)\}/.test(thumb) && /Folder/.test(thumb)
    && /\.asset-thumb \{[^}]*aspect-ratio: 16 \/ 9/.test(src('client/src/styles.css'))
    && /\.asset-thumb img \{[^}]*object-fit: cover; object-position: center/.test(src('client/src/styles.css')))
const dboard = src('client/src/components/DesignBoard.jsx')
ok('a design card shows its artwork and says "Open asset"', /<AssetThumb link=\{t\.design_link\}/.test(dboard) && /tx\('Open asset'\)/.test(dboard)
  && i18n.includes('"Open asset": "Открыть файл",') && i18n.includes('"Open asset": "Faylni ochish",'))
ok('…and a round sent back says so on the card', /tx\('Round \{n\} · to fix'/.test(dboard))
const dpage = src('client/src/pages/Design.jsx')
ok('the Design board gives a design, polls its own list, and the designer hands in from the card',
  /tx\('Give a design'\)/.test(dpage) && /\/content\?design=1&thumbs=1/.test(dpage) && /<HandIn item=\{handing\} kind="design"/.test(dpage))
const tb = src('client/src/components/builder/TaskBuilder.jsx')
// Round 13 (the owner, 14 Oct 2026): the shoot, the edit and the cover are
// switches on the When step, off unless the page or a draft already said who,
// and "Save for now" is on every step but the last.
ok('the builder asks only the steps that were turned on, after the day',
  /\{ key: 'when', label: 'When' \},\s*film && \{ key: 'shoot'[^}]*\}, edit && \{ key: 'edit'[^}]*\}, design && \{ key: 'design'/.test(tb)
    && /const film = canFilm && want\.shoot/.test(tb) && /aria-pressed=\{!!want\[k\]\}/.test(tb)
    && ['StepShoot', 'StepEdit', 'StepDesign'].every((c) => new RegExp(`import ${c} from './${c}.jsx'`).test(tb)))
ok('…and saves for now from any step but the last', /\{!isLast && \(\s*<button[^>]*onClick=\{\(\) => submit\(false, true\)\}/.test(tb) && /tx\('Save for now'\)/.test(tb)
  && /const draftOf = \(\) => \(\{ \.\.\.payloadOf\(\), auto_stage: false,\s*edit_ready_date: d\.edit_ready_date \|\| null, design_ready_date: d\.design_ready_date \|\| null \}\)/.test(tb)
  // …and a clash met on "Save for now" is booked anyway as a save for now (the hunt, 15 Oct 2026).
  && /setClash\(\{ \.\.\.e\.data, draft \}\)/.test(tb) && /onForce=\{\(\) => submit\(true, !!clash\?\.draft\)\}/.test(tb))
ok('a kanban column\'s "+ Add" opens that form, landing in the column',
  /onClick=\{\(\) => onQuickAdd\(s\.id\)\}/.test(src('client/src/components/ContentBoard.jsx'))
    && /setNewDefaults\(\{ channels: \[key\], status_id: statusId \}\)/.test(src('client/src/pages/Department.jsx')))

// ===================== the task's form: the window's Edit mode =====================
// 13 Oct 2026, the owner: one task window, one Edit button. The tabs went; the
// form reads in the window's order — the days and people, the reference, the
// files, the brief — with the rest beside them.
ok('the form is one page, in the window\'s order', !/const SECTIONS|data-sec=/.test(cm)
  && cm.indexOf('{daysBlock}{askForm}') < cm.indexOf('{refRow}') && cm.indexOf('{refRow}') < cm.indexOf('{filesRow}{postRow}{docsRow}'))
ok('…with whoever films it asked once, beside the shoot day', (cm.match(/key: 'operator_id', label: tx\('Operator'\)/g) || []).length === 0
  && /cm-shoot-who/.test(cm))
const menu = cm.slice(cm.indexOf('cm-tools cm-tools-pop'), cm.indexOf('foot-gap foot-gap-tight'))
ok('the ⋯ menu puts Delete last, set apart', menu.lastIndexOf('onClick={del}') > menu.lastIndexOf('onClick={duplicate}') && /cm-tools-sep/.test(menu)
  && !/See it as…|setAsCrew/.test(cm))
ok('a day somebody cannot change is read, not drawn as an empty date box', /drow-read/.test(cm) && /tx\('Not set yet'\)/.test(cm))

for (const t of [given.data, drafted.data]) if (t?.id) await req(`/content/${t.id}`, 'DELETE')
await req(`/content/${task.id}`, 'DELETE')
await req(`/users/${ds.id}`, 'DELETE')
await req(`/users/${out.id}`, 'DELETE')
console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

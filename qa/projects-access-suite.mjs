// Who sees Projects, which projects are "mine", and whose business a budget is.
//
// PAGE ACCESS IS PER KIND OF ACCOUNT; A PROJECT IS HANDED TO A PERSON. The
// admin aims the Projects page at members, editors, designers… — and an editor
// given a project could not open the page that shows it. Owning a project, or
// running a campaign in one, now opens the page whatever the account's kind:
// the login answer and /auth/me carry `on_projects`, and the client reads it
// at every door (lib/pages.jsx, STAKE).
//
// "MINE" IS ONE DEFINITION. The same test sets `mine` on each project in the
// list, so the page's Mine button and the page's door cannot disagree about
// whose a project is.
//
// A BUDGET IS THE OWNER'S AND THE ADMIN'S. Hiding the page never hid this —
// the API answers anybody signed in — so it is withheld where it leaves the
// server, by the rule that already decides who may edit it.
//
// Runs against the shared 4090 stack.
const BASE = process.env.BASE || 'http://localhost:4090'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const loginFull = async (u, p) => (await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }),
})).json())
const T = (await loginFull('admin', 'admin123')).token
const req = async (p, m = 'GET', b, t = T) => {
  const r = await fetch(BASE + '/api' + p, {
    method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const ch = (await req('/channels')).data[0].key
const stamp = Date.now().toString(36)
const mkUser = async (name, role, extra = {}) => (await req('/users', 'POST', {
  name, username: `pa_${role}_${stamp}`, password: 'probe123', role, departments: [ch], ...extra,
})).data
const editor = await mkUser('PA Editor', 'editor')
const member = await mkUser('PA Member', 'member')
const bystander = await mkUser('PA Designer', 'designer')
const tokenOf = async (u) => (await loginFull(u.username, 'probe123')).token
const me = async (t) => (await req('/auth/me', 'GET', null, t)).data.user

// ===================== before anybody owns anything =====================
const edT = await tokenOf(editor)
ok('an editor with no project is not "on projects"', (await me(edT)).on_projects === false,
  String((await me(edT)).on_projects))

// ===================== a project handed to an editor =====================
const owned = await req('/projects', 'POST', { name: `PA owned ${stamp}`, owner_id: editor.id, budget: 5000 })
ok('an admin can hand a project to an editor', owned.status === 201, JSON.stringify(owned.data).slice(0, 100))
const other = await req('/projects', 'POST', { name: `PA other ${stamp}`, owner_id: member.id, budget: 7000 })
ok('…and another to a member', other.status === 201, String(other.status))

ok('owning a project puts the editor "on projects", whatever their role', (await me(edT)).on_projects === true)
const edLogin = await loginFull(editor.username, 'probe123')
ok('…and the login answer says so too, so the door is open from the first page',
  edLogin.user?.on_projects === true, String(edLogin.user?.on_projects))

const edList = (await req('/projects', 'GET', null, edT)).data
const edOwned = edList.find((p) => p.id === owned.data.id)
const edOther = edList.find((p) => p.id === other.data.id)
ok('the editor sees every project, not only their own', !!edOwned && !!edOther, `${edList.length} projects`)
ok('…their own is marked mine', edOwned?.mine === true, String(edOwned?.mine))
ok('…somebody else\'s is not', edOther?.mine === false, String(edOther?.mine))
ok('the owner sees their own budget', edOwned?.budget === 5000, String(edOwned?.budget))
ok('…but not somebody else\'s', !('budget' in (edOther || {})), JSON.stringify(edOther?.budget))

const edDetail = (await req(`/projects/${other.data.id}`, 'GET', null, edT)).data
ok('the budget is withheld on the project\'s own page too, not only in the list',
  !('budget' in edDetail), JSON.stringify(edDetail.budget))
ok('…while the rest of that project is still there to read', edDetail.name === other.data.name, edDetail.name)

// ===================== running a campaign in somebody else's project =====================
const byT = await tokenOf(bystander)
ok('a designer on nothing is not on projects', (await me(byT)).on_projects === false)
const camp = await req('/campaigns', 'POST', { name: `PA camp ${stamp}`, project_id: other.data.id, owner_id: bystander.id })
ok('an admin puts the designer in charge of a campaign in that project', camp.status === 201, JSON.stringify(camp.data).slice(0, 100))
ok('running a campaign in a project puts them on projects', (await me(byT)).on_projects === true)
const byOther = (await req('/projects', 'GET', null, byT)).data.find((p) => p.id === other.data.id)
ok('…and marks that project mine for them', byOther?.mine === true, String(byOther?.mine))
ok('…without handing them its budget: running a campaign is not owning the project',
  !('budget' in (byOther || {})), JSON.stringify(byOther?.budget))

// ===================== the admin =====================
const adList = (await req('/projects')).data
ok('the admin sees every budget', adList.find((p) => p.id === owned.data.id)?.budget === 5000
  && adList.find((p) => p.id === other.data.id)?.budget === 7000)

// ===================== nothing about who may WRITE has moved =====================
ok('seeing a project is not editing it: a non-owner is still refused',
  (await req(`/projects/${other.data.id}`, 'PATCH', { name: 'hijack' }, edT)).status === 403)
ok('…and the owner still may', (await req(`/projects/${owned.data.id}`, 'PATCH', { status: 'at_risk', status_reason: 'Waiting on the venue to confirm the date' }, edT)).status === 200)

// ===================== the little steps under a number =====================
// A number says where the project is going and nothing about how anybody gets
// there. Steps are that, written under the number — and ANYBODY signed in may
// add and tick one, because the person who will do the third step is rarely
// the person who owns the project. What they may not do is move the number
// itself, and a numbers form saved from a stale page must not wipe them.
const numbered = await req('/projects', 'POST', {
  name: `PA numbers ${stamp}`, owner_id: member.id,
  numbers: [{ id: 'n1', name: 'Downloads', current: 120, target: 500 }],
})
const pid = numbered.data.id
const add = (text, t) => req(`/projects/${pid}/numbers/n1/steps`, 'POST', { text }, t)
const stepAdd = await add('Ask the SMM for the banner', edT)
ok('somebody who owns nothing here can add a step', stepAdd.status === 201, JSON.stringify(stepAdd.data).slice(0, 80))
const n1 = () => req(`/projects/${pid}`, 'GET', null, edT).then((r) => r.data.numbers.find((n) => n.id === 'n1'))
let num = await n1()
ok('…it lands under the number it was written for, with a name on it',
  num.steps?.length === 1 && num.steps[0].by_name.startsWith('PA Editor'), JSON.stringify(num.steps?.[0]))
ok('…and the answer is the whole project, so the page needs no second request',
  Array.isArray(stepAdd.data.campaigns) && Array.isArray(stepAdd.data.notes),
  Object.keys(stepAdd.data).join(','))

const stepId = num.steps[0].id
const ticked = await req(`/projects/${pid}/numbers/n1/steps/${stepId}`, 'PATCH', { done: true }, byT)
ok('anybody can tick one', ticked.status === 200, String(ticked.status))
num = await n1()
ok('…and it records who ticked it', num.steps[0].done === true && num.steps[0].done_name.startsWith('PA Designer'),
  JSON.stringify({ done: num.steps[0].done, by: num.steps[0].done_name }))
await req(`/projects/${pid}/numbers/n1/steps/${stepId}`, 'PATCH', { done: false }, byT)
num = await n1()
ok('…and unticking takes the name back off, rather than leaving one on undone work',
  num.steps[0].done === false && !num.steps[0].done_name, JSON.stringify(num.steps[0].done_name))

// The trap this shape is built to avoid.
await req(`/projects/${pid}`, 'PATCH', { numbers: [{ id: 'n1', name: 'Downloads', current: 260, target: 500 }] })
num = await n1()
ok('the owner moving the number does not wipe the steps under it',
  num.current === 260 && num.steps?.length === 1, JSON.stringify({ current: num.current, steps: num.steps?.length }))

ok('a step cannot be written with no words',
  (await add('   ', edT)).status === 400)
ok('a step on a number that is not there is refused',
  (await req(`/projects/${pid}/numbers/nope/steps`, 'POST', { text: 'x' }, edT)).status === 404)
ok('anybody can remove one',
  (await req(`/projects/${pid}/numbers/n1/steps/${stepId}`, 'DELETE', null, byT)).status === 200)
ok('…and it is gone', (await n1()).steps?.length === 0)
ok('a step is not a way in to editing the project',
  (await req(`/projects/${pid}`, 'PATCH', { name: 'hijack' }, edT)).status === 403)
await req(`/projects/${pid}`, 'DELETE')

// ===================== the door itself =====================
// The server can hand somebody the page and the sidebar can still refuse to
// draw the link — which is exactly what happened: `isAdmin && shows('projects')`
// outranked the stake, so a project owner saw Projects on their phone (whose
// shell asks `shows` alone) and not on their laptop. A flag nobody can reach
// is a flag that does not exist, so the doors are read from the source here
// rather than trusted.
const { readFileSync } = await import('fs')
const { join } = await import('path')
const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
const sidebar = readFileSync(join(ROOT, 'client/src/components/Sidebar.jsx'), 'utf8')
const projectsLine = sidebar.split('\n').find((l) => l.includes("key: 'projects'")) || ''
ok('the sidebar offers Projects on what `shows` says, not on being an admin',
  projectsLine.includes("shows('projects')") && !/isAdmin\s*&&\s*shows\('projects'\)/.test(projectsLine),
  projectsLine.trim().slice(0, 96))
const layout = readFileSync(join(ROOT, 'client/src/components/Layout.jsx'), 'utf8')
ok('…and so does the phone', /key: 'projects'/.test(layout) && /\.filter\(\(c\) => shows\(c\.key\)\)/.test(layout))
// THE THIRD SHELL, and the one most of this team is actually in: somebody
// with one channel gets a top bar instead of a sidebar, and that bar lists
// its doors by hand. Projects was simply not among them, so a member who
// owned three projects had no way to reach any of them from a desk. Checked
// by reading the bar, because the flag being right is not the same as the
// door existing.
const soloBar = layout.slice(layout.indexOf('if (solo) {'), layout.indexOf('<MobileTabs tabs={soloTabs}'))
const soloGate = soloBar.includes("shows('projects')")
const soloLink = soloBar.includes('to="/projects"')
ok('…and the one-channel top bar has the door at all', soloGate && soloLink,
  `gate ${soloGate ? 'present' : 'MISSING'}, link ${soloLink ? 'present' : 'MISSING'}`)

// ===================== letting go =====================
await req(`/projects/${owned.data.id}`, 'PATCH', { owner_id: member.id })
ok('handing the project on takes the editor off projects again', (await me(edT)).on_projects === false)

await req(`/campaigns/${camp.data.id}`, 'DELETE')
for (const p of [owned, other]) await req(`/projects/${p.data.id}`, 'DELETE')
for (const u of [editor, member, bystander]) await req(`/users/${u.id}`, 'DELETE')

console.log(fails === 0 ? '\n✔ projects access suite passed' : `\n✘ projects access suite: ${fails} failed`)
process.exit(fails ? 1 : 0)

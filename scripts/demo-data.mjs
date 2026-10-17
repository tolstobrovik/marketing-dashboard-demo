// Fill a LOCAL database with a believable team and six weeks of work, so every
// screen has something on it while you change it: `node scripts/demo-data.mjs`.
//
// Local only. It refuses to run unless the API it talks to is on this machine
// and /api/health answers storage "file" — the private SQLite file under
// data/, never the team's database on GitHub.
//
// Start from a clean board: stop the API, `npm run seed`, start it again
// (`npm run dev`), then run this. It refuses a board that already has tasks.
//
// The work goes in through the API as the seed admin, so the server's own
// rules, notifications and activity log are what made it. The history the
// API can only stamp "now" (when a shoot was handed over, when a piece went
// out, who said yes to a booking) is then written straight into the file.
//
// Everybody it creates signs in with DEMO_PASSWORD.
import { createClient } from '@libsql/client'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import bcrypt from 'bcryptjs'

const API = process.env.DEMO_API || 'http://localhost:4000'
const DEMO_PASSWORD = 'demo-team-2026'
const ADMIN = { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin123' }
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbFile = join(process.env.DATA_DIR || join(root, 'data'), 'dashboard.db')

const stop = (why) => { console.error(`✖ ${why}`); process.exit(1) }

// ---- local, or nothing -------------------------------------------------------
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(API).hostname))
  stop(`${API} is not this machine — demo data only ever goes into a local database`)
const health = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null)
if (!health) stop(`No API at ${API} — start it with \`npm run dev\` first`)
if (health.storage !== 'file') stop(`The API is on "${health.storage}" storage, not the local file — refusing`)
if (!existsSync(dbFile)) stop(`No database at ${dbFile}`)

// ---- the API, as somebody --------------------------------------------------------
async function call(token, method, path, body) {
  const r = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${data?.error || text}`)
  return data
}
const login = async (username, password) => (await call(null, 'POST', '/auth/login', { username, password })).token

const admin = await login(ADMIN.username, ADMIN.password)
  .catch(() => stop('Could not sign in as the seed admin — run `npm run seed` for a clean board, or set ADMIN_PASSWORD'))
const db = createClient({ url: `file:${dbFile}` })
// The running API writes the same file (notifications, the activity log); wait
// for its turn rather than failing on "database is locked".
await db.execute('PRAGMA busy_timeout = 20000')
const one = async (sql, ...args) => (await db.execute({ sql, args })).rows[0]
const run = (sql, ...args) => db.execute({ sql, args })

if ((await one('SELECT COUNT(*) AS n FROM content')).n > 0)
  stop('This board already has tasks. For a clean start: stop the API, `npm run seed`, start it, run this again')

// ---- the same "random" every time --------------------------------------------------
let seed = 20261016
const rnd = () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (list) => list[Math.floor(rnd() * list.length)]
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const chance = (p) => rnd() < p
const hour = (a, b) => String(between(a, b)).padStart(2, '0')

// ---- days, in Tashkent ---------------------------------------------------------------
const TZ = 'Asia/Tashkent'
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const day = (offset) => {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const at = (d, hhmm = '12:00') => new Date(`${d}T${hhmm}:00+05:00`).toISOString()
const plusMin = (hhmm, m) => {
  const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + m
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
// Never in the future: a stamp is something that already happened.
const past = (iso) => (Date.parse(iso) > Date.now() ? new Date(Date.now() - between(5, 90) * 60000).toISOString() : iso)

// Uzbek in the brand book's letters: oʻ gʻ with U+02BB, the tutuq belgisi U+02BC.
const uz = (s) => s.replace(/([oOgG])'/g, '$1ʻ').replace(/'/g, 'ʼ')

// ---- the team ---------------------------------------------------------------------------
const WEEK = [1, 2, 3, 4, 5, 6]
const PEOPLE = [
  { key: 'dilnoza', name: 'Dilnoza Karimova', role: 'member', departments: ['instagram_main', 'youtube'], position: 'SMM — Instagram Main', color: '#A22036' },
  { key: 'sardor', name: 'Sardor Aliev', role: 'member', departments: ['instagram_uzb', 'target'], position: 'SMM — Instagram Uzb', color: '#2a78d6' },
  { key: 'malika', name: 'Malika Yusupova', role: 'member', departments: ['telegram_main', 'telegram_uzb', 'linkedin', 'x_twitter', 'threads'], position: 'Copywriter', color: '#7b5ad6' },
  { key: 'javohir', name: 'Javohir Rakhimov', role: 'member', departments: ['target', 'instagram_main'], position: 'Targetologist', color: '#BA7517' },
  { key: 'otabek', name: 'Otabek Nazarov', role: 'operator', position: 'Operator', color: '#1D9E75' },
  { key: 'bekzod', name: 'Bekzod Tursunov', role: 'operator', position: 'Operator', color: '#0e8f8f',
    study: [{ d: 2, from: '09:00', to: '13:00', label: 'University' }, { d: 4, from: '09:00', to: '13:00', label: 'University' }] },
  { key: 'aziz', name: 'Aziz Khamidov', role: 'crew', crew_roles: ['operator', 'editor'], position: 'Operator & editor', color: '#5a6b7a',
    study: [{ d: 1, from: '14:00', to: '17:00', label: 'Lectures' }, { d: 3, from: '14:00', to: '17:00', label: 'Lectures' }] },
  { key: 'eldor', name: 'Eldor Saidov', role: 'editor', position: 'Editor', color: '#d6499b' },
  { key: 'kamola', name: 'Kamola Ismoilova', role: 'editor', position: 'Editor', color: '#2a78d6' },
  { key: 'nigora', name: 'Nigora Abdullaeva', role: 'designer', position: 'Designer', color: '#7b5ad6' },
  { key: 'shahzoda', name: 'Shahzoda Mirzaeva', role: 'designer', position: 'Designer', color: '#1D9E75' },
]

const who = {}
for (const p of PEOPLE) {
  const u = await call(admin, 'POST', '/users', {
    name: p.name, username: p.key, password: DEMO_PASSWORD, role: p.role, color: p.color,
    ...(p.crew_roles ? { crew_roles: p.crew_roles } : {}),
    ...(p.departments ? { departments: p.departments } : {}),
    position: p.position, phone: `+998 9${between(0, 9)} ${between(100, 999)} ${between(10, 99)} ${between(10, 99)}`,
    work_start: '09:00', work_end: '18:00', work_days: WEEK,
  })
  who[p.key] = u.id
  if (p.study) await run('UPDATE users SET study_blocks = ? WHERE id = ?', JSON.stringify(p.study), u.id)
}
// Every channel has somebody who answers for it.
const HEADS = {
  instagram_main: 'dilnoza', youtube: 'dilnoza', instagram_uzb: 'sardor', target: 'javohir',
  telegram_main: 'malika', telegram_uzb: 'malika', linkedin: 'malika', x_twitter: 'malika', threads: 'malika',
}
for (const [key, head] of Object.entries(HEADS)) await run('UPDATE channels SET head_id = ? WHERE key = ?', who[head], key)
console.log(`✔ ${PEOPLE.length} people`)

// ---- what each channel makes ----------------------------------------------------------
const CHANNELS = {
  instagram_main: {
    maker: 'dilnoza', ops: ['otabek', 'aziz'], eds: ['eldor', 'kamola'], des: ['nigora', 'shahzoda'],
    reel: [
      '5 ошибок на SAT Math, которые стоят 100 баллов',
      'Как наш выпускник поступил в NYU с SAT 1520',
      'Один день в SATashkent перед декабрьским SAT',
      'IELTS 8.0 за три месяца — реально?',
      'Что пишут в эссе те, кто получил 100% стипендию',
      'Задача из реального SAT за 60 секунд',
      'Сколько на самом деле стоит учёба в США',
      'Common App за пять шагов',
      'Мифы о Duolingo English Test',
      'Студенты отвечают: почему SATashkent',
      'До SAT месяц — что делать',
      'Полный разбор: как наша выпускница получила офферы из трёх университетов Лиги плюща, сдав SAT с первого раза и написав эссе о бабушкиной швейной машинке',
      'Преподаватель проверяет ответы ChatGPT на SAT',
      'Early Decision или Regular — что выбрать',
    ],
    post: [
      'Расписание пробных SAT на ноябрь',
      'Наши результаты октябрьского SAT',
      'Новый поток IELTS — старт 3 ноября',
      'Карусель: 10 слов для SAT Reading',
      'Дедлайны Early Decision 2027',
      'Отзыв родителей: «Сын поступил в Purdue»',
    ],
    story: ['Сторис: опрос — какой экзамен сдаёте?', 'Сторис: за кадром съёмки', 'Сторис: напоминание о пробнике'],
  },
  instagram_uzb: {
    maker: 'sardor', ops: ['bekzod', 'otabek'], eds: ['kamola', 'aziz'], des: ['shahzoda', 'nigora'],
    reel: [
      "SAT'dan 1500+ olish sirlari",
      'AQSh universitetiga hujjat topshirish: 5 qadam',
      "IELTS Writing: eng ko'p uchraydigan xatolar",
      "Grant yutgan o'quvchilarimiz bilan suhbat",
      'SAT Math: bitta masala 60 soniyada',
      "Ota-onalar uchun: chet elda o'qish qancha turadi",
      "SATashkent'da bir kun",
      "Esse: birinchi jumla qanday bo'lishi kerak",
      'Imtihondan oldingi kecha nima qilish kerak',
      "Toshkentdan Stenfordgacha: bitiruvchimiz hikoyasi va u bilan birga o'tgan uch yillik tayyorgarlik yo'li",
    ],
    post: ['Noyabr sinov SAT jadvali', 'Oktyabr SAT natijalarimiz', "Yangi IELTS guruhi — 3-noyabrdan", "SAT Reading uchun 10 ta so'z", 'Early Decision muddatlari'],
    story: ['Stories: qaysi imtihonni topshirasiz?', 'Stories: suratga olish sahnasi ortida'],
  },
  youtube: {
    maker: 'dilnoza', ops: ['otabek'], eds: ['eldor'],
    video: [
      'Полный разбор SAT Math за 40 минут',
      'Подкаст: путь в Стэнфорд',
      'Вебинар Common App — запись',
      'SAT Reading: стратегия на 54 вопроса',
      'Интервью с приёмной комиссией',
    ],
  },
  target: {
    maker: 'javohir', ops: ['bekzod', 'aziz'], eds: ['aziz', 'kamola'], des: ['nigora'],
    reel: [
      'Таргет: набор на ноябрьский поток SAT',
      'Реклама: бесплатный пробный SAT',
      'Ads: IELTS intensive за 6 недель',
      'Таргет: родители 9–11 классов',
      'Реклама: консультация по поступлению',
    ],
    post: ['Баннер: скидка до конца октября', 'Баннер: пробный тест в субботу', 'Баннер: набор в группу Uzb'],
  },
  telegram_main: {
    maker: 'malika', text: true,
    post: [
      'Пробный SAT в субботу — запись открыта',
      'Вебинар: как выбрать университет в США',
      'Разбор эссе выпускника',
      '7 ресурсов для SAT Reading',
      'Итоги недели в SATashkent',
      'Дедлайны ноября — напоминание',
      'Вебинар: стипендии в Европе',
      'Как читать результаты SAT',
    ],
  },
  telegram_uzb: {
    maker: 'malika', text: true,
    post: [
      "Shanba kuni sinov SAT — ro'yxat ochiq",
      'Vebinar: AQShda universitet tanlash',
      'Bitiruvchi essesi tahlili',
      'SAT Reading uchun 7 ta manba',
      'Hafta yakunlari',
      'Ota-onalar savollariga javoblar',
    ],
  },
  linkedin: { maker: 'malika', post: ['Our Fall 2026 admissions results', 'Hiring: SAT Math instructor', 'What 300 essays taught us'] },
  x_twitter: { maker: 'malika', post: ['5 SAT myths, debunked', 'Early Decision deadlines this week', 'One SAT Math tip a day'] },
  threads: { maker: 'malika', post: ['Что спросить у приёмной комиссии', 'Your IELTS questions, answered'] },
}
const UZB = new Set(['instagram_uzb', 'telegram_uzb'])

const SCRIPTS = [
  'Хук: «Ты теряешь 100 баллов вот здесь». Три ошибки на доске, по 10 секунд на каждую. В конце — запись на пробный SAT.',
  'Студент в кадре рассказывает свою историю: с чего начал, какой был первый балл, что изменилось. Перебивки — класс, тетради, результат на экране.',
  'Преподаватель решает задачу у доски на время, таймер в углу. Финал: «Хочешь так же — приходи на пробник в субботу».',
  'Формат вопрос-ответ: пять коротких вопросов от подписчиков, ответ на каждый не длиннее 8 секунд.',
]
const TZS = [
  'Длина 30–45 с. Субтитры по всей длине, крупно. Хук в первые 2 секунды. В конце логотип и CTA.',
  'Вертикаль 9:16, 40–60 с. Темп быстрый, без пауз. Музыка спокойная, тише голоса. Обложка с цифрой.',
  'Горизонталь 16:9, главы в описании. Цветокор тёплый, звук почистить. Превью отдельно — с лицом и цифрой.',
]
const REFS = [
  'Как в прошлом разборе SAT Math: белая доска, крупный шрифт, быстрые склейки.',
  'Светлый кадр у окна, без музыки на фоне речи, субтитры жёлтым.',
  'Карусель в фирменных цветах: рубиновый заголовок, светло-серый фон, одна мысль на слайд.',
]
const DESCRIPTIONS = [
  'Для тех, кто сдаёт в декабре. Цель — записи на пробный тест.',
  'Повторяем то, что зашло в прошлом месяце, но с новым студентом.',
  'Охват + сохранения. Отвечаем на частый вопрос из директа.',
  '',
]

// ---- the pipeline ---------------------------------------------------------------------------
const stages = Object.fromEntries((await db.execute('SELECT id, label FROM statuses')).rows.map((r) => [r.label, r.id]))
const designStages = Object.fromEntries((await db.execute('SELECT id, label FROM design_statuses')).rows.map((r) => [r.label, r.id]))
const ORDER = ['Idea', 'To shoot', 'Editing', 'Ready', 'Published']
const reached = (stage, than) => ORDER.indexOf(stage) >= ORDER.indexOf(than)
const campaigns = (await db.execute('SELECT id FROM campaigns')).rows.map((r) => r.id)

// Where a piece stands, read from how far its release day is from today.
// Behind today most are out; around today they are in the making; ahead they
// are booked or still ideas. A share of each band is late on purpose — a calm
// board hides what a crowded one shows.
function stageOf({ filmed, rel, rec }) {
  const p = rnd()
  if (rel < -3) return p < 0.68 ? 'Published' : p < 0.8 ? 'Ready' : p < 0.92 ? 'Editing' : p < 0.96 && filmed ? 'To shoot' : 'Deleted'
  if (rel < 0) return p < 0.35 ? 'Published' : p < 0.6 ? 'Ready' : p < 0.85 ? 'Editing' : filmed ? 'To shoot' : 'Editing'
  if (filmed) {
    if (rec >= 0) return rel > 6 && p < 0.4 ? 'Idea' : 'To shoot'
    return p < 0.5 ? 'Editing' : p < 0.8 ? 'Ready' : 'To shoot'
  }
  if (rel <= 3) return p < 0.35 ? 'Ready' : p < 0.85 ? 'Editing' : 'Idea'
  return p < 0.4 ? 'Editing' : 'Idea'
}

// A few fixed pieces, so today is never empty: two shoots today (one still
// waiting for the operator's yes), one tomorrow, two going out today.
const PINNED = {
  '5 ошибок на SAT Math, которые стоят 100 баллов': { rel: 2, rec: 0, start: '15:30', op: 'otabek', ack: '' },
  "SAT'dan 1500+ olish sirlari": { rel: 3, rec: 0, start: '11:00', op: 'bekzod', ack: 'yes' },
  'Подкаст: путь в Стэнфорд': { rel: 6, rec: 1, start: '14:00', op: 'otabek', ack: '' },
  'Наши результаты октябрьского SAT': { rel: 0, stage: 'Ready' },
  'Пробный SAT в субботу — запись открыта': { rel: 0, stage: 'Ready' },
}

const pieces = []
for (const [ch, c] of Object.entries(CHANNELS)) {
  for (const type of ['reel', 'video', 'post', 'story']) {
    for (const raw of c[type] || []) {
      const pin = PINNED[raw] || {}
      const filmed = type === 'reel' || type === 'video'
      const designed = type === 'post' && !!c.des
      const rel = pin.rel ?? between(-32, 20)
      const rec = pin.rec ?? rel - between(2, 6)
      const stage = pin.stage || (pin.rec !== undefined ? 'To shoot' : stageOf({ filmed, rel, rec }))
      pieces.push({ ch, c, type, raw, title: UZB.has(ch) ? uz(raw) : raw, filmed, designed, rel, rec, stage, pin })
    }
  }
}

// ---- in through the API, as the admin ---------------------------------------------------------
const START = ['10:00', '10:30', '11:00', '14:00', '15:00', '16:30']
const RELEASE = ['12:00', '18:00', '19:00', '20:00']
for (const p of pieces) {
  const { c, filmed, designed, rel, rec, pin } = p
  const idea = p.stage === 'Idea'
  const body = {
    title: p.title, channels: [p.ch], type: p.type, status_id: stages[p.stage],
    assignee_ids: [who[c.maker]], reviewer_id: who[c.maker],
    release_date: day(rel), release_time: pick(RELEASE),
    description: pick(DESCRIPTIONS),
    force: true,
  }
  if (chance(0.3) && campaigns.length) body.campaign_id = pick(campaigns)
  if (c.text) body.telegram_type = pick(['just_post', 'just_post', 'post_plus', 'webinar'])
  if (filmed && !idea) {
    const start = pin.start || pick(START)
    Object.assign(body, {
      operator_id: who[pin.op || pick(c.ops)], editor_id: who[pick(c.eds)],
      recording_date: day(rec), recording_time: start, recording_end: plusMin(start, pick([60, 90, 120])),
      edit_ready_date: day(rel - 1),
      script: pick(SCRIPTS), tz: pick(TZS), reference_text: pick(REFS),
    })
  }
  if (designed && !idea) Object.assign(body, { designer_id: who[pick(c.des)], design_ready_date: day(rel - 1), reference_text: pick(REFS) })
  if (p.stage === 'Published') body.done_at = at(day(rel), body.release_time)
  const row = await call(admin, 'POST', '/content', body)
  Object.assign(p, { id: row.id, body })
}
console.log(`✔ ${pieces.length} tasks`)

// ---- the history the API could only stamp "now" ----------------------------------------------
const yes = (by, d) => ({ ack: 'yes', at: past(at(d, `${hour(9, 17)}:${pick(['00', '15', '30', '45'])}`)), by })
let late = 0
for (const p of pieces) {
  const { body, filmed, designed, rel, rec, stage, pin } = p
  const set = {}
  const created = at(day(Math.min(rec, rel) - between(3, 10)), `${hour(9, 18)}:${pick(['05', '20', '40'])}`)
  set.created_at = past(created)

  if (filmed && body.operator_id) {
    // The operator's answer: yes once filmed; ahead, mostly yes, some still
    // waiting, one or two "no" with a reason.
    let a = yes(body.operator_id, day(Math.min(rec, 0) - between(1, 3)))
    if (stage === 'To shoot' && rec >= 0) {
      const p2 = rnd()
      if (pin.ack === '' || (pin.ack === undefined && p2 < 0.3)) a = { ack: '' }
      else if (pin.ack === undefined && p2 < 0.38) a = { ack: 'no', at: past(at(day(-1), '20:10')), by: body.operator_id, note: 'В это время у меня пара — могу после 17:00' }
    }
    Object.assign(set, { shoot_ack: a.ack, shoot_ack_at: a.at ?? null, shoot_ack_by: a.by ?? null, shoot_ack_note: a.note ?? null })
    const e = stage === 'Editing' && rel >= 0 && chance(0.25) ? { ack: '' } : yes(body.editor_id, day(Math.min(rec, 0)))
    Object.assign(set, { edit_ack: e.ack, edit_ack_at: e.at ?? null, edit_ack_by: e.by ?? null })
    if (reached(stage, 'Editing')) {
      set.shot_at = past(at(day(rec + (chance(0.15) ? 1 : 0)), body.recording_end))
      set.shot_link = `https://drive.google.com/drive/folders/1demo${p.id}raw`
    }
  }
  if (reached(stage, 'Ready')) {
    const handed = past(at(day(rel - 1 + (chance(0.2) ? between(1, 2) : 0)), `${hour(15, 21)}:${pick(['00', '30'])}`))
    set.edited_at = handed
    set.ready_at = handed
    if (filmed) set.ready_link = `https://drive.google.com/file/d/1demo${p.id}cut/view`
    if (designed) set.design_link = `https://drive.google.com/file/d/1demo${p.id}art/view`
    if (chance(0.6)) Object.assign(set, { approved_at: handed, approved_by: who[p.c.maker], approved_name: PEOPLE.find((x) => x.key === p.c.maker).name })
  }
  if (designed && stage !== 'Idea')
    set.design_status_id = designStages[{ 'To shoot': 'New task', Editing: pick(['New task', 'In progress', 'In progress']), Ready: 'Manager review' }[stage] || 'Approved']
  if (stage === 'Published') {
    set.post_link = p.ch.startsWith('instagram') ? `https://www.instagram.com/${p.type === 'reel' ? 'reel' : 'p'}/DEMO${p.id}x/`
      : p.ch === 'youtube' ? `https://www.youtube.com/watch?v=demo${p.id}`
        : p.ch.startsWith('telegram') ? `https://t.me/satashkent/${1200 + p.id}` : `https://example.com/post/${p.id}`
    if (rel < -2) {
      set.views = between(800, p.type === 'reel' ? 60000 : 9000)
      set.views_at = past(at(day(rel + 2), '10:00'))
      set.views_by = who[p.c.maker]
      if (p.type === 'reel') { set.skip_rate = between(18, 72); set.skip_rate_at = set.views_at }
    }
  }
  if (!reached(stage, 'Ready') && stage !== 'Deleted' && rel < 0) late++
  const cols = Object.keys(set)
  await run(`UPDATE content SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => set[k]), p.id)
  await run("UPDATE activity SET created_at = ? WHERE content_id = ? AND kind = 'created'", set.created_at, p.id)
}
console.log(`✔ history written (${late} pieces late on purpose)`)

// ---- people talking: change requests and comments, as themselves ---------------------------------
const tokens = { admin }
const as = async (key) => (tokens[key] ||= await login(key, DEMO_PASSWORD))
const nameOf = (id) => PEOPLE.find((x) => who[x.key] === id)?.name.split(' ')[0] || 'Admin'

const PRAVKI = [
  'Субтитры не совпадают с речью на 0:08–0:15 — поправь, пожалуйста.',
  'Хук слишком длинный: первые 2 секунды должны сразу цеплять. Обрежь паузу в начале.',
  'Логотип в конце еле видно — сделай крупнее и подержи на секунду дольше.',
]
// Pieces handed in and not out yet, the nearest first: a cut or two and a
// piece of artwork go back for a fix.
const sentBack = pieces.filter((p) => p.stage === 'Ready' && (p.filmed || p.designed) && !PINNED[p.raw])
  .sort((a, b) => Math.abs(a.rel) - Math.abs(b.rel)).slice(0, 4)
for (const [i, p] of sentBack.entries()) {
  await run('UPDATE content SET approved_at = NULL, approved_by = NULL, approved_name = \'\' WHERE id = ?', p.id)
  const note = p.filmed ? PRAVKI[i % PRAVKI.length] : 'Заголовок не читается на телефоне — крупнее и в две строки.'
  await call(await as(p.c.maker), 'POST', `/content/${p.id}/revisions`, { note, target: p.filmed ? 'editor' : 'designer' })
  p.stage = 'Editing'
}

const LINES = {
  maker: ['Сценарий готов, посмотрите 🙏', 'Можно обложку чуть ярче?', 'Отлично, публикуем по плану', 'Добавьте в описание ссылку на запись', 'Это в приоритете на этой неделе'],
  operator: ['Буду на месте к началу', 'Снял, исходники в папке', 'Свет в классе плохой — возьму лампу', 'Можно сдвинуть на полчаса позже?'],
  editor: ['Монтаж отправил, ссылка в задаче', 'Беру в работу сегодня', 'Нужна музыка без авторских прав — есть варианты?', 'Субтитры поправил'],
  designer: ['Два варианта обложки в папке', 'Шрифт Nekst на заголовке, как в брендбуке', 'Беру, к вечеру будет'],
}
let said = 0
for (const p of pieces) {
  if (p.stage === 'Idea' || !chance(0.45)) continue
  const voices = [['maker', who[p.c.maker]]]
  if (p.body.operator_id) voices.push(['operator', p.body.operator_id])
  if (p.body.editor_id) voices.push(['editor', p.body.editor_id])
  if (p.body.designer_id) voices.push(['designer', p.body.designer_id])
  const n = between(1, 4)
  const from = Date.parse(await one('SELECT created_at FROM content WHERE id = ?', p.id).then((r) => r.created_at))
  for (let k = 0; k < n; k++) {
    const [hat, id] = voices[k % voices.length]
    const key = PEOPLE.find((x) => who[x.key] === id).key
    const c = await call(await as(key), 'POST', `/content/${p.id}/comments`, { text: pick(LINES[hat]) })
    const when = new Date(Math.min(Date.now() - 60000, from + (k + 1) * between(2, 30) * 3600000)).toISOString()
    await run('UPDATE comments SET created_at = ? WHERE content_id = ? AND user_id = ? AND id = (SELECT MAX(id) FROM comments WHERE content_id = ?)', when, p.id, id, p.id)
    said++
  }
}
// The bell starts with the last few days unread, not six weeks of it.
await run('UPDATE notifications SET read_at = ? WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 60)', new Date().toISOString())
console.log(`✔ ${sentBack.length} change requests, ${said} comments`)

const count = Object.fromEntries((await db.execute('SELECT s.label, COUNT(*) AS n FROM content c JOIN statuses s ON s.id = c.status_id GROUP BY s.label')).rows.map((r) => [r.label, r.n]))
console.log('  by stage:', count)
// The admin signs in with the demo password too, so the "your password is the
// one this app ships with" warning — which the real team never sees — is not
// drawn over every admin screen.
await run("UPDATE users SET password_hash = ?, weak_password = 0 WHERE username = 'admin'", bcrypt.hashSync(DEMO_PASSWORD, 10))
console.log(`\nDone. Sign in as admin or any of: ${PEOPLE.map((p) => p.key).join(', ')} (password: ${DEMO_PASSWORD}).`)
db.close()

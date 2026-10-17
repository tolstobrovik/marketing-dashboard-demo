// The brand book, as checks. SATashkent BRAND BOOK v1 (August 2026) is the
// source; every rule below is one of its rules, read from the code rather
// than remembered in review.
//
//   six colours     ruby #A22036, bright red #CB3351, near black #262626,
//                   mid grey #B6B6B7, light grey #E9E9E9, white — one red
//                   variable, and none of the reds the book lists as escaped
//   no gradients    anywhere in the identity
//   type            the page headline is Nekst (--font-display), everything
//                   else Inter — the owner confirmed Nekst's web licence on
//                   7 October 2026; nothing heavier than Bold (Thin and Black
//                   are not used), none of the retired faces
//   the sidebar     neutral in the Coach look, ruby in the previous one
//   mid grey        is never text
//   the logo        is the book's artwork, never redrawn or re-typeset
//   Uzbek           oʻ/gʻ with U+02BB and the tutuq belgisi with U+02BC
//
//   node qa/brand-suite.mjs            (reads the source; no server needed)
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = process.env.DASHB_ROOT || '/home/user/dashb'
let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = `${dir}/${f}`
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p]
})
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const css = read('client/src/styles.css')
const cssCode = noComments(css)
const code = walk('client/src').filter((p) => /\.(jsx?|css)$/.test(p))
  .map((p) => ({ p, s: noComments(read(p)) }))
  .concat(['server/db.js', 'server/routes/users.js', 'server/routes/boards.js'].map((p) => ({ p, s: noComments(read(p)) })))

// ---- colour ----
const tok = (name) => (new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css) || [])[1]?.toUpperCase()
ok('ruby is #A22036', tok('ruby') === '#A22036', tok('ruby'))
ok('bright red is #CB3351', tok('bright-red') === '#CB3351', tok('bright-red'))
ok('near black is #262626', tok('near-black') === '#262626', tok('near-black'))
ok('mid grey is #B6B6B7', tok('mid-grey') === '#B6B6B7', tok('mid-grey'))
ok('light grey is #E9E9E9', tok('light-grey') === '#E9E9E9', tok('light-grey'))
ok('type on ruby is light grey, not white', tok('on-ruby') === '#E9E9E9', tok('on-ruby'))

// The reds the book names as escaped or retired, and the ones this board had
// grown on its own. None of them may be written anywhere.
const RETIRED = ['8D1D2C', 'C1272D', '8B1A2E', 'C4243F', 'C0392B', '8F171C',
  'A32234', 'A32D2D', 'B5324A', 'D03B3B', '8C1D2C', 'C44A60', '711523', '8C2438', 'C2185B']
const hits = []
for (const { p, s } of code) {
  for (const h of RETIRED) if (new RegExp(`#${h}\\b`, 'i').test(s)) hits.push(`${p}: #${h}`)
}
ok('no retired or escaped red is used anywhere', hits.length === 0, hits.slice(0, 6).join(', '))

// Any red at all outside the token block has to come from the tokens.
const tokenBlockEnd = cssCode.indexOf('* { box-sizing: border-box; }')
const body = cssCode.slice(tokenBlockEnd)
// A red is a saturated colour whose hue sits within a few degrees of red —
// orange file icons and amber warnings are not reds.
const hexRed = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max < 110 || (max - min) / max < 0.45) return false
  let h = max === r ? 60 * (((g - b) / (max - min)) % 6) : max === g ? 60 * ((b - r) / (max - min) + 2) : 60 * ((r - g) / (max - min) + 4)
  if (h < 0) h += 360
  return h <= 12 || h >= 335
}
const strayReds = [...body.matchAll(/#([0-9A-Fa-f]{6})\b/g)]
  .map((m) => m[1]).filter((h) => hexRed([0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))))
  .filter((h) => !['A22036', 'CB3351'].includes(h.toUpperCase()))
ok('every red in the stylesheet is a token', strayReds.length === 0, [...new Set(strayReds)].slice(0, 8).join(' '))

// ---- no gradients ----
// What is left are patterns and fades that carry no colour of their own:
// hairline grids, stripes, masks. A gradient between two colours is gone.
const grads = [...body.matchAll(/(linear|radial|conic)-gradient\(([^;]*)/g)].map((m) => m[2])
const colourful = grads.filter((g) => /var\(--(brand|ruby|bright-red|near-black|surface|page)/.test(g)
  || /#(?!000\b)[0-9A-Fa-f]{3,6}\b/.test(g))
ok('no gradient carries a colour', colourful.length === 0, colourful.slice(0, 3).join(' | '))
// Two looks, two sidebars: the previous look's is flat ruby; in the Coach look
// ruby is the one strong colour, so the sidebar steps down to the soft ground.
ok('the sidebar is flat ruby in the previous look', /\.sidebar \{[^}]*background: var\(--ruby\);/.test(body))
ok('…and neutral in the Coach look', /html\[data-look="coach"\] \.sidebar \{[^}]*background: var\(--soft\);/.test(body))

// ---- type ----
// The owner confirmed the web licence for Nekst on 7 October 2026. It is the
// page's one headline and a large number; everything else is Inter, which also
// stands behind it in the stack for the Uzbek ʻ ʼ Nekst cannot set.
ok('the page headline is Nekst, with Inter behind it', /--font-display: 'Nekst', 'Inter'/.test(css))
ok('the interface is Inter', /--font: 'Inter'/.test(css))
const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1])
ok('Nekst is served from this board, in the two weights a headline uses, and never blocks the text',
  faces.length === 2 && faces.every((f) => /font-family: 'Nekst'/.test(f) && /font-display: swap/.test(f) && /url\('\/fonts\/Nekst-(SemiBold|Bold)\.ttf'\)/.test(f))
  && /font-weight: 600/.test(faces[0]) && /font-weight: 700/.test(faces[1])
  && ['SemiBold', 'Bold'].every((w) => { try { return statSync(join(ROOT, `client/public/fonts/Nekst-${w}.ttf`)).size > 50000 } catch { return false } }))
// In the Coach look the display face is the headline's alone: what wore it as
// Georgia — a window's title, a question, a group's heading — is Inter.
ok('…and in the Coach look only the headline wears it',
  /html\[data-look="coach"\] :where\([^)]*\.modal-head h3[^)]*\.tb-ask[^)]*\.sp-head h2[^)]*\) \{ font-family: var\(--font\);/.test(css)
  && /html\[data-look="coach"\] :where\([^)]*\.co-title\) \{ font-family: var\(--font-display\);/.test(css))
const heavy = code.filter(({ s }) => /font-weight:\s*(800|900)|fontWeight:\s*['"]?(800|900)/.test(s)).map(({ p }) => p)
ok('nothing heavier than Bold — Thin and Black are not used', heavy.length === 0, heavy.join(', '))
const retiredFaces = code.filter(({ s }) => /Golos|Poppins|Calibri|Lora\b|Myriad|Space Grotesk|['"]Arial/i.test(s)).map(({ p }) => p)
ok('none of the retired faces is named', retiredFaces.length === 0, retiredFaces.join(', '))
const html = read('client/index.html')
ok('Inter is the only face fetched from outside; the bold Nekst is preloaded from this board',
  /family=Inter/.test(html) && !/Golos/.test(html) && !/css2\?family=(?!Inter)/.test(html)
  && /<link rel="preload" href="\/fonts\/Nekst-Bold\.ttf" as="font" type="font\/ttf" crossorigin \/>/.test(html))

// ---- mid grey is never text ----
ok('mid grey is never a text colour', !/(^|[;\s{])color:\s*(var\(--mid-grey\)|#B6B6B7)/i.test(body))

// ---- the logo ----
const logo = read('client/src/components/Logo.jsx')
ok('the logo is the brand book\'s artwork, not a drawing or a font', /\/brand\/mark\.png/.test(logo) && !/<path\b/.test(logo) && !/logo-word|logo-sat/.test(logo))
ok('on ruby it is light grey', /reversed \? 'var\(--on-ruby\)'/.test(logo))
const login = read('client/src/pages/Login.jsx')
ok('the sign-in page shows the stacked lockup, not a typed wordmark', /<LogoStacked/.test(login) && !/login-word/.test(login))

// ---- Uzbek apostrophes ----
const i18n = read('client/src/lib/i18n.jsx').replace(/\r\n/g, '\n')
const uzText = i18n.slice(i18n.indexOf('const UZ = {'), i18n.indexOf('\n}', i18n.indexOf('const UZ = {')))
  + i18n.slice(i18n.indexOf('\n  uz: {\n'), i18n.indexOf('\n}', i18n.indexOf('\n  uz: {\n')))
const uzValues = [...uzText.matchAll(/:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)].map((m) => m[1].slice(1, -1))
const wrong = uzValues.filter((v) => /[A-Za-z][‘’'`][A-Za-z]/.test(v))
ok('Uzbek uses ʻ (U+02BB) and ʼ (U+02BC), not quotes, for its apostrophes', wrong.length === 0, wrong.slice(0, 4).join(' | '))
ok('…and oʻ/gʻ take the turned comma', /[oOgG]ʻ/.test(uzText) && !/[oOgG]ʼ[a-z]/.test(uzText))

console.log(fails ? `\n${fails} FAILED` : '\nall good')
process.exit(fails ? 1 : 0)

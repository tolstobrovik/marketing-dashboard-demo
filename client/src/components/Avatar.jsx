import { initials } from '../lib/constants.js'

// Team avatar: the profile photo when one is set, initials on the accent
// color otherwise.
//
// The initials always read (S-07): white where white has 4.5:1 on the
// person's colour, near-black where that does (4.6, a hair above the 4.5 line,
// since axe rounds its own way), and where neither does the
// fill is deepened towards near-black until white reads. Seven of the demo's
// twelve colours (a mid green, a teal, a pink, a blue) gave white 3.4–4.4:1.
const lum = (hex) => {
  const n = String(hex).replace('#', '')
  if (n.length < 6) return 0
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const NEAR_BLACK_LUM = 0.0186   // #262626, the brand's near black
export function inkOn(color) {
  const L = lum(color)
  if (1.05 / (L + 0.05) >= 4.6) return { color: 'var(--white)' }
  if ((L + 0.05) / (NEAR_BLACK_LUM + 0.05) >= 4.6) return { color: 'var(--near-black)' }
  return { color: 'var(--white)', background: `color-mix(in srgb, ${color} 68%, var(--near-black))` }
}
export default function Avatar({ name, color = '#A22036', size = 'md', src = null }) {
  const cls = size === 'xs' ? 'avatar avatar-xs' : size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar'
  if (src) {
    return <img className={`${cls} avatar-img`} src={src} alt={name} title={name} />
  }
  return (
    <div className={cls} style={{ background: color, ...inkOn(color) }} title={name}>
      {initials(name)}
    </div>
  )
}

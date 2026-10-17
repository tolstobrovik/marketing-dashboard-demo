// The SATashkent logo — the brand book's own artwork, never a redrawing.
//
// The brand book is plain about it: logo files are frozen, nobody redraws
// them, and the wordmark is never rebuilt in another typeface. This file used
// to do both — a hand-drawn SVG of the shield and "SATashkent" set in the
// display font — so it now shows the artwork itself, taken from BRAND BOOK v1:
//
//   /brand/mark.png            L1, the mark alone (from the cover lockup)
//   /brand/l2-mark|type.png    L2, the horizontal lockup, split in two layers
//   /brand/l3-mark|type.png    L3, the stacked lockup, split in two layers
//
// Each file is used as a mask and filled with a token, because the book
// allows exactly two treatments: on white or light grey the mark is ruby and
// the type near black; on ruby (and, by the same rule, on a dark ground)
// both are light grey #E9E9E9 — never white, never any other colour. Two
// layers let the mark and the type take different colours without either
// being moved: they are the same size and sit exactly on top of each other.
//
// To regenerate the files from the PDF: see the note in CLAUDE.md (Brand).

const ART = {
  mark: { w: 294, h: 331 },
  l2: { w: 515, h: 96 },
  l3: { w: 660, h: 538 },
}

function Layer({ src, color }) {
  const mask = `url(${src}) center / 100% 100% no-repeat`
  return <span className="brand-layer" style={{ WebkitMask: mask, mask, background: color }} />
}

// The mark alone, `size` pixels tall.
export default function Logo({ size = 36, tone }) {
  const w = Math.round((size * ART.mark.w) / ART.mark.h)
  return (
    <span className="brand-art" style={{ width: w, height: size }} role="img" aria-label="SATashkent">
      <Layer src="/brand/mark.png" color={tone || 'var(--logo-mark)'} />
    </span>
  )
}

// L2, the horizontal lockup: the mark, SATASHKENT and "College Prep
// Community", as one piece. `reversed` is the treatment for a ruby ground.
export function LogoLockup({ height = 34, reversed = false }) {
  const w = Math.round((height * ART.l2.w) / ART.l2.h)
  return (
    <div className="logo-lockup">
      <span className="brand-art" style={{ width: w, height }} role="img" aria-label="SATashkent — College Prep Community">
        <Layer src="/brand/l2-mark.png" color={reversed ? 'var(--on-ruby)' : 'var(--logo-mark)'} />
        <Layer src="/brand/l2-type.png" color={reversed ? 'var(--on-ruby)' : 'var(--logo-type)'} />
      </span>
    </div>
  )
}

// L3, the stacked lockup, `width` pixels wide.
export function LogoStacked({ width = 180, reversed = false }) {
  const h = Math.round((width * ART.l3.h) / ART.l3.w)
  return (
    <span className="brand-art" style={{ width, height: h }} role="img" aria-label="SATashkent — College Prep Community">
      <Layer src="/brand/l3-mark.png" color={reversed ? 'var(--on-ruby)' : 'var(--logo-mark)'} />
      <Layer src="/brand/l3-type.png" color={reversed ? 'var(--on-ruby)' : 'var(--logo-type)'} />
    </span>
  )
}

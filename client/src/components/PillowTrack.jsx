import { tr as tx } from '../lib/i18n.jsx'

// The safety pillow as a track, drawn from the figures the server paid on.
//
// The bar it replaces was two grey-and-green halves sized off `pct` — a whole
// percent, rounded and capped — so a month at 99.6% drew full while the words
// under it said money was still to fill, a month 1% past the pillow and a
// month 300% past it drew identically, and a month whose late penalties ran
// past its earnings drew a negative width the browser threw away. So:
//
//  - the widths come from the exact ratio, what the month earned over the
//    pillow, never from the rounded percent;
//  - each part is its own colour: what the work earned toward the pillow,
//    what the pillow itself adds on top of that, and — once the month runs
//    past it — how far past, on the same scale, with a notch where the
//    guarantee ends;
//  - a month that earned less than nothing is drawn as nothing earned, and
//    says why rather than drawing a bar backwards;
//  - it grows in once, on arrival, and not at all for somebody who has asked
//    their system for less motion;
//  - a screen reader is told the share in words and never the money, which
//    stays behind the card's eye like every other figure on it.
//
// Only an arrangement that HAS a pillow sends one, so a card without one
// draws nothing here.

// The figures, from a pillowProgress as the server sends it. `earned` is the
// exact month; a month closed before the server sent it is rebuilt from what
// it did send, which is exact for every month that earned anything.
export function pillowFigures(pp) {
  const pillow = Math.max(0, Number(pp?.pillow) || 0)
  const sent = pp?.earned
  const earned = sent !== null && sent !== undefined && Number.isFinite(Number(sent))
    ? Number(sent)
    : (Number(pp?.past) > 0 ? pillow + Number(pp.past) : Number(pp?.filled) || 0)
  const work = Math.max(0, Math.min(earned, pillow))
  const past = Math.max(0, earned - pillow)
  const scale = Math.max(pillow, earned)
  const pct = pillow > 0 ? Math.max(0, Math.min(100, Math.floor((earned / pillow) * 100))) : 0
  return { pillow, earned, work, past, scale, pct }
}

export default function PillowTrack({ pp, amt, hint = '' }) {
  const f = pillowFigures(pp)
  if (!(f.pillow > 0)) return null
  const w = (n) => `${(n / f.scale) * 100}%`
  const adds = f.pillow - f.work
  // What the pillow adds, in money, is the server's `left` — the whole gap
  // between the month and the guarantee, which is more than the pillow itself
  // on a month that earned less than nothing.
  const addsMoney = pp.left ?? Math.max(0, f.pillow - f.earned)
  const say = f.earned >= f.pillow ? tx('The pillow is filled')
    : f.earned > 0 ? tx('{pct}% of the pillow earned', { pct: f.pct })
      : tx('Nothing earned toward the pillow yet')
  const why = f.earned < 0 ? tx('the late penalties came to more than the work') : ''
  return (
    <div className="pillow-track">
      <div className="pt-bar" role="progressbar" aria-label={tx('Safety pillow')}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.pct} aria-valuetext={say}>
        <span className="pt-track">
          <span className="pt-fill">
            {f.work > 0 && <i className="pt-work" style={{ width: w(f.work) }} />}
            {adds > 0 && <i className="pt-adds" style={{ width: w(adds) }} />}
            {f.past > 0 && <i className="pt-past" style={{ width: w(f.past) }} />}
          </span>
        </span>
        <i className="pt-notch" style={{ left: `min(${w(f.pillow)}, calc(100% - 2px))` }} aria-hidden="true" />
      </div>
      <span className="stat-sub pt-say">{[say, why, hint].filter(Boolean).join(' · ')}</span>
      <span className="pt-key">
        <span><i className="pt-sw pt-work" />{tx('Earned toward the pillow')} <b>{amt(Math.max(0, pp.filled ?? f.work))}</b></span>
        {addsMoney > 0 && <span><i className="pt-sw pt-adds" />{tx('The pillow adds')} <b>{amt(addsMoney)}</b></span>}
        {f.past > 0 && <span><i className="pt-sw pt-past" />{tx('Past the pillow')} <b>{amt(pp.past ?? f.past)}</b></span>}
      </span>
    </div>
  )
}

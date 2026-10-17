import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { X, ArrowRight, ArrowLeft } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the first-day tour (r10) -------------------------------------------------------
//
// "I would need help from someone technical" and "I had to learn a lot first"
// both scored 3.2 in the October survey: a new person lands on a full page
// with nothing saying where to start, and asks a teammate. Three steps, once,
// on My Day — the menu, the list, the task — with Back, Next and Skip. It is
// shown on a person's first visit in this browser and can be replayed from
// More ("Replay the tour"), which sends the `co-tour` event.
//
// It points, it does not explain the board: each step names one place and
// what to press there, and rings that place on the page.

const DONE = (uid) => `satashkent_tour_done_${uid}`
export const replayTour = () => window.dispatchEvent(new Event('co-tour'))

const STEPS = [
  { at: '.co-sb-nav, .mob-tabs', title: () => tx('This is your menu'), text: () => tx('My Day is where you start every time. Everything else is one press away under More.') },
  { at: '.co-hero, .co-now, .co-list', title: () => tx('Start at the top'), text: () => tx('The big card is the one thing to do first. The list under it is in the order to do it.') },
  { at: '.co-hero .co-btn-p, .co-now .co-btn-p, .co-row', title: () => tx('Open a task, press one button'), text: () => tx('Press a task to open it. Your step is at the top, and one red button sends it on. Questions go in the comments.') },
]

export default function CoachTour({ user }) {
  const { pathname } = useLocation()
  const [i, setI] = useState(-1)
  // First visit to My Day in this browser: start. A replay starts anywhere.
  useEffect(() => {
    if (pathname !== '/brief') return undefined
    let done = true
    try { done = !!localStorage.getItem(DONE(user.id)) } catch { /* a private window: no tour, rather than every time */ }
    if (done) return undefined
    const t = setTimeout(() => setI(0), 900)   // after the day has drawn
    return () => clearTimeout(t)
  }, [pathname, user.id])
  useEffect(() => {
    const go = () => setI(0)
    window.addEventListener('co-tour', go)
    return () => window.removeEventListener('co-tour', go)
  }, [])
  // Ring the place this step is about.
  useEffect(() => {
    if (i < 0) return undefined
    const el = document.querySelector(STEPS[i].at)
    if (!el) return undefined
    el.classList.add('co-tour-on')
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    return () => el.classList.remove('co-tour-on')
  }, [i, pathname])
  const finish = () => {
    try { localStorage.setItem(DONE(user.id), '1') } catch { /* fine */ }
    setI(-1)
  }
  useEffect(() => {
    if (i < 0) return undefined
    const onKey = (e) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps
  if (i < 0) return null
  const s = STEPS[i]
  const last = i === STEPS.length - 1
  return (
    <div className="co-tour" role="dialog" aria-modal="false" aria-labelledby="co-tour-t">
      <div className="co-tour-top">
        <span className="co-tour-n">{tx('Step {n} of {total}', { n: i + 1, total: STEPS.length })}</span>
        <button type="button" className="co-x" onClick={finish} aria-label={tx('Skip the tour')}><X size={16} aria-hidden="true" /></button>
      </div>
      <h3 id="co-tour-t">{s.title()}</h3>
      <p>{s.text()}</p>
      <div className="co-btns">
        {i > 0 && <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setI(i - 1)}><ArrowLeft size={16} aria-hidden="true" />{tx('Back')}</button>}
        <button type="button" className="co-btn co-btn-p co-btn-sm" onClick={() => (last ? finish() : setI(i + 1))}>
          {last ? tx('Got it') : tx('Next')}{!last && <ArrowRight size={16} aria-hidden="true" />}
        </button>
        {!last && <button type="button" className="co-link" onClick={finish}>{tx('Skip the tour')}</button>}
      </div>
    </div>
  )
}

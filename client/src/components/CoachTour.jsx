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

// Three steps, chosen by the page this person lands on (D-05): the tour
// used to tell an admin to "start at the top with the big card", on a page
// that has no big card. A step whose place is not on the page today (no card,
// nothing waiting) is left out, so the tour never rings an empty spot.
const MENU = { at: '.co-sb-nav, .mob-tabs', title: () => tx('This is your menu'), text: () => tx('My Day is where you start every time. Every other page is on this one list; your channels are in the middle.') }
const STEPS_OF = {
  // A maker: the card, the bands, and where a new task starts.
  maker: [
    { at: '.co-here', title: () => tx('Start at the top'), text: () => tx('The big card is the one thing to do first. Its button does the step; “Open the task” shows the whole piece.') },
    { at: '.co-list', title: () => tx('Then the groups'), text: () => tx('Under the card, your pieces in the order they press: late first, then what is yours to move, then what is ready to publish.') },
    { at: '.co-sb-new, .mob-new', title: () => tx('A new idea'), text: () => tx('“New task” asks for a name and the idea. The channel decides the rest; the later questions wait until the piece moves on.') },
  ],
  // The crew: the menu, the card, and what waits for others.
  crew: [
    MENU,
    { at: '.co-here', title: () => tx('Start at the top'), text: () => tx('The big card is the one thing to do first. Its button opens the task with your step ready — drop the file, press Send.') },
    { at: '.co-parked, .co-list', title: () => tx('Waiting for others'), text: () => tx('Yours, but not yet in your hands: a cut with no footage, a piece not sent on. Each wakes up by itself when its turn comes.') },
  ],
  // An admin: the menu, the timetable, the deadlines.
  admin: [
    MENU,
    { at: '.co-ad-wrap', title: () => tx('Who does what today'), text: () => tx('A row per person, the hours across: shoots are bars, posts are pins, lessons are hatched. Press a name’s count to see what they hold up.') },
    { at: '.co-ad-dl', title: () => tx('The deadlines'), text: () => tx('What is past its day, what is due today and what needs editing now — folded under the timetable. Open a piece from any row.') },
  ],
}
const roleOf = (user) => (user.role === 'admin' ? 'admin' : user.role === 'member' ? 'maker' : 'crew')

export default function CoachTour({ user }) {
  const { pathname } = useLocation()
  const [i, setI] = useState(-1)
  // The steps of this page, read when the tour starts: a place that is not
  // drawn today is skipped (never fewer than the menu step).
  const [STEPS, setSteps] = useState(() => STEPS_OF[roleOf(user)])
  const start = () => {
    const all = STEPS_OF[roleOf(user)]
    const here = all.filter((s) => document.querySelector(s.at))
    setSteps(here.length ? here : [MENU])
    setI(0)
  }
  // First visit to My Day in this browser: start. A replay starts anywhere.
  useEffect(() => {
    if (pathname !== '/brief') return undefined
    let done = true
    try { done = !!localStorage.getItem(DONE(user.id)) } catch { /* a private window: no tour, rather than every time */ }
    if (done) return undefined
    const t = setTimeout(start, 900)   // after the day has drawn
    return () => clearTimeout(t)
  }, [pathname, user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const go = () => start()
    window.addEventListener('co-tour', go)
    return () => window.removeEventListener('co-tour', go)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Ring the place this step is about.
  useEffect(() => {
    if (i < 0) return undefined
    const el = STEPS[i] && document.querySelector(STEPS[i].at)
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
  if (!s) return null
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

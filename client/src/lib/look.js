import { useEffect, useState } from 'react'

// ---- the new look, and the way back -------------------------------------------
//
// October 2026: the pages a new person lands on were rebuilt, because somebody
// who joined last week should not need showing round — first as one list and
// one button, then, when the owner found that "too simple and not even
// guiding", as the Coach look (lib/coach.js): one "Start here" card, a list
// numbered in the order to do it, and a task window that says what to do step
// by step. People who have worked the old pages for months get the new ones
// too — and one switch, under More, that puts the old page back, so the change
// is something they can step out of for a fortnight rather than something done
// to them on a Monday.
//
// There are two looks, not three: the Coach look replaced the first simple one
// outright, and this switch still chooses between the new look and the
// previous ("classic") pages. Its storage key and its names say "simple"
// because that is what was stored in people's browsers when it shipped — a
// choice somebody made last week must still be their choice this week.
//
// A per-person, per-browser preference and nothing more: the server neither
// knows nor cares which look drew the page, and every rule is the same under
// both. When the old pages are removed, this file goes with them.
const KEY = (uid) => `satashkent_look_${uid}`
const EVENT = 'satashkent-look'

// 13 October 2026, the owner: the previous look goes with the one task window.
// Everybody is on the Coach look; a 'classic' left in a browser is ignored.
// (Its pages are no longer reachable and go next, with this switch.)
export const isSimple = () => true
export function setSimple(user, on) {
  try {
    if (on) localStorage.removeItem(KEY(user?.id))
    else localStorage.setItem(KEY(user?.id), 'classic')
  } catch { /* a private window keeps the default */ }
  window.dispatchEvent(new Event(EVENT))
}
// Every page that draws two looks listens here, so the switch takes effect
// where it is pressed and everywhere else at once.
//
// The look's scope in the stylesheet is html[data-look="coach"]: white page,
// hairline cards, neutral sidebar, Nekst headline. It is set here, from the
// one reading every two-look page already makes, and only for a signed-in
// person — the sign-in page has no look to choose. The classic look removes
// it, so that look keeps today's shell untouched.
const LAST = 'satashkent_look_last'
const scope = (user, on) => {
  const coach = !!user?.id && on
  if (coach) document.documentElement.dataset.look = 'coach'
  else delete document.documentElement.dataset.look
  try { if (coach) localStorage.setItem(LAST, 'coach'); else localStorage.removeItem(LAST) } catch { /* fine */ }
}
// The scope is set by the shell, which is drawn only after the session has been
// checked — so every load would open on the previous look's grey page and turn
// white a moment later. The look this browser last showed is put on before the
// first paint instead; the shell corrects it if the person has changed.
try { if (localStorage.getItem(LAST) === 'coach') document.documentElement.dataset.look = 'coach' } catch { /* fine */ }
// How many pages are reading the look: when the last one goes (sign-out takes
// the shell with it) the scope goes too, so the sign-in page is never dressed.
let readers = 0
export function useSimpleLook(user) {
  const [on, setOn] = useState(() => isSimple(user))
  useEffect(() => {
    const read = () => { const now = isSimple(user); scope(user, now); setOn(now) }
    readers += 1
    read()
    window.addEventListener(EVENT, read)
    return () => {
      window.removeEventListener(EVENT, read)
      readers -= 1
      if (!readers) scope(null, false)
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return on
}

// The three steps a new person is shown above their page, until they close
// them — and the "?" beside the counts that brings them back, because the day
// somebody needs "how does this page work" is rarely the day they first saw it.
// One answer per page (`name`), kept per person in this browser.
const HINT = (uid, name) => `satashkent_hint_${name}_${uid}`
export const hintOpen = (user, name) => {
  try { return localStorage.getItem(HINT(user?.id, name)) !== 'seen' } catch { return false }
}
export const closeHint = (user, name) => {
  try { localStorage.setItem(HINT(user?.id, name), 'seen') } catch { /* fine */ }
}
export const openHint = (user, name) => {
  try { localStorage.removeItem(HINT(user?.id, name)) } catch { /* fine */ }
}

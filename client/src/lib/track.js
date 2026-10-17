import { getToken } from './api.js'

// ---- where people struggle (round 13; server/routes/track.js) ----------------
//
// The owner, 14 Oct 2026: track everything possible — pages, where people
// press, a heatmap — by name, and the team is told. What is sent: the page,
// where on it a press landed, the words ON what was pressed (a button's label,
// a box's name — never what is typed into a box), the messages the board says
// no with, and a task window opening, changing the task and closing.
// Gathered here and sent in batches: every 15 seconds, and when the tab is put
// away. A press that lands on nothing pressable is marked (`dead`: people
// thought it was a button), and three presses on one spot inside 0.8 s are
// marked too (`rage`: it looked like nothing happened).

const PRESSABLE = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], input, select, textarea, label, summary, [tabindex]:not([tabindex="-1"])'
const EVERY = 15000
let q = []
let on = false
let page = ''
let recent = []   // the last presses, for the "again and again" mark

const send = (keepalive = false) => {
  if (!q.length) return
  const token = getToken()
  if (!token) { q = []; return }
  const events = q.splice(0, 300)
  fetch('/api/track', {
    method: 'POST', keepalive,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
  }).catch(() => {})
}
const add = (e) => { if (on) { q.push({ t: Date.now(), p: location.pathname, ...e }); if (q.length >= 200) send() } }

// What a press was on, in the words the screen shows — never a box's value.
const labelOf = (el) => {
  if (el.matches('input, textarea, select')) return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.type || el.tagName
  return (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
}
const nameOf = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''}`

// Anything that wants to say what happened: a task window, a search.
export const track = (ty, data = {}) => add({ ty, ...data })

export function startTracking(user) {
  if (on || !user || user.role === 'ambassador') return () => {}
  on = true
  page = location.pathname
  add({ ty: 'page' })
  const click = (ev) => {
    const t = ev.target instanceof Element ? ev.target : null
    // Looking into a picture, the heatmap's own bar, or an admin reading a heatmap: not use.
    if (!t || t.closest('.pz-box, .hm-bar') || location.search.includes('heatmap=')) return
    // Selecting words (a double or triple press, or text left selected) is reading, not a
    // press that missed a button (the hunt, 15 Oct 2026).
    const reading = ev.detail >= 2 || !!String(window.getSelection?.() || '').trim()
    const hit = t.closest(PRESSABLE)
    const now = Date.now()
    recent = recent.filter((c) => now - c.t < 800 && Math.hypot(c.x - ev.clientX, c.y - ev.clientY) < 30)
    recent.push({ t: now, x: ev.clientX, y: ev.clientY })
    add({
      ty: 'click', x: Math.round(ev.clientX + window.scrollX), y: Math.round(ev.clientY + window.scrollY),
      vw: window.innerWidth, vh: window.innerHeight,
      el: hit ? labelOf(hit) : nameOf(t), tag: (hit || t).tagName.toLowerCase(),
      dead: (!hit && !reading) || undefined, rage: (recent.length >= 3 && !reading) || undefined,
      w: t.closest('.co-panel') ? 1 : undefined, task: Number(t.closest('.co-panel')?.dataset.task) || undefined,
    })
  }
  // A page is a new pathname; the app moves with pushState, so it is watched there.
  const moved = () => { if (location.pathname !== page) { add({ ty: 'page', from: page }); page = location.pathname } }
  const push = history.pushState, replace = history.replaceState
  history.pushState = function (...a) { const r = push.apply(this, a); moved(); return r }
  history.replaceState = function (...a) { const r = replace.apply(this, a); moved(); return r }
  const said = (e) => add({ ty: 'error', msg: String(e.detail || '').slice(0, 160) })
  const away = () => { if (document.visibilityState === 'hidden') send(true) }
  const gone = () => send(true)
  document.addEventListener('click', click, { capture: true, passive: true })
  window.addEventListener('popstate', moved)
  window.addEventListener('board:said-no', said)
  document.addEventListener('visibilitychange', away)
  window.addEventListener('pagehide', gone)
  const timer = setInterval(send, EVERY)
  return () => {
    send(true)
    on = false
    clearInterval(timer)
    history.pushState = push; history.replaceState = replace
    document.removeEventListener('click', click, { capture: true })
    window.removeEventListener('popstate', moved)
    window.removeEventListener('board:said-no', said)
    document.removeEventListener('visibilitychange', away)
    window.removeEventListener('pagehide', gone)
  }
}

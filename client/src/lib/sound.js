// Synthesised UI sounds, bar one file (notify.mp3 — see playNotify). The
// completion chime (playDing) is two soft rising notes with a bell shimmer, in
// the spirit of Microsoft To Do; the rest are quieter one-off blips. All of
// them respect the Profile → Appearance → Sounds switch and never break the
// click.
const KEY = 'satashkent_sounds'
export const soundsOn = () => localStorage.getItem(KEY) !== 'off'
export const setSounds = (on) => localStorage.setItem(KEY, on ? 'on' : 'off')

let ctx
const ac = () => {
  if (!soundsOn()) return null
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch { return null }
}

const note = (c, freq, at, dur, peak, type = 'sine') => {
  const t0 = c.currentTime
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0 + at)
  g.gain.setValueAtTime(0.0001, t0 + at)
  g.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.014)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(t0 + at)
  o.stop(t0 + at + dur + 0.05)
}

/* The completion chime — a task is done. */
export function playDing() {
  const c = ac()
  if (!c) return
  try {
    note(c, 587.33, 0.0, 0.30, 0.28)  // D5 — the pickup
    note(c, 880.0, 0.10, 0.60, 0.36)  // A5 — the landing
    note(c, 1174.66, 0.10, 0.45, 0.10) // D6 — soft shimmer
    note(c, 1760.0, 0.14, 0.35, 0.05)  // A6 — sparkle on top
  } catch { /* sound is a nicety */ }
}
export const playDone = playDing

/* A checklist tick — one gentle click. */
export function playTick() {
  const c = ac()
  if (!c) return
  try { note(c, 880, 0, 0.07, 0.06) } catch { /* nicety */ }
}

/* A program launched — three quick ascending notes. */
export function playLaunch() {
  const c = ac()
  if (!c) return
  try {
    note(c, 523.25, 0.0, 0.09, 0.10)
    note(c, 659.25, 0.08, 0.09, 0.12)
    note(c, 783.99, 0.16, 0.16, 0.14)
  } catch { /* nicety */ }
}

/* Somebody's work just landed for you to review. The one sound that is a
   FILE (public/notify.mp3, the completion chime rendered once) and played
   through a plain HTML5 Audio element: it has to sound from a dashboard left
   open in a background tab, where the reviewer is doing something else —
   which is exactly where a freshly built AudioContext is not allowed to start.
   If the browser still refuses, the synthesised chime is tried instead; if
   that is refused too, the toast is still there. */
let notifyEl
export function playNotify() {
  if (!soundsOn()) return
  try {
    notifyEl = notifyEl || new Audio('/notify.mp3')
    notifyEl.volume = 0.7
    notifyEl.currentTime = 0
    const p = notifyEl.play()
    if (p && typeof p.catch === 'function') p.catch(() => playDing())
  } catch { playDing() }
}

/* Halted — a soft low landing. */
export function playHalt() {
  const c = ac()
  if (!c) return
  try { note(c, 330, 0, 0.14, 0.08, 'triangle') } catch { /* nicety */ }
}

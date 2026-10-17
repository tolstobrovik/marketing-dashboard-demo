import { useCallback, useEffect, useRef, useState } from 'react'

// Two things a long form owes the person filling it in.
//
// ---- 1. it does not lose what they typed -----------------------------------
// The task sheet is three views now, and a view you have left is still holding
// what you wrote in it. That is the point — but it means the sheet can be
// closed on top of unsaved words without the person seeing the box they were
// in. So the sheet knows whether it is dirty, and closing a dirty sheet asks
// first. Switching VIEWS never asks: the views are one form, nothing is lost
// moving between them, and a dialog every time somebody looks at the dates
// would be the friction this refactor exists to remove.
//
// Dirtiness is measured against the values the sheet OPENED with, not against
// the record — a sheet that reopens after a save must not think it is dirty
// because the server rounded a date.
export function useDirtyState(form, ready = true) {
  const clean = useRef(null)
  const [dirty, setDirty] = useState(false)

  // The baseline is taken once, when the sheet has the values it opens with.
  useEffect(() => {
    if (!ready || clean.current !== null) return
    clean.current = snapshot(form)
  }, [ready, form])

  useEffect(() => {
    if (clean.current === null) return
    setDirty(snapshot(form) !== clean.current)
  }, [form])

  // After a save, what is on screen IS what is stored.
  const settle = useCallback((next) => { clean.current = snapshot(next ?? form); setDirty(false) }, [form])

  // After a PART of the sheet went to the server on its own — a crew member's
  // hand-in sends the link with it — those fields are stored and the rest are
  // not. Settling the whole sheet would throw away anything else they had
  // typed; settling nothing made Close ask about a link that was already in.
  const settleFields = useCallback((keys) => {
    if (clean.current === null) return
    try {
      const base = JSON.parse(clean.current)
      for (const k of keys) if (k in base) base[k] = JSON.parse(snapshot({ v: form[k] })).v
      clean.current = JSON.stringify(base)
      setDirty(snapshot(form) !== clean.current)
    } catch { /* leave it dirty: asking once too often is the safe mistake */ }
  }, [form])

  // Fields the sheet LOADS after it has opened: the list row it opened from
  // carries no photographs, and the album arrives with the full record a
  // moment later. That arrival is not somebody's edit, so it moves into the
  // baseline with the values it brought — or every task with a reference
  // photo opened "unsaved" and asked before closing.
  const rebase = useCallback((values) => {
    if (clean.current === null) return
    try {
      clean.current = JSON.stringify({ ...JSON.parse(clean.current), ...JSON.parse(snapshot(values)) })
    } catch { /* leave it dirty: asking once too often is the safe mistake */ }
  }, [])

  // The values the form opened with (the baseline above, rebased loads
  // included): what a save compares against to send only what was changed.
  const opened = useCallback(() => { try { return clean.current === null ? null : JSON.parse(clean.current) } catch { return null } }, [])

  return { dirty, settle, settleFields, rebase, opened }
}

// Photographs and file blobs are hundreds of kilobytes and never change under
// somebody's fingers; comparing them on every keystroke is the one way a
// dirty-check can itself make a form feel slow. They are compared as
// present-or-absent instead.
//
// A checklist does NOT belong here. It looked like a list and got swept in
// with the blobs, and the result was a sheet you could tick four things on
// and close without being asked — the ticks gone, silently, which is the one
// failure this hook exists to prevent. It is a handful of short strings; it
// is compared like everything else.
const HEAVY = new Set(['photo', 'photo_thumb'])
const snapshot = (form) => {
  try {
    return JSON.stringify(form, (k, v) => (HEAVY.has(k) ? (v ? 'set' : null) : v))
  } catch {
    return String(Date.now()) // unserialisable: treat as changed rather than as clean
  }
}

// ---- 2. it keeps the dates in an order that can happen ---------------------
// The three dates are a chain: you shoot, then you cut, then it goes out. Move
// the shoot past the cut and the cut is now due before the footage exists —
// a promise nobody can keep, made silently. So the ones downstream move with
// it, by the same number of days, and the sheet says what it did.
//
// Only ever forwards. Pulling the shoot EARLIER leaves the rest alone: an
// earlier shoot does not oblige the editor to finish sooner, and quietly
// dragging somebody's deadline towards them is the opposite of the point.
// Two chains, because two kinds of work reach the same day. A filmed piece is
// shot, then cut, then goes out. A designed one is drawn, then goes out. The
// release is the end of both, and moving anything upstream of it moves it.
export const CHAINS = [
  ['recording_date', 'edit_ready_date', 'release_date'],
  ['design_ready_date', 'release_date'],
]
export const LABELS = {
  recording_date: 'the shoot',
  edit_ready_date: 'the edit',
  design_ready_date: 'the artwork',
  release_date: 'the release',
}

export function cascadeDates(form, changedKey, nextValue) {
  const out = { ...form, [changedKey]: nextValue }
  const chain = CHAINS.find((c) => c.includes(changedKey))
  const at = chain ? chain.indexOf(changedKey) : -1
  if (at < 0 || !nextValue) return { form: out, moved: [] }

  const moved = []
  let prev = changedKey   // the link each later date keeps its distance from
  let floor = nextValue
  for (const key of chain.slice(at + 1)) {
    const held = out[key]
    if (!held) continue                    // nothing promised downstream yet
    if (held >= floor) { prev = key; floor = held; continue }  // already after: leave it
    const pushedTo = addDays(floor, gapOf(form, prev, key))
    out[key] = pushedTo
    moved.push({ key, from: held, to: pushedTo })
    prev = key
    floor = pushedTo
  }
  return { form: out, moved }
}

// Keep the shape of the plan: if the cut was two days after the shoot, it is
// still two days after the shoot. A chain squashed to zero-day gaps is a plan
// nobody agreed to either.
//
// The distance is measured from the link BEFORE it, never from whatever the
// person happened to touch. Moving the shoot four days should move the plan
// four days; measuring everything from the shoot stacks each gap on top of the
// last and throws the release a fortnight into the future.
function gapOf(before, fromKey, toKey) {
  const wasFrom = before[fromKey]
  const wasTo = before[toKey]
  if (!wasFrom || !wasTo) return 1
  const days = Math.round((Date.parse(wasTo) - Date.parse(wasFrom)) / 86400000)
  return days > 0 ? days : 1
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ---- 3. …and backwards, for a release pulled earlier ------------------------
// The chain above only ever pushes forward. The one move it cannot answer is
// the release itself dragged EARLIER than the cut or the artwork it waits on:
// the piece would then go out before it is made. So those days come back with
// it, by the same number of days, keeping the gap the plan had (a cut due two
// days before release is still due two days before it) — and only the ones
// that would otherwise land after the new day; one still comfortably before it
// is left alone. The revised cut day (a re-promise made when footage arrived
// late) is the live one when it exists, so it is the one that moves.
//
// A cut or an artwork already HANDED IN is history, not a plan. Its day stays
// where it was met, and it neither moves nor stands in the way of the release:
// "it is ready, put it out tomorrow" is the commonest drag there is, and it
// used to be refused because a deadline that no longer applied would have
// landed in the past. Each is judged on its own hand-in, the way the server's
// review gate judges it — the cut is in once it has crossed into Ready
// (edited_at) or beyond; the artwork only once the piece itself has
// (ready_at, done_at), because the design board moves on its own and has no
// "done" the server recognises. One flag for both let a reel whose cut was in
// go out before an artwork still being drawn.
//
// The gap is kept where it can be. When keeping it would put the day in the
// past, it is due TODAY instead — still on or before the new release, and a
// cut never before its own shoot — and the toast says where it went. Only
// when there is no such day at all is the move refused, with the reason
// rather than written: a release pulled into the past with work still owed
// before it, or a release pulled before the shoot the cut waits on.
//
// And a release pulled before a shoot that has not happened, on a piece with
// no cut day to catch it (an idea, in practice — booking a shoot asks for the
// cut), is refused too: the piece would go out before it is filmed.
export function pullBackDates(item, nextRelease, today) {
  const was = item.release_date
  if (!was || !nextRelease || nextRelease >= was) return { moved: [], problem: null }
  const delta = Math.round((Date.parse(nextRelease) - Date.parse(was)) / 86400000)
  const editKey = item.edit_due_revised ? 'edit_due_revised' : 'edit_ready_date'
  const cutDone = !!(item.edited_at || item.ready_at || item.done_at)
  const artDone = !!(item.ready_at || item.done_at)
  // A shoot that has happened (shot_at, or a cut already in) holds nothing up.
  const shootAhead = !item.shot_at && !cutDone && item.recording_date ? item.recording_date : null
  const moved = []
  for (const key of [editKey, 'design_ready_date']) {
    const held = item[key]
    if (!held || held <= nextRelease) continue
    const isCut = key !== 'design_ready_date'
    if (isCut ? cutDone : artDone) continue
    const label = isCut ? 'edit_ready_date' : key
    // The earliest the day may be: today, and for the cut its own shoot.
    const floor = isCut && shootAhead && shootAhead > today ? shootAhead : today
    if (floor > nextRelease) {
      return { moved: [], problem: { key: label, to: floor, why: today > nextRelease ? 'past' : 'shoot' } }
    }
    let to = addDays(held, delta)
    if (to > nextRelease) to = nextRelease
    if (to < floor) to = floor
    moved.push({ key: label, field: key, from: held, to })
  }
  if (shootAhead && nextRelease < shootAhead && !item.edit_ready_date && !item.edit_due_revised) {
    return { moved: [], problem: { key: 'release_date', to: nextRelease, why: 'release' } }
  }
  return { moved, problem: null }
}

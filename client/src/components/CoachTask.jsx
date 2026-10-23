import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ExternalLink, FileText, Send, Check, Clock, ArrowRight, PenLine, CalendarClock, Plus, Hand, Undo2, UploadCloud } from 'lucide-react'
import HandIn from './HandIn.jsx'
import DayPick from './DayPick.jsx'
import NextStep from './NextStep.jsx'
import Booking from './Booking.jsx'
import PravkaBox from './PravkaBox.jsx'
import PravkaNote from './PravkaNote.jsx'
import RefMedia from './RefMedia.jsx'
import CharCount from './CharCount.jsx'
import Reposts from './Reposts.jsx'
import TaskMore, { DayAsks } from './TaskMore.jsx'
import TaskPlan from './TaskPlan.jsx'
import { VoiceRecorder, VoicePlayer, canRecord } from './VoiceNote.jsx'
import { CopyName } from './DriveDrops.jsx'
import { TaskFiles, DriveBox } from './DriveFiles.jsx'
import { LinkText, LinkViewer, LinkPreview } from './LinkView.jsx'
import {
  KIND, Chans, Badge, Face, CrewBadge, MakerBadge, RemindButton, remindHelp, firstName, dayInLine, dayShort, hoursOf, lateWords, KindMark, ownOf, StageMark,
} from './CoachParts.jsx'
import { Capsule, tracks } from './CoachBits.jsx'
import { api } from '../lib/api.js'
import { can, PRAVKA_ROUNDS, tashkentDay, typeLabel, todayISO, telegramTypeLabel } from '../lib/constants.js'
import { editDue, reviewDue } from '../lib/due.js'
import { actOf, kindOfAct, makerDay, wayOf, ownersOf, daysBetween, fixUntil, seatAt, putBack, HATS } from '../lib/coach.js'
import { deliveryHref, URL_RE, isSentence } from '../lib/text.js'
import { toast } from '../lib/toast.js'
import { useIsPhone } from '../lib/usePhone.js'
import { colorIndexOf, colorStyle, ownerIdOf, PALETTE } from '../lib/pieceColor.js'
import { tr as tx } from '../lib/i18n.jsx'
import { reachOf, adminOn } from '../lib/auth.jsx'
import { track } from '../lib/track.js'

// ---- a task, in the window that slides in -------------------------------------------
//
// One window for everybody. The crew's task page and the maker's task page
// were two windows that showed the same piece from two chairs, and each ended
// in a button that opened a second window to ask what the first had not. The
// owner's choice was the opposite: the task comes in from the side of the
// page, over the list it was opened from, and reads top to bottom as an
// instruction —
//
//   what to do, step by step      a short numbered list, ticked as it is done
//   your step now                 the ONE ruby button, what is still missing
//                                 for it, and what happens after it is pressed
//   the way of this task          every stop from an idea to out, and who does it
//   the brief · files · comments  what to make, what to make it from, what was said
//
// and it is the same for the person holding the camera and the person running
// the piece. What differs is only "your step now", and that is one reading —
// actOf in lib/coach.js — of whose step it is.
//
// It knows no rule. Handing work in is components/HandIn.jsx and moving a
// piece on is components/NextStep.jsx, both drawn here `inline`: the same
// questions the server asks, the same writes, without a window of their own.
// A booking is answered through components/Booking.jsx, changes are asked
// through the same PravkaBox the full task sheet uses, and accepting, sending
// back and commenting are the server's own routes. So a rule added on the
// server tomorrow turns up here as one more question, or one more refusal said
// in the server's words.

// What a tick is worth: the steps a person has ticked on a task stay ticked
// when they close the window to go and film it. Per person, per browser.
const TICKS = (uid) => `satashkent_steps_${uid}`
const readTicks = (uid, key) => {
  try { return JSON.parse(localStorage.getItem(TICKS(uid)) || '{}')[key] || {} } catch { return {} }
}
const writeTicks = (uid, key, ticks) => {
  try {
    const all = JSON.parse(localStorage.getItem(TICKS(uid)) || '{}')
    localStorage.setItem(TICKS(uid), JSON.stringify({ ...all, [key]: ticks }))
  } catch { /* a private window forgets, which is fine */ }
}

const GO = { shoot: () => tx('Shoot is done'), edit: () => tx('Hand in the edit'), design: () => tx('Hand in the artwork') }
// A list the server keeps as JSON text or as an array (reviewers, faces, the checklist), or a single id.
const listed = (v, one = null) => {
  const l = Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]') } catch { return [] } })()
  return l.length ? l : one ? [one] : []
}

export default function CoachTask({
  item, user, byKey, step, prefer = null, focus = null, next = null, onNext = null, onClose, onChanged,
  mayEdit = null, edit = null, startEdit = false,
}) {
  const { stepOf, pipe, makingFor, reviewsOn } = step
  const phone = useIsPhone()
  const today = todayISO()

  // The piece as this window knows it: the row it was opened from, then the
  // whole task once the server answers, then whatever each press sends back.
  const [t, setT] = useState(item)
  const [loaded, setLoaded] = useState(false)
  const [team, setTeam] = useState([])
  const load = useCallback(() => api.get(`/content/${item.id}`).then((f) => {
    // The full task carries its rounds, not the two list columns read off them.
    const open = (f.revisions || []).filter((r) => !r.resolved_at)
    setT((old) => ({ ...old, ...f, open_round: open.length ? Math.max(...open.map((r) => r.round)) : null, open_for: open[open.length - 1]?.target || null }))
    setLoaded(true)
  }).catch((e) => { toast(e.message, 'err'); setLoaded(true) }), [item.id])
  useEffect(() => { load() }, [load])
  // A task window opened and closed, for "how people close a task" (lib/track.js).
  useEffect(() => {
    const at = Date.now()
    track('open', { task: item.id })
    return () => track('close', { task: item.id, ms: Date.now() - at })
  }, [item.id])
  // The names: asked again until they come. A window opened while the server
  // was restarting said "Nobody is named to edit it yet" and "You can remind ."
  // over a piece Jaloliddin edits (the owner's screenshot, 14 Oct 2026).
  useEffect(() => {
    let stop = false, wait = 2000
    const get = () => api.cached('/users').then((u) => { if (!stop) setTeam(Array.isArray(u) ? u : []) })
      .catch(() => { if (!stop) setTimeout(get, (wait = Math.min(wait * 2, 30000))) })
    get()
    return () => { stop = true }
  }, [])
  // ---- Edit (the owner, 13 Oct: one window for everybody, one Edit button) ----
  // The window turns into the task's form (components/ContentModal.jsx): the
  // same blocks in the same order, as boxes to fill in, and back on Save or
  // Cancel. Built on the piece as the server has it now — never on the row the
  // window was opened from, which a press here may already have changed.
  const [editing, setEditing] = useState(false)
  const editOut = useRef(null)   // the form's own way out: it asks over unsaved changes
  const canEditIt = !!edit && loaded && !!mayEdit?.(t)
  const editOpened = useRef(false)
  useEffect(() => {
    if (startEdit && canEditIt && !editOpened.current) { editOpened.current = true; setEditing(true) }
  }, [startEdit, canEditIt])
  const person = (id) => team.find((u) => u.id === id) || null
  const nameOf = (id) => firstName(person(id))
  // A sentence needs a subject even when a name has not loaded or a seat's
  // holder has left: the crew, for whoever makes; the team, for whoever waits.
  const crewName = (id) => nameOf(id) || tx('The crew')
  const teamName = (id) => nameOf(id) || tx('The team')

  // A press landed: the window shows the piece as it is now, the page behind
  // it hears, and the thread and the rounds are read again.
  const [acted, setActed] = useState(false)
  // ---- Undo ----
  // The design has an Undo after every press, and the server has had the
  // route all along: POST /content/:id/undo takes a stage move back for ten
  // seconds — the stage and everything the move stamped (the links, the
  // clocks, the seats) — for whoever made the move. It is what the board's
  // "Moved to… · Undo" toast presses. So after a press that MOVED the piece
  // (a hand-in, a send, a publish) the window offers it, for as long as the
  // server will take it and not a second longer; a refusal ("Too late to undo
  // that") is said in the server's words. Accepting a delivery, asking for
  // changes and answering a booking move no stage and have no undo on the
  // server, so none is offered there.
  const UNDO_MS = 9000   // the server keeps the move for 10 s; a second is left for the way there
  const [undo, setUndo] = useState(0)        // when the offer ends (ms), or 0
  const [left, setLeft] = useState(0)        // whole seconds still left, for the button
  const [undoing, setUndoing] = useState(false)
  useEffect(() => {
    if (!undo) return undefined
    const tickDown = () => { const s = Math.ceil((undo - Date.now()) / 1000); if (s <= 0) setUndo(0); else setLeft(s) }
    tickDown()
    const id = setInterval(tickDown, 250)
    return () => clearInterval(id)
  }, [undo])
  // `undoable: false` — asking for changes and the owner's own fix move the
  // stage through routes that keep no snapshot, so Undo would only fail.
  const apply = (u, opts) => {
    track('change', { task: item.id })
    if (!u?.id) { load(); return }
    if (opts?.undoable !== false && u.status_id != null && u.status_id !== t.status_id) setUndo(Date.now() + UNDO_MS)
    setT((old) => ({ ...old, ...u }))
    setActed(true)
    onChanged?.(u)
    load()
  }
  // A press in the window's record (a round, a hand raised, a day moved): the
  // window reads the task again, and the page behind takes the row it got.
  // (Only a row of this task: a hand raised answers with the flag's own row.)
  const heard = (u) => { if (u?.id === item.id) onChanged?.(u); load() }
  const takeBack = async () => {
    if (undoing) return
    setUndoing(true)
    try {
      const u = await api.post(`/content/${t.id}/undo`)
      setUndo(0); setActed(false)
      setT((old) => ({ ...old, ...u }))
      onChanged?.(u)
      load()
      toast(tx('Move taken back'))
    } catch (e) { setUndo(0); toast(e.message, 'err') } finally { setUndoing(false) }
  }

  // ---- whose step it is ----
  const revisions = t.revisions || []
  const openRound = revisions.filter((r) => !r.resolved_at).slice(-1)[0] || null
  const reviews = reviewsOn(t)
  const read = actOf(t, { userId: user.id, pipe, step: stepOf(t), today, rounds: revisions.length, maxRounds: PRAVKA_ROUNDS, canReview: reviews.accept, prefer })
  // A job on a piece its maker is still planning is "not sent to you yet" —
  // the list gives it no number and the window says who has it. But the server
  // takes a hand-in at any stage (a maker who asked for the poster in the
  // corridor and never pressed "Send"), and the previous look let them hand it
  // in, so nothing is taken away: one quiet link opens the same hand-in box.
  const [anyway, setAnyway] = useState(false)
  const act = read.kind === 'early' && anyway ? { kind: 'handin', hat: read.hat } : read
  const hat = act.hat || null
  const kind = kindOfAct(act)
  const owners = ownersOf(t)
  const owner = owners[0] || null
  // Whoever runs the piece may nudge the person holding it. A pen is offered
  // only on a piece that is theirs to write to (the server's canTouch): anybody
  // may open any piece, from the calendars and the quick find.
  const reach = reachOf(user, t)
  const runs = owners.includes(user.id) || (reach && can(user, 'manage_content'))
  const at = pipe.live.findIndex((s) => s.id === t.status_id)
  // Somebody who held a job on the piece and has handed it over keeps reading
  // the window as that job, done — the crew's pages never show a release day,
  // which is somebody else's promise.
  const doneHat = !hat && act.didMine && !runs ? HATS.find((h) => t[h.seat] === user.id) : null

  // ---- when ----
  // A change sent back has no day of its own on the server: its day is the
  // next one the piece is still promised for (fixUntil), the same the list drew.
  // A piece put back with no round is read the same way (crewDay, `again`): not
  // late by the day of the delivery it already met.
  const again = !!hat && hat.kind !== 'shoot' && act.kind === 'handin' && putBack(t, pipe.live[at]?.label || '')
    && !(hat.kind === 'design' && t.editor_id)
  const due = !hat ? null : again ? (fixUntil(t, hat.name, today) || today) : act.kind === 'fix' ? fixUntil(t, hat.name, today) : hat.kind === 'shoot' ? t.recording_date : hat.kind === 'edit' ? (editDue(t) || reviewDue(t)) : (t.design_ready_date || reviewDue(t))
  const hours = hoursOf(t)
  const shootWhen = t.recording_date ? `${dayInLine(t.recording_date, today)}${hours ? `, ${hours}` : ''}` : ''
  const lateDays = due && due < today && act.kind !== 'fix' ? daysBetween(due, today) : 0
  const whenLine = hat
    ? (hat.kind === 'shoot' && act.kind !== 'fix' ? shootWhen : !due ? '' : due < today ? tx('was due {day}', { day: dayShort(due) }) : tx('due {day}', { day: dayInLine(due, today) }))
    : doneHat ? ''
      : t.done_at ? tx('went out {day}', { day: dayInLine(tashkentDay(t.done_at), today) })
        : !reviewDue(t) ? '' : reviewDue(t) < today ? tx('was planned for {day}', { day: dayShort(reviewDue(t)) })
          : tx('goes out {day}', { day: dayInLine(reviewDue(t), today) })
  // The same badge the list drew for it.
  const badge = hat
    ? <CrewBadge today={today} row={{ t, kind: hat.kind, due, late: lateDays, state: { fix: 'fix', ask: 'ask', handin: 'go', blocked: 'blocked', notyet: 'wait', early: 'early', declined: 'declined' }[act.kind] }} />
    : doneHat ? <CrewBadge today={today} row={{ t, kind: doneHat.kind, state: 'done' }} />
      : at >= 0 ? <MakerBadge today={today} nameOf={nameOf}
        row={makerDay({ pieces: [t], today, userId: user.id, pipe, stepOf, roundsOf: () => revisions.length, maxRounds: PRAVKA_ROUNDS, canReviewOf: () => reviews.accept }).rows[0]} />
        : <Badge>{tx('Deleted')}</Badge>

  // ---- the form under "Your step now" tells the window where it stands ----
  const [awake, setAwake] = useState(true)        // is the button awake?
  const [pasted, setPasted] = useState(false)     // is there anything in the hand-in box?
  const [asked, setAsked] = useState(null)        // how many things a move still asks (null: still checking)
  // An admin hands the work in for whoever holds the step (the owner, 14 Oct
  // 2026: "sometimes I upload instead of the editors"). The seat keeps the
  // credit and the pay — both are read off the seat, never off who pressed.
  const [forThem, setForThem] = useState(false)
  const [refused, setRefused] = useState(false)   // the server refused the move outright (its words are shown)

  // ---- accept, or ask for changes ----
  const [asking, setAsking] = useState(focus === 'note')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const accept = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const u = await api.post(`/content/${t.id}/approve`, {})
      toast(tx('Accepted — it is ready to publish'))
      apply(u)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // Whom the changes go to: the maker of what came in, unless the asker picks
  // another seat — the operator for a re-shoot (the sheet's choice, kept).
  const targets = [
    t.editor_id && { key: 'editor', label: tx('Editor') },
    t.operator_id && { key: 'operator', label: tx('Operator · re-shoot') },
    t.designer_id && { key: 'designer', label: tx('Designer') },
  ].filter(Boolean)
  const [target, setTarget] = useState(null)
  const sendTarget = target || (act.what === 'artwork' ? 'designer' : 'editor')
  const fixer = target ? t[`${target}_id`] : act.maker
  const [noteClip, setNoteClip] = useState(null)
  const sendBack = async () => {
    if (busy || uploading || !note.trim()) return
    setBusy(true); setErr('')
    try {
      const u = await api.post(`/content/${t.id}/revisions`, {
        note: note.trim(), target: sendTarget,
        ...(noteClip ? { voice: noteClip.data, voice_secs: noteClip.secs } : {}),
      })
      toast(tx('{name} got your note', { name: crewName(fixer) }))
      setAsking(false); setNote(''); setNoteClip(null)
      apply(u, { undoable: false })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // A change asked of the piece's owner — a written post has no editor's seat —
  // is answered with the new version's link, through the round's own route.
  const [fixLink, setFixLink] = useState('')
  const ownFix = async () => {
    if (busy || !fixLink.trim() || !openRound) return
    setBusy(true); setErr('')
    try {
      const r = await api.post(`/content/revisions/${openRound.id}/resolve`, { link: fixLink.trim() })
      toast(tx('Fixed — back to the SMM'))
      setFixLink('')
      apply(r.task, { undoable: false })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // ---- the thread ----
  const [draft, setDraft] = useState('')
  const [saying, setSaying] = useState(false)
  const [sayClip, setSayClip] = useState(null)   // a voice note, said instead of or beside the words
  const [clipKey, setClipKey] = useState(0)      // remounts the recorder to clear it
  const comments = t.comments || []
  const addComment = (c) => setT((old) => ({ ...old, comments: [...(old.comments || []), c] }))
  // A ref, not only the state: two Enters in a row arrive before the state
  // has redrawn, and the same comment was posted twice (the audit, 12 Oct).
  const sayingNow = useRef(false)
  const say = async () => {
    const text = draft.trim()
    if ((!text && !sayClip) || sayingNow.current) return
    sayingNow.current = true
    setSaying(true)
    try {
      addComment(await api.post(`/content/${t.id}/comments`, { text, ...(sayClip ? { voice: sayClip.data, voice_secs: sayClip.secs } : {}) }))
      setDraft(''); setSayClip(null); setClipKey((n) => n + 1)
    } catch (e) { toast(e.message, 'err') } finally { sayingNow.current = false; setSaying(false) }
  }

  // ---- what to do, step by step ----
  // Short on purpose: three or four lines, each one thing. The step that needs
  // something typed ticks itself when the box below is filled; the last step
  // is the button, so it has no tick of its own.
  // r10: a hand-in says who gets it — "Send to Jasmina" — as the design for
  // the simpler task window has it. A shoot keeps "Shoot is done".
  // A reel's cover handed in before its cut waits for the edit (the server holds it on Editing).
  const coverFirst = hat?.kind === 'design' && !!t.editor_id && act.kind !== 'fix'
    && (!t.ready_link || revisions.some((r) => !r.resolved_at && r.target === 'editor'))
  const sendTo = act.kind === 'fix' ? (String(openRound?.requested_name || '').split(' ')[0] || nameOf(owner)) : nameOf(owner)
  const button = act.kind === 'ownfix' ? tx('Hand in the fix')
    : hat && hat.kind !== 'shoot' && sendTo && owner !== user.id && !coverFirst ? tx('Send to {name}', { name: sendTo })
      : act.kind === 'fix' ? tx('Hand in the fix') : hat ? GO[hat.kind]() : act.kind === 'publish' ? tx('Publish') : act.verb ? tx(act.verb) : ''
  const press = { t: tx('Press “{button}”', { button }), s: tx('The red button, just below.'), last: true }
  const jobSteps = (k) => (k === 'shoot' ? [
    { t: tx('Read the script'), s: tx('It is lower in this window. It says what to film.') },
    { t: tx('Film it'), s: tx('Check the sound before you start.') },
    // The server takes a shoot without a link, and the box says "optional":
    // so does the step. It ticks when a link is really in the box, and never
    // holds the list up.
    { t: tx('Paste the link to the footage, if you have one'), s: tx('The box is just below. You can skip it — but the editor edits from these files.'), need: true, opt: true },
  ] : k === 'edit' ? [
    { t: tx('Read the brief first'), s: tx('It is lower in this window. It says what the video must look like.') },
    { t: tx('Open the footage and edit it'), s: tx('The footage is under Files.') },
    { t: tx('Paste the link to your edit'), s: tx('The box is just below.'), need: true },
  ] : [
    { t: tx('Read the brief first'), s: tx('It is lower in this window. It says what the picture must show.') },
    { t: tx('Draw it'), s: tx('The examples are under Files.') },
    { t: tx('Paste the link to your artwork'), s: tx('The box is just below.'), need: true },
  ])
  const watching = act.kind === 'waiting' && act.wait === 'shoot' && runs && t.recording_date === today && act.holder
  // Round 8: the numbered steps are no longer drawn in the window (the owner:
  // "too much guidance"). The lists below still feed the ticks that some of
  // the act box's sentences read; they go when that box is next rewritten.
  const askSteps = act.kind === 'ask' ? [
    { t: tx('Look when it is'), s: act.which === 'shoot' ? shootWhen : tx('due {day}', { day: dayShort(editDue(t)) }) },
    { t: tx('Press “I can make it” — or “I can’t”'), s: tx('The two buttons, just below.'), last: true },
  ] : null
  const steps = act.kind === 'fix' || act.kind === 'ownfix' ? [
    { t: tx('Read what to change'), s: tx('It is just below, in “Your step now”.') },
    { t: tx('Make the changes'), s: tx('Change only what was asked.') },
    { t: tx('Paste the link to the new version'), s: tx('The box is just below.'), need: true },
    press,
  ] : ['handin', 'ask', 'blocked', 'notyet', 'early', 'declined'].includes(act.kind) ? [...jobSteps(hat.kind), press]
    : act.kind === 'check' ? [
      { t: act.what === 'cut' ? tx('Watch the edit') : tx('Look at the artwork'), s: nameOf(act.maker) ? tx('It is under Files. {name} made it.', { name: nameOf(act.maker) }) : tx('It is under Files.') },
      { t: tx('Is it what you asked for?'), s: tx('Look at the brief lower in this window.') },
      { t: tx('Press “Accept” — or “Ask for changes”'), s: tx('The two buttons, just below.'), last: true },
    ] : act.kind === 'move' ? [
      { t: tx('Fill in what is asked'), s: asked == null ? tx('Checking what is needed…') : asked === 1 ? tx('One thing is asked. The box is just below.') : asked > 0 ? tx('{n} things are asked. The boxes are just below.', { n: asked }) : tx('Nothing is missing.'), need: true },
      press,
    ] : act.kind === 'publish' ? [
      { t: tx('Look at it one last time'), s: tx('It is under Files.') },
      { t: tx('Post it on the channel'), s: tx('On {channels}.', { channels: (t.channels || []).map((c) => byKey[c]?.label || c).join(', ') }) },
      { t: tx('Paste the link to the post'), s: tx('The box is just below.'), need: true },
      press,
    ] : watching ? [
      { t: tx('Check that {name} is coming', { name: nameOf(act.holder) }), s: tx('Look at the mark by the name. Green means yes.') },
      { t: tx('Be there 10 minutes early'), s: tx('Bring the script.') },
      { t: tx('After the shoot — wait'), s: tx('{name} presses “Shoot is done”. Then the edit starts.', { name: nameOf(act.holder) }) },
    ] : []
  const frozen = ['ask', 'blocked', 'notyet', 'early', 'declined'].includes(act.kind)   // read ahead, tick later
  // The round is in the key: a second round of changes is a new list. Without
  // it round 2 opened with "Read what to change" and "Make the changes" already
  // green — ticked for round 1 — before the new note had been read.
  const ticksKey = `${t.id}:${act.kind}:${hat?.kind || ''}:${act.round || ''}`
  const [ticks, setTicks] = useState(() => readTicks(user.id, ticksKey))
  useEffect(() => { setTicks(readTicks(user.id, ticksKey)) }, [ticksKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const tick = (i) => { const nextTicks = { ...ticks, [i]: !ticks[i] }; setTicks(nextTicks); writeTicks(user.id, ticksKey, nextTicks) }
  // The step that needs something typed is done when it IS typed: for a move,
  // once the server's questions are loaded and answered; for a hand-in, once
  // there is something in the box (an awake button is not that — a shoot's is
  // awake with the box empty); for an owner's own fix, once the link is in.
  const needMet = act.kind === 'move' || act.kind === 'publish' ? asked != null && awake
    : act.kind === 'ownfix' ? !!fixLink.trim() : pasted && awake
  const ticked = (s, i) => (s.last ? false : s.need ? needMet && !frozen : !!ticks[i])
  // The step to do now: the first one not done — passing over one that may be skipped.
  const current = frozen ? -1 : steps.findIndex((s, i) => !s.opt && !ticked(s, i))

  // ---- the brief, and what to make it from ----
  const briefParts = [['tz', t.tz], ['script', t.script], ['description', t.description]]
    .filter(([, v]) => String(v || '').replace(URL_RE, '').trim())
  // Whoever films reads the script first; everybody else the ТЗ.
  if (hat?.kind === 'shoot') briefParts.sort((a, b) => (a[0] === 'script' ? -1 : b[0] === 'script' ? 1 : 0))
  const BRIEF = { tz: () => 'ТЗ', script: () => tx('Script'), description: () => tx('Description') }
  // The day this person works to, by the job they hold — or, for whoever owns
  // the piece, the day it goes out (r11). The server moves it on their word.
  const DAY_OF = { shoot: 'recording_date', edit: 'edit_ready_date', design: 'design_ready_date' }
  // Whoever has no job on it — an admin, a planner, somebody looking — reads the
  // day it goes out: the window starts with the deadline for every role (the
  // owner's order, 13 Oct). Crew who handed theirs over do not: that day is
  // somebody else's promise.
  const myDay = hat ? DAY_OF[hat.kind] : doneHat || ((t.done_at || at < 0) && !owners.includes(user.id)) ? null : 'release_date'
  const refLinks = (() => {
    const raw = t.reference_links
    const list = Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw || '[]') } catch { return [] } })()
    // As LinkText reads them: a bare domain is a link too, and a sentence's full stop is not part of it.
    const inText = [...String(t.reference_text || '').matchAll(URL_RE)]
      .map((m) => m[0].replace(/[.,;:!?)\]»"']+$/, '')).map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
    return [...new Set([...list, ...inText])].filter((u) => /^https?:\/\//i.test(u))
  })()
  // The words around the links (the links are drawn as previews): "Like this,
  // fast cuts: <link> and <link>" reads "Like this, fast cuts".
  const refWords = String(t.reference_text || '').replace(URL_RE, ' ').replace(/[ \t]{2,}/g, ' ')
    .replace(/(?:[\s,:;–—-]+(?:and|или|и|va|yoki))*[\s,:;–—-]*$/i, '').trim()
  // The team's Google Drive, as the server reads this task: the files it points
  // at (drawn by TaskFiles, with a player and Download), and which link boxes
  // those came from — those are not drawn a second time as plain links.
  const [drive, setDrive] = useState(null)
  const boxAdd = useRef(null)
  const registerBox = useCallback((fn) => { boxAdd.current = fn }, [])
  const shownHere = drive?.handled || []
  const files = [
    deliveryHref(t.shot_link) && { href: deliveryHref(t.shot_link), label: tx('Footage'), field: 'shot_link' },
    deliveryHref(t.ready_link) && { href: deliveryHref(t.ready_link), label: tx('The edit'), field: 'ready_link' },
    deliveryHref(t.design_link) && { href: deliveryHref(t.design_link), label: tx('The artwork'), field: 'design_link' },
    deliveryHref(t.post_link) && { href: deliveryHref(t.post_link), label: tx('The published post') },
  ].filter((m) => m && !shownHere.includes(m.field))
  const docs = t.documents || []
  // r11 (the crew's feedback): a link opens here, in the viewer — never a jump to another site.
  const [linkOpen, setLinkOpen] = useState(null)
  // A link or a note added to the reference (the owner, 13 Oct), kept in reference_text.
  const [refDraft, setRefDraft] = useState('')
  // The reference is drawn only when there is one (the owner, 13 Oct: "reference if
  // given"): words, a link, or a picture RefMedia holds. The first one is added
  // from More details, which opens the block in its place.
  const [refHeld, setRefHeld] = useState(0)
  const [refOpen, setRefOpen] = useState(false)
  const refInput = useRef(null)
  useEffect(() => { if (refOpen) refInput.current?.focus() }, [refOpen])
  const hasRef = !!String(t.reference_text || '').trim() || refLinks.length > 0 || refHeld > 0
  // What is empty is not drawn (the owner, 14 Oct 2026: "if not done, do not
  // show — straight to the ТЗ"). Only the task's owner keeps a small "+ Add"
  // line; everybody else changes a reference or a file through Edit.
  const mayRef = at >= 0 && owners.includes(user.id)
  const [fileOpen, setFileOpen] = useState(false)
  const nFiles = files.length + docs.length + (drive?.files?.length || 0)
  const [refBusy, setRefBusy] = useState(false)
  const addRef = async () => {
    const v = refDraft.trim()
    if (!v || refBusy) return
    setRefBusy(true)
    try {
      // Added under what is there — anybody on the task may (POST /content/:id/reference).
      apply(await api.post(`/content/${t.id}/reference`, { text: v }))
      setRefDraft('')
    } catch (e) { toast(e.message, 'err') } finally { setRefBusy(false) }
  }
  const openDoc = async (d) => {
    try { const { url } = await api.get(`/content/files/${d.id}`); window.open(url, '_blank', 'noopener') } catch (e) { toast(e.message, 'err') }
  }

  // ---- the window itself: in from the right, out on Esc or a click outside ----
  const panel = useRef(null)
  const closeBtn = useRef(null)
  // The sticky step box sits under the sticky head, however tall the head is
  // (a long title, the leave note): its height is kept on the panel.
  const headRef = useRef(null)
  useEffect(() => {
    const keep = () => panel.current?.style.setProperty('--co-head-h', `${Math.ceil(headRef.current?.offsetHeight || 0)}px`)
    keep()
    if (!headRef.current || !window.ResizeObserver) return undefined
    const ro = new ResizeObserver(keep)
    ro.observe(headRef.current)
    return () => ro.disconnect()
  }, [])
  const [closing, setClosing] = useState(false)
  // What was typed in the window and is still in its box — a correction, a
  // link, a reason, a comment. None of it is saved until its own button is
  // pressed, and Esc or one click beside a 540px panel used to throw it away.
  // The boxes belong to five different forms, so they are not asked one by
  // one: every box typed into is remembered, and "unsent" is any of those
  // still on the page with words in it (a form that sent clears or leaves).
  const typed = useRef(new Set())
  const unsent = () => [...typed.current].some((el) => el.isConnected && String(el.value || '').trim())
  // `leaving` is the way out that was asked for and is being held: closing,
  // the full task sheet ("Edit the task" / "All details"), or the next task.
  // All three take this window off the page and its boxes with it, so all
  // three ask first. (The first cut asked only on closing: a pravka typed and
  // then "Edit the task" pressed was gone without a word.)
  const [leaving, setLeaving] = useState(null)   // null | 'close' | 'full' | 'next'
  const close = useCallback((sure) => {
    if (busy) return
    if (editing) { editOut.current?.(); return }
    if (sure !== true && unsent()) { setLeaving('close'); return }
    setClosing(true)
    // Long enough for the panel to leave; at once for whoever asked for less motion.
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setTimeout(onClose, calm ? 0 : 180)
  }, [busy, onClose, editing])
  useEffect(() => {
    // A window opened over this one (a clash to settle, the full task) takes Esc first.
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) close() }   // a second Esc does not confirm: only the button does
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  useEffect(() => {
    // The page behind does not scroll, and the row that opened the window gets
    // the focus back when it closes — so the keyboard is where the eye is.
    const opener = document.activeElement
    document.body.classList.add('co-held')
    if (focus !== 'note' && focus !== 'step') closeBtn.current?.focus({ preventScroll: true })
    return () => {
      document.body.classList.remove('co-held')
      if (opener && document.contains(opener)) opener.focus?.({ preventScroll: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Opened from the start-here card (D-02): the keyboard lands on the step's
  // first control — the drop box, the question, the button — once it is drawn.
  useEffect(() => {
    if (focus !== 'step' || !loaded) return undefined
    const t = setTimeout(() => {
      const el = panel.current?.querySelector('.co-act button:not([disabled]), .co-act input:not([disabled]), .co-act textarea:not([disabled]), .co-act [tabindex="0"]')
      el?.focus({ preventScroll: false })
    }, 60)
    return () => clearTimeout(t)
  }, [focus, loaded])
  const leave = (how) => { setLeaving(null); if (how === 'edit') setEditing(true); else if (how === 'next') onNext(); else close(true) }
  const goOut = (how) => { if (unsent()) setLeaving(how); else leave(how) }
  // Tab stays inside the window while it is open.
  const trap = (e) => {
    if (e.key !== 'Tab' || !panel.current) return
    const stops = [...panel.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, audio[controls], video[controls], [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
      // What is inside a shut <details> still has a box in Chrome (content-visibility),
      // so visibility is asked, not measured — else the last stop is one the
      // keyboard can never reach, and Tab walks out of the window after the summary.
      .filter((el) => (el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0) && !el.closest('[hidden], [aria-hidden="true"]'))
    if (!stops.length) return
    const first = stops[0], last = stops[stops.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  // ---- "After you press: …" — who gets it next, in their name ----
  const after = (words) => <p className="co-after"><b>{tx('After you press:')}</b> {words}</p>
  const notYet = (words) => <p className="co-after co-warn"><b>{tx('Not yet.')}</b> {words}</p>
  const nothing = (words) => <p className="co-after"><b>{tx('Nothing to press.')}</b> {words}</p>
  // The strip over the step (round 17): the stage as its mark, whose turn it
  // is as a face, and the day — the same three marks the calendar and My Day
  // wear, so the window is read before its words are.
  const stop = at >= 0 ? wayOf(t, pipe, makingFor(t)).find((s) => s.cls === 'on') : null
  const holder = stop?.who && stop.who !== user.id ? person(stop.who) : null
  const box = (title, body) => (
    <section className="co-act" aria-label={title}>
      <div className="r14-act-h">
        <h3>{title}</h3>
        {pipe.live[at] && <StageMark status={pipe.live[at]} />}
        {holder && <span className="co-strip-who"><Face person={holder} size="xs" />{firstName(holder)}</span>}
        {(hat || doneHat || at >= 0) && badge}{whenLine && <span className="r14-act-when">{whenLine}</span>}
      </div>
      {body}
    </section>
  )
  const holderRow = (id, line, sub) => (
    <div className="co-holder">
      {person(id) ? <Face person={person(id)} size="lg" /> : <span className="co-kic co-k-idea" aria-hidden="true"><Clock size={18} /></span>}
      <div><b>{line}</b>{sub && <span>{sub}</span>}</div>
    </div>
  )
  const nextBtn = next && onNext && (
    <button type="button" className="co-btn co-btn-p" onClick={() => goOut('next')}>
      {tx('Next: {title}', { title: next.title.length > 26 ? `${next.title.slice(0, 24)}…` : next.title })} <ArrowRight size={18} aria-hidden="true" />
    </button>
  )
  const ownerName = teamName(owner)

  const handInAfter = () => {
    if (!awake) return notYet(drive?.connected ? tx('Drop the file first. Then the button appears.') : tx('Paste the link first. Then the button appears.'))
    // A re-shoot is footage like any other: it goes to the editor, not back to
    // whoever asked (the bug hunt, 14 Oct 2026).
    if (act.kind === 'fix' && hat.kind !== 'shoot') return after(openRound?.requested_name ? tx('{name} gets the new version and checks it again.', { name: openRound.requested_name.split(' ')[0] }) : tx('The new version goes back to be checked again.'))
    if (hat.kind === 'shoot') {
      if (t.editor_id === user.id) return after(tx('The task moves to Editing. You edit it next — it comes back to your list as an edit.'))
      if (nameOf(t.editor_id)) return after(tx('{name} gets the footage and starts to edit it. You are done with this one.', { name: nameOf(t.editor_id) }))
      return after(tx('The task moves on. {name} sees that it is filmed.', { name: ownerName }))
    }
    if (coverFirst) return after(tx('Your artwork waits for the edit. Then {name} checks both.', { name: ownerName }))
    return after(hat.kind === 'edit'
      ? tx('{name} gets your edit. {name} watches it and takes it — or asks you to change something.', { name: ownerName })
      : tx('{name} gets your artwork. {name} looks at it and takes it — or asks you to change something.', { name: ownerName }))
  }

  const actBox = () => {
    if (!loaded) return box(tx('Your step now'), <p className="muted">{tx('Checking what is needed…')}</p>)
    switch (act.kind) {
      case 'ask': return box(tx('Your step now'), (
        <>
          <p className="co-lead"><b>{act.which === 'shoot'
            ? tx('{name} asks: can you film it {when}?', { name: ownerName, when: shootWhen })
            : tx('{name} asks: can you finish the edit by {day}?', { name: ownerName, day: dayShort(editDue(t)) })}</b></p>
          <Booking item={t} which={act.which} label={act.which === 'shoot' ? tx('Shoot') : tx('Editing')} mine holderName={user.name} openNo={focus === 'no'}
            onAnswered={(u) => { if (u?.released) { onChanged?.(u); onClose() } else apply(u) }} />
          {after(tx('{name} sees your answer at once. If you say no, {name} finds another person.', { name: ownerName }))}
        </>
      ))
      case 'fix':
      case 'handin': return box(tx('Your step now'), (
        <>
          <HandIn inline key={`${t.id}:${hat.kind}:${act.kind}`} item={t} kind={hat.kind} label={button} onReady={(ok, has) => { setAwake(ok); setPasted(!!has) }} onDone={apply} />
          {handInAfter()}
          {lateDays > 0 && <LateHelp taskId={t.id} phase={hat.kind} today={today} onMoved={apply} />}
        </>
      ))
      case 'blocked': return box(tx('Not your step yet'), (
        <>
          <div className="co-note co-n-wait"><Clock size={20} aria-hidden="true" /><span><b>{tx('You can’t start yet.')}</b> {nameOf(t.operator_id) && shootWhen
            ? tx('{name} films it {when}. When the footage is in, this task wakes up and you can start.', { name: nameOf(t.operator_id), when: shootWhen })
            : tx('It is not filmed yet. When the footage is in, this task wakes up and you can start.')}</span></div>
          {/* T-04: no sleeping button. The sentence says what is missing; the
              button appears the moment it can be pressed. */}
        </>
      ))
      case 'early': {
        const name = teamName(act.holder)
        return box(tx('Not your step yet'), (
          <>
            <div className="co-note co-n-wait"><Clock size={20} aria-hidden="true" /><span><b>{tx('This one is not sent to you yet.')}</b> {tx('{name} is still planning it. When it is sent on, it moves into your list and the button appears here.', { name })}</span></div>
            <div><button type="button" className="co-link" onClick={() => setAnyway(true)}>{tx('Already made it? Hand it in')}</button></div>
          </>
        ))
      }
      // They said no and still hold the seat: the maker's step. The answer is
      // shown with its reason, and can be changed to a yes right here (the
      // server takes a new answer from the holder).
      case 'declined': {
        const name = teamName(act.holder)
        return box(tx('Not your step now'), (
          <>
            <div className="co-note co-n-wait"><Clock size={20} aria-hidden="true" /><span><b>{tx('You said you can’t make it.')}</b> {tx('{name} moves the day or asks another person. Nothing for you to do until then.', { name })}</span></div>
            <Booking item={t} which={act.which} label={act.which === 'shoot' ? tx('Shoot') : tx('Editing')} mine holderName={user.name} onAnswered={apply} />
            {(act.which === 'shoot' ? t.recording_date : editDue(t)) >= today
              ? <p className="co-after"><b>{tx('Can you make it after all?')}</b> {tx('Press “I can make it”. It comes back to your list.')}</p>
              : nothing(tx('The day has gone. {name} sets a new one.', { name }))}
          </>
        ))
      }
      case 'notyet': return box(tx('Not your step yet'), (
        <>
          <div className="co-note co-n-wait"><Clock size={20} aria-hidden="true" /><span>{shootWhen
            ? tx('The shoot is {when}. On that day the button appears here.', { when: shootWhen })
            : tx('The shoot has no day yet. When it has one, it shows here.')}</span></div>
        </>
      ))
      case 'check': {
        const maker = crewName(act.maker)
        const href = deliveryHref(act.what === 'cut' ? t.ready_link : t.design_link)
        return box(tx('Your step now'), (
          <>
            <p className="co-lead"><b>{act.what === 'cut'
              ? tx('{name} handed in the edit', { name: maker }) : tx('{name} handed in the artwork', { name: maker })}.</b>{' '}
            {act.what === 'cut' ? tx('Watch it, then answer.') : tx('Look at it, then answer.')}</p>
            {href && <div><a className="co-file" href={href} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />{act.what === 'cut' ? tx('The edit') : tx('The artwork')}</a></div>}
            <div className="co-btns">
              <button type="button" className={'co-btn ' + (asking ? 'co-btn-s' : 'co-btn-p')} disabled={busy} onClick={accept}><Check size={18} aria-hidden="true" />{tx('Accept')}</button>
              {reviews.ask && <button type="button" className="co-btn co-btn-s" aria-expanded={asking} onClick={() => setAsking(true)}>{tx('Ask for changes')}</button>}
            </div>
            {asking ? (
              <>
                <span className="co-lbl">{tx('What must change?')}</span>
                <PravkaBox taskId={t.id} value={note} phone={phone} disabled={busy}
                  onChange={(v) => setNote((old) => (typeof v === 'function' ? v(old) : v))}
                  onError={setErr} onUploading={setUploading}
                  placeholder={tx('For example: the music is too loud at 0:40. Make the name bigger.')} />
                {targets.length > 1 && (
                  <div className="pravki-target" role="group" aria-label={tx('Send back to')}>
                    {targets.map((x) => (
                      <button key={x.key} type="button" className={'tchip' + (sendTarget === x.key ? ' on' : '')} aria-pressed={sendTarget === x.key} onClick={() => setTarget(x.key)}>{x.label}</button>
                    ))}
                  </div>
                )}
                {canRecord() && <VoiceRecorder onClip={setNoteClip} disabled={busy} />}
                {revisions.length === PRAVKA_ROUNDS - 1 && (
                  <span className="co-help">{tx('This is the last pravka — the next delivery is approved as it stands.')}</span>
                )}
                <div className="co-btns">
                  {note.trim() && (
                    <button type="button" className="co-btn co-btn-p" disabled={busy || uploading} onClick={sendBack}>
                      {tx('Send to {name}', { name: crewName(fixer) })} <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" className="co-btn co-btn-s" disabled={busy} onClick={() => setAsking(false)}>{tx('Cancel')}</button>
                </div>
                {note.trim()
                  ? after(`${tx('{name} gets your note and fixes it.', { name: maker })} ${tx('Then it comes back to you to check.')}`)
                  : notYet(tx('Write what must change first. Then the button appears.'))}
              </>
            ) : (
              <p className="co-after">
                <b>{tx('After you press Accept:')}</b> {tx('it is ready to publish, and you can post it.')}
                {reviews.ask && <> <b>{tx('Ask for changes:')}</b> {tx('{name} gets your note and fixes it.', { name: maker })}</>}
              </p>
            )}
          </>
        ))
      }
      case 'fixing': {
        const name = crewName(act.holder)
        const does = act.seat === 'designer' ? tx('{name} fixes the artwork', { name })
          : act.seat === 'operator' ? tx('{name} films it again', { name }) : tx('{name} fixes the edit', { name })
        const until = fixUntil(t, act.seat, today)
        const gone = !until && reviewDue(t) && reviewDue(t) < today
        return box(tx('Not your step now'), (
          <>
            {holderRow(act.holder, does, [tx('round {n}', { n: act.round }),
              until ? tx('until {day}', { day: dayInLine(until, today) }) : gone && tx('was planned for {day}', { day: dayShort(reviewDue(t)) })].filter(Boolean).join(' · '))}
            {openRound && <div className="co-quote"><b>{tx('What was asked')}</b><PravkaNote text={openRound.note} /></div>}
            {nothing(tx('When {name} hands it in, it comes back under “Check it”.', { name }))}
            <div className="co-btns">
              {runs && <RemindButton user={user} taskId={t.id} person={person(act.holder)} today={today} onSent={addComment} />}
              {acted && nextBtn}
            </div>
          </>
        ))
      }
      case 'ownfix': return box(tx('Your step now'), (
        <>
          <p className="co-lead"><b>{tx('{name} asked you to change something.', { name: (openRound?.requested_name || tx('The team')).split(' ')[0] })}</b></p>
          {openRound && <div className="co-quote"><b>{tx('What to change')}</b><PravkaNote text={openRound.note} /></div>}
          <input className="input" value={fixLink} placeholder={tx('Link to the new version')} aria-label={tx('Link to the new version')}
            disabled={busy} onChange={(e) => { setFixLink(e.target.value); setErr('') }} />
          {fixLink.trim() && (
            <div className="co-btns">
              <button type="button" className="co-btn co-btn-p" disabled={busy} onClick={ownFix}><Check size={18} aria-hidden="true" />{tx('Hand in the fix')}</button>
            </div>
          )}
          {fixLink.trim() ? after(tx('The new version goes back to be checked again.')) : notYet(tx('Paste the link first. Then the button appears.'))}
        </>
      ))
      case 'move':
      case 'publish': return box(tx('Your step now'), (
        <>
          <NextStep inline key={`${t.id}:${act.to.id}`} item={t} to={act.to} verb={act.verb} seat={seatAt(t, pipe, makingFor(t), act.to)}
            recheck={refHeld} onAsks={(n, ok, no) => { setAsked(n); setAwake(ok); setRefused(!!no) }} onDone={apply} onCancel={() => {}} />
          {asked == null || refused ? null : !awake
            ? notYet(act.kind === 'publish' ? tx('Paste the link to the post first. Then the button appears.') : tx('Fill in the boxes above first. Then the button appears.'))
            : after(act.kind === 'publish' ? tx('The task moves to Published. The team sees it is out. Nothing more to do.')
              : act.verb === 'Send to the shoot' ? tx('The person who films gets the task and says if they can come.')
                : act.verb === 'Send to the designer' ? `${tx('The designer gets the task with your words and draws it.')} ${tx('Then it comes back to you to check.')}`
                  : tx('The task moves to «{stage}».', { stage: tx(act.to.label) }))}
        </>
      ))
      case 'waiting': {
        // A seat that is held is never "nobody", even before its name has loaded.
        const known = nameOf(act.holder)
        const name = known || (act.holder ? tx('Someone') : '')
        const W = act.wait
        const does = W === 'shoot' ? (name ? tx('{name} films it', { name }) : tx('Nobody is named to film it yet'))
          : W === 'cut' ? (name ? tx('{name} edits it', { name }) : tx('Nobody is named to edit it yet'))
            : W === 'artwork' ? (name ? tx('{name} draws it', { name }) : tx('Nobody is named to draw it yet'))
              : W === 'review' ? (name ? tx('{name} checks it and posts it', { name }) : tx('It waits to be checked and posted'))
                : (name ? tx('{name} plans it', { name }) : tx('It is still an idea'))
        const forKind = { shoot: 'shoot', cut: 'edit', artwork: 'design' }[W]
        const day = W === 'shoot' ? t.recording_date : W === 'cut' ? (editDue(t) || reviewDue(t)) : W === 'artwork' ? (t.design_ready_date || reviewDue(t)) : W === 'review' ? reviewDue(t) : null
        const late = day && day < today ? daysBetween(day, today) : 0
        const sub = !day ? '' : W === 'shoot' ? shootWhen : late ? tx('was due {day}', { day: dayShort(day) }) : tx('until {day}', { day: dayShort(day) })
        const mark = late ? <Badge tone="late">{lateWords(late)}</Badge>
          : W === 'shoot' && act.holder ? (t.shoot_ack === 'yes' ? <Badge tone="good" icon="check">{tx('{name} is coming', { name })}</Badge>
            : t.shoot_ack === 'no' ? <Badge tone="late">{tx('{name} can’t come', { name })}</Badge> : <Badge tone="wait">{tx('No answer yet')}</Badge>)
            : act.holder ? <Badge tone="good">{tx('On time')}</Badge> : null
        return box(act.didMine ? tx('Finished') : tx('Not your step now'), (
          <>
            {act.didMine && <div className="co-note"><Check size={20} aria-hidden="true" /><span><b>{tx('You did your part.')}</b> {name ? tx('{name} has it now.', { name }) : tx('It has moved on.')}</span></div>}
            {!act.didMine && holderRow(act.holder, does, sub)}
            {!act.didMine && mark && <div>{mark}</div>}
            {!act.didMine && nothing(!act.holder ? (canEditIt ? tx('Press Edit at the top to name a person.') : '')
              : late ? (runs && known ? tx('It is late. You can remind {name}.', { name: known }) : tx('It is late.'))
                : W === 'shoot' && t.shoot_ack === 'no' ? (canEditIt ? tx('Name another person, or move the shoot to a new day: press Edit at the top.') : '')
                  : W === 'review' ? tx('{name} posts it when it is checked.', { name })
                    : tx('It comes back to you when {name} hands it in.', { name }))}
            {!act.didMine && act.holder && forKind && adminOn(user, t.channels) && (forThem
              ? <HandIn inline key={`for:${t.id}:${forKind}`} item={t} kind={forKind} label={tx('Hand in for: {name}', { name })}
                onDone={(u) => { setForThem(false); apply(u) }} />
              : <div><button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setForThem(true)}><UploadCloud size={16} aria-hidden="true" />{tx('Upload instead of them')}</button></div>)}
            <div className="co-btns">
              {runs && !act.didMine && act.holder && <RemindButton user={user} taskId={t.id} person={person(act.holder)} today={today} onSent={addComment} />}
              {(acted || act.didMine) && nextBtn}
            </div>
          </>
        ))
      }
      case 'out': return box(tx('Finished'), (
        <>
          <div className="co-note"><Check size={20} aria-hidden="true" /><span><b>{tx('This one is out.')}</b> {tx('Nothing left to press.')}</span></div>
          {acted && nextBtn && <div className="co-btns">{nextBtn}</div>}
        </>
      ))
      default: return box(tx('Not your step now'), (
        <>
          {act.didMine && <div className="co-note"><Check size={20} aria-hidden="true" /><span><b>{tx('You did your part.')}</b> {tx('It has moved on.')}</span></div>}
          {nothing(at < 0 ? tx('This task was deleted.') : '')}
          {acted && nextBtn && <div className="co-btns">{nextBtn}</div>}
        </>
      ))
    }
  }

  // ---- the maker's colour (r11) ----
  const maker = person(ownerIdOf(t))
  const pcNow = colorIndexOf(t, maker, today)
  const canColor = (maker?.color_mode || 'own') === 'own' && (owners.includes(user.id) || user.role === 'admin') && at >= 0
  const [pcOpen, setPcOpen] = useState(false)
  const pickColor = async (i) => {
    try { apply(await api.post(`/content/${t.id}/color`, { color: i })); setPcOpen(false) } catch (e) { toast(e.message, 'err') }
  }

  const K = KIND[doneHat ? doneHat.kind : kind] || KIND.idea
  // ---- round 14: the one window, as the owner picked it (16 Oct 2026) ----
  // "The task view is complicated", "the edit form does not match the task view":
  // a header that says what it is and whose; then two columns on a desk —
  // what to do and what to make it from (your step with its drop box, the brief
  // open, the reference, the files, the talk), and beside it the plan, pressed
  // to change by whoever may edit the piece (TaskPlan). One column on a phone.
  const chanWords = (t.channels || []).map((c) => byKey[c]?.label || c).join(', ')
  const crumb = [typeLabel(t.type), chanWords, owner === user.id ? tx('yours') : nameOf(owner) ? tx('for {name}', { name: nameOf(owner) }) : ''].filter(Boolean).join(' · ')
  // A person moves their own day from its row of the plan when they cannot edit the piece.
  const DAY_ROW = { recording_date: 'shoot', edit_ready_date: 'edit', design_ready_date: 'design', release_date: 'out' }
  const ownDay = myDay && !(again || act.kind === 'fix') && t[myDay] && !t.done_at && (hat || owners.includes(user.id)) && !canEditIt
  const moveExtra = ownDay ? { [DAY_ROW[myDay]]: <MoveDay task={t} field={myDay} today={today} onMoved={apply} /> } : null
  return (
    <div className={'co-win' + (closing ? ' out' : '')}>
      <div className="co-scrim" onMouseDown={() => close()} />
      <aside className={`co-panel r14-tw ${K.cls}`} role="dialog" aria-modal="true" aria-labelledby="co-win-t" ref={panel} onKeyDown={trap} data-task={item.id}
        onInput={(e) => { if (e.target.matches?.('input:not([type=file]):not([type=radio]):not([type=checkbox]), textarea')) typed.current.add(e.target) }}>
        <header className="co-p-head r14-tw-h" ref={headRef}>
          <span className={`r14-tw-kt co-kic ${K.cls}`} aria-hidden="true"><K.Icon size={18} /></span>
          <div className="r14-tw-tt">
            {!editing && crumb && <p className="r14-tw-crumb">{crumb}</p>}
            {editing ? <h2 id="co-win-t">{tx('Edit the task')}</h2> : (<>
            {/* The maker's colour is the dot by the title; its owner presses the dot
                to pick one (no second row under the title — the owner, 13 Oct). */}
            <h2 id="co-win-t">
              {canColor ? (
                <button type="button" className="co-pc-dot" aria-expanded={pcOpen} onClick={() => setPcOpen((v) => !v)} aria-label={tx('Colour of this piece')}>
                  <i className="pc-dot pc-dot-lg" style={pcNow != null ? colorStyle(pcNow) : { '--pc': 'var(--hairline-strong)' }} aria-hidden="true" />
                </button>
              ) : pcNow != null && <i className="pc-dot pc-dot-lg" style={colorStyle(pcNow)} aria-hidden="true" />}
              {t.title}
            </h2>
            {canColor && pcOpen && (
              <div className="co-pc">
                <span className="pc-filter co-pc-pick" role="group" aria-label={tx('Colour of this piece')}>
                  {[...Array(PALETTE)].map((_, i) => (
                    <button key={i} type="button" className="pc-swatch" style={colorStyle(i)} aria-pressed={t.color === i}
                      aria-label={tx('Colour {n}', { n: i + 1 })} onClick={() => pickColor(t.color === i ? null : i)} />
                  ))}
                </span>
              </div>
            )}
            {/* The piece as its line of stops (round 18), for everybody: the lit
                stop says whose turn it is before the step below says so. */}
            {at >= 0 ? (
              <Capsule t={t} pipe={pipe} making={makingFor(t)} userId={user.id} person={person} today={today} />
            ) : null}
            </>)}
          </div>
          <div className="co-p-acts">
            {canEditIt && !editing && (
              <button type="button" className="co-btn co-btn-q co-btn-sm co-edit-btn" onClick={() => goOut('edit')} aria-label={tx('Edit')}><PenLine size={16} aria-hidden="true" /><span>{tx('Edit')}</span></button>
            )}
            <button type="button" className="co-x" ref={closeBtn} onClick={() => close()} aria-label={editing ? tx('Cancel') : tx('Close the task')}><X size={18} aria-hidden="true" /></button>
          </div>
          {leaving && (
            <div className="co-note co-n-wait co-leave" role="alertdialog" aria-label={tx('You wrote something and did not send it.')}>
              <span><b>{tx('You wrote something and did not send it.')}</b> {tx('If you close now, it is lost.')}</span>
              <span className="co-btns">
                <button type="button" className="co-btn co-btn-s co-btn-sm" autoFocus onClick={() => setLeaving(null)}>{tx('Keep writing')}</button>
                <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => leave(leaving)}>{tx('Close anyway')}</button>
              </span>
            </div>
          )}
        </header>

        {editing ? edit(t, {
          closeRef: editOut,
          done: () => { setEditing(false); load() },
          leave: (nextTask) => onClose(nextTask),
        }) : (
        <div className="co-p-body r14-tw-b">
          <div className="r14-tw-main">
            <DayAsks t={t} user={user} onChanged={heard} />
            {/* Your step: the one button, its drop box, what happens after it. */}
            {actBox()}
            {undo > 0 && (
              <div className="co-note co-n-wait co-undo" role="status">
                <span><b>{tx('Pressed by mistake?')}</b> {tx('You can take it back for {n} more seconds.', { n: left })}</span>
                <span className="co-btns">
                  <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={undoing} onClick={takeBack}><Undo2 size={16} aria-hidden="true" />{tx('Undo')}</button>
                </span>
              </div>
            )}
            {err && <div className="form-error" role="alert">{err}</div>}

            {/* What to make, open and whole (the owner's pick: "by default it must be
                the brief"): the ТЗ for whoever edits or draws, the script first for
                whoever films, the brief for the piece's owner. */}
            <section className={`co-blk r14-brief co-main-${hat?.kind || doneHat?.kind || 'brief'}`}>
              <h3>{hat?.kind === 'edit' ? tx('ТЗ — how to edit') : hat?.kind === 'shoot' ? tx('Script — what to film') : hat?.kind === 'design' ? tx('ТЗ — what to make') : tx('The brief')}</h3>
              {briefParts.length === 0
                ? (
                  <div className="co-brief-empty">
                    <p className="co-main-none">{hat ? tx('Nothing is written here yet — ask whoever gave you the task.') : tx('Nothing is written yet. It is asked when the task moves on.')}</p>
                    {hat && owner && owner !== user.id && <RemindButton user={user} taskId={t.id} person={person(owner)} today={today} onSent={addComment} />}
                  </div>
                )
                : (
                  <div className="r14-brief-box">
                    {briefParts.map(([k, v]) => (
                      <div key={k} className="co-main-part">
                        {briefParts.length > 1 && <span className="co-main-lbl">{BRIEF[k]()}</span>}
                        <p className="co-main-txt"><LinkText text={String(v).trim()} /></p>
                        {k === 'description' && <CharCount text={v} channels={t.channels} />}
                      </div>
                    ))}
                  </div>
                )}
            </section>

            {mayRef && ((!hasRef && !refOpen) || (nFiles === 0 && !fileOpen && drive?.connected)) && (
              <div className="co-add-line">
                {!hasRef && !refOpen && <button type="button" className="co-link" onClick={() => setRefOpen(true)}><Plus size={14} aria-hidden="true" />{tx('Add a reference')}</button>}
                {nFiles === 0 && !fileOpen && drive?.connected && <button type="button" className="co-link" onClick={() => setFileOpen(true)}><Plus size={14} aria-hidden="true" />{tx('Add a file')}</button>}
              </div>
            )}
            <section className="co-blk co-ref" hidden={!(hasRef || refOpen)}>
              <h3>{tx('The reference')}</h3>
              {refWords && <p className="co-ref-txt"><LinkText text={refWords} /></p>}
              {/* Each link as a preview; pressed, it opens in the middle of the page. */}
              {refLinks.length > 0 && <div className="lp-row">{refLinks.map((u) => <LinkPreview key={u} url={u} onOpen={setLinkOpen} />)}</div>}
              <RefMedia task={t} user={user} plans={reach && can(user, 'manage_content')} onHeld={setRefHeld} adds={mayRef && refOpen} catchAll={mayRef}
                onOther={drive?.connected ? (fs) => { if (!boxAdd.current) return false; setFileOpen(true); return boxAdd.current(fs) } : null}
                legacy={Array.isArray(t.reference_photos) ? t.reference_photos : []}
                onRemoveLegacy={reach && can(user, 'manage_content') ? async (i) => {
                  try {
                    const u = await api.patch(`/content/${t.id}`, { reference_photos: t.reference_photos.filter((_, j) => j !== i) })
                    setT((old) => ({ ...old, ...u, reference_photos: old.reference_photos.filter((_, j) => j !== i) }))
                  } catch (e) { toast(e.message, 'err') }
                } : null} />
              {mayRef && hasRef && !refOpen && (
                <button type="button" className="co-link co-add-more" onClick={() => setRefOpen(true)}><Plus size={14} aria-hidden="true" />{tx('Add to the reference')}</button>
              )}
              {mayRef && refOpen && (
                <div className="co-ref-add">
                  <input className="input" ref={refInput} value={refDraft} placeholder={tx('Paste a link or write how it should look…')} aria-label={tx('Paste a link or write how it should look…')}
                    onChange={(e) => setRefDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRef() } }} />
                  <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={!refDraft.trim() || refBusy} onClick={addRef}><Plus size={16} aria-hidden="true" />{tx('Add')}</button>
                </div>
              )}
            </section>

            <section className="co-blk" hidden={nFiles === 0 && !fileOpen}>
              <h3>{tx('Files')}</h3>
              {files.length + docs.length > 0 && (
                <div className="co-files">
                  {files.map((m) => (
                    <button key={m.label + m.href} type="button" className="co-file" onClick={() => setLinkOpen(m.href)} title={m.href}><ExternalLink size={16} aria-hidden="true" />{m.label}</button>
                  ))}
                  {docs.map((d) => (
                    <button key={d.id} type="button" className="co-file" onClick={() => openDoc(d)}><FileText size={16} aria-hidden="true" />{d.name}</button>
                  ))}
                </div>
              )}
              {/* Every Drive file the task points at — dropped, uploaded, or an old
                  link — to play and download here; then the drop box that sends the
                  next one to the team's Drive (server/taskfiles.js, server/dropin.js). */}
              <TaskFiles taskId={t.id} onList={setDrive} />
              {/* Mounted for the owner even while folded, so a file dropped on the task lands in it. */}
              {loaded && drive?.connected && mayRef && <div hidden={!fileOpen}><DriveBox task={t} folder={t.drop?.folder_name} register={registerBox} /></div>}
              {loaded && drive?.connected && mayRef && nFiles > 0 && !fileOpen && (
                <button type="button" className="co-link co-add-more" onClick={() => setFileOpen(true)}><Plus size={14} aria-hidden="true" />{tx('Add a file')}</button>
              )}
            </section>
            {linkOpen && <LinkViewer url={linkOpen} onClose={() => setLinkOpen(null)} />}

            <section className="co-blk">
              <h3>{tx('Comments')}{comments.length > 0 && <span className="count"> · {comments.length}</span>}</h3>
              {comments.length === 0 && <p className="co-none">{tx('No comments yet. If something is not clear, write here — everybody on the task sees it.')}</p>}
              {comments.map((c) => (
                <div key={c.id} className="co-cmt">
                  <Face person={person(c.user_id) || { name: c.author }} size="sm" />
                  <div><b>{c.user_id === user.id ? tx('You') : (c.author || '?').split(' ')[0]}</b>{c.text ? <LinkText text={c.text} /> : !c.voice_id && tx('voice note')}{c.voice_id ? <VoicePlayer id={c.voice_id} secs={c.voice_secs} mine={c.user_id === user.id} /> : null}</div>
                  <time>{c.created_at ? dayInLine(tashkentDay(c.created_at), today) : ''}</time>
                </div>
              ))}
              <div className="co-say">
                <input className="input" value={draft} placeholder={tx('Write a question or a note…')} aria-label={tx('Write a question or a note…')}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); say() } }} />
                {canRecord() && <VoiceRecorder key={clipKey} onClip={setSayClip} disabled={saying} />}
                <button type="button" className="co-btn co-btn-s co-send" onClick={say} disabled={saying || (!draft.trim() && !sayClip)} aria-label={tx('Send comment')}><Send size={18} aria-hidden="true" /></button>
              </div>
            </section>
          </div>

          {/* The side: the plan (who and when, pressed to change it), the facts, and one fold for the rest. */}
          <aside className="r14-tw-side" aria-label={tx('Plan')}>
            <section className="r14-tw-sec">
              <h3>{tx('Plan')}{canEditIt && at >= 0 && !t.done_at && <span>{tx('press to change')}</span>}</h3>
              <TaskPlan t={t} label={at >= 0 ? pipe.live[at].label : ''} making={makingFor(t)} team={team} today={today} byKey={byKey}
                edit={canEditIt && at >= 0} onSaved={apply} extra={moveExtra} />
            </section>
            <section className="r14-tw-sec">
              <h3>{tx('Details')}</h3>
              <dl className="co-facts r14-dets">
                {at >= 0 && <><dt>{tx('Stage')}</dt><dd>{tx(pipe.live[at].label)}</dd></>}
                <dt>{tx('Type')}</dt><dd>{typeLabel(t.type)}</dd>
                {person(owner) && <><dt>{tx('Whose piece')}</dt><dd>{ownerName}</dd></>}
                {/* What the form holds, read here by everybody — the people without
                    Edit had no way to it any more (the review, 14 Oct 2026). */}
                {t.format && <><dt>{tx('Format')}</dt><dd>{t.format}</dd></>}
                {t.rubrika && <><dt>{tx('Rubrika')}</dt><dd>{t.rubrika}</dd></>}
                {t.telegram_type && <><dt>Telegram</dt><dd>{tx(telegramTypeLabel(t.telegram_type))}{t.is_guiding ? ` · ${tx('Guiding post (teaches)')}` : ''}</dd></>}
                {listed(t.reviewers, t.reviewer_id).length > 0 && <><dt>{tx('Checks it')}</dt><dd>{listed(t.reviewers, t.reviewer_id).map(crewName).join(', ')}</dd></>}
                {listed(t.faces, t.face_id).length > 0 && <><dt>{tx('Brand faces')}</dt><dd>{listed(t.faces, t.face_id).map(crewName).join(', ')}</dd></>}
                {(t.done_at || t.views != null) && <><dt>{tx('Views')}</dt><dd>{t.views == null ? tx('Not counted yet') : Number(t.views).toLocaleString()}</dd></>}
                {(t.done_at || t.skip_rate != null) && <><dt>{tx('Skip rate')}</dt><dd>{t.skip_rate == null ? tx('Not measured yet') : `${t.skip_rate}%`}</dd></>}
                {listed(t.checklist).length > 0 && <><dt>{tx('Checklist')}</dt><dd>{listed(t.checklist).map((c) => `${c.done ? '✓' : '○'} ${c.text}`).join(' · ')}</dd></>}
              </dl>
            </section>
            {/* Round 9: one fold for what is rarely needed — where else it goes out,
                the name to give a file, the full sheet. */}
            <details className="sd-fold co-more">
              <summary>{tx('More details')}</summary>
              {/* "Also TikTok", "Also Shorts" on a video being made; where its
                  reposts are once it is out; and, on a repost, where it came from
                  and the video to post. All of it read off the server. */}
              {loaded && <Reposts taskId={t.id} info={t.reposts} onInfo={(r) => setT((old) => ({ ...old, reposts: r }))} />}
              {/* A short written post (X, Threads, LinkedIn) is typed and goes out.
                  One switch says it carries a video or a picture; the server then
                  asks it what a feed post owes, and the plan grows the
                  editor's or the designer's stop. Whoever runs the piece sets it. */}
              {(t.channels || []).some((k) => byKey[k]?.format === 'short') && runs && !t.done_at && (
                <section className="co-blk">
                  <h3>{tx('A video or a picture?')}</h3>
                  <label className="co-switch">
                    <input type="checkbox" checked={!!t.with_media} disabled={busy}
                      onChange={async (e) => {
                        const on = e.target.checked
                        setBusy(true)
                        try { apply(await api.patch(`/content/${t.id}`, { with_media: on })) } catch (er) { toast(er.message, 'err') } finally { setBusy(false) }
                      }} />
                    {tx('This post has a video or a picture')}
                  </label>
                  <p className="co-help">{t.with_media
                    ? tx('An editor or a designer makes it first, as on Instagram.')
                    : tx('You write it and post it. Nobody films or designs.')}</p>
                </section>
              )}
              {loaded && <CopyName drop={t.drop} />}
              {loaded && (
                <TaskMore t={t} user={user} team={team} label={at >= 0 ? pipe.live[at].label : ''} onChanged={heard}
                  canEdit={reach && can(user, 'manage_content')}
                  canRaise={at >= 0 && ([t.operator_id, t.editor_id, t.designer_id].includes(user.id) || owners.includes(user.id) || (reach && (can(user, 'manage_content') || can(user, 'move_tasks'))))} />
              )}
            </details>
          </aside>
        </div>
        )}
      </aside>
    </div>
  )
}

// ---- moving your own day (r11) --------------------------------------------------------
// The research report: two people had to ask the owner to change a date. A
// day that is yours now moves on your word — the server files the ask and
// answers it at once, with every check an admin's yes has (the day full, the
// operator already filming then), and tells everyone else on the piece. One
// line says why, because a moved day with no reason is the record nobody
// trusts. Somebody else's day is still an ask, and the server says so.
function MoveDay({ task, field, today, onMoved }) {
  const [form, setForm] = useState(null)   // { to, reason }
  const [busy, setBusy] = useState(false)
  if (!form) {
    return <button type="button" className="co-link co-move-day" onClick={() => setForm({ to: '', reason: '' })}><CalendarClock size={14} aria-hidden="true" />{tx('Move my day')}</button>
  }
  const live = field === 'edit_ready_date' ? editDue(task) : task[field]
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(form.to) && form.to !== live && isSentence(form.reason)
  const send = async () => {
    if (!ok || busy) return
    setBusy(true)
    try {
      const out = await api.post(`/content/${task.id}/date-requests`, { field, to_date: form.to, reason: form.reason.trim() })
      if (out?.task) { toast(tx('Day moved to {day} — the others on it are told', { day: dayShort(form.to) })); onMoved(out.task) }
      else toast(tx('Asked — an admin will answer, and you will hear it'))
      setForm(null)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <div className="co-late-form co-move-form">
      <label className="co-lbl">{tx('New day')}
        <DayPick value={form.to} min={today} label={tx('New day')} onChange={(d) => setForm({ ...form, to: d })} />
      </label>
      <input className="input" value={form.reason} placeholder={tx('Why, in one line — e.g. “the footage came in late”')}
        aria-label={tx('Why the day moves')} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      <span className="co-help">{tx('It moves at once. Everyone else on the piece is told. No admin needed.')}</span>
      <div className="co-btns">
        <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={!ok || busy} onClick={send}>{tx('Move it')}</button>
        <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setForm(null)}>{tx('Cancel')}</button>
      </div>
    </div>
  )
}

// ---- a late job's two answers ---------------------------------------------------------
// Ask for a new day, or say what is in the way — the same two answers the
// crew's page has always folded under a late row (components/CrewDay.jsx,
// which keeps its own copy for the previous look and goes when that look
// does), sent to the same two routes. Offered only where the SERVER has the
// job as late, so what is asked is filed against the deadline that actually
// slipped; an admin answers a new day, and asking moves nothing by itself.
function LateHelp({ taskId, phase, today, onMoved }) {
  const [info, setInfo] = useState(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)   // { kind: 'day' | 'why', to, reason }
  const [busy, setBusy] = useState(false)
  const loadLate = useCallback(() => api.get('/content/late/mine')
    .then((rows) => setInfo((Array.isArray(rows) ? rows : []).find((r) => r.content_id === taskId && r.phase === phase) || null))
    .catch(() => {}), [taskId, phase])
  useEffect(() => { loadLate() }, [loadLate])
  if (!info) return null
  if (info.asked || info.flagged) {
    return (
      <span className="co-help">
        {info.asked ? <><CalendarClock size={13} aria-hidden="true" /> {tx('New day asked for — waiting on an admin')}</>
          : <><Hand size={13} aria-hidden="true" /> {tx('The planners know this one is late')}</>}
      </span>
    )
  }
  const send = async () => {
    if (busy || !form || !isSentence(form.reason)) return
    setBusy(true)
    try {
      if (form.kind === 'day') {
        // Your own late job's day now moves at once (r11); anything else is still an ask.
        const out = await api.post(`/content/${taskId}/date-requests`, { field: info.field, to_date: form.to, reason: form.reason.trim() })
        toast(out?.task ? tx('Day moved — the others on it are told') : tx('Asked — an admin will answer, and you will hear it'))
        if (out?.task) onMoved?.(out.task)
      } else {
        await api.post(`/content/${taskId}/flags`, { kind: 'at_risk', reason: form.reason.trim() })
        toast(tx('Sent — they know what is in the way'))
      }
      setForm(null); setOpen(false)
      loadLate()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  if (!open) return <div><button type="button" className="co-link" onClick={() => setOpen(true)}>{tx('Can’t make it?')}</button></div>
  if (!form) {
    return (
      <div className="co-btns">
        <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setForm({ kind: 'day', to: '', reason: '' })}><CalendarClock size={16} aria-hidden="true" />{tx('Move to a new day')}</button>
        <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setForm({ kind: 'why', to: '', reason: '' })}><Hand size={16} aria-hidden="true" />{tx('Say what is in the way')}</button>
        <button type="button" className="co-link" onClick={() => setOpen(false)}>{tx('Never mind')}</button>
      </div>
    )
  }
  return (
    <div className="co-late-form">
      {form.kind === 'day' && (
        <label className="co-lbl">{tx('New day')}
          <DayPick value={form.to} min={today} label={tx('New day')} onChange={(d) => setForm({ ...form, to: d })} />
        </label>
      )}
      <textarea className="input" rows={2} autoFocus value={form.reason}
        placeholder={form.kind === 'day' ? tx('What happened — e.g. “the footage came in late”') : tx('What is in the way — e.g. “waiting for the music”')}
        onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      <span className="co-help">{form.kind === 'day' ? (form.to ? tx('It moves at once. Everyone else on the piece is told. No admin needed.') : tx('Pick the new day.')) : tx('The planners hear it straight away.')}</span>
      <div className="co-btns">
        {/* A new day is a day: sent empty, it cleared the deadline (the bug hunt, 14 Oct 2026). */}
        <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy || !isSentence(form.reason) || (form.kind === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(form.to))} onClick={send}>{form.kind === 'day' ? tx('Move it') : tx('Send')}</button>
        <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => { setForm(null); setOpen(false) }}>{tx('Cancel')}</button>
      </div>
    </div>
  )
}

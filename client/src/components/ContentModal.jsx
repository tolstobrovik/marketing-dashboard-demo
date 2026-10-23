import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, Plus, Check, AlertCircle, ImagePlus, X, Clapperboard, Send, Scissors, AlignLeft, CheckSquare, UserRound, Palette, Link2, ExternalLink, BookOpen, ClipboardList, FileText, Layers, Hash, CopyPlus, Paperclip, Download, FileType2, CalendarClock, Eye, MoreHorizontal, SkipForward } from 'lucide-react'
import Modal from './Modal.jsx'
import TaskBuilder from './builder/TaskBuilder.jsx'
import CoachTask from './CoachTask.jsx'
import DayTimeline from './DayTimeline.jsx'
import ClashDialog, { isClash } from './ClashDialog.jsx'
import PersonPicker from './PersonPicker.jsx'
import Avatar from './Avatar.jsx'
import { can, todayISO, addDaysISO, CONTENT_TYPES, typeInfo, isWritingChannel, dateLabel, longDayLabel, snapHalfHour } from '../lib/constants.js'
import { hasSubstance, isSentence, deliveryHref } from '../lib/text.js'
import { useT, tr as tx } from '../lib/i18n.jsx'
import { useChannels } from '../lib/channels.jsx'
import { scaleWithin, scaleExact } from '../lib/picture.js'
import { useAuth, reachOf } from '../lib/auth.jsx'
import { useIsPhone } from '../lib/usePhone.js'
import Booking from './Booking.jsx'
import Timetable from './Timetable.jsx'
import { api, cache } from '../lib/api.js'
import { getPicks, bumpPick } from '../lib/picks.js'
import { gapsOf, stageRankOf, datesFrozenAt } from '../lib/gaps.js'
import { askedOf } from '../lib/channelFormat.js'
import { useNextStep } from '../lib/useNextStep.js'
import CharCount from './CharCount.jsx'
import { toast } from '../lib/toast.js'
import { useDirtyState, cascadeDates, LABELS } from '../lib/formState.js'
import { saveDraft, readDraft, clearDraft, draftBeatsRow } from '../lib/draft.js'
import { rewardFinish } from '../lib/reward.js'
import TextHelp from './TextHelp.jsx'
import BriefCheck from './BriefCheck.jsx'
import Zoom from './Zoom.jsx'
import RefMedia from './RefMedia.jsx'
import TelegramFields from './TelegramFields.jsx'

// Documents a task can carry. The cap is deliberate and low: every byte is
// stored, synced and paid for on the team's storage, so a 4 MB brief is a
// brief, not a raw export.

const DOC_MAX = 4 * 1024 * 1024
const DOC_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.csv'
const docSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const docKind = (name) => {
  const e = String(name || '').split('.').pop().toLowerCase()
  if (e === 'pdf') return 'pdf'
  if (e === 'doc' || e === 'docx' || e === 'rtf') return 'doc'
  if (e === 'xls' || e === 'xlsx' || e === 'csv') return 'xls'
  if (e === 'ppt' || e === 'pptx') return 'ppt'
  return 'txt'
}

// Which deadlines are promises. Once one of these holds a day, only an admin
// moves it — everyone else asks, in writing. Naming them here keeps the form's
// warning and the server's refusal talking about the same four fields.
// The names of the four promised days, as they read inside a sentence
// ("Ask an admin to move the shoot day"). Looked up through tx at the call
// site so they follow the language like everything else.
const PROMISED = {
  recording_date: 'the shoot day', edit_ready_date: 'the day the edit is due',
  design_ready_date: 'the day the artwork is due', release_date: 'the release day',
}
const promisedDay = (field) => tx(PROMISED[field] || field)

// Defined at module level — an inline component would remount its date/time
// inputs on every keystroke elsewhere in the modal and drop their focus.
function DateRow({ icon: Icon, label, dateKey, timeKey, endKey, form, setForm, disabled, locked, frozen, onAskMove, confirmSet, bad, revised, stored, own = false }) {
  // Which of the time boxes somebody has typed in. Only a typed time is put
  // on the half-hour grid when the box is left: tabbing past an older 10:15
  // must not quietly move a slot its operator has already said yes to.
  const typed = useRef({})
  const snapTyped = (key, up) => () => {
    if (!typed.current[key]) return
    typed.current[key] = false
    setForm((f) => ({ ...f, [key]: snapHalfHour(f[key], up) }))
  }
  // A day that is already promised is read-only here: the picker would let
  // somebody change it and only find out on save that they could not, having
  // already lost the day they were looking at.
  // Promised means SAVED: a day picked a second ago in this sheet is still
  // only typed, and locked itself before anybody could correct it.
  const promised = locked && !!stored
  // Once the work is being made — booked to shoot, or being cut — the days on
  // it stop being editable at all, empty ones included. Bolting a fresh
  // deadline onto a piece somebody is already filming is the same disruption
  // as moving one, so the picker says so here rather than letting it be typed
  // and refused on save. An empty day cannot be ASKED about either: the
  // request flow moves a promise, it does not make one.
  const shut = promised || (locked && frozen)
  const setDate = (v) => {
    // Promising a day is the moment worth pausing on — afterwards it takes an
    // admin to undo. So the form says so once, plainly, before it happens
    // rather than after.
    if (v && !form[dateKey] && PROMISED[dateKey] && confirmSet && !confirmSet(dateKey, v)) return
    // The three dates are a chain: shoot, then cut, then out. Pushing the
    // shoot past the cut leaves the cut due before the footage exists — a
    // promise nobody can keep, made without anybody noticing. The days after
    // it move with it, keeping the gaps the plan had, and the sheet says so.
    // Pulling a day EARLIER moves nothing: dragging somebody's deadline
    // towards them is not a correction.
    const { form: next, moved } = cascadeDates(form, dateKey, v)
    setForm(next)
    if (moved.length) {
      toast(tx('{what} moved with it — {days}', {
        what: moved.map((m) => tx(LABELS[m.key])).join(tx(' and ')),
        days: moved.map((m) => m.to).join(', '),
      }))
    }
  }
  return (
    <div className={'drow' + (shut ? ' drow-locked' : '') + (bad ? ' field-bad' : '')} data-field={dateKey}>
      <span className="drow-label"><Icon size={14} /> {tx(label)}</span>
      {/* Somebody who cannot change the day reads it — an empty, greyed
          browser date box said «дд.мм.гггг» to the crew, which is the
          browser's placeholder, not an answer. */}
      {disabled && !shut ? (
        <span className="drow-read">
          {form[dateKey] ? longDayLabel(form[dateKey]) : <span className="muted">{tx('Not set yet')}</span>}
          {timeKey && form[timeKey] ? ` · ${form[timeKey].slice(0, 5)}${endKey && form[endKey] ? `–${form[endKey].slice(0, 5)}` : ''}` : ''}
        </span>
      ) : (<>
      <input className="input" type="date" disabled={disabled || shut} value={form[dateKey]}
        data-tip={shut ? (promised ? tx('This day is promised — ask an admin to move it')
          : tx('This is being made — an admin sets the days now')) : undefined}
        onChange={(e) => setDate(e.target.value)} />
      {/* A shoot's hours (the row with an end) are on the half-hour grid the
          timeline books on: the wheel steps by 30 minutes, and a minute typed
          by hand is rounded when the box is left — start down, end up — rather
          than fought over while it is being typed. The release time is when a
          post goes out, not a booking, and keeps its minutes. */}
      {timeKey && <input className="input" type="time" disabled={disabled} value={form[timeKey]}
        data-tip={endKey ? 'From' : undefined} step={endKey ? 1800 : undefined}
        onChange={(e) => { typed.current[timeKey] = true; setForm({ ...form, [timeKey]: e.target.value }) }}
        onBlur={endKey ? snapTyped(timeKey, false) : undefined} />}
      {endKey && (
        <>
          <span className="drow-dash">–</span>
          <input className="input" type="time" disabled={disabled} value={form[endKey]} data-tip={tx('To')} step={1800}
            onChange={(e) => { typed.current[endKey] = true; setForm({ ...form, [endKey]: e.target.value }) }}
            onBlur={snapTyped(endKey, true)} />
        </>
      )}
      </>)}
      {!disabled && !shut && (
        <span className="drow-quick">
          <button type="button" className="qbtn" onClick={() => setDate(todayISO())}>{tx("Today")}</button>
          <button type="button" className="qbtn" onClick={() => setDate(addDaysISO(todayISO(), 1))}>{tx("Tomorrow")}</button>
          {form[dateKey] && (
            <button type="button" className="qbtn" data-tip={tx("Clear this date")} aria-label={tx("Clear date")}
              onClick={() => setForm({ ...form, [dateKey]: '', ...(timeKey ? { [timeKey]: '' } : {}), ...(endKey ? { [endKey]: '' } : {}) })}>✕</button>
          )}
        </span>
      )}
      {shut && !promised && (
        <span className="drow-ask">
          <span className="drow-promised">{tx('This is being made — an admin sets the days now.')}</span>
        </span>
      )}
      {promised && (
        // Its own line across the row: the grid's last column is a narrow
        // slot for quick buttons, and a sentence wrapped into it a word at a
        // time is how "Ask to move" became four lines tall.
        <span className="drow-ask">
          {onAskMove && (
            <button type="button" className="qbtn qbtn-ask" onClick={() => onAskMove(dateKey)}>{own ? tx('Move my day') : tx('Ask to move')}</button>
          )}
          <span className="drow-promised">
            {/* Your own day moves on your word (the server answers the ask at once). */}
            {own ? tx('Your own day: say why, and it moves at once.')
              : onAskMove ? tx('This day is promised — only an admin moves it, and only on a reason.') : tx('This day is promised — only an admin moves it.')}
          </span>
        </span>
      )}
      {/* The re-promise, said on the task itself. A handover that landed late
          wrote a new day beside this one, and that new day is the deadline
          from then on — the server judges it, the desks now draw it. The box
          above keeps the ORIGINAL on purpose (the pair is what shows what the
          delay cost), so without this line the one screen a person opens to
          check their deadline showed them the day that no longer counts. */}
      {revised && revised !== form[dateKey] && (
        <span className="drow-ask">
          <span className="drow-revised">
            {tx('Re-promised after a late handover — {day} is the day that counts', { day: dateLabel(revised) })}
          </span>
        </span>
      )}
    </div>
  )
}

// Task editor: a new task's whole form, and the Edit mode of the task window
// (components/CoachTask.jsx). One form and no tabs: the rows are grouped in
// the order the window reads — the days and the people, the reference, the
// files, the brief — with the rest under "More details" beside them.

function TaskSheet({ item, statuses, defaults = {}, onClose, onCreate, onUpdate, onDelete, startFull = false, askFor = null, onLeave = null, closeRef = null }) {
  const { user } = useAuth()
  const { visible, byKey, reload } = useChannels()
  const { t } = useT()
  const creating = !item
  const [err, setErr] = useState('')
  // Which field the refusal is ABOUT. A red banner at the top of a long form
  // tells you something is wrong; it does not tell you where, and the answer
  // is usually three screens down. Naming the field lets the form ring it and
  // scroll to it, so "«Script» needs a real answer" lands next to the script.
  // A one-tap "done" that was refused for the missing published link opens the
  // task on that box, ringed — the refusal and the answer in the same place.
  const [badField, setBadField] = useState(item?.needs_post_link ? 'post_link' : '')
  const refuse = (field, message) => { setBadField(field); setErr(message) }
  const phone = useIsPhone()
  const [tools, setTools] = useState(false)
  // Escape belongs to the innermost thing that is open. The sheet closes on
  // Escape, and losing a half-typed brief because you were dismissing a menu
  // is not a trade anybody would make on purpose.
  useEffect(() => {
    if (!tools) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setTools(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [tools])
  // What the booking cards read. The FORM holds what is being typed; a
  // booking is about what is actually saved, and answering one sends back the
  // fresh row rather than making the whole sheet reload.
  const [booked, setBooked] = useState(() => item || null)
  // The operator's week, folded away until asked for.
  // Open by default: the free times are the answer this row exists to give,
  // and a shoot that is already booked folds them away with one press.
  const [slotsOpen, setSlotsOpen] = useState(true)
  // How long the shoot is. Beside the week rather than inside it: the grid
  // draws somebody's diary, and the length of this shoot is a fact about this
  // shoot. It decides which gaps are big enough to offer.
  const [slotLen, setSlotLen] = useState(120)
  // "View schedule availability" under the crew: one person's day, folded
  // until asked for. It opens on the shoot's day, or today.
  const [schedOpen, setSchedOpen] = useState(false)
  const [schedDay, setSchedDay] = useState(() => (item?.recording_date && item.recording_date >= todayISO() ? item.recording_date : todayISO()))
  const [schedFor, setSchedFor] = useState('operator_id')
  const [busy, setBusy] = useState(false)


  const [subText, setSubText] = useState('')
  // Every platform on offer, or only the ones this task goes to.
  const [allPlatforms, setAllPlatforms] = useState(() => !item?.channels?.length)
  const [form, setForm] = useState(() => ({
    title: item?.title || defaults.title || '',
    channels: item?.channels?.length ? [...item.channels] : (defaults.channels || (visible[0] ? [visible[0].key] : [])),
    type: item?.type || defaults.type || 'post',
    // A new task takes what the page or the builder already said — the kanban
    // column it was added in, the shoot hour, the cut's and the artwork's days.
    status_id: item?.status_id || (item ? null : defaults.status_id) || statuses[0]?.id || null,
    recording_date: item?.recording_date || defaults.recording_date || '',
    recording_time: item?.recording_time || (item ? '' : defaults.recording_time || ''),
    recording_end: item?.recording_end || (item ? '' : defaults.recording_end || ''),
    edit_ready_date: item?.edit_ready_date || (item ? '' : defaults.edit_ready_date || ''),
    design_ready_date: item?.design_ready_date || (item ? '' : defaults.design_ready_date || ''),
    release_date: item?.release_date || defaults.release_date || '',
    release_time: item?.release_time || '',
    description: item?.description || defaults.description || '',
    // The reference album, and the single pair the rest of this file reads.
    // Everything below still asks `form.photo` whether there is a reference at
    // all — the shoot's brief-ready check, the section chips, the save's
    // "points somewhere" rule — so the pair is kept as element 0 of the album
    // by setPhotos() and nothing else has to change.
    reference_photos: item?.reference_photos?.length
      ? item.reference_photos
      : (item?.photo && !item?.photo_media_id ? [{ photo: item.photo, thumb: item.photo_thumb ?? null }] : (item ? [] : (defaults.reference_photos || []))),
    photo: item?.photo ?? (item ? null : defaults.reference_photos?.[0]?.photo ?? null),
    photo_thumb: item?.photo_thumb ?? (item ? null : defaults.reference_photos?.[0]?.thumb ?? null),
    checklist: item?.checklist ? [...item.checklist] : [],
    campaign_id: item ? (item.campaign_id ?? null) : (defaults.campaign_id ?? null),
    operator_id: item?.operator_id ?? (item ? null : defaults.operator_id ?? null),
    editor_id: item?.editor_id ?? (item ? null : defaults.editor_id ?? null),
    designer_id: item?.designer_id ?? (item ? null : defaults.designer_id ?? null),
    tz: item?.tz ?? (item ? '' : defaults.tz || ''),
    // '' means nobody has counted yet; '0' means it was counted and got none.
    views: item?.views === null || item?.views === undefined ? '' : String(item.views),
    reviewer_ids: (() => {
      try {
        const l = Array.isArray(item?.reviewers) ? item.reviewers : JSON.parse(item?.reviewers || '[]')
        return l.length ? l : (item?.reviewer_id ? [item.reviewer_id] : [])
      } catch { return item?.reviewer_id ? [item.reviewer_id] : [] }
    })(),
    ready_link: item?.ready_link || '',
    post_link: item?.post_link || '',
    face_ids: (() => {
      if (!item && Array.isArray(defaults.face_ids)) return [...defaults.face_ids]
      try {
        const l = Array.isArray(item?.faces) ? item.faces : JSON.parse(item?.faces || '[]')
        return l.length ? l : (item?.face_id ? [item.face_id] : [])
      } catch { return item?.face_id ? [item.face_id] : [] }
    })(),
    skip_rate: item?.skip_rate === null || item?.skip_rate === undefined ? '' : String(item.skip_rate),
    shot_link: item?.shot_link || '',
    design_link: item?.design_link || '',
    // What the person typed into the "which file?" box. Kept apart from the
    // stored link so switching a channel's folder on or off never silently
    // rewrites a delivery that already exists.
    ready_file: '', shot_file: '', design_file: '',
    reference_text: item?.reference_text || (item ? '' : defaults.reference_text || ''),
    reference_links: item?.reference_links?.length ? [...item.reference_links] : (item ? [] : [...(defaults.reference_links || [])]),
    format: item?.format || '',
    rubrika: item?.rubrika || '',
    script: item?.script || (item ? '' : defaults.script || ''),
    // What a Telegram piece is, for the copywriter's pay (TelegramFields).
    telegram_type: item?.telegram_type || defaults.telegram_type || '',
    is_guiding: !!(item ? item.is_guiding : defaults.is_guiding),
    // Admins choose who the task is for (any number of people); everyone
    // else creates for themselves.
    ...(user.role === 'admin' ? {
      assignee_ids: item
        ? (item.assignees?.length ? [...item.assignees] : item.assignee_id ? [item.assignee_id] : [])
        : (defaults.assignee_ids?.length ? [...defaults.assignee_ids] : defaults.assignee_id ? [defaults.assignee_id] : [user.id]),
    } : {}),
  }))

  // Three views mean a view you have left is still holding what you wrote in
  // it — which is the point, and also the way a sheet gets closed on top of
  // unsaved words the person cannot see. So closing a dirty sheet asks first.
  // Switching views never asks: they are one form.
  // ---- a task that is written, not filmed --------------------------------
  // Telegram work is typed. Nobody books a shooter for it, nobody hands over
  // footage, and there is no reference reel to look at — so the sheet stops
  // asking. A text admin gets the title, the words and an attachment, and the
  // three blocks that only make sense around a camera are not drawn at all.
  //
  // EVERY channel on the task has to be a written one. A piece cross-posted to
  // Instagram is still filmed, and hiding the shooter on it would hide a seat
  // somebody has to fill.
  // …and a short post (X, Threads, LinkedIn) that carries a video or a
  // picture (with_media, switched on in the task window) is made like a feed
  // post: the crew is back.
  const textOnly = form.channels.length > 0
    && form.channels.every((k) => isWritingChannel(byKey[k]))
    && !(item?.with_media && form.channels.some((k) => byKey[k]?.format === 'short'))

  const { dirty: edited, rebase, opened } = useDirtyState(form, true)
  // Answers carried in from the builder ("All fields") are not stored anywhere
  // yet — the builder dropped its own copy — so the form counts them as
  // unsaved: closing asks, and the rescue copy keeps them (the bug hunt, 14 Oct 2026).
  const dirty = edited || (creating && startFull)

  // ---- the copy that survives the tab dying ------------------------------
  // Every five seconds, if anything has been typed since the sheet opened,
  // what is on screen is written to this browser. Nothing is sent to the
  // server: a form saved on a timer would fire the board's own rules at
  // somebody mid-thought and write half-made rows other people can see. The
  // draft is private until they press Save.
  const draftKey = item?.id ?? 'new'
  // Once the work is stored — or deliberately thrown away — the copy must stay
  // gone. Without this the unmount flush below fires AFTER the save cleared
  // it and quietly resurrects the draft, so the next visit is offered words
  // that are already saved.
  const draftDone = useRef(false)
  useEffect(() => {
    if (!dirty || draftDone.current) return
    const id = setInterval(() => saveDraft(user?.id, draftKey, form), 5000)
    // …and once more on the way out, so the last few seconds are not the ones
    // that get lost. A tab that is closed or hidden gets the same treatment.
    const flush = () => saveDraft(user?.id, draftKey, form)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      if (!draftDone.current) flush()
    }
  }, [dirty, form, user?.id, draftKey])

  // On the way in: a copy newer than the row itself means the last visit ended
  // badly. Offer it rather than restoring silently — the person knows what
  // they meant to keep, and a sheet that changes under them is its own kind of
  // data loss.
  const [rescue, setRescue] = useState(null)
  useEffect(() => {
    const d = readDraft(user?.id, draftKey)
    if (draftBeatsRow(d, item)) setRescue(d)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Words only: a stage or a seat in an old copy is a move nobody is making
  // now — restored, it un-published a piece (the bug hunt, 14 Oct 2026).
  const takeDraft = () => {
    const { status_id, operator_id, editor_id, designer_id, ...words } = rescue.form || {} // eslint-disable-line no-unused-vars
    draftDone.current = false; setForm((f) => ({ ...f, ...words })); setRescue(null)
  }
  const dropDraft = () => { draftDone.current = true; clearDraft(user?.id, draftKey); setRescue(null) }
  const [leaving, setLeaving] = useState(false)
  const tryClose = () => { if (dirty && !busy) setLeaving(true); else onClose() }
  // The task window's own ways out (its ×, Esc, a click beside it) ask the same.
  useEffect(() => { if (closeRef) closeRef.current = tryClose })
  // Team list: the admin's assignee picker + the video crew pickers.
  // (cached — every modal open reuses one fetch for a while)
  // T-06: the sheet opens with the last roster this browser saw, so a name
  // is never drawn as "…" and the crew row does not jump when /users answers.
  const [team, setTeam] = useState(() => { const c = cache.get('users'); return Array.isArray(c) ? c : [] })
  useEffect(() => {
    api.cached('/users').then((list) => { if (Array.isArray(list)) { setTeam(list); cache.set('users', list) } }).catch(() => {})
  }, [])
  // The people you pick most rise to the top of every assign list.
  const picks = useMemo(() => getPicks(), [])
  // Campaigns for the one-dropdown chip that ties cards to campaign progress.
  const [campaigns, setCampaigns] = useState([])
  useEffect(() => {
    api.cached('/campaigns').then(setCampaigns).catch(() => {})
  }, [])
  // The task-form rules the admin tuned: which brief fields exist for this
  // type, which are required, and the Format / Rubrika option lists.
  const [fieldRules, setFieldRules] = useState(null)
  useEffect(() => {
    api.cached('/fields').then(setFieldRules).catch(() => {})
  }, [])

  // Lists carry only a thumbnail and no revision history — pull the full task
  // (original photo + Pravki history) in on demand when a task is opened.
  const [initialPhoto] = useState(item?.photo ?? null)
  // The album as it arrived, serialised — an untouched album is hundreds of
  // kilobytes and must not ride back up on every unrelated save, which is the
  // same reason initialPhoto exists beside it.
  const [initialPhotos] = useState(() => JSON.stringify(
    item?.reference_photos?.length
      ? item.reference_photos
      : (item?.photo && !item?.photo_media_id ? [{ photo: item.photo, thumb: item.photo_thumb ?? null }] : []),
  ))
  // The task's paperwork — a ТЗ in Word, a reference deck as PDF. Only names
  // and sizes travel with the task; the bytes are fetched when one is opened.
  const [docs, setDocs] = useState(() => item?.documents || [])
  const [docBusy, setDocBusy] = useState(false)
  const pickDoc = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // so the same file can be picked again after a failure
    if (!file || !item) return
    if (file.size > DOC_MAX) {
      setErr(`“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — documents are capped at 4 MB`)
      return
    }
    setDocBusy(true); setErr('')
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('That file could not be read'))
        r.readAsDataURL(file)
      })
      const doc = await api.post(`/content/${item.id}/files`, { name: file.name, data })
      setDocs((prev) => [...prev, doc])
      toast(tx('Document attached — synced'))
    } catch (e2) { setErr(e2.message) } finally { setDocBusy(false) }
  }
  // Asking to open one gets a short-lived link back; the browser then fetches
  // the bytes itself and saves them under the name the SERVER states. Doing it
  // in JS instead would lose a Russian name — the browser drops non-ASCII from
  // an <a download> attribute and the brief arrives as "download".
  const openDoc = async (doc) => {
    setErr('')
    try {
      const { url } = await api.get(`/content/files/${doc.id}`)
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e2) { setErr(e2.message) }
  }
  const removeDoc = async (doc) => {
    if (!confirm(`Remove “${doc.name}” from this task?`)) return
    try {
      await api.del(`/content/files/${doc.id}`)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (e2) { setErr(e2.message) }
  }
  // The brief is the point of the form, not an extra: Reference and
  // Description are open from the start, so the boxes the crew actually work
  // from are in front of whoever is filling the task in rather than folded
  // behind a row of buttons at the very bottom. Chrome that is only useful
  // once there is something in it (checklist, documents, the other people's
  // delivery links) still waits to be asked for.
  // A NEW task is an idea: a name and a couple of sentences about it. That is
  // all anybody has when they think of something, and asking for a shoot day,
  // three crew seats and a script at that moment is how a board stops being
  // written in. Everything else waits until the task is actually going to be
  // made — the shooting gate asks for it then, when the answers exist.
  //
  // The rest is one press away for anybody who already knows it. Nothing is
  // removed; it is only not demanded on the way in.
  const [fillNow, setFillNow] = useState(startFull)
  // Which stage counts as "still only an idea" — the admin's stage list, read
  // the way every other stage rule reads it, not a constant.
  const liveStages = useMemo(() => statuses.filter((st) => !/^deleted$/i.test(String(st.label || '').trim())), [statuses])
  const ideaStage = statuses.find((st) => /^idea$|^ideas$|g'oya|идея/i.test(String(st.label || ''))) || liveStages[0]
  // Where the task actually IS — a thought jotted down, or work being made.
  // The same reading the cards use for what they say is missing, and the same
  // one the server applies (`isIdeaStage` in routes/content.js): a form that
  // refuses what the server would accept is a wall with nothing behind it.
  const stageRank = useMemo(() => stageRankOf(statuses), [statuses])
  const atIdea = form.status_id === null || form.status_id === undefined
    || stageRank(form.status_id) === 'idea'
  const ideaOnly = creating && !fillNow && atIdea
  // Where the task IS SAVED, which is a different question from where the form
  // is currently showing. Leaving Idea needs no ticket — an idea is a thought
  // nobody has promised anything about, and a column you need a permission to
  // empty is a column that fills up. The server has said so for a while
  // (`wasAnIdea` in routes/content.js) and the board agrees (ContentBoard's
  // `openStages`); this menu was the one surface still refusing, so a content
  // maker could drag an idea onward but not move it from the task it opened.
  // Read off the SAVED stage: reading the form would re-lock the picker the
  // instant somebody chose the stage they were trying to move to.
  //
  // All of it only on a task that is this person's to touch at all — the
  // server's first question on every write (canTouch, routes/content.js): an
  // admin whose writ covers one of its channels, anybody on one of its
  // channels, whoever's name is on it, and its crew. The calendars and the
  // quick find open EVERY task for everybody, and the sheet offered a pen on
  // all of them that only bounced off "Not your channel" at Save.
  const reach = creating || reachOf(user, item)
  const heldAtIdea = !creating && reach && (item?.status_id === null || item?.status_id === undefined
    || stageRank(item?.status_id) === 'idea')

  const [show, setShow] = useState(() => ({
    description: true,
    photo: !!item?.photo || !!item?.has_photo,
    checklist: (item?.checklist?.length || 0) > 0,
    reference: true,
    delivery: false,
    script: false,
    // ТЗ has always been on the form when you can edit it; the admin's switch
    // decides whether it exists, not whether it hides behind a button.
    tz: true,
    docs: (item?.documents?.length || 0) > 0,
  }))

  const canEdit = reach && can(user, 'manage_content')
  const canMove = reach && can(user, 'move_tasks')
  // Anybody the task was handed to, not only the first name on it: the server
  // reads the whole list (assigneesOf) when it lets an owner tick the
  // checklist, and a co-owner's ticks were locked here.
  const isMine = !!item && (item.assignees?.length ? item.assignees : [item.assignee_id]).includes(user.id)
  // The task's crew: filming, editing and designing are stage changes, so the
  // operator, editor or designer may always move their own task through the
  // pipeline.
  const isCrew = !creating && !!item &&
    (item.operator_id === user.id || item.editor_id === user.id || item.designer_id === user.id)
  // Detail fields (title, type, platforms, dates, description, photo) need
  // manage_content; the stage needs move_tasks; the assignee may always tick
  // their own checklist. The UI locks exactly what the server would reject.
  const detailsLocked = !creating && !canEdit
  // What the person whose seat this is could actually change about the brief.
  const briefEditable = canEdit
  const checklistLocked = detailsLocked && !isMine
  // …and `heldAtIdea` for the same reason the picker unlocks below: somebody
  // who may move a thought along needs a Save button to do it with. Unlocking
  // the picker and then hiding the button left the change nowhere to go, which
  // is a worse answer than the greyed-out picker it replaced.
  const readOnly = detailsLocked && !isMine && !canMove && !isCrew && !heldAtIdea


  // The shared Drive folder, if this task's channels agree on one. Two
  // channels with two different folders have no single answer, so the box
  // goes back to asking for the whole address.
  const sharedFolder = (() => {
    const set = [...new Set(form.channels.map((k) => (byKey[k]?.drive_url || '').trim()).filter(Boolean))]
    return set.length === 1 ? set[0] : ''
  })()

  const plan = typeInfo(form.type).plan
  // WHERE this piece is going, and therefore what it can be asked for at all.
  // Every rule below used to read the TYPE alone, which is why a Telegram
  // announcement was asked for artwork, a designer and a reference image: the
  // board knew what the piece was and never where it was going. The channel's
  // format is the other half of the question, and the two are asked together.
  const asked = useMemo(
    () => askedOf(fieldRules?.channel_formats, form.channels, byKey, !!item?.with_media),
    [fieldRules, form.channels, byKey, item?.with_media])
  // Going to a written (Telegram) channel — alone or cross-posted — the piece
  // says what it is for the copywriter's pay; anywhere else the question is
  // not drawn and the server keeps nothing.
  const tgOn = asked.formats.includes('text')
  // Design work — the kinds the admin's crew rule says are designed, where the
  // surface it is going to has designers at all. It gets the designer's seat.
  const designWork = !!fieldRules?.crew?.designer?.includes(form.type) && asked.crew('designer')
  // Does a brief field apply to this task's type, on these channels — and is
  // it demanded?
  // `must` is the board's own demand, whatever the admin's setting says: a
  // post carries a ТЗ (getTaskFields in server/db.js).
  const must = (r) => (r.must || []).includes(form.type)
  const fOn = (k) => {
    const r = fieldRules?.[k]
    return !!r && (must(r) || (r.state !== 'off' && r.types.includes(form.type))) && asked.field(k)
  }
  const fReq = (k) => {
    const r = fieldRules?.[k]
    return !!r && (must(r) || (r.state === 'required' && r.types.includes(form.type))) && asked.field(k)
  }
  // Does this type of task need somebody holding the camera? The admin's crew
  // rule (Admin → Pipeline) decides, and /fields serves it beside the brief
  // rules — so a text post is never asked, and a type added there starts being
  // asked with nothing further to wire up.
  const isFilmedType = !!fieldRules?.crew?.operator?.includes(form.type) && asked.crew('operator')
  // WHERE the task sits decides what it owes. Before the shooting stage it is
  // an idea — a title and a maybe — and owes nobody a crew, a date or a brief.
  // From the shooting stage on it is a BOOKED shoot and owes all three; one
  // stage further, with footage in hand, it owes an editor as well.
  // What this piece still owes at the stage it is on — the same reading the
  // server's walls use to refuse a move, shown BEFORE the move is attempted so
  // nobody drags a card into a wall to find out what it wanted.
  const gaps = useMemo(() => {
    const probe = {
      ...form,
      // Only an admin picks who a task is for; everybody else is creating it
      // for themselves, so a brand-new task must not open by telling its
      // author it needs an owner.
      assignees: form.assignee_ids
        ?? (item?.assignees?.length ? item.assignees : item?.assignee_id ? [item.assignee_id] : creating ? [user.id] : []),
      ready_at: item?.ready_at || null,
    }
    const g = gapsOf(probe, fieldRules?.crew, stageRank, asked)
    return [...g.people, ...g.dates]
  }, [form, item, fieldRules, stageRank, creating, user.id, asked])

  const shootAt = liveStages.findIndex((s) => /to\s*shoot|shooting|s[yj]omka/i.test(s.label || ''))
  const stageAt = liveStages.findIndex((s) => s.id === form.status_id)
  // Each demand stands at the stage it is about and lands on a save that puts
  // the card THERE. A card parked further along is not making either promise —
  // it is a record of work that happened elsewhere, and a shoot day in its
  // future would be a day that has been and gone.
  const needsOperator = isFilmedType && shootAt >= 0 && stageAt === shootAt
  const needsEditor = isFilmedType && shootAt >= 0 && stageAt === shootAt + 1
  // The seats this person holds on it: their own delivery box is theirs to fill.
  const myHats = {
    operator: !creating && item?.operator_id === user.id,
    editor: !creating && item?.editor_id === user.id,
    designer: !creating && item?.designer_id === user.id,
  }
  // ---- Reference block helpers (example links live as an array) ----
  const setRefLink = (i, v) => setForm((f) => ({ ...f, reference_links: f.reference_links.map((x, j) => (j === i ? v : x)) }))
  const addRefLink = () => setForm((f) => ({ ...f, reference_links: [...f.reference_links, ''] }))
  const removeRefLink = (i) => setForm((f) => ({ ...f, reference_links: f.reference_links.filter((_, j) => j !== i) }))
  const shortUrl = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 42)

  // ---- Per-stage delivery links ----
  // Operator's raw footage (shot_link), the editor's finished cut (ready_link,
  // the "Edit ready" link), the designer's artwork (design_link, shown only
  // when a designer is on the task). Each crew member edits their own; the
  // rest stay read-only so an editor can grab the shot footage, etc.
  // Crew always see their stage's field; everyone else sees only links that
  // exist — three empty Drive inputs on every open were pure chrome. The
  // extras row reveals the empty ones when an editor wants to paste by hand.
  // A link that EXISTS is always shown, whatever the task's type — a post
  // that was filmed still has footage, and hiding it left admins hunting for
  // a link they could see was there. The type only decides which EMPTY
  // fields are worth offering.
  const DELIVERY = [
    // Recording is the operator's raw footage. Written work has none, so the
    // row is not offered — the same reason the Recording calendar left the
    // Telegram channel pages.
    ...(textOnly ? [] : [{ col: 'shot_link', file: 'shot_file', label: 'Recording', sub: 'the operator’s raw material — the editor’s source', icon: Clapperboard, kind: 'shot', mine: myHats.operator, present: !!item?.operator_id, offer: true }]),
    { col: 'ready_link', file: 'ready_file', label: 'Edit ready', sub: 'the editor’s finished edit', icon: Scissors, kind: 'edit', mine: myHats.editor, present: !!item?.editor_id, offer: true },
    { col: 'design_link', file: 'design_file', label: 'Design ready', sub: 'the designer’s finished artwork', icon: Palette, kind: 'design', mine: myHats.designer, present: !!item?.designer_id, offer: true },
  ]
  // Three EMPTY boxes on a task nobody is making yet is clutter, which is why
  // this waited behind a button. But a seat that is FILLED is a person who has
  // been asked to deliver something, and their box is then the most useful
  // thing on the sheet — folded away, it had planners opening the task,
  // finding nothing, and going to ask in Telegram whether the cut was done.
  // So a box appears the moment somebody is expected to fill it. The crew
  // branch has always read it this way (`f.present`); the planner's branch
  // now reads it the same. An unfilled seat's box still waits to be asked
  // for, because there is nobody to put anything in it.
  const deliveryFields = DELIVERY.filter((f) => (form[f.col] ? true : (f.offer && canEdit && (f.present || show.delivery))))

  // The files themselves, one press away for anyone who can open the task.
  // A delivery made through a channel's shared folder is stored as the folder,
  // a separator and the file the person named — "…/folders/ABC · 1-3". It is
  // one fact and reads as one, but pasted whole into an href it 404s, so the
  // address is taken from it rather than assumed to BE it.
  // How full everybody's day already is, for the three pickers. The cap
  // refuses an over-assignment at save time, which is correct and, on its
  // own, rude: a content head picks a name out of nine and is then told that
  // person's Tuesday was full. They could not have known — it was a list of
  // names. So the same arithmetic is fetched up front and shown ON the names.
  const [dayLoad, setDayLoad] = useState({})
  const loadDays = `${form.recording_date || ''}|${form.edit_ready_date || ''}|${form.design_ready_date || ''}`
  useEffect(() => {
    const want = [
      ['operator_id', form.recording_date],
      ['editor_id', form.edit_ready_date],
      ['designer_id', form.design_ready_date],
    ].filter(([, d]) => d)
    if (!want.length) { setDayLoad({}); return }
    let alive = true
    Promise.all(want.map(([hat, day]) =>
      api.get(`/content/load?hat=${hat}&day=${day}`).then((r) => [hat, r]).catch(() => [hat, {}])))
      .then((pairs) => { if (alive) setDayLoad(Object.fromEntries(pairs)) })
    return () => { alive = false }
  }, [loadDays]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasRef = !!(form.reference_text || form.reference_links.length > 0 || form.photo || form.photo_thumb)

  // ---- Review / Pravki (SMM & admin, when a task is waiting at Ready) ----
  const readyStatus = statuses.find((s) => /^ready$/i.test(s.label))
  const finalStatusObj = statuses.find((s) => s.is_final)
  const atReady = !!item && !!readyStatus && item.status_id === readyStatus.id
  // ---- what it got ----
  // Only worth asking once the piece is out: views on something unpublished is
  // a box that can only be answered wrongly. Whoever it is FOR may write the
  // number, and so may an admin — the maker is the one who opens the app and
  // reads the count off it.
  const isOut = !!item?.done_at || (!!finalStatusObj && item?.status_id === finalStatusObj.id)
  // Asked for from Ready onwards, so the link is already there when somebody
  // goes to move the card to the last stage rather than being a wall they
  // meet with nothing to paste.
  // …and a refused one-tap finish opens it wherever the piece stands, since
  // that is exactly the moment somebody was told to paste one.
  // …and whenever it is actually being asked for: the stage dropdown already
  // set to the last stage (so the box is there BEFORE the save that would
  // refuse), or a refusal that named this field — which used to highlight a
  // box that was never drawn, leaving the sentence and nowhere to answer it.
  const nearlyOut = isOut || atReady || !!item?.needs_post_link
    || (!!finalStatusObj && form.status_id === finalStatusObj.id) || badField === 'post_link'
  // Which pay tier this piece's skip rate puts it in, said where the number is
  // typed. A rate nobody can act on is a number nobody bothers to enter.
  const tiers = fieldRules?.skip_tiers || []
  const tierHere = form.skip_rate === '' ? null
    : tiers.find((t) => Number(form.skip_rate) >= t.min && Number(form.skip_rate) <= t.max) || null
  const tierNote = tiers.length === 0
    ? tx('Counts towards the maker’s month.')
    : tierHere
      ? tx('Tier {name} — {film} for filming, {edit} for the edit.', {
        name: tierHere.name,
        film: Math.round(tierHere.per_film).toLocaleString('en-US').replace(/,/g, ' '),
        edit: Math.round(tierHere.per_edit).toLocaleString('en-US').replace(/,/g, ' '),
      })
      : tx('Outside every tier the admin has set.')
  const madeIt = !!item && [item.assignee_id, ...(item.assignees || [])].filter(Boolean).includes(user.id)
  const canCount = !!item && (user.role === 'admin' || madeIt)
  const showViews = !!item && (isOut || item.views !== null && item.views !== undefined)
  // ---- promised days: asking, and answering ----
  // `askFor` opens the sheet with the ask already started: the Master
  // Calendar passes it when a drag onto a promised day was refused, so the
  // toast's "Ask to move" lands here with the day that was dragged to in it,
  // waiting only for the reason. Nobody else passes it, and without it the
  // sheet opens exactly as it always did.
  const [asking, setAsking] = useState(() => (askFor && item
    ? { field: askFor.field, to: askFor.to || '', reason: '' } : null))  // null | { field, to, reason }
  // …and it opens on the page the ask sits on. The sheet opens on the brief,
  // and an ask started on Logistics behind it is an ask nobody sees — so it
  // turns there (unfolded for this sheet only, if the person keeps the quiet
  // one, the way a refusal borrows the page it points at) and puts the cursor
  // in the reason. Once, as it opens: turning pages after that is theirs.
  useEffect(() => {
    if (!askFor || !item) return
    requestAnimationFrame(() => {
      const box = document.querySelector('.ask-move')
      box?.scrollIntoView({ block: 'center' })
      box?.querySelector('textarea')?.focus({ preventScroll: true })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isAdmin = user.role === 'admin'
  // Promised days are the admin's to move. For everyone else the picker is
  // read-only and the ask is the way through.
  //
  // …except while the task is still an IDEA. A day on a thought nobody has
  // promised anything about is not a promise: no operator's morning is held
  // by it and no editor has been told when the cut is due. The server says so
  // (`wasAnIdea`, routes/content.js), and a form that refuses what the server
  // would accept is a wall with nothing behind it — which is exactly what a
  // content maker hit when they tried to move an idea and were told to go and
  // ask an admin. Judged on the stage the task IS in, the way the freeze
  // below is, because that is the question the server asks when it saves.
  const onlyAnIdea = !!item && stageRank(item.status_id) === 'idea'
  const datesLocked = !isAdmin && !onlyAnIdea
  // …and while it is being made, the days do not move at all: an empty one
  // cannot be filled in either. Judged on the stage the task IS in, not the
  // one the form is about to put it in, because that is the question the
  // server asks when it saves.
  const datesFrozen = datesLocked && !!item && datesFrozenAt(item.status_id, statuses)
  // The shoot's day is fixed for this person: its week and the day's strip
  // only show it, never re-book it (the bug hunt, 14 Oct 2026).
  const shootLocked = datesLocked && !creating && (datesFrozen || !!item?.recording_date)
  // Only the people who could actually make the ask are offered it. A crew
  // account has neither right, and a button that answers 403 is worse than no
  // button — it reads as the app being broken rather than as "not your call".
  const canAsk = reach && !isAdmin && (can(user, 'manage_content') || can(user, 'move_tasks'))
  const confirmSet = (field, day) => window.confirm(
    `${tx('Promise {day} for {date}?', { day: promisedDay(field), date: longDayLabel(day) })}\n\n`
    + tx('Everything on the board measures itself against this day, so once it is set only an admin can move it — and only when somebody says why.')
    + `\n\n${tx('Set it?')}`)
  const askToMove = (field) => {
    setErr('')
    setAsking({ field, to: form[field] || '', reason: '' })
  }
  const sendAsk = async () => {
    if (!asking || busy) return
    setBusy(true); setErr('')
    try {
      const made = await api.post(`/content/${item.id}/date-requests`, {
        field: asking.field, to_date: asking.to || null, reason: asking.reason.trim(),
      })
      setAsking(null)
      // Your own day moved at once, and the answer carries the task (the bug
      // hunt, 14 Oct 2026: it said "Asked", kept the old day, and the next Save
      // was refused for sending that old day back).
      if (made?.task) {
        const v = made.task[asking.field] || ''
        setForm((f) => ({ ...f, [asking.field]: v }))
        rebase({ [asking.field]: v })
        toast(tx('Day moved to {day} — the others on it are told', { day: v ? longDayLabel(v) : '—' }))
      } else toast(tx('Asked — the admins have it'))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // Take the person to the field the refusal is about. The show-flags are set
  // in the same breath, so the section is open by the time this runs.
  useEffect(() => {
    if (!badField) return
    const el = document.querySelector(`[data-field="${badField}"]`)
    if (!el) { errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return }
    const go = () => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const focusable = el.querySelector('input, textarea, select')
      if (focusable) focusable.focus({ preventScroll: true })
    }
    go()
  }, [badField])

  // Admin's shortcut: a brand-new department without leaving the task.
  // The icon picks itself from the name (Instagram/Telegram/YouTube/Target…).
  const [newDept, setNewDept] = useState(null) // null | '' | typing…
  const guessIcon = (label) => {
    const l = label.toLowerCase()
    if (l.includes('insta')) return 'instagram'
    if (l.includes('telegram') || l.includes('tg')) return 'telegram'
    if (l.includes('youtube') || l.includes('yt')) return 'youtube'
    if (l.includes('tiktok') || l.includes('music')) return 'music'
    if (l.includes('video')) return 'video'
    if (l.includes('photo') || l.includes('камера')) return 'camera'
    if (l.includes('site') || l.includes('web')) return 'globe'
    if (l.includes('target') || l.includes('ads')) return 'target'
    return 'megaphone'
  }
  const createDept = async () => {
    const label = String(newDept || '').trim()
    if (!label) { setNewDept(null); return }
    try {
      const c = await api.post('/channels', { label, icon: guessIcon(label) })
      reload()
      setForm((f) => ({ ...f, channels: [...f.channels, c.key] }))
      setNewDept(null)
    } catch (e) { setErr(e.message) }
  }

  const toggleChannel = (key) =>
    setForm((f) => {
      const on = f.channels.includes(key)
      if (on && f.channels.length === 1) return f // always at least one platform
      return { ...f, channels: on ? f.channels.filter((c) => c !== key) : [...f.channels, key] }
    })

  // Photos are downscaled in the browser before upload: the original becomes a
  // ≤1600px JPEG, shrunk further if it is still heavy, and a ≤320px thumbnail
  // is generated for lists and cards.
  //
  // scaleWithin, not a bare scale: this sheet carries up to EIGHT reference
  // photos and sends them all inside one save, so a picture that merely got
  // smaller is not enough — it has to fit. The identical scaler that used to
  // live here is gone; picture.js is the one pipeline, so a photo pasted into
  // the sheet and a photo added in the task builder cannot come out different
  // sizes.
  const scaleImage = (img, maxW, quality) =>
    (maxW <= 320 ? scaleExact(img, maxW, quality) : scaleWithin(img, maxW, quality))
  // The server's ceiling, said here too: it drops the ninth silently, and
  // watching a photo vanish on save teaches nothing.
  const MAX_PHOTOS = 8
  // The album and the derived pair are always written together — see the form
  // state above for why the pair still exists at all.
  const setPhotos = (pics) => setForm((f) => ({
    ...f,
    reference_photos: pics,
    photo: pics[0]?.photo ?? null,
    photo_thumb: pics[0]?.thumb ?? null,
  }))
  const takePhoto = (file, how = 'pasted') => {
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { setErr('Image is too large — keep it under 15 MB'); return }
    if ((form.reference_photos || []).length >= MAX_PHOTOS) {
      setErr(`That is as many reference photos as one task carries — ${MAX_PHOTOS}`); return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const pic = { photo: scaleImage(img, 1600, 0.85), thumb: scaleImage(img, 320, 0.75) }
        // Appends. A brief is built up one screenshot at a time — the layout,
        // then the thing it must not look like — and the old box threw the
        // previous answer away every time a second one arrived.
        setForm((f) => {
          const pics = [...(f.reference_photos || []), pic].slice(0, MAX_PHOTOS)
          return { ...f, reference_photos: pics, photo: pics[0].photo, photo_thumb: pics[0].thumb }
        })
        setErr('')
        toast(how === 'pasted' ? 'Screenshot pasted in' : 'Photo attached')
      } catch { setErr('Could not read that image') } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { setErr('Could not read that image'); URL.revokeObjectURL(url) }
    img.src = url
  }
  // The input is cleared before the file is read, or picking the SAME file
  // twice fires no change event and the second copy never arrives — which is
  // exactly what building an album out of one folder looks like.
  const pickPhoto = (e) => { const f = e.target.files?.[0]; e.target.value = ''; takePhoto(f, 'picked') }
  // A reference is almost always a screenshot that is already on the
  // clipboard — Ctrl+V drops it straight in, so nobody has to save it to disk
  // first just to pick it back out of a file dialog. Anywhere in the task
  // (or in a Pravki note) counts, as long as the cursor is not in a field
  // where a paste means text.
  const pasteImageFrom = (e) => {
    const items = [...(e.clipboardData?.items || [])]
    const shot = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (!shot) return false
    e.preventDefault()
    takePhoto(shot.getAsFile())
    return true
  }
  useEffect(() => {
    if (!canEdit || !creating) return undefined
    const onPaste = (e) => {
      const el = e.target
      // A paste into a text box is a paste of text — unless what is on the
      // clipboard is an image, which no text box can hold anyway.
      if (!e.clipboardData?.items) return
      const hasImage = [...e.clipboardData.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))
      if (!hasImage) return
      if (el?.tagName === 'INPUT' && el.type !== 'text') return
      pasteImageFrom(e)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [canEdit, creating]) // eslint-disable-line react-hooks/exhaustive-deps

  const addCheck = () => {
    if (!subText.trim()) return
    setForm((f) => ({ ...f, checklist: [...f.checklist, { text: subText.trim(), done: false }] }))
    setSubText('')
  }
  const toggleCheck = (i) =>
    setForm((f) => ({ ...f, checklist: f.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c)) }))
  const removeCheck = (i) =>
    setForm((f) => ({ ...f, checklist: f.checklist.filter((_, j) => j !== i) }))

  // A 409 from the server means the operator is double-booked or outside
  // their working hours — shown as a warning; only an admin can push through.
  const [conflict, setConflict] = useState(null)
  const save = async (force = false) => {
    if (busy || !form.title.trim()) return // guard against double-submit
    // The admin's required brief fields gate the save — with the section
    // opened so the cursor lands where the answer goes.
    // ---- the admin is not made to fill in a form ----
    // Every check below stops WORK going out half-briefed, which is right for
    // the people doing the work and wrong for the person who set the rules.
    // They are usually correcting the board at speed — a name on a card
    // somebody phoned in, a date, four pieces dragged out of the wrong stage
    // — and being asked for a reference photo each time is how a board stops
    // being kept up to date. The server agrees with this; see `unfettered` in
    // server/routes/content.js.
    if ((creating || canEdit) && !isAdmin) {
      // A Telegram piece says what it is — when it is made, and from the moment
      // it stops being an idea (the server asks it on that move too).
      if (tgOn && !form.telegram_type && (creating || !atIdea)) {
        refuse('telegram_type', tx('Pick the Telegram Item Type.'))
        return
      }
      // Booking a shoot is a promise about a day that passes whether or not a
      // camera, a crew and a brief turn up — so the whole booking is asked at
      // the stage where the booking happens, and nothing is asked of an idea.
      // Only on the way ONTO it: a typo fixed on a piece already booked was
      // refused for a shoot day the form itself had locked (the bug hunt, 14 Oct 2026).
      const savedAt = creating ? -1 : liveStages.findIndex((s) => s.id === item.status_id)
      if (needsOperator && savedAt < shootAt) {
        // Round 8: a shoot is booked with who films, the day, the hours and the
        // script — the edit day, the day to post and the reference are asked
        // on the way to editing, by the server, not here.
        const gap = [
          [!form.operator_id, 'Pick who is filming this — a shoot nobody is holding is nobody’s job', 'operator_id'],
          [!form.recording_date, 'Pick the shoot day — a shoot with no day is one nobody can turn up to', 'recording_date'],
          // AND THE HOUR. A day with no time on it is somebody told "you are
          // filming Thursday" and left to guess — and their week is drawn
          // right there under the date, so the answer is one press away.
          [!form.recording_time, 'Pick the hour as well — their week is right there, and a shoot day with no time is a day nobody can plan around', 'recording_date'],
          // The script, in the same order the server asks for it: a reference
          // link on its own used to satisfy this form and then be refused on
          // save, which is the board saying yes and meaning no.
          [fOn('script') && !isSentence(form.script), 'Write the script before booking the shoot — a crew turning up without one is a day spent working out what to film', 'script'],
        ].find(([bad]) => bad)
        // The week is unfolded with them: being told to pick an hour while
        // the grid that holds the answer is folded away is a dead end.
        if (gap) {
          setShow((s) => ({ ...s, reference: true, script: true }))
          setSlotsOpen(true)
          refuse(gap[2], gap[1])
          return
        }
      }
      if (needsEditor && !form.editor_id && savedAt < shootAt + 1) {
        refuse('editor_id', 'Name who edits this — footage with no editor waiting is footage nobody is editing')
        return
      }
      // An idea owes its name and, if the admin asks for one, its description.
      // The rest of the brief is asked when the piece leaves the idea stage —
      // demanding a script of a thought is how ideas stop being written down.
      const asked = atIdea ? ['description'] : ['format', 'rubrika', 'script', 'tz', 'description', 'reference']
      const missing = [
        ['format', 'Format', form.format],
        ['rubrika', 'Rubrika', form.rubrika],
        ['script', 'Script', form.script.trim()],
        ['tz', 'ТЗ', form.tz.trim()],
        ['description', 'Description', form.description.trim()],
        ['reference', 'Reference', form.reference_text || form.reference_links.length > 0 || form.photo],
      ].find(([k, , v]) => asked.includes(k) && fReq(k) && !v)
      if (missing) {
        setShow((s) => ({ ...s, script: true, tz: true, reference: true, description: true }))
        refuse(missing[0], `«${missing[1]}» is required for this type of task`)
        return
      }
      // Filled is not answered. A demanded field holding "." or "N/A" is
      // caught here so the message arrives beside the field, rather than as a
      // refusal after the save has apparently been accepted.
      const thin = [
        ['format', 'Format', form.format, hasSubstance],
        ['rubrika', 'Rubrika', form.rubrika, hasSubstance],
        ['script', 'Script', form.script.trim(), isSentence],
        ['tz', 'ТЗ', form.tz.trim(), isSentence],
        ['description', 'Description', form.description.trim(), hasSubstance],
      ].find(([k, , v, real]) => asked.includes(k) && fReq(k) && v && !real(v))
      if (thin) {
        setShow((s) => ({ ...s, script: true, description: true }))
        refuse(thin[0], `«${thin[1]}» needs a real answer — “${thin[2]}” is a placeholder, not a brief`)
        return
      }
      // A reference is a link or words that say how it should look (the owner,
      // 13 Oct); only a placeholder is refused, from the working stages on.
      const refCarried = form.reference_links.length > 0 || !!form.photo
      if (form.reference_text && !refCarried && !atIdea) {
        if (!hasSubstance(form.reference_text)) {
          setShow((s) => ({ ...s, reference: true }))
          refuse('reference', `«Reference» needs a real answer — “${form.reference_text.trim()}” is a placeholder, not a reference`)
          return
        }
        // (Words alone are a real reference — a link or text, the owner, 13 Oct.)
      }
    }
    setBusy(true)
    setErr('')
    setBadField('')
    setConflict(null)
    let payload
    if (creating || canEdit) {
      payload = {
        ...form,
        title: form.title.trim(),
        // A named file wins over the stored link: it is what was just typed.
        ...(form.ready_file ? { ready_file: form.ready_file.trim() } : {}),
        ...(form.shot_file ? { shot_file: form.shot_file.trim() } : {}),
        ...(form.design_file ? { design_file: form.design_file.trim() } : {}),
        format: form.format || null,
        rubrika: form.rubrika.trim() || null,
        telegram_type: form.telegram_type || null,
        is_guiding: !!form.is_guiding,
        script: form.script.trim() || null,
        tz: form.tz.trim() || null,
        // Empty means "nobody has counted yet"; the server keeps null and 0
        // apart on purpose, so the box does too.
        ...(showViews && canCount ? { views: form.views.trim() === '' ? null : Number(form.views) } : {}),
        ...(showViews && canCount ? { skip_rate: form.skip_rate.trim() === '' ? null : Number(form.skip_rate) } : {}),
        recording_date: form.recording_date || null,
        recording_time: form.recording_time || null,
        recording_end: form.recording_end || null,
        edit_ready_date: form.edit_ready_date || null,
        design_ready_date: form.design_ready_date || null,
        release_date: form.release_date || null,
        release_time: form.release_time || null,
        ...(force ? { force: true } : {}),
      }
      // The spread above carries EVERY box the sheet holds, including the ones
      // this account may not write — and a save that mentions a field you may
      // not set is refused whole, even when the value is exactly what is
      // already stored. That refusal landed on the reviewer pasting a
      // published link: they were told they may not record views they never
      // typed. What this account cannot write, it does not send.
      if (!(showViews && canCount)) { delete payload.views; delete payload.skip_rate }
      // Off a written channel the question was never asked; the server clears
      // whatever is stored when the channels change, so nothing is sent.
      if (!tgOn) { delete payload.telegram_type; delete payload.is_guiding }
      if (!canEdit) { delete payload.face_id; delete payload.face_ids }
      // An empty file box is not a named file, and sending it as one is how
      // the link beside it used to be erased (see buildDelivery in
      // routes/content.js). `...form` carries all six boxes whether or not
      // anybody typed in them, so the blank ones are dropped here.
      for (const k of ['ready_file', 'shot_file', 'design_file']) {
        if (!String(payload[k] ?? '').trim()) delete payload[k]
      }
      // Don't re-upload an unchanged photo — it can be hundreds of KB.
      // The album is the same argument several times over: eight untouched
      // pictures are megabytes, and every save that merely renamed the task
      // would carry them. Sent only when it actually differs — and when it is
      // sent, the single pair goes with it, because the server reads the album
      // as the truth and writes the pair from its first entry.
      if (!creating && JSON.stringify(form.reference_photos || []) === initialPhotos) {
        delete payload.reference_photos
        if (form.photo === initialPhoto) {
          delete payload.photo
          delete payload.photo_thumb
        }
      }
      // What this sheet did not change, it does not send. The form still holds
      // the stage and the three seats it OPENED with, and the sheet itself can
      // have moved them since — a hand-in ticked here, a booking handed back —
      // so repeating the old values on Save quietly undid both.
      // …nor anything else it did not change. The task can have moved since the
      // form opened — a hand-in, a reference added, a day moved — and every
      // value sent counts as an edit: the save wrote the old ones back and
      // erased that work (the bug hunt, 14 Oct 2026). Compared with what the
      // form opened with; the pictures have their own test above.
      if (!creating) {
        for (const k of ['status_id', 'operator_id', 'editor_id', 'designer_id']) {
          if ((form[k] ?? null) === (item[k] ?? null)) delete payload[k]
        }
        const base = opened()
        if (base) {
          for (const k of Object.keys(form)) {
            if (['reference_photos', 'photo', 'photo_thumb'].includes(k)) continue
            if (JSON.stringify(form[k] ?? null) === JSON.stringify(base[k] ?? null)) delete payload[k]
          }
        }
      }
    } else {
      // Limited rights: send only what this person may actually change,
      // so the server never rejects the whole save.
      payload = {}
      // Their own seat's delivery box, never another's link.
      for (const [hat, col, file] of [
        [myHats.operator, 'shot_link', 'shot_file'],
        [myHats.editor, 'ready_link', 'ready_file'],
        [myHats.designer, 'design_link', 'design_file'],
      ]) {
        if (!hat) continue
        if (form[file]) payload[file] = form[file].trim()
        else if ((form[col] || '') !== (item[col] || '')) payload[col] = form[col].trim()
      }
      // …but an IDEA may be moved on by anybody (`heldAtIdea`), the crew
      // included: their picker unlocks for it, and the stage they picked was
      // left out of the save, which sent nothing and said "saved".
      if ((canMove || heldAtIdea) && form.status_id !== item.status_id) {
        payload.status_id = form.status_id
      }
      if (isMine && JSON.stringify(form.checklist) !== JSON.stringify(opened()?.checklist ?? item.checklist ?? [])) payload.checklist = form.checklist
      // Where it went live is not a right anybody holds — the server takes it
      // from anyone on the task — so a limited save carries it whenever the
      // box changed. The editor who uploaded the piece is exactly the person
      // with the address, and exactly the person who lands in this branch.
      if ((form.post_link || '') !== (item?.post_link || '')) payload.post_link = String(form.post_link || '').trim()
    }
    try {
      if (creating) await onCreate(payload)
      else await onUpdate(item, payload)
      // Reaching the last stage is the moment a piece is FINISHED, however it
      // was reached — the stage chips, the done tick, or the Publish button.
      if (!creating && finalStatusObj && payload.status_id === finalStatusObj.id
          && item.status_id !== finalStatusObj.id) rewardFinish()
      // Learn from the confirmed save: these picks float up next time.
      bumpPick(payload.operator_id, payload.editor_id, payload.designer_id, ...(payload.assignee_ids || []))
      // Stored on the server now, so the local copy has nothing left to rescue.
      draftDone.current = true
      clearDraft(user?.id, draftKey)
      toast(creating ? tx('Task added — synced') : tx('Task saved — synced'))
      onClose()
    } catch (e) {
      if (e.status === 409 && e.data) setConflict(e.data)
      // A promised day was refused. Rather than leave the person staring at
      // "only an admin can move it", the ask opens right here with the day
      // they wanted already in it — the refusal and the way through are the
      // same gesture.
      else if (e.status === 403 && e.data?.ask_to_move) {
        const { field, to } = e.data.ask_to_move
        setAsking({ field, to: to || '', reason: '' })
        setErr(`${e.message} The ask is below — say what happened and it goes to them.`)
      }
      // A refusal that names the box it wants filled ("paste the published
      // link", "that link is already on «…»") lands on that box, the way it
      // already did from the one-tap Publish button.
      // …and so does any refusal that names its field (a person not on this
      // channel, a day already full): in the banner at the top it was out of
      // sight, and Save seemed to do nothing (the bug hunt, 14 Oct 2026).
      else {
        const f = e.data?.needs || e.data?.field || e.data?.crew_field
        const BOX = { reference_text: 'reference', recording_time: 'recording_date', recording_end: 'recording_date', to_date: asking?.field }
        if (f) refuse(BOX[f] || f, e.message)
        else setErr(e.message)
      }
    } finally { setBusy(false) }
  }
  // A refusal that names no box is the banner at the top: brought into sight.
  const errRef = useRef(null)
  useEffect(() => { if (err && !badField) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [err, badField])
  const del = async () => {
    if (!confirm('Delete this task?')) return
    try { await onDelete(item); toast(tx('Task deleted')); (onLeave || onClose)() } catch (e) { setErr(e.message) }
  }
  // One press spawns the recurring piece: brief, crew and platforms ride
  // along; dates, stage and delivery start clean.
  // The server makes the copy, because the name has to be the next free
  // "Duplicate N" across every copy that exists and two people pressing this
  // at the same moment must not both get Duplicate 1.
  const duplicate = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const copy = await api.post(`/content/${item.id}/duplicate`)
      toast(tx('Duplicated as {name}', { name: copy.title }))
      // Open the copy. It is the thing you asked for; you should be looking
      // at it rather than at a message saying it exists somewhere.
      ;(onLeave || onClose)(copy)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const rescueEl = (<>
      {/* The tab died with words in it. They are still here. */}
      {rescue && (
        <div className="cm-rescue">
          <b>{tx('Unsaved changes from last time')}</b>
          <span className="stat-sub">{tx('This tab closed before these were saved.')}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-primary" onClick={takeDraft}>{tx('Restore them')}</button>
          <button type="button" className="btn btn-sm" onClick={dropDraft}>{tx('Discard')}</button>
        </div>
      )}
  </>)

  const errEl = (<>
      {err && <div className="form-error" role="alert" ref={errRef}><AlertCircle size={16} /> {err}</div>}
  </>)

  const clashEls = (<>
      {/* Scheduling warning: the operator is double-booked or off the clock.
          A window over the sheet (ClashDialog), not a box at the top of it —
          the top is half a sheet away from the timeline the booking is made
          on, so from there Save looked as if it had done nothing. Admins may
          push through on purpose; everyone else goes back to the day, which
          is where "Pick another time" turns the sheet to. */}
      {conflict && isClash(conflict) && (
        <ClashDialog clash={conflict} busy={busy} onForce={() => save(true)}
          chanLabel={(ch) => byKey[ch]?.label || ch}
          onBack={() => {
            setConflict(null)
            if (creating) { setSlotsOpen(true); setBadField('recording_date') } else {
              // Back to the operator's day the clash is on — not whichever
              // person or day the strip was last left showing.
              setSchedFor('operator_id')
              if (form.recording_date && form.recording_date >= todayISO()) setSchedDay(form.recording_date)
              setSchedOpen(true); setBadField('schedule')
            }
          }} />
      )}
      {/* Any other 409 — a full day, a slot the holder already accepted — is
          a sentence that says what to do, and stays one. */}
      {conflict && !isClash(conflict) && (
        <div className="conflict-box">
          <div className="conflict-head"><AlertCircle size={15} /> {conflict.error}</div>
        </div>
      )}
  </>)

  const titleEl = (<>
      {/* Big, calm title — the first thing you type */}
      <input
        className="cm-title"
        autoFocus={creating}
        disabled={detailsLocked}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        placeholder={tx("Task title")}
      />
  </>)

  const typeRow = (<>
      {/* What is it? The type binds the task to each platform's plan. */}
      <div className="cm-row">
        <span className="cm-key">{t('task.type')}</span>
        {/* One small dropdown, not a row of chips: six coloured buttons for a
            choice made once per task was the first thing the eye landed on
            and the last thing it needed. */}
        <select className="select cm-select" data-pick="type" disabled={detailsLocked} value={form.type} aria-label={t('task.type')}
          onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {CONTENT_TYPES.map((ct) => <option key={ct.key} value={ct.key}>{ct.label}</option>)}
        </select>
      </div>
  </>)

  const formatRow = (<>
      {/* Format and rubrika are how a piece is CLASSIFIED, which is a question
          about work that is going to be made. Asked of a thought being jotted
          down they are two more rows between somebody and the button, and the
          admin's own rule already says an idea owes nothing but its name. They
          are one press away behind "I already know the rest". */}
      {!ideaOnly && (fOn('format') || fOn('rubrika')) && (
        <div className="cm-row">
          <span className="cm-key">{t('task.brief')}</span>
          {/* Own classes on purpose: these are brief fields, not crew hats —
              nothing that counts crew-fields may count these. */}
          <div className="brief-fields">
            {fOn('format') && (
              <label className={'brief-field' + (badField === 'format' ? ' field-bad' : '')} data-field="format">
                <span className="brief-label"><Layers size={12} /> {tx('Format')} {fReq('format')
                  ? <b className="req-star" data-tip={tx("The admin made this required")}>*</b>
                  : <span className="crew-opt">{tx("optional")}</span>}</span>
                <select className="select" disabled={detailsLocked} value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}>
                  <option value="">{tx('— pick a format —')}</option>
                  {[...new Set([...(fieldRules.format.options || []), ...(form.format ? [form.format] : [])])]
                    .map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            )}
            {fOn('rubrika') && (
              <label className={'brief-field' + (badField === 'rubrika' ? ' field-bad' : '')} data-field="rubrika">
                <span className="brief-label"><Hash size={12} /> {tx('Rubrika')} {fReq('rubrika')
                  ? <b className="req-star" data-tip={tx("The admin made this required")}>*</b>
                  : <span className="crew-opt">{tx("optional")}</span>}</span>
                {(fieldRules.rubrika.options || []).length > 0 ? (
                  <select className="select" disabled={detailsLocked} value={form.rubrika}
                    onChange={(e) => setForm({ ...form, rubrika: e.target.value })}>
                    <option value="">{tx('— pick a rubrika —')}</option>
                    {[...new Set([...(fieldRules.rubrika.options || []), ...(form.rubrika ? [form.rubrika] : [])])]
                      .map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="input" disabled={detailsLocked} placeholder={tx("e.g. SU events")}
                    value={form.rubrika} onChange={(e) => setForm({ ...form, rubrika: e.target.value })} />
                )}
              </label>
            )}
          </div>
        </div>
      )}
  </>)

  const tgRow = (<>
      {/* What a Telegram piece is. Unlike Format and Rubrika it is asked of an
          idea too: it is one pick, it decides what the copywriter is paid,
          and the builder has already asked it of everything it made. */}
      {tgOn && (
        <div className="cm-row">
          <span className="cm-key">Telegram</span>
          <TelegramFields type={form.telegram_type} guiding={form.is_guiding}
            disabled={detailsLocked} required={!isAdmin} bad={badField === 'telegram_type'}
            onType={(v) => setForm({ ...form, telegram_type: v || '' })}
            onGuiding={(v) => setForm({ ...form, is_guiding: v })} />
        </div>
      )}
  </>)

  const stageRow = (<>
      {/* Stage — the pipeline, in its own colours */}
      <div className="cm-row">
        <span className="cm-key">{t('task.stage')}</span>
        <div className="stage-wrap">
        <div className="stage-chips">
          {(() => {
            // The crew see the stage but never set it by hand (they tick their
            // milestone instead) — only move_tasks unlocks the picker. An IDEA
            // is the exception, and the same exception the server and the
            // board already make: anybody who can see a thought may shove it
            // along.
            const locked = !creating && !canMove && !heldAtIdea
            const current = statuses.find((s) => s.id === form.status_id)
            // "Deleted" is not a stage anybody picks from a list — deleting has
            // its own door — so it is offered only when the task is already there.
            const options = statuses.filter((s) => !/^deleted$/i.test(s.label || '') || s.id === form.status_id)
            // A dropdown that cannot be opened reads as broken. The crew get
            // the stage as a word, which is all it is to them.
            return (
              <span className="cm-stage-pick">
                <span className="status-dot" style={{ background: current?.color || 'var(--muted)' }} />
                <select className="select cm-select" data-pick="stage" disabled={locked} value={form.status_id ?? ''} aria-label={t('task.stage')}
                  onChange={(e) => setForm({ ...form, status_id: Number(e.target.value) })}>
                  {options.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </span>
            )
          })()}
        </div>
        {/* Still missing — the checker, in the open, on the row it is about. */}
        {/* The planner's list: an editor cannot set the shoot day, and being
            told it is missing on every open was a worry with no handle. */}
        {gaps.length > 0 && (
          <div className="cm-gaps">
            <span className="gap-key">{tx('Still missing')}</span>
            {gaps.map((g) => <span key={g.key} className="chip chip-gap">{tx(g.label)}</span>)}
          </div>
        )}
        </div>
      </div>
  </>)

  const viewsRow = (<>
      {/* ---- what it got ---- */}
      {showViews && (
        <div className="cm-row cm-views">
          <span className="cm-key"><Eye size={13} style={{ verticalAlign: -2 }} /> {tx('Views')}</span>
          <div className="views-box">
            {canCount ? (
              <input className="input views-input" type="number" min="0" step="1" inputMode="numeric"
                placeholder={tx('Not counted yet')}
                value={form.views}
                onChange={(e) => setForm({ ...form, views: e.target.value.replace(/[^0-9]/g, '') })} />
            ) : (
              <b className="views-read">
                {form.views === '' ? tx('Not counted yet') : Number(form.views).toLocaleString()}
              </b>
            )}
            <span className="stat-sub">
              {form.views === ''
                ? tx('Leave it empty until somebody has actually looked — an empty box is not zero views.')
                : tx('Counts towards the maker’s month.')}
            </span>
          </div>
        </div>
      )}
  </>)

  const skipRow = (<>
      {/* How much of it people skipped. Read off the same screen as the view
          count, so it is asked for in the same place — and left empty until
          somebody has actually looked, for the same reason. */}
      {/* Its own class, not the view count's: the two rows are read together
          and styled alike, and anything that COUNTS the views box must not
          find two of them. */}
      {showViews && (
        <div className="cm-row cm-skip">
          <span className="cm-key"><SkipForward size={13} style={{ verticalAlign: -2 }} /> {tx('Skip rate')}</span>
          <div className="views-box">
            {canCount ? (
              <span className="skip-input">
                <input className="input skip-input-box" type="number" min="0" max="100" step="0.1" inputMode="decimal"
                  placeholder={tx('Not measured yet')}
                  value={form.skip_rate}
                  onChange={(e) => setForm({ ...form, skip_rate: e.target.value.replace(/[^0-9.]/g, '') })} />
                <b>%</b>
              </span>
            ) : (
              <b className="views-read">
                {form.skip_rate === '' ? tx('Not measured yet') : `${form.skip_rate}%`}
              </b>
            )}
            <span className="stat-sub">
              {form.skip_rate === ''
                ? tx('Empty until somebody has looked — an empty box is not a nought per cent skip.')
                : tierNote}
            </span>
          </div>
        </div>
      )}
  </>)

  const refRow = (<>
      {/* Reference — the brief the crew reads before working: style/mood/format
          notes, example links, and a reference photo. All optional; none of it
          blocks moving a task forward. Crew see it; only editors set it. */}
      {!ideaOnly && !textOnly && (hasRef || !creating || (canEdit && show.reference)) && (
        <div className={'cm-row cm-ref' + (badField === 'reference' ? ' field-bad' : '')} data-field="reference">
          <span className="cm-key"><BookOpen size={13} style={{ verticalAlign: -2 }} /> {t('task.reference')}</span>
          <div className="ref-block">
            {briefEditable ? (
              <textarea className="input" rows={2} value={form.reference_text}
                onChange={(e) => setForm({ ...form, reference_text: e.target.value })}
                placeholder={tx("Style, mood, length, format… (optional)")} />
            ) : form.reference_text ? <p className="ref-text">{form.reference_text}</p> : null}

            {briefEditable ? (
              <div className="ref-links">
                {form.reference_links.map((url, i) => (
                  <div key={i} className="ref-link-row">
                    <input className="input" value={url} placeholder={tx('https://… reference video or post')}
                      onChange={(e) => setRefLink(i, e.target.value)} />
                    <button type="button" className="icon-btn" aria-label={tx("Remove link")} onClick={() => removeRefLink(i)}><X size={13} /></button>
                  </div>
                ))}
                <button type="button" className="extra-btn" onClick={addRefLink}><Plus size={13} />{' '}{tx("Example link")}</button>
              </div>
            ) : form.reference_links.length > 0 ? (
              <div className="ref-links-view">
                {form.reference_links.map((url, i) => (
                  /^https?:\/\//i.test(url)
                    ? <a key={i} className="ref-link-chip" href={url} target="_blank" rel="noreferrer"><Link2 size={12} /> {shortUrl(url)} <ExternalLink size={11} /></a>
                    : <span key={i} className="ref-link-chip"><Link2 size={12} /> {url}</span>
                ))}
              </div>
            ) : null}

            {/* A saved task's photos and videos — twenty, added by anybody on
                it, pasted or dropped anywhere over the sheet (RefMedia). The
                old album's photos are shown among them and still saved with
                the sheet. A task being written down keeps the old album until
                it exists. */}
            {!creating ? (
              <RefMedia task={item} initial={item?.media} user={user} plans={canEdit}
                legacy={form.reference_photos || []}
                onRemoveLegacy={briefEditable ? (i) => setPhotos(form.reference_photos.filter((_, j) => j !== i)) : null} />
            ) : (<>
            {(form.reference_photos || []).length > 0 && (
              <div className="ref-photo-album">
                {form.reference_photos.map((p, i) => (
                  <div className="photo-wrap ref-photo" key={i}>
                    <Zoom src={p.thumb || p.photo} full={p.photo || p.thumb} alt={tx('reference')} />
                    {briefEditable && (
                      <button className="photo-remove" data-tip={tx("Remove the photo")} data-tip-left=""
                        onClick={() => setPhotos(form.reference_photos.filter((_, j) => j !== i))}
                        aria-label={tx("Remove photo")}><X size={14} /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {briefEditable && (form.reference_photos || []).length < MAX_PHOTOS ? (
              <label className="photo-pick ref-photo-pick"
                data-tip={tx("Pick a file — or just press Ctrl+V with a screenshot on the clipboard")}>
                <ImagePlus size={15} />{' '}
                {(form.reference_photos || []).length > 0 ? tx('Another reference photo') : tx('Reference photo')}{' '}
                <span className="crew-opt">{phone ? tx('take one or pick one') : tx('or paste it — Ctrl+V')}</span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />
              </label>
            ) : null}
            </>)}
          </div>
        </div>
      )}
  </>)

  const docsRow = (<>
      {/* Documents — the ТЗ as a Word file, the reference deck as a PDF, the
          slot plan as a spreadsheet. Anyone who can open the task can read
          them and add one; only whoever attached a document (or an admin)
          takes it away. Names and sizes are all that travel with the task —
          the bytes are fetched on the click that opens one. */}
      {!creating && (docs.length > 0 || show.docs) && (
        <div className="cm-row">
          <span className="cm-key"><Paperclip size={13} style={{ verticalAlign: -2 }} /> {t('task.documents')}</span>
          <div className="doc-block">
            {docs.map((d) => (
              <div key={d.id} className={`doc-row dk-${docKind(d.name)}`}>
                <FileType2 size={15} className="doc-ico" />
                <button type="button" className="doc-name" onClick={() => openDoc(d)}
                  data-tip={tx("Download this document")}>{d.name}</button>
                <span className="doc-meta">
                  {docSize(d.size)}
                  {d.uploader && <span className="doc-who"> · {d.uploader.split(' ')[0]}</span>}
                </span>
                <button type="button" className="icon-btn doc-get" onClick={() => openDoc(d)} aria-label={tx("Download")}
                  data-tip={tx("Download")}><Download size={14} /></button>
                {(user.role === 'admin' || d.uploaded_by === user.id) && (
                  <button type="button" className="icon-btn" onClick={() => removeDoc(d)} aria-label={tx("Remove")}
                    data-tip={tx("Remove this document")} data-tip-left=""><X size={14} /></button>
                )}
              </div>
            ))}
            <label className={'doc-pick' + (docBusy ? ' busy' : '')}>
              <Paperclip size={14} /> {docBusy ? 'Uploading…' : 'Attach a document'}
              <input type="file" accept={DOC_ACCEPT} style={{ display: 'none' }} disabled={docBusy} onChange={pickDoc} />
            </label>
            <span className="doc-hint">{tx("Word, PDF, Excel, PowerPoint or text — up to 4 MB each.")}</span>
          </div>
        </div>
      )}
  </>)

  const scriptRow = (<>
      {/* The script — the words and shots the crew films by. Editors write it;
          the crew read it. Folds behind the extras row unless demanded. */}
      {!ideaOnly && fOn('script') && canEdit && (form.script || fReq('script') || show.script) && (
        <div className={'cm-row' + (badField === 'script' ? ' field-bad' : '')} data-field="script">
          <span className="cm-key"><FileText size={13} style={{ verticalAlign: -2 }} /> {t('task.script')}{fReq('script') && <b className="req-star" data-tip={tx("The admin made this required")}> *</b>}</span>
          <div>
            <textarea className="input cm-script" rows={6} disabled={detailsLocked}
              placeholder={tx("The script / shot plan the crew works by…")}
              value={form.script} onChange={(e) => setForm({ ...form, script: e.target.value })} />
            {!detailsLocked && <BriefCheck text={form.script} kind={form.type || 'video'} />}
            {!creating && <TextHelp text={item?.script} label={t('task.script')} />}
          </div>
        </div>
      )}
  </>)

  const tzRow = (<>
      {/* ТЗ — техническое задание. Separate from the script on purpose: the
          script is what the operator films, the ТЗ is what the editor is told
          to make of it. A shoot can be scripted with no ТЗ written yet, and
          an edit cannot start without one. */}
      {!ideaOnly && fOn('tz') && canEdit && (form.tz || fReq('tz') || show.tz) && (
        <div className={'cm-row' + (badField === 'tz' ? ' field-bad' : '')} data-field="tz">
          <span className="cm-key"><ClipboardList size={13} style={{ verticalAlign: -2 }} /> {tx('ТЗ')}{fReq('tz') && <b className="req-star" data-tip={tx("The admin made this required")}> *</b>}</span>
          <div>
            <textarea className="input cm-script" rows={5} disabled={detailsLocked}
              placeholder={tx('What the editor is asked to make — length, pace, captions, music…')}
              value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })} />
            {!detailsLocked && <BriefCheck text={form.tz} kind={form.type || 'video'} />}
            {!creating && <TextHelp text={item?.tz} label={tx('ТЗ')} />}
          </div>
        </div>
      )}
  </>)

  const ideaDoor = (<>
      {/* The door to the full form, and only the door. The sentence that used
          to sit beside it explained a rule the form already demonstrates by
          not asking for anything: somebody writing an idea down reads it once
          and then reads past it for ever, and it was two lines of the shortest
          screen on the board. */}
      {ideaOnly && (
        <div className="cm-idea-note">
          <button type="button" className="btn btn-sm" onClick={() => setFillNow(true)}>
            {tx('I already know the rest')}
          </button>
        </div>
      )}
  </>)

  const postRow = (<>
      {/* Where it actually went live. Asked for once the piece is near the
          end, and always shown once there is one — this is the address every
          report downstream is built on, and the board used to record that
          something was published without recording WHERE.

          It sits HERE, on the page the sheet opens on, and not on the Review
          page with the Publish button: the sheet is paged on a desk as well
          as a phone, and a box two presses away behind "Add details" and a
          tab is a box people report as missing. The wall that asks for it is
          met from the stage dropdown on this page, so the pen is on this page. */}
      {!creating && (form.post_link || nearlyOut) && (
        <div className="cm-row">
          <span className="cm-key">{tx('Published at')}</span>
          <label className="ready-link-field dlv-post" data-field="post_link">
            <span className="crew-label dlv-head">
              <Send size={13} />
              <b>{tx('The published post')}</b>
              {/* Said forwards or backwards depending on where the piece
                  actually is. A task already ON the last stage was being told
                  the link was "needed before it can move" there — advice about
                  a move that has happened, on a board that is supposed to know
                  where its own work stands. */}
              <span className="stat-sub">
                {isOut ? tx('where it went out') : tx('needed before it can move to the last stage')}
              </span>
            </span>
            <input className={'input' + (badField === 'post_link' ? ' field-bad' : '')}
              value={form.post_link} placeholder="https://…"
              onChange={(e) => setForm({ ...form, post_link: e.target.value })} />
            {form.post_link && (
              <a className="btn btn-sm" href={form.post_link} target="_blank" rel="noreferrer">{tx('Open it')}</a>
            )}
          </label>
        </div>
      )}
  </>)

  const descRow = (<>
      {show.description && (
        <div className={'cm-row' + (badField === 'description' ? ' field-bad' : '')} data-field="description">
          <span className="cm-key"><AlignLeft size={13} style={{ verticalAlign: -2 }} /> {t('task.description')}{fReq('description') && <b className="req-star" data-tip={tx("The admin made this required")}> *</b>}</span>
          <div>
            <textarea className="input" rows={2} disabled={detailsLocked} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={tx("References, links, notes…")} />
            <CharCount text={form.description} channels={form.channels} />
            {!detailsLocked && <BriefCheck text={form.description} kind={form.type || 'video'} />}
            {!creating && <TextHelp text={item?.description} label={t('task.description')} />}
          </div>
        </div>
      )}
  </>)

  const filesRow = (<>
      {!creating && deliveryFields.length > 0 && (
        <div className="cm-row">
          <span className="cm-key">{t('task.files')}</span>
          <div className="crew-do">
            {/* Three near-identical Drive boxes in a row were impossible to
                tell apart at a glance — people pasted the cut into Recording.
                Each one now carries its stage's colour, its own icon and the
                name of the person it belongs to, so the box you want is the
                one you can see. */}
            {deliveryFields.map((f) => {
              const Icon = f.icon
              // In a borrowed seat only THEIR box is theirs to fill — otherwise
              // the preview would show reach the person does not have, which
              // is the thing it exists to reveal.
              const editable = f.mine || canEdit
              const owner = team.find((u) => u.id === item?.[{ shot: 'operator_id', edit: 'editor_id', design: 'designer_id' }[f.kind]])
              return (
                <label key={f.col} data-field={f.col}
                  className={`ready-link-field dlv-${f.kind}` + (f.mine ? ' dlv-mine' : '') + (badField === f.col ? ' field-bad' : '')}>
                  <span className="crew-label dlv-head">
                    {/* The filmed chain is numbered because it has an order —
                        footage first, cut second. Design is a track of its own
                        and wears no number rather than a confusing second "2". */}
                    {f.kind !== 'design' && <span className="dlv-step">{f.kind === 'shot' ? '1' : '2'}</span>}
                    <span className="dlv-badge"><Icon size={14} /></span>
                    <b className="dlv-name">{tx(f.label)}</b>
                    <span className="crew-opt dlv-sub">{tx(f.sub)}</span>
                    <span className="dlv-who">{f.mine ? 'yours' : owner ? owner.name.split(' ')[0] : 'nobody yet'}</span>
                  </span>
                  <span className="ready-link-input">
                    {/* With a folder on the channel, the box asks WHICH file —
                        the folder is the same forty times a week and the file
                        is the part people leave out. */}
                    {sharedFolder && !/^https?:\/\//i.test(form[f.col] || '') ? (
                      <input className="input" placeholder={tx("which file? e.g. 1-3, or “reel 14”")}
                        disabled={!editable}
                        value={form[f.file] || ''}
                        onChange={(e) => setForm({ ...form, [f.file]: e.target.value })} />
                    ) : (
                      <input className="input" placeholder={'https://drive.google.com/…'}
                        disabled={!editable}
                        value={form[f.col]}
                        onChange={(e) => setForm({ ...form, [f.col]: e.target.value })} />
                    )}
                    {deliveryHref(form[f.col]) && (
                      <a className="btn btn-sm" href={deliveryHref(form[f.col])} target="_blank" rel="noreferrer"><ExternalLink size={14} />{' '}{tx("Open")}</a>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
  </>)

  const daysBlock = (<>
      {/* Dates — the shoot in hours (from–to), the editor's cut deadline, the
          designer's artwork deadline, and the public release. Each maker is
          judged by their own date, never by the release. */}
      <div className="dates-block">
        {(() => {
          const shared = {
            form, setForm, disabled: detailsLocked, confirmSet: creating || onlyAnIdea ? null : confirmSet,
            locked: datesLocked && !creating, frozen: datesFrozen, onAskMove: canAsk ? askToMove : null,
          }
          const at = (k) => ({ ...shared, bad: badField === k, stored: item?.[k] })
          // Your own days: the ask moves them at once.
          const ownOf = { recording_date: myHats.operator, edit_ready_date: myHats.editor, design_ready_date: myHats.designer, release_date: isMine }
          return (<>
            {/* Who films it, on the page where WHEN is decided.
                Booking is one decision — a person and a time — and the form
                had it as two, on two different tabs: the operator seat lives
                with the rest of the crew on Execution, and the days live
                here. So giving a task meant picking a name, crossing to this
                page to find the free times had appeared, and crossing back
                when the answer was "not that week". The same state, so there
                is no second source of truth: this picker and the crew seat
                are two windows on one field. */}
            {!textOnly && asked.crew('operator') && (
              <div className={'cm-row cm-shoot-who' + (badField === 'operator_id' ? ' field-bad' : '')} data-field="operator_id">
                <span className="cm-key">
                  <Clapperboard size={13} style={{ verticalAlign: -2 }} /> {tx('Who films it')}
                </span>
                <div>
                  <PersonPicker
                    disabled={detailsLocked}
                    value={form.operator_id ?? null}
                    placeholder={needsOperator ? tx('— pick the operator —') : tx('— nobody —')}
                    tip={tx('Who films / shoots this')}
                    groups={[
                      { label: tx('Operators'), people: team.filter((u) => (u.crew_roles || []).includes('operator'))
                        .map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar })) },
                      { label: tx('Everyone else — one-time duty'), people: team.filter((u) => !(u.crew_roles || []).includes('operator'))
                        .map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar })) },
                    ].filter((g) => g.people.length > 0)}
                    onPick={(id) => setForm({ ...form, operator_id: id })}
                  />
                </div>
              </div>
            )}
            {<DateRow icon={Clapperboard} label="Shoot" dateKey="recording_date" timeKey="recording_time" endKey="recording_end" {...at('recording_date')} own={ownOf.recording_date} />}
            {/* …or pick the time out of the operator's actual week. Typing a
                date and a time was guessing at somebody else's diary and
                being corrected afterwards; this asks how long the shoot is
                and then offers only the times that exist. Folded away by
                default — the boxes above are still the fast path for a
                planner who already agreed the time in the corridor. */}
            {/* Open, once somebody is in the seat.
                It hid behind "Find a free slot", which is a button asking
                whether you would like to know the one thing you came to this
                row to find out. A planner who already agreed the time in the
                corridor still has the boxes above and can ignore this; a
                planner who has not is shown the answer instead of a button
                that admits it exists. Still foldable, because a booked shoot
                does not need its alternatives on screen for ever. */}
            {!detailsLocked && !shootLocked && form.operator_id && (
              <div className="cm-row cm-slots">
                <span className="cm-key">
                  <CalendarClock size={13} style={{ verticalAlign: -2 }} /> {tx('Their week')}
                </span>
                <div className="cm-slot-wrap">
                  {slotsOpen && (
                    <div className="tt-len">
                      <span className="stat-sub">{tx('How long?')}</span>
                      <div className="seg" role="tablist">
                        {[[30, '30m'], [60, '1h'], [120, '2h'], [240, 'Half day']].map(([m, lbl]) => (
                          <button key={m} type="button" role="tab" aria-selected={slotLen === m}
                            className={'seg-btn' + (slotLen === m ? ' on' : '')}
                            onClick={() => setSlotLen(m)}>{tx(lbl)}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {slotsOpen && (
                    <Timetable
                      userId={Number(form.operator_id) || null}
                      excludeId={item?.id}
                      mins={slotLen}
                      value={form.recording_date && form.recording_time
                        ? { date: form.recording_date, from: form.recording_time, to: form.recording_end } : null}
                      onPick={({ date, from, to }) => {
                        // Through the chain a typed day goes through
                        // (cascadeDates): a shoot picked past the cut takes the
                        // cut and the release along with it.
                        setForm((f) => ({ ...cascadeDates(f, 'recording_date', date).form, recording_time: from, recording_end: to }))
                        // …and it stays open. A LIST of the times somebody
                        // could have been booked for is noise once the
                        // question is settled, which is why it used to fold
                        // itself away. A WEEK with the booking drawn on it is
                        // the opposite: it is the only thing on this page that
                        // shows what was just agreed to in the context of
                        // everything around it — the lecture it sits beside,
                        // the shoot before it. Folding that away the instant
                        // it becomes useful is hiding the answer.
                      }}
                    />
                  )}
                  <button type="button" className="cm-slot-toggle sp-further" onClick={() => setSlotsOpen((v) => !v)}>
                    {slotsOpen ? tx('Hide their week') : tx('Show their week')}
                  </button>
                </div>
              </div>
            )}
            {/* The booked slot, and whether the person holding it has agreed
                to it. A date typed into a box is a plan; this is where it
                becomes an arrangement between two people. */}
            {!creating && (
              <Booking item={booked} which="shoot" label={tx('Shoot')}
                holderName={team.find((u) => u.id === booked?.operator_id)?.name?.split(' ')[0]}
                mine={booked?.operator_id === user.id} onAnswered={setBooked} />
            )}
            {/* Who cuts it and who draws it, next to the days they owe — the
                Work page reads in the order the work is made: who films it and
                when, who edits and designs it and by when, then where it goes. */}
            {(<>
      {/* The crew hats, offered by ROLE: the operator list holds operators,
          the editor list editors, the designer list designers — set the roles
          in Admin → People (they multi-select). A post is designed, not shot,
          so it carries only the designer hat; filmed types carry all three.
          Hidden hats keep their person, so flipping the type loses nothing. */}
      <div className="cm-row" data-field={['operator_id', 'editor_id', 'designer_id'].includes(badField) ? badField : undefined}>
        <span className="cm-key">{t('task.crew')}</span>
        <div className="crew-row">
          {/* Two hats. The designer used to be a third, offered on every task
              and picked on almost none — the pipeline this board runs is
              idea → shoot → edit, and a designer has no stage in it. The
              column and anyone already holding it are untouched; it is simply
              not offered any more. */}
          {[
            // Only the hats the channels this is going to actually have. A
            // written channel has neither: nothing is filmed and nothing is
            // cut, and a seat nobody can fill is a seat somebody spends a
            // minute trying to.
            // The operator is asked beside the shoot's day, further down this
            // page — a booking is a person and a time, one decision.
            ...(asked.crew('editor') ? [{ key: 'editor_id', label: tx('Editor'), role: 'editor', tip: 'Who edits this' }] : []),
            // …and the designer back, for design work: designers have their
            // own board and stages now, and the task has to be able to name
            // who draws it. Anyone already holding the seat keeps it in view.
            ...((designWork || form.designer_id) ? [{ key: 'designer_id', label: tx('Designer'), role: 'designer', tip: 'Who designs this' }] : []),
          ].map((f) => {
            const holds = (u) => (u.crew_roles || []).includes(f.role)
            const bySort = (a, b) =>
              (picks[b.id] || 0) - (picks[a.id] || 0) || a.name.localeCompare(b.name)
            // Only the people who work on THIS channel. Somebody scoped to
            // two channels was previously offered on all nine, and the
            // refusal came at save time, after the picking. Now they simply
            // are not in the list. Nobody scoped is offered everywhere, as
            // before. The person already holding the hat stays visible even
            // if the channel later moves out from under them — a select whose
            // value is not among its options renders blank while still
            // holding the id, which is worse than showing it.
            const here = (u) => {
              if (u.id === form[f.key]) return true
              const mine = u.crew_channels || []
              if (!mine.length) return true
              return form.channels.some((ch) => mine.includes(ch))
            }
            const pool = team.filter(here)
            const specialists = pool.filter(holds).sort(bySort)
            const everyoneElse = pool.filter((u) => !holds(u)).sort(bySort)
            // "Dilnoza (3/4 that day)" — and a full day says so rather than
            // waiting for the save to say it. The person already holding the
            // hat is never marked full by their own piece.
            const load = dayLoad[f.key] || {}
            const nameOf = (u) => {
              const l = load[u.id]
              if (!l || !l.cap) return u.name
              const mine = u.id === form[f.key] ? 1 : 0
              const taken = Math.max(0, l.taken - mine)
              return `${u.name} — ${taken}/${l.cap}${taken >= l.cap ? ` ${tx('day is full')}` : ''}`
            }
            const isFull = (u) => {
              const l = load[u.id]
              if (!l || !l.cap || u.id === form[f.key]) return false
              return l.taken >= l.cap
            }
            // What the stage owes: a booked shoot needs its shooter, and
            // footage in hand needs the editor who will cut it. An idea owes
            // neither — the hats say "optional" until the work reaches them.
            const mustHave = (f.key === 'operator_id' && needsOperator) || (f.key === 'editor_id' && needsEditor)
            return (
              <div key={f.key} className={'crew-field' + (mustHave && !form[f.key] ? ' crew-missing' : '') + (badField === f.key ? ' field-bad' : '')}>
                <span className="crew-label">
                  {f.label}{' '}
                  {mustHave
                    ? <span className="crew-req">{tx("required")}</span>
                    : <span className="crew-opt">{tx("optional")}</span>}
                </span>
                <PersonPicker
                  disabled={detailsLocked}
                  value={form[f.key] ?? null}
                  placeholder={mustHave ? `— pick the ${f.label.toLowerCase()} —` : tx('— nobody —')}
                  tip={mustHave ? `${f.label} — this stage can’t go on without one` : f.tip}
                  groups={[
                    { label: `${f.label}s`, people: specialists.map((u) => ({ id: u.id, name: nameOf(u), color: u.color, avatar: u.avatar, disabled: isFull(u) })) },
                    { label: tx('Everyone else — one-time duty'), people: everyoneElse.map((u) => ({ id: u.id, name: nameOf(u), color: u.color, avatar: u.avatar, disabled: isFull(u) })) },
                  ].filter((g) => g.people.length > 0)}
                  onPick={(id) => setForm({ ...form, [f.key]: id })}
                />
              </div>
            )
          })}
          {/* Their day, one press away — the operator's to book a half-hour
              from, the editor's to look at. The Logistics page has the whole
              week; this answers the smaller question right where the person
              is picked. */}
          {/* Shown while the task is being created too: assigning somebody
              from the full sheet is assigning them, and "All fields" from the
              builder lands here with the person already picked. */}
          {(form.operator_id || form.editor_id) && (() => {
            const who = form[schedFor] ? schedFor : (form.operator_id ? 'operator_id' : 'editor_id')
            const both = form.operator_id && form.editor_id && form.operator_id !== form.editor_id
            const firstOf = (id) => (team.find((u) => u.id === id)?.name || '').split(' ')[0]
            const booking = who === 'operator_id' && !detailsLocked && !shootLocked
            return (
              <div className="crew-sched" data-field="schedule">
                {!schedOpen ? (
                  <button type="button" className="tb-link" onClick={() => setSchedOpen(true)}>{tx('View schedule availability')}</button>
                ) : (
                  <>
                    {both && (
                      <span className="dt-len" role="group" aria-label={tx('Whose day')}>
                        {['operator_id', 'editor_id'].map((k) => (
                          <button key={k} type="button" className={'dt-len-btn' + (who === k ? ' on' : '')} aria-pressed={who === k}
                            onClick={() => {
                              setSchedFor(k)
                              // Each on the day they owe: the shoot's day, the cut's day.
                              const owed = k === 'editor_id' ? form.edit_ready_date : form.recording_date
                              if (owed && owed >= todayISO()) setSchedDay(owed)
                            }}>{firstOf(form[k])}</button>
                        ))}
                      </span>
                    )}
                    <DayTimeline userId={form[who]} day={schedDay} onDay={setSchedDay} excludeId={item?.id}
                      readOnly={!booking} showDue={who === 'editor_id'} showUntimed
                      value={booking && form.recording_date === schedDay && form.recording_time
                        ? { from: form.recording_time, to: form.recording_end } : null}
                      onPick={(slot) => setForm((f) => ({ ...cascadeDates(f, 'recording_date', schedDay).form, recording_time: slot.from, recording_end: slot.to }))}
                      onClear={booking ? () => setForm((f) => ({ ...f, recording_time: '', recording_end: '' })) : undefined} />
                    <button type="button" className="tb-link" onClick={() => setSchedOpen(false)}>{tx('Hide')}</button>
                  </>
                )}
              </div>
            )
          })()}
          {/* Whose face carries it. Not a crew hat — a hat is work done ON the
              piece, and this is the piece. Offered for anything filmed, and
              always shown once somebody has been named. Its own class on
              purpose: nothing that counts crew-fields may count it. */}
          {(form.face_ids.length > 0 || form.type === 'target') && (
            <div className="face-field">
              <span className="crew-label">
                {tx('Brand faces')}{' '}<span className="crew-opt">{tx('optional')}</span>
              </span>
              <div className="rev-picker">
                {form.face_ids.map((id) => {
                  const u = team.find((x) => x.id === id)
                  return (
                    <span key={id} className="chip assignee-chip">
                      <Avatar name={u?.name || tx('Someone')} color={u?.color} src={u?.avatar} size="xs" />
                      {u?.name || tx('Someone')}
                      {!detailsLocked && (
                        <button type="button" className="chip-x" aria-label={tx('Remove')}
                          onClick={() => setForm({ ...form, face_ids: form.face_ids.filter((x) => x !== id) })}>×</button>
                      )}
                    </span>
                  )
                })}
                {!detailsLocked && (
                  <PersonPicker
                    className="reviewer-add"
                    value={null}
                    clearable={false}
                    placeholder={form.face_ids.length ? tx('Add person…') : tx('— nobody —')}
                    tip={tx('Who is in this creative')}
                    groups={[{
                      label: '',
                      people: team.filter((u) => !form.face_ids.includes(u.id))
                        .map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar })),
                    }]}
                    onPick={(id) => { if (id && !form.face_ids.includes(id)) setForm({ ...form, face_ids: [...form.face_ids, id] }) }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

            </>)}
            {<DateRow icon={Scissors} label="Edit ready" dateKey="edit_ready_date" {...at('edit_ready_date')} revised={item?.edit_due_revised} own={ownOf.edit_ready_date} />}
            {!creating && (
              <Booking item={booked} which="edit" label={tx('Edit ready')}
                holderName={team.find((u) => u.id === booked?.editor_id)?.name?.split(' ')[0]}
                mine={booked?.editor_id === user.id} onAnswered={setBooked} />
            )}
            {/* A deadline for a craft this task does not have.
                The crew seats offer an Operator and an Editor and nothing
                else — the designer hat came off the picker in round 78 — but
                this row was gated on WHO IS LOOKING rather than on whether
                there is a designer, so every reel asked for a day the
                artwork was due when no artwork was coming and nobody could
                be assigned to make it. It follows the seat now, the same way
                the delivery boxes do. */}
            {(designWork || !!form.designer_id || !!item?.designer_id || !!form.design_ready_date) && (
              <DateRow icon={Palette} label="Design ready" dateKey="design_ready_date" {...at('design_ready_date')} own={ownOf.design_ready_date} />
            )}
            {<DateRow icon={Send} label="Release" dateKey="release_date" timeKey="release_time" {...at('release_date')} revised={item?.review_due_revised} own={ownOf.release_date} />}
          </>)
        })()}
      </div>
  </>)

  const askForm = (<>
      {/* Asking for a promised day to move. The reason is the point: a date
          that slips without one is a date nobody can plan around next time. */}
      {asking && (
        <div className="ask-move">
          <div className="ask-head">
            <CalendarClock size={15} /> {tx('Ask an admin to move {day}', { day: promisedDay(asking.field) })}
          </div>
          <div className="ask-row">
            <span className="ask-was">{tx('now')} <b>{item?.[asking.field] || '—'}</b></span>
            <span className="drow-dash">→</span>
            <input className="input" type="date" value={asking.to}
              onChange={(e) => setAsking({ ...asking, to: e.target.value })} />
          </div>
          <textarea className="input" rows={2} autoFocus value={asking.reason}
            onChange={(e) => setAsking({ ...asking, reason: e.target.value })}
            placeholder={tx("What happened? The shoot was rained off, the location fell through…")} />
          <div className="ask-actions">
            <span className="stat-sub">{tx("They see it in the bell and in Telegram. The day does not move until they say yes.")}</span>
            <button type="button" className="btn btn-sm" onClick={() => setAsking(null)}>{tx("Cancel")}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !asking.reason.trim()} onClick={sendAsk}>
              <Send size={13} /> {tx('Ask')}
            </button>
          </div>
        </div>
      )}
  </>)

  const platformsRow = (<>
      {/* Platforms — a task can go out on several at once. Nearly every task
          goes to one, and a wall of thirteen chips with one lit was the
          loudest thing on the page; the others are one press away. */}
      <div className="cm-row">
        <span className="cm-key">{t('task.platforms')}</span>
        <div className="checkbox-row">
          {visible.filter((c) => allPlatforms || form.channels.includes(c.key)).map((c) => (
            <label key={c.key} className={'checkbox-chip chip-sm' + (form.channels.includes(c.key) ? ' on' : '')}>
              <input type="checkbox" disabled={detailsLocked} checked={form.channels.includes(c.key)} onChange={() => toggleChannel(c.key)} />
              {c.label}
            </label>
          ))}
          {!allPlatforms && !detailsLocked && (
            <button type="button" className="checkbox-chip chip-sm chip-add" onClick={() => setAllPlatforms(true)}>
              <Plus size={12} /> {tx('Another platform')}
            </button>
          )}
          {allPlatforms && user.role === 'admin' && !detailsLocked && (
            newDept === null ? (
              <button type="button" className="checkbox-chip chip-sm chip-add" data-tip={tx("Create a new department right here")}
                onClick={() => setNewDept('')}>
                <Plus size={12} /> New
              </button>
            ) : (
              <span className="chip-add-form">
                <input className="input pc-mini" autoFocus placeholder={tx("Department name…")} value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createDept() } if (e.key === 'Escape') setNewDept(null) }} />
                <button type="button" className="btn btn-sm" onClick={createDept}>{tx("Add")}</button>
              </span>
            )
          )}
        </div>
      </div>
  </>)

  const assigneesRow = (<>
      {/* Who is it for? Admins assign any number of people; an empty list
          leaves the task to the whole channel. */}
      {user.role === 'admin' && (
        <div className="cm-row">
          <span className="cm-key"><UserRound size={13} style={{ verticalAlign: -2 }} /> {t('task.assignees')}</span>
          <div className="assignee-multi">
            {form.assignee_ids.length === 0 && <span className="chip chip-muted">{tx("Unassigned — whole channel")}</span>}
            {form.assignee_ids.map((id) => {
              const u = team.find((x) => x.id === id)
              return (
                <span key={id} className="chip assignee-chip">
                  {u?.name || tx('Someone')}
                  <button type="button" className="chip-x" aria-label={tx("Remove")}
                    onClick={() => setForm({ ...form, assignee_ids: form.assignee_ids.filter((x) => x !== id) })}>×</button>
                </span>
              )
            })}
            <PersonPicker
              className="assignee-add"
              value={null}
              clearable={false}
              placeholder={tx('Add person…')}
              tip={tx("Add another person to this task")}
              groups={[{
                label: '',
                people: [...team].filter((u) => !form.assignee_ids.includes(u.id))
                  .sort((a, b) => (picks[b.id] || 0) - (picks[a.id] || 0) || a.name.localeCompare(b.name))
                  .map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar, hint: u.role === 'admin' ? tx('admin') : '' })),
              }]}
              onPick={(id) => {
                if (id && !form.assignee_ids.includes(id)) setForm({ ...form, assignee_ids: [...form.assignee_ids, id] })
              }}
            />
          </div>
        </div>
      )}
  </>)

  const reviewersRow = (<>
      {/* Review can be shared — several names, all of them on the hook for the
          same date. Kept apart from the single-hat crew pickers above. */}
      <div className="cm-row">
        <span className="cm-key">{t('task.reviewer')}</span>
        {/* Who signs it off, as the people who ARE on it — not as the whole
            team laid out in a grid for you to read your colleagues' names.
            A thirty-person board drew thirty buttons here, twenty-nine of
            which were the wrong answer. The picked faces show; the rest are
            behind a search that narrows. */}
        <div className="rev-picker">
          {form.reviewer_ids.map((id) => {
            const u = team.find((x) => x.id === id)
            return (
              <span key={id} className="chip assignee-chip">
                <Avatar name={u?.name || tx('Someone')} color={u?.color} src={u?.avatar} size="xs" />
                {u?.name || tx('Someone')}
                {!detailsLocked && (
                  <button type="button" className="chip-x" aria-label={tx('Remove')}
                    onClick={() => setForm({ ...form, reviewer_ids: form.reviewer_ids.filter((x) => x !== id) })}>×</button>
                )}
              </span>
            )
          })}
          {!detailsLocked && (
            <PersonPicker
              className="reviewer-add"
              value={null}
              clearable={false}
              placeholder={form.reviewer_ids.length ? tx('Add person…') : tx('Nobody signs this off yet.')}
              tip={tx('Who signs this off')}
              groups={[{
                label: '',
                people: team.filter((u) => !form.reviewer_ids.includes(u.id))
                  .map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar })),
              }]}
              onPick={(id) => {
                if (id && !form.reviewer_ids.includes(id)) setForm({ ...form, reviewer_ids: [...form.reviewer_ids, id] })
              }}
            />
          )}
        </div>
      </div>
  </>)

  const campaignRow = (<>
      {/* Campaign — one dropdown, so campaign progress follows the kanban */}
      <div className="cm-row">
        <span className="cm-key">{t('task.campaign')}</span>
        <select
          className="select"
          style={{ maxWidth: 280 }}
          disabled={detailsLocked}
          value={form.campaign_id ?? ''}
          data-tip={tx("Tags this card to a campaign — its board fills itself")}
          onChange={(e) => setForm({ ...form, campaign_id: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">{tx("No campaign")}</option>
          {campaigns.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
        </select>
      </div>
  </>)

  const checklistRow = (<>
      {show.checklist && (
        <div className="field">
          <label>Checklist{form.checklist.length > 0 ? ` · ${form.checklist.filter((c) => c.done).length}/${form.checklist.length}` : ''}</label>
          <div className="subtask-list">
            {form.checklist.map((c, i) => (
              <div key={i} className="subtask-row">
                <button className={`mini-check${c.done ? ' on' : ''}`} disabled={checklistLocked} data-tip={c.done ? 'Mark as not done' : 'Mark as done'} onClick={() => !checklistLocked && toggleCheck(i)}>
                  {c.done && <Check size={12} strokeWidth={3} />}
                </button>
                <span className={c.done ? 'done-txt' : ''} style={{ flex: 1 }}>{c.text}</span>
                {!checklistLocked && <button className="icon-btn" style={{ padding: 2 }} data-tip={tx("Remove this item")} data-tip-left="" onClick={() => removeCheck(i)} aria-label={tx("Remove")}><X size={13} /></button>}
              </div>
            ))}
          </div>
          {!checklistLocked && (
            <div className="add-inline" style={{ padding: '6px 0 0' }}>
              <input className="input" value={subText} onChange={(e) => setSubText(e.target.value)}
                placeholder={tx("Add an item, press Enter…")} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCheck() } }} />
              <button className="btn btn-sm" onClick={addCheck}><Plus size={14} /></button>
            </div>
          )}
        </div>
      )}
  </>)

  const extrasRow = (<>
      {/* Asking for a row is asking to fill it in, so the sheet takes you to
          where it appeared. Before the views, "Delivery links" opened three
          boxes somewhere below the fold; now it opens them and puts them in
          front of you. */}
      {!detailsLocked && (!show.checklist || (fOn('script') && !show.script && !form.script && !fReq('script')) || (!creating && !show.docs && docs.length === 0) || (!creating && canEdit && !show.delivery)) && (
        <div className="extra-btns">
          {!creating && !show.docs && docs.length === 0 && (
            <button type="button" className="extra-btn" onClick={() => { setShow({ ...show, docs: true }) }}><Paperclip size={14} />{' '}{tx("Documents")}</button>
          )}
          {fOn('script') && !show.script && !form.script && !fReq('script') && <button type="button" className="extra-btn" onClick={() => { setShow({ ...show, script: true }) }}><FileText size={14} />{' '}{tx("Script")}</button>}
          {!show.checklist && <button type="button" className="extra-btn" onClick={() => { setShow({ ...show, checklist: true }) }}><CheckSquare size={14} />{' '}{tx("Checklist")}</button>}
          {!creating && canEdit && !show.delivery && (
            <button type="button" className="extra-btn" onClick={() => { setShow({ ...show, delivery: true }) }}><Link2 size={14} />{' '}{tx("Delivery links")}</button>
          )}
        </div>
      )}
  </>)

  const leaveEl = (<>
      {/* Leaving with words nobody saved. Two ways out and no third: go back
          to the form, or drop what was typed. No "save and close" — a save
          that happens as a side effect of leaving is a save nobody read. */}
      {leaving && (
        <div className="cm-leave" role="alertdialog" aria-modal="true">
          <div className="cm-leave-box u-quiet">
            <b>{tx('You have changes nobody has saved.')}</b>
            <span className="stat-sub">{tx('Close this and they are gone.')}</span>
            <div className="cm-leave-acts">
              <button type="button" className="btn" onClick={() => setLeaving(false)}>
                {tx('Keep editing')}
              </button>
              {/* Thrown away means thrown away: left in this browser, the copy
                  was offered back as "unsaved changes" the next time. */}
              <button type="button" className="btn btn-danger" onClick={() => { dropDraft(); setLeaving(false); onClose() }}>
                {tx('Discard them')}
              </button>
            </div>
          </div>
        </div>
      )}
  </>)

  // ---- the shell ----
  // A new task is a window of its own. A task that exists is edited inside its
  // task window (CoachTask draws the panel around this form): the same blocks in
  // the order they are read there — the days, the reference, the files, the
  // brief — as boxes to fill in, with the rest beside them.
  const footer = (<>
    {!creating && canEdit && (<>
      <button type="button" className={'btn btn-ghost btn-icon cm-more-btn' + (tools ? ' on' : '')}
        onClick={() => setTools((v) => !v)} aria-label={tx('More actions')} aria-expanded={tools}
        aria-haspopup="menu">
        <MoreHorizontal size={18} />
      </button>
      {/* Anywhere else closes it. */}
      {tools && <button type="button" className="cm-tools-scrim" tabIndex={-1}
        aria-hidden="true" onClick={() => setTools(false)} />}
      <div className={'cm-tools cm-tools-pop' + (tools ? ' open' : '')} role="menu"
        onClick={() => setTools(false)}>
        <button className="btn btn-ghost" onClick={duplicate} disabled={busy} role="menuitem"
          data-tip={tx("A fresh copy: brief, crew and platforms kept — dates and stage cleared")}>
          <CopyPlus size={15} /> {t('task.duplicate')}
        </button>
        {/* Delete last and set apart: not where the pointer lands when the menu opens. */}
        <span className="cm-tools-sep" role="separator" />
        <button className="btn btn-danger" role="menuitem" onClick={del}><Trash2 size={15} />{' '}{tx("Delete")}</button>
      </div>
    </>)}
    <span className="foot-gap foot-gap-tight" />
    <button className="btn btn-ghost" onClick={() => { dropDraft(); onClose() }}>{tx("Cancel")}</button>
    <button className="btn btn-primary" onClick={() => save()} disabled={busy || !form.title.trim()}>
      {busy ? t('task.saving') : creating ? t('task.create') : t('task.savechanges')}
    </button>
  </>)
  const body = (<>
    {rescueEl}
    {errEl}
    {clashEls}
    {titleEl}
    {ideaOnly ? (<>
      {typeRow}
      {tgRow}
      {stageRow}
      {descRow}
      {ideaDoor}
    </>) : (
      <div className="te-cols">
        <div className="te-main">
          <div className="te-blk">{daysBlock}{askForm}</div>
          <div className="te-blk">{refRow}</div>
          <div className="te-blk">{filesRow}{postRow}{docsRow}</div>
          <div className="te-blk">{tzRow}{scriptRow}{descRow}</div>
        </div>
        <div className="te-side">
          <h3 className="te-h">{tx('More details')}</h3>
          {typeRow}
          {formatRow}
          {tgRow}
          {stageRow}
          {platformsRow}
          {assigneesRow}
          {reviewersRow}
          {campaignRow}
          {viewsRow}
          {skipRow}
          {checklistRow}
          {extrasRow}
        </div>
      </div>
    )}
    {leaveEl}
  </>)
  if (!creating) {
    return (<>
      <div className="co-edit">{body}</div>
      <div className="modal-foot co-edit-foot">{footer}</div>
    </>)
  }
  return (
    <Modal wide tall={!ideaOnly} title={tx('New task')} onClose={tryClose} footer={footer}>{body}</Modal>
  )
}

// ---- which window a task opens in ------------------------------------------
// One door for every page. A task that exists opens in the task window
// (components/CoachTask.jsx), the same for everybody; its Edit button turns the
// window into the form above. A NEW one opens in the task builder
// (components/builder/) — four small questions instead of a form — and only
// reaches the form when somebody asks for all the fields, carrying every answer
// they had already given.
export default function ContentModal(props) {
  const [full, setFull] = useState(null)
  if (!props.item && !full && !props.defaults?.full) {
    return (
      <TaskBuilder statuses={props.statuses} defaults={props.defaults || {}}
        onClose={props.onClose} onCreate={props.onCreate} onFull={setFull} />
    )
  }
  if (!props.item) return <TaskSheet {...props} defaults={full ? { ...(props.defaults || {}), ...full } : props.defaults} startFull={!!full} />
  return <TaskWindow {...props} />
}

// Who gets the Edit button: the sheet's own reading of what this person may
// change at all — anything (manage_content), the stage (move_tasks), an idea
// (anybody on it), their own piece's checklist — on a piece that is theirs to
// touch. The form then locks, field by field, what the server would refuse.
const mayEdit = (user, t, stageRank) => {
  if ((t.assignees?.length ? t.assignees : [t.assignee_id]).includes(user.id)) return true
  // The crew on it: their own delivery box, the published link, a document —
  // the form locks the rest (the review, 14 Oct 2026).
  if ([t.operator_id, t.editor_id, t.designer_id].includes(user.id)) return true
  if (!reachOf(user, t)) return false
  return can(user, 'manage_content') || can(user, 'move_tasks') || t.status_id == null || stageRank(t.status_id) === 'idea'
}

function TaskWindow({ item, statuses, onClose, onUpdate, onDelete, onChanged = null, askFor = null, ...win }) {
  const { user } = useAuth()
  const { byKey } = useChannels()
  const step = useNextStep(user, statuses, byKey)
  const stageRank = useMemo(() => stageRankOf(statuses), [statuses])
  const [ask, setAsk] = useState(askFor)   // the calendar's ask: started once, by the first Edit
  // The page behind hears of every press: through its own list keeper when it
  // has one, else through an empty save, which answers with the row as it
  // stands now (the old sheet's trick after an approval).
  const changed = onChanged || ((u) => { Promise.resolve(onUpdate?.(u, {})).catch(() => {}) })
  return (
    <CoachTask key={item.id} item={item} user={user} byKey={byKey} step={step} {...win}
      onClose={onClose} onChanged={changed} startEdit={!!askFor}
      mayEdit={(t) => mayEdit(user, t, stageRank)}
      edit={(t, out) => (
        <TaskSheet item={t} statuses={statuses} askFor={ask} closeRef={out.closeRef}
          onUpdate={onUpdate} onDelete={onDelete} onClose={() => { setAsk(null); out.done() }} onLeave={out.leave} />
      )} />
  )
}

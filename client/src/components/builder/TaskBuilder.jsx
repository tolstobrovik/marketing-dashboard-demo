import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, FileDown, SlidersHorizontal, Clapperboard, Scissors, Palette } from 'lucide-react'
import Modal from '../Modal.jsx'
import ClashDialog from '../ClashDialog.jsx'
import { api } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.jsx'
import { useChannels } from '../../lib/channels.jsx'
import { askedOf } from '../../lib/channelFormat.js'
import { todayISO, addDaysISO, typeInfo, isWrittenFormat } from '../../lib/constants.js'
import { hasSubstance, isSentence, URL_RE } from '../../lib/text.js'
import { toast } from '../../lib/toast.js'
import { getPicks, bumpPick } from '../../lib/picks.js'
import { isPicture, readPicture, readDocument } from '../../lib/picture.js'
import { tr as tx } from '../../lib/i18n.jsx'
import StepTitle from './StepTitle.jsx'
import StepType from './StepType.jsx'
import StepWhen from './StepWhen.jsx'
import StepMore from './StepMore.jsx'
import StepShoot from './StepShoot.jsx'
import StepEdit from './StepEdit.jsx'
import StepDesign from './StepDesign.jsx'

// ---- giving a task, one question at a time ----------------------------------
//
// The form this replaces opened as a title, two dropdowns, a description and
// a button reading "I already know the rest" — behind which were four tabs and
// fifteen boxes. The things people actually give a new task (read off the
// last month of the live board: a release day on 79% of them, somebody filming
// on 70%, an editor on 66%) were on the second and third of those tabs, and
// the Type box opened on Post while two tasks in three are reels.
//
// So a task is now a few small questions, one per screen, each with its usual
// answer already chosen — and only the ones this kind of work, on this
// channel, has. In the order the work happens:
//
//   Name     What needs to be made? — and a description, if there is one.
//            "Save as draft" makes it right there, with nothing else asked.
//   Kind     six pictures, one press — and it moves on
//   Shoot    filmed kinds: who films it, their half-hour, who is in it
//   Editing  filmed kinds: who edits it, and the day the cut is due
//   When     a month on a card
//   Design   designed kinds: who designs it, and the day the artwork is due
//   Extras   Reference / Script / ТЗ, and files
//
// A reel walks Name → Kind → Shoot → Editing → When → Extras; a post walks
// Name → Kind → When → Design → Extras; a written channel only Name → Kind →
// When → Extras. Create is on every screen from the second one on, so
// somebody who only has a name and a kind is two presses from done. Nothing is lost by leaving: the
// answers are kept in this browser until the task is made. And "All fields"
// hands every answer to the full sheet for the rare task that needs a script
// or a shoot hour on the way in.
//
// It writes exactly what the sheet wrote for a new idea — same route, same
// stage, same checks on the server — so the two can never disagree.

// What a kind of work looks like in the form: the colour it wears (the same
// token its chip wears everywhere — a post's chip is ruby), how far ahead it
// is usually given (median days, the live board's last 120 days: a Telegram
// post 2, a paid ad 3, a post 2, a reel 6), and what its last step asks.
const ACCENT = { reel: 'var(--type-reel)', post: 'var(--ruby)', target: 'var(--type-target)', video: 'var(--type-video)', story: 'var(--type-story)', other: 'var(--type-other)' }
const QUICK = { text: [0, 1, 2], ads: [1, 3, 5], post: [1, 2, 5], story: [0, 1, 2], filmed: [3, 6, 10] }
const BRIEF = {
  filmed: { label: 'Brief', ask: 'What should they film?', sub: 'The script, the ТЗ and a reference — what the crew works from.' },
  designed: { label: 'Brief', ask: 'What should it look like?', sub: 'What the designer works from: a reference and the ТЗ.' },
  // No "What goes in the post?" here: the text is the name and the
  // description, asked on the first step (the bug hunt, 14 Oct 2026).
  text: { label: 'Text' },
  other: { label: 'Extras' },
}

// Which step a refusal about a seat (or the day) belongs to.
// What a crew switch clears when it is turned off.
const OFF = {
  shoot: { operator_id: null, recording_date: '', recording_time: '', recording_end: '', face_ids: [] },
  edit: { editor_id: null, edit_ready_date: '' },
  design: { designer_id: null, design_ready_date: '' },
}
const SEAT_STEP = { operator_id: 'shoot', editor_id: 'edit', designer_id: 'design', release_date: 'when' }
const DRAFT_DAYS = 7
const LAST_KEY = 'satashkent_builder_last'

const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } }

export default function TaskBuilder({ statuses, defaults = {}, onClose, onCreate, onFull }) {
  const { user } = useAuth()
  const { visible, byKey } = useChannels()
  const isAdmin = user.role === 'admin'
  const today = todayISO()
  const [team, setTeam] = useState([])
  const [rules, setRules] = useState(null)
  useEffect(() => {
    api.cached('/users').then((t) => setTeam(Array.isArray(t) ? t : [])).catch(() => {})
    api.cached('/fields').then(setRules).catch(() => {})
  }, [])

  // ---- where it starts from ----
  // A page that opened this for a reason — a channel, a day on a calendar, a
  // campaign — says so in `defaults`, and then an old unfinished draft is not
  // brought back over the top of it.
  const DRAFT = `satashkent_builder_${user.id}`
  const pageSaid = !!(defaults.release_date || defaults.recording_date || defaults.campaign_id || defaults.assignee_id || defaults.title
    || defaults.type || defaults.status_id || defaults.design || defaults.designer_id)
  const [saved] = useState(() => {
    const d = readJSON(DRAFT)
    // …and only one left on the channel this page opened on: a reel drafted on
    // Instagram came back on Telegram, as a reel, with the Kind step hidden (the
    // bug hunt, 14 Oct 2026).
    const fresh = d && d.title && Date.now() - (d.at || 0) < DRAFT_DAYS * 864e5
      && (!defaults.channels?.[0] || d.channel === defaults.channels[0])
    // The quick idea's "More options" names the piece: its draft of that name is
    // the same piece, and comes back (the review, 14 Oct 2026).
    if (pageSaid && !(fresh && defaults.title && d.title.trim() === String(defaults.title).trim())) return null
    return fresh ? d : null
  })
  const last = useMemo(() => readJSON(LAST_KEY) || {}, [])
  // A design is drawn: given from the Design board, only channels that take
  // artwork are offered (Telegram and X posts are typed).
  const pickable = defaults.design ? visible.filter((c) => !['text', 'short', 'repost'].includes(c.format)) : visible
  const canUse = (k) => pickable.some((c) => c.key === k)
  const startChannel = [defaults.channels?.[0], saved?.channel, last.channel, visible.length === 1 ? visible[0].key : '']
    .find((k) => k && canUse(k)) || pickable[0]?.key || ''
  // A written channel gets posts — 48 of the last 49 — whatever was picked
  // on it last; anywhere else, what this person last gave on that channel.
  const kindFor = (ch) => {
    if (byKey[ch]?.format === 'short') return 'post'   // X, Threads, LinkedIn: written too
    if (byKey[ch]?.format === 'text') return 'post'
    const remembered = last.types?.[ch]
    if (remembered) return remembered
    return 'reel'
  }

  const carried = Object.fromEntries(Object.entries(defaults).filter(([, v]) => v != null && v !== ''))
  const shot = defaults.recording_date ? defaults : { ...(saved || {}), ...carried }
  const [d, setD] = useState(() => ({
    title: saved?.title || defaults.title || '',
    channel: startChannel,
    type: defaults.type || saved?.type || kindFor(startChannel),
    release_date: defaults.release_date || saved?.release_date || '',
    // Everything a page carried in (the quick idea's "More options") is kept,
    // over a draft of the same piece; and the shoot is one booking — its day,
    // hours and who films come from one place, or a quick idea's day got an old
    // draft's hour (the check of the review, 14 Oct 2026).
    recording_date: shot.recording_date || '',
    recording_time: shot.recording_time || '',
    recording_end: shot.recording_end || '',
    operator_id: shot.operator_id ?? null,
    editor_id: defaults.editor_id ?? saved?.editor_id ?? null,
    designer_id: defaults.designer_id ?? saved?.designer_id ?? null,
    design_ready_date: saved?.design_ready_date || '',
    face_ids: saved?.face_ids || [],
    owner_id: defaults.assignee_id || saved?.owner_id || user.id,
    edit_ready_date: saved?.edit_ready_date || '',
    reference: defaults.reference_text || saved?.reference || '',
    script: defaults.script || saved?.script || '',
    tz: defaults.tz || saved?.tz || '',
    notes: defaults.description || saved?.notes || '',
    telegram_type: defaults.telegram_type || saved?.telegram_type || '',
    is_guiding: !!(saved?.is_guiding ?? defaults.is_guiding),
  }))
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }))
  const [photos, setPhotos] = useState([])
  const [files, setFiles] = useState([])
  const [restored, setRestored] = useState(!!saved)
  // Kept in this browser as it is typed, so closing the window — Esc, a
  // click outside, a phone call — loses nothing. Pictures and files are not
  // kept: they are megabytes, and the words are what hurts to lose.
  useEffect(() => {
    if (!d.title.trim()) return
    writeJSON(DRAFT, { ...d, at: Date.now() })
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the steps ----
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState('fwd')
  const [err, setErr] = useState('')
  // A refusal is said where the person is looking, not below the fold.
  const errBox = useRef(null)
  useEffect(() => { if (err) errBox.current?.scrollIntoView({ block: 'nearest' }) }, [err])
  const [busy, setBusy] = useState(false)
  // The server's double-booking answer, kept so it can be read and — for a
  // channel admin — overridden, rather than flashed as an error.
  const [clash, setClash] = useState(null)
  // ---- what this task can be asked, on this channel ----
  const asked = useMemo(() => askedOf(rules?.channel_formats, [d.channel], byKey), [rules, d.channel, byKey])
  const canFilm = !!rules?.crew?.operator?.includes(d.type) && asked.crew('operator')
  const canEdit = !!rules?.crew?.editor?.includes(d.type) && asked.crew('editor')
  // Designed: the kinds the crew rule says, or anything given from the
  // Design board — where the channel has designers at all.
  const canDesign = (!!rules?.crew?.designer?.includes(d.type) || !!defaults.design) && asked.crew('designer')
  // …and only what the person turns on is asked (the owner, 14 Oct 2026: a
  // reel walked through Shoot, Editing and Design before it could be saved).
  // On when the page or a draft already said who, or when given as a design.
  const [want, setWant] = useState(() => ({
    shoot: !!(defaults.operator_id || defaults.recording_date || saved?.operator_id),
    edit: !!(defaults.editor_id || saved?.editor_id),
    design: !!(defaults.design || defaults.designer_id || saved?.designer_id),
  }))
  const film = canFilm && want.shoot
  const edit = canEdit && want.edit
  const design = canDesign && want.design
  // The channel's kind of surface, and the kind of work on it.
  // A short written channel (X, Threads, LinkedIn) is asked as a written one:
  // the form has one written face, and Telegram's item type is read off
  // `asked` below, never off this.
  const format = isWrittenFormat(byKey[d.channel]?.format) ? 'text' : byKey[d.channel]?.format || 'social'
  const flow = format === 'text' ? 'text' : canFilm || canEdit ? 'filmed' : design ? 'designed' : 'other'
  const brief = BRIEF[flow]
  // A written channel opened from its own page has nothing to ask on the
  // Kind step — it is a post — so the step is not drawn. Neither is it for a
  // design given from the Design board on a known channel.
  const givenOk = !!defaults.channels?.[0] && canUse(defaults.channels[0])
  const skipKind = (format === 'text' || !!defaults.design) && givenOk
  const steps = useMemo(() => [
    { key: 'title', label: 'Name' }, !skipKind && { key: 'type', label: 'Kind' },
    // The day it goes out, with the switches for the crew; then only the
    // crew steps that were turned on.
    { key: 'when', label: 'When' },
    film && { key: 'shoot', label: 'Shoot' }, edit && { key: 'edit', label: 'Editing' }, design && { key: 'design', label: 'Design' },
    { key: 'more', label: brief.label },
  ].filter(Boolean), [film, edit, design, skipKind, brief.label])
  const go = (i) => {
    const n = Math.max(0, Math.min(steps.length - 1, i))
    if (n === step) return
    if (n > 0 && !d.title.trim()) { setStep(0); return }
    setDir(n > step ? 'fwd' : 'back'); setStep(n); setErr('')
  }
  const goTo = (k) => { const i = steps.findIndex((x) => x.key === k); go(i < 0 ? steps.length - 1 : i) }
  const next = () => go(step + 1)
  const back = () => go(step - 1)
  // Going to a written (Telegram) channel: the item type is owed up front —
  // it is what the copywriter is paid by — with the guiding switch under it.
  const written = asked.formats.includes('text')
  const descRule = rules?.description
  const needsDescription = !!descRule && descRule.state === 'required' && descRule.types.includes(d.type) && asked.field('description')
  // The brief lines the admin has switched on for this kind, on this channel —
  // the same switches the full sheet reads. Until the rules arrive, all show.
  // `must`: what the board demands whatever the switch says (a post owes a ТЗ —
  // the sheet and the server read it; the builder did not, and the post's first
  // move was refused for a box it never offered — the bug hunt, 14 Oct 2026).
  const fOn = (k) => { const r = rules?.[k]; return !r || (((r.must || []).includes(d.type) || (r.state !== 'off' && r.types.includes(d.type))) && asked.field(k)) }

  // ---- the cut's day, and the artwork's ----
  // Asked on their own step once somebody holds the seat: one line, never
  // before the shoot (or today), never after the release. With no release
  // yet the cut is two days after the shoot and the artwork three days out;
  // a release picked later pulls either back to the day before it. Not
  // written unless it is shown — a deadline nobody saw is not a promise.
  const filmBooked = film && !!d.operator_id && !!d.recording_date
  const dayBefore = (floor) => (addDaysISO(d.release_date, -1) >= floor ? addDaysISO(d.release_date, -1) : d.release_date)
  const within = (v, floor) => !!v && v >= floor && (!d.release_date || v <= d.release_date)
  const cutFloor = d.recording_date && d.recording_date > today ? d.recording_date : today
  const cutShown = edit && (filmBooked || !!d.editor_id)
  const cutDay = !cutShown ? ''
    : within(d.edit_ready_date, cutFloor) ? d.edit_ready_date
      : d.release_date && d.release_date >= cutFloor ? dayBefore(cutFloor) : addDaysISO(cutFloor, 2)
  const artShown = design && !!d.designer_id
  const artDay = !artShown ? ''
    : within(d.design_ready_date, today) ? d.design_ready_date
      : d.release_date ? dayBefore(today) : addDaysISO(today, 3)
  // A shoot with its person, day, hour, three dates and a script is BOOKED,
  // and the server puts it straight on "To shoot" (see `shootGateFor` in
  // server/routes/content.js). Said here so it is not a surprise — and, one
  // line short of it, so the missing line is named.
  const shootStage = (statuses || []).find((st) => /to\s*shoot|shooting|s[yj]omka/i.test(String(st.label || '')))
  const booking = shootStage && filmBooked && d.recording_time && cutDay
    ? (!fOn('script') || isSentence(d.script)
      ? tx('Booked — it goes straight to «{stage}».', { stage: tx(shootStage.label) })
      : tx('Add the script and it goes straight to «{stage}».', { stage: tx(shootStage.label) }))
    : ''

  // ---- the faces ----
  const picks = useMemo(() => getPicks(), [])
  const onChannel = (u) => {
    const mine = u.crew_channels || []
    return !mine.length || mine.includes(d.channel)
  }
  const staff = team.filter((u) => u.role !== 'ambassador')
  // The people this person picks most first, then whoever holds the hat, then
  // the channel's own people — on this board SMMs film and cut their own reels
  // as often as the crew does — and everybody else last.
  const rank = (u, hat) => ((u.crew_roles || []).includes(hat) ? 2 : 0)
    + ((u.departments || []).includes(d.channel) ? 1 : 0)
  const faces = (hat) => staff.filter(onChannel).sort((a, b) =>
    (picks[b.id] || 0) - (picks[a.id] || 0)
    || rank(b, hat) - rank(a, hat)
    || a.name.localeCompare(b.name))
  const operators = useMemo(() => faces('operator'), [team, d.channel]) // eslint-disable-line react-hooks/exhaustive-deps
  const editors = useMemo(() => faces('editor'), [team, d.channel]) // eslint-disable-line react-hooks/exhaustive-deps
  const designers = useMemo(() => faces('designer'), [team, d.channel]) // eslint-disable-line react-hooks/exhaustive-deps
  // Who is in front of the camera can be anybody on the team.
  const people = useMemo(() => [...staff].sort((a, b) => (picks[b.id] || 0) - (picks[a.id] || 0) || a.name.localeCompare(b.name)), [team]) // eslint-disable-line react-hooks/exhaustive-deps
  // Admins give tasks to people; everybody else's new task is their own (the
  // server says so), so only an admin is asked whose it is.
  const owners = useMemo(() => {
    if (!isAdmin) return null
    const planners = staff.filter((u) => u.id === user.id || u.role === 'admin'
      || (u.role === 'member' && (u.departments || []).includes(d.channel)))
    return planners.sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id)
      || (picks[b.id] || 0) - (picks[a.id] || 0) || a.name.localeCompare(b.name))
  }, [team, d.channel, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pictures and files ----
  const addFiles = async (list) => {
    setErr('')
    let held = photos.length
    for (const f of list) {
      try {
        if (isPicture(f)) {
          // Eight is what a task carries; the ninth is said, not dropped in silence.
          if (held >= 8) { setErr(tx('That is as many reference photos as one task carries — {n}', { n: 8 })); continue }
          held += 1
          const pic = await readPicture(f)
          setPhotos((cur) => (cur.length >= 8 ? cur : [...cur, pic]))
        } else {
          await readDocument(f) // checks the size now, not after the task exists
          setFiles((cur) => [...cur, f])
        }
      } catch (e) { setErr(tx(e.message)) }
    }
  }
  const onPaste = (e) => {
    const pics = [...(e.clipboardData?.files || [])].filter(isPicture)
    if (!pics.length) return
    e.preventDefault()
    addFiles(pics)
    if (steps[step]?.key !== 'more') go(steps.length - 1)
  }

  // ---- what goes to the server ----
  const ideaStage = (statuses || []).find((s) => /^idea$|^ideas$|g'oya|идея/i.test(String(s.label || '')))
    || (statuses || []).find((s) => !/^deleted$/i.test(String(s.label || '')))
  // Added from a kanban column, it lands in that column.
  const startStage = (defaults.status_id && (statuses || []).find((s) => s.id === defaults.status_id)) || ideaStage
  const payloadOf = () => {
    // A link written in the Reference or Notes line is a reference — the
    // brief's "Example link" — so the full sheet shows it where a crew looks
    // for one. The words around it stay as the reference text.
    const links = [...new Set([...(d.reference.match(URL_RE) || []), ...(d.notes.match(URL_RE) || [])].map((u) => u.trim()))]
    const refWords = d.reference.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim()
    return {
      title: d.title.trim(),
      channels: [d.channel],
      type: d.type,
      status_id: startStage?.id ?? null,
      // Nobody picks a stage here, so the board may: a shoot booked in full
      // is born on "To shoot" rather than left at Idea. (The server only
      // moves an idea; a task added in a column stays in it.)
      auto_stage: true,
      release_date: d.release_date || null,
      recording_date: d.recording_date || null,
      // The hours were picked on somebody's day. With nobody filming any more
      // they are nobody's hours, and are not sent — the day stays.
      recording_time: film && d.operator_id && d.recording_date && d.recording_time ? d.recording_time : null,
      recording_end: film && d.operator_id && d.recording_date && d.recording_end ? d.recording_end : null,
      edit_ready_date: cutDay || null,
      description: d.notes.trim(),
      reference_text: hasSubstance(refWords) ? refWords : null,
      script: d.script.trim() || null,
      tz: d.tz.trim() || null,
      reference_links: links,
      reference_photos: photos,
      photo: photos[0]?.photo ?? null,
      photo_thumb: photos[0]?.thumb ?? null,
      operator_id: film ? d.operator_id : null,
      editor_id: edit ? d.editor_id : null,
      designer_id: design ? d.designer_id : null,
      design_ready_date: artDay || null,
      face_ids: film ? d.face_ids : [],
      ...(written ? { telegram_type: d.telegram_type || null, is_guiding: !!d.is_guiding } : {}),
      campaign_id: defaults.campaign_id ?? null,
      ...(isAdmin ? { assignee_ids: d.owner_id ? [d.owner_id] : [user.id] } : {}),
    }
  }
  const canCreate = !!d.title.trim() && !!d.channel && !busy

  // "Save for now" (the owner, 14 Oct 2026: "in any stage must be save for
  // now"): everything filled so far, landing where the page said — an idea,
  // or the column it was added in — and never moved on by itself; every
  // other question waits for Edit.
  const draftOf = () => ({ ...payloadOf(), auto_stage: false,
    edit_ready_date: d.edit_ready_date || null, design_ready_date: d.design_ready_date || null })
  const submit = async (force = false, draft = false) => {
    if (!d.title.trim()) { go(0); return }
    if (!d.channel) { setErr(tx('Pick where it goes')); go(1); return }
    if (written && !d.telegram_type && !draft) {
      go(steps.length - 1)
      setErr(tx('Pick the Telegram Item Type.'))
      return
    }
    if (needsDescription && !hasSubstance(d.notes)) {
      go(0)
      setErr(tx('This kind of task needs a short description.'))
      return
    }
    if (busy) return
    setBusy(true); setErr(''); setClash(null)
    const payload = { ...(draft ? draftOf() : payloadOf()), ...(force ? { force: true } : {}) }
    try {
      const created = await onCreate(payload)
      // Files hang on a task, so they go up once there is one to hang on.
      if (files.length && created?.id) {
        for (const f of files) {
          try { await api.post(`/content/${created.id}/files`, { name: f.name, data: await readDocument(f) }) }
          catch (e) { toast(`${f.name}: ${e.message}`, 'err') }
        }
      }
      bumpPick(payload.operator_id, payload.editor_id, payload.designer_id, ...(payload.assignee_ids || []))
      writeJSON(LAST_KEY, { channel: d.channel, types: { ...(last.types || {}), [d.channel]: d.type } })
      try { localStorage.removeItem(DRAFT) } catch { /* ok */ }
      // Where it landed, when that is not where every new task lands.
      const gate = created?.status_id && created.status_id !== ideaStage?.id
        ? (statuses || []).find((st) => st.id === created.status_id) : null
      toast(draft ? tx('Saved for now — add the rest with Edit') : gate ? tx('Task added — on «{stage}»', { stage: tx(gate.label) }) : tx('Task added — synced'))
      onClose()
    } catch (e) {
      // Somebody is already booked then: say so, and let an admin go ahead.
      if (e.status === 409 && e.data?.conflicts) { setClash({ ...e.data, draft }); goTo('shoot'); return }
      // Take them to the question the refusal is about — and say it there:
      // going to a step clears the error, so it is set after (the bug hunt,
      // 14 Oct 2026: "Create now" jumped to a step with no message).
      if (e.data?.crew_field) goTo(SEAT_STEP[e.data.crew_field])
      else if (SEAT_STEP[e.data?.field]) goTo(SEAT_STEP[e.data.field])
      else if (/description/i.test(e.message)) go(0)
      else if (e.data?.field === 'telegram_type' || /«/i.test(e.message)) go(steps.length - 1)
      setErr(e.message)
    } finally { setBusy(false) }
  }
  // Nothing attached is lost to a stray Esc or a click beside the form: the
  // words are kept in this browser, the pictures and files are not.
  const leave = () => {
    if ((photos.length || files.length) && !window.confirm(tx('Leave without saving what you entered?'))) return
    onClose()
  }

  const openFull = () => {
    const p = payloadOf()
    // The full sheet keeps its own rescue copy from here on; leaving this one
    // behind would bring back a task that sheet has since made.
    try { localStorage.removeItem(DRAFT) } catch { /* ok */ }
    onFull({
      title: p.title, channels: p.channels, type: p.type, release_date: p.release_date || '',
      recording_date: p.recording_date || '', recording_time: p.recording_time || '', recording_end: p.recording_end || '',
      edit_ready_date: p.edit_ready_date || '',
      description: p.description, reference_links: p.reference_links,
      reference_text: p.reference_text || '', script: p.script || '', tz: p.tz || '',
      reference_photos: p.reference_photos, operator_id: p.operator_id, editor_id: p.editor_id,
      designer_id: p.designer_id, design_ready_date: p.design_ready_date || '', face_ids: p.face_ids, status_id: p.status_id,
      telegram_type: d.telegram_type || '', is_guiding: !!d.is_guiding,
      ...(p.assignee_ids ? { assignee_ids: p.assignee_ids } : {}),
    })
    if (files.length) toast(tx('Attach the files again once the task is saved'), 'err')
  }

  const startOver = () => {
    try { localStorage.removeItem(DRAFT) } catch { /* ok */ }
    setD({
      title: '', channel: startChannel, type: kindFor(startChannel), release_date: '', recording_date: '', recording_time: '', recording_end: '',
      operator_id: null, editor_id: null, designer_id: null, design_ready_date: '', face_ids: [],
      owner_id: user.id, edit_ready_date: '', reference: '', script: '', tz: '', notes: '',
      telegram_type: '', is_guiding: false,
    })
    setPhotos([]); setFiles([]); setRestored(false); setErr(''); setDir('back'); setStep(0)
  }

  // Ctrl/⌘+Enter makes it from anywhere; plain Enter belongs to each step.
  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (canCreate) submit() }
  }

  const at = Math.min(step, steps.length - 1)
  const key = steps[at].key
  const isLast = at === steps.length - 1
  const footer = (
    <>
      {step > 0 && (
        <button type="button" className="btn btn-ghost tb-back" onClick={back} aria-label={tx('Back')}>
          <ArrowLeft size={15} /> <span className="tb-back-word">{tx('Back')}</span>
        </button>
      )}
      <span className="foot-gap" />
      {!isLast && (
        <button type="button" className="btn tb-now" disabled={!canCreate} onClick={() => submit(false, true)}>
          <FileDown size={15} /> {tx('Save for now')}
        </button>
      )}
      {isLast ? (
        <button type="button" className="btn btn-primary tb-go" disabled={!canCreate} onClick={() => submit()}>
          <Check size={15} /> {busy ? tx('Creating…') : tx('Create task')}
        </button>
      ) : (
        <button type="button" className="btn btn-primary tb-next" disabled={!d.title.trim()} onClick={next}>
          {steps[at + 1] ? tx('Next: {step}', { step: tx(steps[at + 1].label) }) : tx('Next')} <ArrowRight size={15} />
        </button>
      )}
    </>
  )

  return (
    <Modal onClose={leave} footer={footer} bodyClass="tb-body"
      title={(
        <span className="tb-head" style={{ '--tb-accent': ACCENT[d.type] || 'var(--ruby)' }}>
          {tx('New task')}
          <span className="tb-head-what">
            {(() => { const I = typeInfo(d.type).icon; return I ? <I size={13} /> : null })()}
            {tx(defaults.design ? 'Design' : typeInfo(d.type).label)}
            {byKey[d.channel] && byKey[d.channel].label !== tx(typeInfo(d.type).label) && <span className="tb-head-where">· {byKey[d.channel].label}</span>}
          </span>
        </span>
      )}>
      <div className="tb" onKeyDown={onKey} onPaste={onPaste} style={{ '--tb-accent': ACCENT[d.type] || 'var(--ruby)' }}>
        <div className="tb-top">
          <ol className="tb-progress" aria-label={tx('Steps')}>
            {steps.map((s, i) => (
              <li key={s.key}>
                <button type="button" className={'tb-dot' + (i === at ? ' on' : '') + (i < at ? ' done' : '')}
                  aria-current={i === at ? 'step' : undefined}
                  disabled={i > 0 && !d.title.trim()} onClick={() => go(i)}>
                  <span className="tb-dot-bar" />
                  <span className="tb-dot-label">{tx(s.label)}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="tb-all" onClick={openFull} disabled={!d.title.trim()}
            data-tip={tx('Script, ТЗ, shoot hour and the rest')}>
            <SlidersHorizontal size={13} /> {tx('All fields')}
          </button>
        </div>
        {startStage && startStage !== ideaStage && step === 0 && (
          <div className="tb-restored">{tx('It lands in «{stage}».', { stage: startStage.label })}</div>
        )}
        {restored && step === 0 && (
          <div className="tb-restored">
            {tx('Picked up where you left off.')}
            <button type="button" className="tb-link" onClick={startOver}>{tx('Start fresh')}</button>
          </div>
        )}
        <div className="tb-stage-wrap">
          <div key={key} className={`tb-stage tb-${dir}`}>
            {key === 'title' && (
              <StepTitle value={d.title} onChange={(v) => set({ title: v })} onNext={next}
                description={d.notes} onDescription={(v) => set({ notes: v })} required={needsDescription} channels={[d.channel]} />
            )}
            {key === 'type' && (
              <StepType type={d.type} channel={d.channel}
                channels={givenOk ? [] : pickable}
                onChannel={(k) => set({ channel: k, type: defaults.design ? d.type : kindFor(k), operator_id: null, editor_id: null, designer_id: null, face_ids: [] })}
                format={format}
                onPick={(t) => { set({ type: t }); setDir('fwd'); setStep(steps.findIndex((x) => x.key === 'type') + 1); setErr('') }} />
            )}
            {key === 'shoot' && (
              <StepShoot today={today} operators={operators} operatorId={d.operator_id} onOperator={(id) => set({ operator_id: id })}
                filming={d.recording_date} filmFrom={d.recording_time} filmTo={d.recording_end}
                onFilm={(slot) => set(slot ? { recording_date: slot.date, recording_time: slot.from, recording_end: slot.to } : { recording_date: '', recording_time: '', recording_end: '' })}
                onClearFilming={() => set({ recording_date: '', recording_time: '', recording_end: '' })}
                people={people} faces={d.face_ids} onFaces={(ids) => set({ face_ids: ids })} askFaces={d.type === 'target'}
                showDue={edit && d.editor_id === d.operator_id} release={d.release_date} />
            )}
            {key === 'edit' && (
              <StepEdit editors={editors} editorId={d.editor_id} onEditor={(id) => set({ editor_id: id })}
                sameAsShooter={d.editor_id === d.operator_id}
                cut={cutDay} cutFloor={cutFloor} release={d.release_date} onCut={(v) => set({ edit_ready_date: v })} />
            )}
            {key === 'when' && (
              <StepWhen today={today} release={d.release_date} onRelease={(v) => set({ release_date: v })}
                filming={d.recording_date}
                quick={QUICK[format === 'text' ? 'text' : format === 'ads' ? 'ads' : flow === 'filmed' ? 'filmed' : d.type === 'story' ? 'story' : 'post']}
                owners={owners} owner={d.owner_id} onOwner={(id) => set({ owner_id: id })} />
            )}
            {key === 'when' && (canFilm || canEdit || canDesign) && (
              <div className="tb-adds" role="group" aria-label={tx('Add to it now, or later with Edit')}>
                <span className="tb-adds-q">{tx('Add to it now, or later with Edit')}</span>
                {[canFilm && ['shoot', Clapperboard, 'Book a shoot'], canEdit && ['edit', Scissors, 'Name who edits'], canDesign && ['design', Palette, 'Ask for a cover']]
                  .filter(Boolean).map(([k, I, label]) => (
                    <button key={k} type="button" className="tb-add" aria-pressed={!!want[k]}
                      onClick={() => { if (want[k]) set(OFF[k]); setWant((w) => ({ ...w, [k]: !w[k] })) }}>
                      {want[k] ? <Check size={15} aria-hidden="true" /> : <I size={15} aria-hidden="true" />}{tx(label)}
                    </button>
                  ))}
              </div>
            )}
            {key === 'design' && (
              <StepDesign designers={designers} designerId={d.designer_id} onDesigner={(id) => set({ designer_id: id })}
                art={artDay} artFloor={today} release={d.release_date} onArt={(v) => set({ design_ready_date: v })} />
            )}
            {key === 'more' && (
              <StepMore brief={d} onBrief={set} booking={booking} ask={brief.ask ? tx(brief.ask) : ''} sub={brief.sub ? tx(brief.sub) : ''}
                telegram={written ? { type: d.telegram_type, guiding: d.is_guiding, missing: !!err && !d.telegram_type } : null}
                show={{ reference: fOn('reference'), script: fOn('script'), tz: fOn('tz') }}
                photos={photos} files={files} onAdd={addFiles}
                onRemovePhoto={(i) => setPhotos((cur) => cur.filter((_, j) => j !== i))}
                onRemoveFile={(i) => setFiles((cur) => cur.filter((_, j) => j !== i))}
                onSubmit={() => submit()} />
            )}
          </div>
        </div>
        {err && <div className="form-error tb-err" role="alert" ref={errBox}>{err}</div>}
        {/* The server's double-booking answer, in the same window the task
            sheet uses. The builder is already back on the step with the
            person's day by the time it opens (goTo('shoot') in submit). */}
        {clash && (
          <ClashDialog clash={clash} busy={busy} onBack={() => setClash(null)} onForce={() => submit(true, !!clash?.draft)} />
        )}
      </div>
    </Modal>
  )
}

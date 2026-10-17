import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import TimeBand from './TimeBand.jsx'
import CharCount from './CharCount.jsx'
import { ChanMark } from './CoachBits.jsx'
import { dayShort } from './CoachParts.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { todayISO, isWrittenFormat, TELEGRAM_TYPES } from '../lib/constants.js'
import { addDays } from '../lib/coach.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import { PALETTE, colorStyle } from '../lib/pieceColor.js'

// ---- a new idea ---------------------------------------------------------------------
//
// Writing a task down used to be a seven-step builder, or a form of fourteen
// fields. Both asked, on the day somebody had an idea, for things nobody knows
// on that day: who films it, at what hour, the script.
//
// Round 8 (October 2026), the owner's rule: "in the idea creation just name
// and idea" — and the place decides the form. Opened from a channel's page it
// is that channel's form at once: a filmed channel (Instagram, YouTube, the
// ads) asks a name and the idea; a written one (Telegram, X…) asks the text
// and the day, and names the card by the text's first line. Opened from My Day
// or the calendar it first asks where — only among the person's own channels.
// What kind of piece it is follows the channel; nobody picks a type here.
//
// "If a person … have everything there, so they can fill it up": under a rule,
// at half strength until touched, the later questions are offered — never
// required. A complete booking is born on To shoot, as the server allows
// (`auto_stage`). The cover is not asked: it is added afterwards.
//
// The long builder is still there ("More options") for the piece this does
// not fit.
const TYPE_OF = { video: 'video', ads: 'target' }
// The first line of a text, cut at a word near 48 characters: the card's name.
export const titleFrom = (text) => {
  const line = String(text || '').trim().split('\n')[0].trim()
  if (line.length <= 48) return line
  const cut = line.slice(0, 48)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 24)).replace(/[\s,;:—–-]+$/, '')}…`
}

// `min`: the first day it may go out — never before it is filmed (the bug hunt,
// 14 Oct 2026: "Today" put a release before the shoot).
function Days({ value, onChange, label, min = '' }) {
  const today = todayISO()
  const first = min && min > today ? min : today
  return (
    <>
      <span className="co-ask-days" role="group" aria-label={label}>
        {[0, 1, 2, 3, 4].map((n) => {
          const d = addDays(today, n)
          return (
            <button key={d} type="button" className="co-chip co-ask-day" aria-pressed={value === d} disabled={d < first} onClick={() => onChange(value === d ? '' : d)}>
              {n === 0 ? tx('Today') : n === 1 ? tx('Tomorrow') : dayShort(d)}
            </button>
          )
        })}
      </span>
      <input className="input qt-otherday" type="date" min={first} value={value} aria-label={tx('Another day')} onChange={(e) => onChange(e.target.value)} />
    </>
  )
}

export default function QuickTask({ defaults = {}, onClose, onCreated, onFull = null }) {
  const { user } = useAuth()
  const { visible, byKey } = useChannels()
  const [channel, setChannel] = useState(defaults.channel || (visible.length === 1 ? visible[0].key : ''))
  const [title, setTitle] = useState('')
  const [idea, setIdea] = useState('')
  const [day, setDay] = useState('')                 // the day it goes out
  const [tgType, setTgType] = useState('just_post')
  const [shoot, setShoot] = useState({ day: '', from: '', to: '', operator: null })
  const [more, setMore] = useState({ script: '', reference_text: '', tz: '', editor_id: '' })
  const [forWhom, setForWhom] = useState('')
  const [team, setTeam] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // r11 · one of the maker's ten colours, while their colours are picked per piece.
  const [pc, setPc] = useState(null)
  const picksColours = (user.color_mode || 'own') === 'own'
  const admin = user.role === 'admin'
  useEffect(() => { api.cached('/users').then((u) => setTeam(Array.isArray(u) ? u : [])).catch(() => {}) }, [])
  const [stages, setStages] = useState([])
  useEffect(() => { api.cached('/statuses').then((s) => setStages(Array.isArray(s) ? s : [])).catch(() => {}) }, [])

  const ch = byKey[channel]
  const written = isWrittenFormat(ch?.format)
  // A repost channel (TikTok, YouTube Shorts) posts videos already made: nobody
  // films or edits for it, so the form books nobody (the bug hunt, 14 Oct 2026).
  const reposts = ch?.format === 'repost'
  const type = written ? 'post' : TYPE_OF[ch?.format] || 'reel'
  // …and only people who work on this channel: anybody else the server refuses.
  const holds = (hat) => team.filter((u) => (u.crew_roles || []).includes(hat)
    && (!(u.crew_channels || []).length || u.crew_channels.includes(channel)))
  const makers = useMemo(
    () => team.filter((u) => u.role === 'member' && (!channel || (u.departments || []).includes(channel))),
    [team, channel])
  const name = written ? titleFrom(idea) : title.trim()
  const ready = !!channel && !!name
  const touched = !!(shoot.day || shoot.from || more.script || more.reference_text || more.tz || more.editor_id || (!written && day))

  // A ref as well as the state: a double click lands before the state redraws,
  // and two POSTs went out (the server refused the twin; the page should not send it).
  const creating = useRef(false)
  const given = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))
  // What is typed in the filmed fold, as the task's fields. A day picked with no
  // hour yet goes (the review, 14 Oct 2026); a day the band filled in for a time
  // goes away with that time (`autoDay`), or a time taken back left a hidden day.
  const autoDay = useRef(false)
  const filmedFields = () => (written || reposts ? {} : given({
    recording_date: shoot.day, recording_time: shoot.from, recording_end: shoot.to, operator_id: shoot.operator,
    script: more.script.trim(), reference_text: more.reference_text.trim(), tz: more.tz.trim(),
    editor_id: more.editor_id ? Number(more.editor_id) : '',
  }))
  const create = async () => {
    if (!ready || busy || creating.current) return
    creating.current = true
    setBusy(true); setErr('')
    try {
      const t = await api.post('/content', {
        title: name, type, channels: [channel], description: idea.trim() || null, release_date: day || null,
        ...(written && ch?.format === 'text' ? { telegram_type: tgType } : {}),
        ...filmedFields(),
        // A complete booking is born on To shoot; anything less stays an idea.
        ...(!written && !reposts && shoot.day && shoot.from && shoot.operator ? { auto_stage: true } : {}),
        ...(admin && forWhom ? { assignee_ids: [Number(forWhom)] } : {}),
      })
      const made = pc != null && t?.id ? await api.post(`/content/${t.id}/color`, { color: pc }).catch(() => t) : t
      // Said as it landed: a booking that went straight to To shoot is not "an idea".
      const at = stages.find((s) => s.id === made?.status_id)
      const first = [...stages].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0]
      toast(at && first && at.id !== first.id ? tx('Added — on «{stage}»', { stage: tx(at.label) }) : tx('Idea added'))
      onCreated?.(made)
      onClose()
    } catch (e) { setErr(e.message) } finally { creating.current = false; setBusy(false) }
  }
  // Nothing typed is lost to a stray Esc, a click beside the form or its ×.
  const leave = () => {
    if (busy) return
    if ((title.trim() || idea.trim() || touched || pc != null || forWhom) && !window.confirm(tx('Leave without saving what you entered?'))) return
    onClose()
  }
  // "More options" carries everything typed into the long form (it opened empty).
  const toFull = () => onFull({
    channels: [channel], title: name, description: idea.trim(), release_date: day,
    ...(written && ch?.format === 'text' ? { telegram_type: tgType } : {}), ...filmedFields(),
    ...(admin && forWhom ? { assignee_id: Number(forWhom) } : {}),
  })
  // A refusal is said where the person is looking, not below the fold.
  const errRef = useRef(null)
  useEffect(() => { if (err) errRef.current?.scrollIntoView({ block: 'nearest' }) }, [err])
  const keys = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); create() } }

  // ---- where does it go? — only when the place has not said ----
  if (!channel) {
    return (
      <Modal title={tx('New idea')} onClose={onClose}>
        <div className="ns" onKeyDown={keys}>
          <span className="ns-q">{tx('Where does it go?')}</span>
          <div className="qt-where">
            {visible.map((c) => (
              <button key={c.key} type="button" className="qt-chan" onClick={() => setChannel(c.key)}>
                <ChanMark channel={c} size={22} /><b>{c.label}</b>
              </button>
            ))}
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`${tx('New idea')} · ${ch?.label || ''}`} onClose={leave}
      footer={(
        <>
          {onFull && <button type="button" className="btn btn-ghost" onClick={toFull}>{tx('More options')}</button>}
          <span className="st-spacer" />
          <button type="button" className="btn btn-primary st-go" disabled={!ready || busy} onClick={create}>
            {busy ? tx('Saving…') : tx('Create')}
          </button>
        </>
      )}>
      <div className="ns" onKeyDown={keys}>
        {written ? (
          <>
            {ch?.format === 'text' && (
              <div className="qt-kinds" role="radiogroup" aria-label={tx('What kind of Telegram piece is it?')}>
                {TELEGRAM_TYPES.map((k) => (
                  <button key={k.key} type="button" role="radio" aria-checked={tgType === k.key} className="co-chip" aria-pressed={tgType === k.key}
                    onClick={() => setTgType(k.key)}>{tx(k.label)}</button>
                ))}
              </div>
            )}
            <div className="ns-ask">
              <label className="ns-q" htmlFor="qt-text">{tx('The text')}</label>
              <textarea id="qt-text" className="input" rows={6} autoFocus value={idea} onChange={(e) => setIdea(e.target.value)} />
              <CharCount text={idea} channels={[channel]} />
            </div>
            <div className="ns-ask">
              <span className="ns-q">{tx('Post it on')}<span className="ns-opt"> · {tx('optional')}</span></span>
              <Days value={day} onChange={setDay} label={tx('Post it on')} />
            </div>
          </>
        ) : (
          <>
            <div className="ns-ask">
              <label className="ns-q" htmlFor="qt-title">{tx('Name')}</label>
              <input id="qt-title" className="input" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); create() } }} />
            </div>
            <div className="ns-ask">
              <label className="ns-q" htmlFor="qt-idea">{tx('The idea')}</label>
              <textarea id="qt-idea" className="input" rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} />
            </div>
            {reposts ? (
              <div className="ns-ask">
                <span className="ns-q">{tx('Post it on')}<span className="ns-opt"> · {tx('optional')}</span></span>
                <Days value={day} onChange={setDay} label={tx('Post it on')} />
              </div>
            ) : (
            <details className={'qt-later' + (touched ? ' touched' : '')}>
              <summary className="qt-later-h">{tx('I already know more — add it now')}</summary>
              <div className="ns-ask">
                <span className="ns-q">{tx('When do you film, and who films?')}</span>
                <TimeBand compact day={shoot.day} onDay={(d, auto) => { autoDay.current = !!auto; setShoot((s) => ({ ...s, day: d })) }}
                  value={{ from: shoot.from, to: shoot.to }} onChange={({ from, to }) => setShoot((s) => ({ ...s, from, to, ...(!from && autoDay.current ? { day: '' } : {}) }))}
                  operatorId={shoot.operator} onOperator={(id) => setShoot((s) => ({ ...s, operator: id || null }))}
                  operators={holds('operator')} />
              </div>
              <div className="qt-pair">
                <div className="ns-ask">
                  <label className="ns-q" htmlFor="qt-script">{tx('What is filmed? (the script)')}</label>
                  <textarea id="qt-script" className="input" rows={3} value={more.script} onChange={(e) => setMore((m) => ({ ...m, script: e.target.value }))} />
                </div>
                <div className="ns-ask">
                  <label className="ns-q" htmlFor="qt-tz">{tx('What should be made? (ТЗ)')}</label>
                  <textarea id="qt-tz" className="input" rows={3} value={more.tz} onChange={(e) => setMore((m) => ({ ...m, tz: e.target.value }))} />
                </div>
              </div>
              <div className="qt-pair">
                <div className="ns-ask">
                  <label className="ns-q" htmlFor="qt-ref">{tx('An example to follow — a link or a few words')}</label>
                  <input id="qt-ref" className="input" placeholder={tx('https://… or: warm light, slow walk, 30 seconds')} value={more.reference_text} onChange={(e) => setMore((m) => ({ ...m, reference_text: e.target.value }))} />
                </div>
                <div className="ns-ask">
                  <label className="ns-q" htmlFor="qt-editor">{tx('Who edits it?')}</label>
                  <select id="qt-editor" className="select" value={more.editor_id} onChange={(e) => setMore((m) => ({ ...m, editor_id: e.target.value }))}>
                    <option value="">{tx('Choose…')}</option>
                    {holds('editor').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="ns-ask">
                <span className="ns-q">{tx('Post it on')}</span>
                <Days value={day} onChange={setDay} label={tx('Post it on')} min={shoot.day} />
              </div>
            </details>
            )}
          </>
        )}
        {picksColours && (
          <div className="ns-ask">
            <span className="ns-q">{tx('Colour')}<span className="ns-opt"> · {tx('optional')}</span></span>
            <span className="pc-filter" role="group" aria-label={tx('Colour')}>
              {[...Array(PALETTE)].map((_, i) => (
                <button key={i} type="button" className="pc-swatch" style={colorStyle(i)} aria-pressed={pc === i}
                  aria-label={tx('Colour {n}', { n: i + 1 })} onClick={() => setPc(pc === i ? null : i)} />
              ))}
            </span>
          </div>
        )}
        {admin && (
          <div className="ns-ask">
            <label className="ns-q" htmlFor="qt-for">{tx('Who is it for?')}</label>
            <select id="qt-for" className="select" value={forWhom} onChange={(e) => setForWhom(e.target.value)}>
              <option value="">{tx('Myself')}</option>
              {makers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        {err && <p className="ns-err" role="alert" ref={errRef}>{err}</p>}
      </div>
    </Modal>
  )
}

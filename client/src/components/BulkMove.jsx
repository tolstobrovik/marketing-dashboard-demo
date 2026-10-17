import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Check, AlertCircle, Loader2, ArrowRight } from 'lucide-react'
import Modal from './Modal.jsx'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import { TELEGRAM_TYPES } from '../lib/constants.js'

// ---- several tasks, one stage, one window ------------------------------------
//
// Moving one card asks its questions one at a time (StageGate). Moving twelve
// that way is twelve windows. So this is ONE: every task picked, what each
// still needs for the stage it is going to, and a box for exactly that beside
// it. A task that is short of something is red and stays where it is until
// the box is filled; the rest go on the press of one button.
//
// The rules are never guessed here. Each task is first put to the server as a
// dry run (`PATCH …?dry=1`) — every check a real save makes, nothing written —
// and whatever it refuses is what the row asks for. The refusal names its
// field, so the row can put the right box there: a script is a paragraph, a
// shoot day is a date, a filmer is a person.
//
// And EVERY box at once. A dry run lists every wall the move meets, not just
// the first (`missing`, content.js), so a reel short of a ТЗ, a shoot day and
// the hour shows three boxes on its row from the start — filled together and
// checked with one press — rather than one box, then the next, then the next.

const FIELD = {
  script: { kind: 'long', label: 'Script' },
  // Its own name, not the bare «ТЗ»: that phrase is the task sheet's, on
  // every channel board, and the Uzbek book spells this box TZ.
  tz: { kind: 'long', label: 'The brief (ТЗ)' },
  description: { kind: 'long', label: 'Description' },
  format: { kind: 'text', label: 'Format' },
  rubrika: { kind: 'text', label: 'Rubrika' },
  reference_text: { kind: 'text', label: 'Reference link', placeholder: 'https://…' },
  post_link: { kind: 'text', label: 'Published link', placeholder: 'https://instagram.com/p/…' },
  shot_link: { kind: 'text', label: 'Footage link', placeholder: 'https://drive.google.com/…', ask: 'Where is the footage? Paste the link — the editor starts from it' },
  ready_link: { kind: 'text', label: 'Link to the edit', placeholder: 'https://drive.google.com/…', ask: 'Where is the edit? Paste the link — the reviewer signs off from it' },
  recording_date: { kind: 'date', label: 'Shoot day' },
  edit_ready_date: { kind: 'date', label: 'Day the edit is due' },
  release_date: { kind: 'date', label: 'Release day' },
  recording_time: { kind: 'time', label: 'Shoot time' },
  operator_id: { kind: 'person', label: 'Who films it', hat: 'operator', ask: 'Who is shooting this?' },
  editor_id: { kind: 'person', label: 'Who edits it', hat: 'editor', ask: 'Who is editing this?' },
  reviewer_ids: { kind: 'person', label: 'Who reviews it', hat: 'reviewer', ask: 'Who is reviewing this?' },
  // A Telegram idea leaving the idea stage says what it is (the copywriter's
  // pay reads it) — one of three, so a list rather than a box to type in.
  telegram_type: { kind: 'choice', label: 'Telegram Item Type', options: TELEGRAM_TYPES },
  // No box for the OWNER. The wall that asks for one (a piece going out with
  // nobody's name on it) only ever stops somebody who may not name one: only
  // an admin reassigns a task (content.js, "Only admins can reassign tasks"),
  // and the admin walks through that wall. A picker there could only ever end
  // in a refusal, so the row says what is wrong and offers the task instead.
}
// The name a refusal gives its field, whichever way it gives it.
const fieldOf = (d = {}) => d.field || d.needs || d.needs_link || d.crew_field || null
// What goes on the wire for a filled box. Review is shared, so it is a list —
// of one, here, the same as the handover window sends when one is picked.
const wire = (field, v) => (field === 'reviewer_ids' ? [Number(v)]
  : field === 'operator_id' || field === 'editor_id' ? Number(v) : v)
// Who wears a hat: the crew roles are declared on the person, and review is a
// permission — signing work off is an SMM's job, not a craft (the same reading
// the handover's own candidate list makes on the server).
const holds = (u, hat) => (hat === 'reviewer'
  ? u.role === 'admin' || !!u.permissions?.review_publish
  : (u.crew_roles || []).includes(hat))

// The handover window's questions, asked here as well. The server's gates
// only ADVISE (content.js, `shortfalls` — worked out, never refused on), so a
// dry run says yes to a cut nobody attached. The board asks for the next pair
// of hands and the file on every single move (StageGate); a stack of twelve
// is not a way round a question one card is asked.
//
// Every one still unanswered, not the first, so the row carries a box for
// each. Two of that window's questions are left out, on purpose:
//   - the owner ('own'). Only an admin may name one, and an admin is asked
//     no handover questions at all (the server sends them none), so for
//     everybody this could ask, the answer would be a refusal.
//   - the late re-promise. A handover landing after its deadline wants a new
//     date for the next person, and when nobody names one the server writes
//     TODAY there itself (content.js, "The re-promise") — the day the work
//     actually reached them, with the missed deadline kept beside it. The
//     board's window lets somebody pick another day; a bulk move takes the
//     server's, which is why this window never asks for it.
const handoverGap = (gates = [], given = {}) => {
  const gaps = []
  // (Not read at all — `null` — asks nothing here: settle holds that row.)
  for (const g of gates || []) {
    if (g.key === 'own') continue
    const who = g.owner_field === 'reviewer_id' ? 'reviewer_ids' : g.owner_field
    if (!g.current?.length && given[who] === undefined) gaps.push(who)
    if (g.link_field && !g.link_ok && !/^https?:\/\/\S+$/i.test(String(given[g.link_field] || ''))) gaps.push(g.link_field)
  }
  return gaps
}

// What a refusal asks for, one entry per box. A dry run lists every wall the
// move meets (`missing`). A refusal from further up the save — a script that
// is only a link, a reference that points nowhere — names the one field it is
// about. A clash (a crew member already full that day, a link already on
// another task, a file the stage wants first) is not an empty box but a wrong
// answer in a full one, so it keeps the server's own sentence.
//
// …and so is every refusal of a field that HAS an answer: one just sent
// (`sent`, what this Check carried), or one the task already holds that the
// dry run says is wrong (`wrong` — a script that is only a Docs link, a
// published link that is not a link). "Needs «Script»" beside the script
// somebody has just typed tells them the one thing that is not true, and
// hides the thing that is: it is a twin, a link, a note. Only a field with
// nothing in it is asked for as empty.
const needsOf = (d = {}, message = '', sent = {}) => {
  const answered = (field, wrong) => !!wrong || (!!field && sent[field] !== undefined)
  if (Array.isArray(d.missing) && d.missing.length)
    return d.missing.map((m) => ({ field: m.field || null, error: m.error || message, how: answered(m.field, m.wrong) ? 'clash' : 'fill' }))
  const field = fieldOf(d)
  const clash = !!(d.crew_field || d.needs_link || d.twin) || answered(field)
  return [{ field, error: message, how: !field ? 'stop' : clash ? 'clash' : 'fill' }]
}
// One entry per field, the first to name it winning.
const byField = (list) => list.filter((n, i) => !n.field || list.findIndex((m) => m.field === n.field) === i)

export default function BulkMove({ items, stage, team = [], byKey = {}, statusesById = {}, onMoved, onOpen, onClose }) {
  const [rows, setRows] = useState(() => Object.fromEntries(items.map((t) => [t.id, { state: 'checking' }])))
  const [fixes, setFixes] = useState({})   // id → { field: value } already given
  // What is typed in each box, kept per task AND per field. A box refused
  // again keeps what was typed in it, to be mended rather than written again
  // from nothing — and a different box never inherits it.
  const [typing, setTyping] = useState({}) // `${id}:${field}` → the box's text
  const [moving, setMoving] = useState(false)
  // The handover's questions per task: fetched once, beside the first dry
  // run, and kept — a Check asks the server again, not the handover.
  const gatesRef = useRef({})
  // Everything moved while this window has been open, over every press of
  // Move — so it closes itself when the last red row goes too, not only when
  // one press happened to carry all of them.
  const movedRef = useRef(new Set())
  // The rows as last drawn, for the answers that arrive after a render.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const set = (id, patch) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }))
  // Drop what was typed for a task — all of it, or all but the boxes it still shows.
  const forget = (id, keep = []) => setTyping((x) => Object.fromEntries(Object.entries(x)
    .filter(([k]) => !k.startsWith(`${id}:`) || keep.includes(k.slice(String(id).length + 1)))))

  // Where a task stands once the server has answered: ready to go, or red
  // with a box for everything it still needs.
  const settle = (t, extra, refused, gates) => {
    // A handover that could not be read is not "no questions". The board's
    // own window stops right there (StageGate, `fatal`), and so does this
    // row: red, with nothing to fill in and a way to ask again — never ready
    // on a dry run alone, which says yes to a cut nobody attached. Where the
    // server refused as well, that refusal already holds the row, and the
    // Check that answers it asks the handover again.
    if (gates == null && !refused) {
      const said = tx('The handover could not be checked, so this one stays where it is')
      set(t.id, { state: 'blocked', error: said, needs: [{ field: null, error: said, how: 'retry' }] })
      return
    }
    const asked = handoverGap(gates, extra).map((field) => ({ field, error: tx(FIELD[field]?.ask || FIELD[field]?.label || field), how: 'ask' }))
    if (!refused && !asked.length) {
      set(t.id, { state: 'ok', error: '', needs: [] })
      forget(t.id)
      return
    }
    const told = refused ? needsOf(refused.data, refused.message, extra) : []
    const named = told.some((n) => n.field)
    const listed = Array.isArray(refused?.data?.missing)
    const flat = refused && !named && refused.status !== 400
    // A refusal from further up names only its own field: the walls below it
    // were never reached this time, so whatever they asked for before and has
    // not been answered since is still asked. One that names no field at all
    // (a 400 about the values as a whole) keeps every box it had, typing and
    // all, so the answer can be mended where it was given.
    const before = refused && !listed && !flat
      ? (rowsRef.current[t.id]?.needs || []).filter((n) => n.how !== 'ask' && FIELD[n.field] && (!named || extra[n.field] === undefined))
      : []
    // …and a flat no (not your step, not your channel) is not something a box
    // can answer, so the handover's questions are not put beside it either.
    const needs = byField([...told, ...before, ...(flat ? [] : asked)])
    set(t.id, { state: 'blocked', error: needs[0]?.error || refused?.message || '', needs })
    forget(t.id, needs.map((n) => n.field).filter(Boolean))
  }

  const ask = async (t, extra = {}) => {
    if (t.status_id === stage.id) { set(t.id, { state: 'already' }); return }
    set(t.id, { state: 'checking' })
    // A handover that cannot be read is not remembered at all — neither as
    // "no questions" nor as the failure — so the next ask fetches it again.
    // It answers `null`, which holds the row (settle).
    gatesRef.current[t.id] ??= api.get(`/content/${t.id}/handover?to=${stage.id}`)
      .then((d) => d.gates || [], () => { delete gatesRef.current[t.id]; return null })
    const [gates, refused] = await Promise.all([
      gatesRef.current[t.id],
      api.patch(`/content/${t.id}?dry=1`, { status_id: stage.id, ...extra }).then(() => null, (e) => e),
    ])
    settle(t, extra, refused, gates)
  }
  // Four at a time: a dozen tasks answer in a moment without a dozen requests
  // landing on the server in the same instant. Each task's handover is asked
  // inside the same four, beside its dry run.
  useEffect(() => {
    let alive = true
    const queue = [...items]
    const worker = async () => { while (alive && queue.length) await ask(queue.shift()) }
    Promise.all([worker(), worker(), worker(), worker()])
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const boxes = (r) => (r?.needs || []).filter((n) => FIELD[n.field])
  const typed = (t, field) => String(typing[`${t.id}:${field}`] ?? '').trim()
  // Every box on the row that has something in it goes up together, so three
  // answers are one Check, not three.
  const check = (t) => {
    const filled = {}
    for (const n of boxes(rows[t.id])) {
      const v = typed(t, n.field)
      if (v) filled[n.field] = wire(n.field, v)
    }
    if (!Object.keys(filled).length) return
    const next = { ...(fixes[t.id] || {}), ...filled }
    setFixes((f) => ({ ...f, [t.id]: next }))
    ask(t, next)
  }

  const ready = items.filter((t) => rows[t.id]?.state === 'ok')
  const blocked = items.filter((t) => rows[t.id]?.state === 'blocked')
  const checking = items.some((t) => rows[t.id]?.state === 'checking')

  const moveAll = async () => {
    if (!ready.length || moving) return
    setMoving(true)
    let moved = 0
    for (const t of ready) {
      set(t.id, { state: 'moving' })
      try {
        const c = await api.patch(`/content/${t.id}`, { status_id: stage.id, ...(fixes[t.id] || {}) })
        set(t.id, { state: 'moved' })
        movedRef.current.add(t.id)
        onMoved?.(c)
        moved++
      } catch (e) {
        // The server had the last word and it was no — said on the row.
        settle(t, fixes[t.id] || {}, e, await gatesRef.current[t.id])
      }
    }
    setMoving(false)
    if (moved) toast(tx('{n} moved to «{stage}»', { n: moved, stage: stage.label }), 'ok')
    if (items.every((t) => t.status_id === stage.id || movedRef.current.has(t.id))) onClose(true)
  }

  const people = useMemo(() => team.filter((u) => u.role !== 'ambassador'), [team])
  // The reason above a box. An empty box says what it needs in the reader's
  // language, with the server's own sentence kept as its tip; a question from
  // the handover is asked the way the handover window asks it; and a clash —
  // any box that already had an answer (needsOf) — is said in the server's
  // words, on the row where it can be read, because it is about the answer,
  // not the box.
  const why = (n) => (n.how === 'fill' ? tx('Needs «{what}» before it can move', { what: tx(FIELD[n.field].label) }) : n.error)
  const box = (t, field, last) => {
    const f = FIELD[field]
    const v = typing[`${t.id}:${field}`] ?? ''
    const on = (val) => setTyping((x) => ({ ...x, [`${t.id}:${field}`]: val }))
    const key = (e) => { if (e.key === 'Enter' && (f.kind !== 'long' || e.ctrlKey || e.metaKey)) { e.preventDefault(); check(t) } }
    const common = { className: 'input bm-input', value: v, disabled: moving, 'aria-label': tx(f.label), onKeyDown: key }
    let input
    if (f.kind === 'long') input = <textarea {...common} rows={2} placeholder={tx(f.label)} onChange={(e) => on(e.target.value)} />
    else if (f.kind === 'date') input = <input {...common} type="date" onChange={(e) => on(e.target.value)} />
    else if (f.kind === 'time') input = <input {...common} type="time" step={1800} onChange={(e) => on(e.target.value)} />
    else if (f.kind === 'person') {
      const list = f.hat ? [...people].sort((a, b) => Number(holds(b, f.hat)) - Number(holds(a, f.hat))) : people
      input = (
        <select {...common} className="select bm-input" onChange={(e) => on(e.target.value)}>
          <option value="">{tx(f.label)}…</option>
          {list.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )
    } else if (f.kind === 'choice') {
      input = (
        <select {...common} className="select bm-input" onChange={(e) => on(e.target.value)}>
          <option value="">{tx(f.label)}…</option>
          {f.options.map((o) => <option key={o.key} value={o.key}>{tx(o.label)}</option>)}
        </select>
      )
    } else input = <input {...common} placeholder={f.placeholder || tx(f.label)} onChange={(e) => on(e.target.value)} />
    // One Check for the whole row, on its last box.
    const any = boxes(rows[t.id]).some((n) => typed(t, n.field))
    return (
      <div className="bm-fix">
        {input}
        {last && <button type="button" className="btn btn-sm" disabled={moving || !any} onClick={() => check(t)}>{tx('Check')}</button>}
      </div>
    )
  }

  return (
    <Modal title={tx('Move {n} to «{stage}»', { n: items.length, stage: stage.label })} onClose={moving ? () => {} : onClose}
      footer={(
        <>
          <span className="stat-sub bm-sum">
            {checking ? tx('Checking each task…')
              : blocked.length ? tx('{ok} ready · {bad} need something first', { ok: ready.length, bad: blocked.length })
                : tx('{ok} ready', { ok: ready.length })}
          </span>
          <span className="foot-gap" />
          <button type="button" className="btn" onClick={onClose} disabled={moving}>{tx('Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={moveAll} disabled={moving || checking || !ready.length}>
            <ArrowRight size={15} /> {moving ? tx('Moving…') : tx('Move {n}', { n: ready.length })}
          </button>
        </>
      )}>
      <ul className="bm-list">
        {items.map((t) => {
          const r = rows[t.id] || {}
          const from = statusesById[t.status_id]
          const fixable = boxes(r)
          const stuck = (r.needs || []).filter((n) => !FIELD[n.field])
          const retry = stuck.some((n) => n.how === 'retry')
          return (
            <li key={t.id} className={'bm-row ' + r.state}>
              <span className="bm-mark" aria-hidden="true">
                {r.state === 'checking' || r.state === 'moving' ? <Loader2 size={15} className="spin" />
                  : r.state === 'blocked' ? <AlertCircle size={15} /> : <Check size={15} />}
              </span>
              <div className="bm-body">
                <div className="bm-top">
                  <button type="button" className="bm-title" onClick={() => onOpen?.(t)}>{t.title}</button>
                  <span className="stat-sub">
                    {(t.channels || []).map((k) => byKey[k]?.label || k).join(' · ')}
                    {from ? ` · ${from.label}` : ''}
                  </span>
                </div>
                {r.state === 'already' && <span className="stat-sub">{tx('Already there')}</span>}
                {r.state === 'moved' && <span className="bm-ok">{tx('Moved')}</span>}
                {r.state === 'blocked' && (
                  <>
                    {/* What no box here can answer, in the server's words. */}
                    {(stuck.length ? stuck : fixable.length ? [] : [{ error: r.error }]).map((n, i) => (
                      <span key={`stuck-${i}`} className="bm-why">{n.error}</span>
                    ))}
                    {fixable.map((n, i) => (
                      <Fragment key={n.field}>
                        <span className="bm-why" title={n.how === 'fill' ? n.error : undefined}>{why(n)}</span>
                        {box(t, n.field, i === fixable.length - 1)}
                      </Fragment>
                    ))}
                    {retry ? (
                      <button type="button" className="tb-link" disabled={moving} onClick={() => ask(t, fixes[t.id] || {})}>{tx('Try again')}</button>
                    ) : (stuck.length > 0 || !fixable.length) && (
                      <button type="button" className="tb-link" onClick={() => onOpen?.(t)}>{tx('Open the task to fix it')}</button>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}

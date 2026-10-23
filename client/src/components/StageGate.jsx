import { useEffect, useState } from 'react'
import { AlertTriangle, Video, Scissors, Eye, Link2, CalendarClock, Check } from 'lucide-react'
import { api } from '../lib/api.js'
import Modal from './Modal.jsx'
import { useClash } from './ClashDialog.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// The handover window.
//
// It opens on the move itself, not after a refusal: moving work on is the
// moment you decide who is taking it, so that is when the question gets asked.
// The server says which gates the move crosses and who is eligible for each —
// the editing stage offers editors, review offers the people who sign work
// off — and this walks them one at a time. The rules are never duplicated
// here; a refusal the client failed to predict still reopens on the right step.

const ICON = { operator: Video, editor: Scissors, reviewer: Eye }
const ASK = {
  operator: { title: 'Who is shooting this?', hint: 'The shooter owns the shooting deadline from here on.' },
  editor: { title: 'Who is editing this?', hint: 'Handing it over makes the editor responsible for the editing deadline.' },
  reviewer: { title: 'Who is reviewing this?', hint: 'Everyone picked answers for the review deadline.' },
}

// Pre-fill what the task already knows, so a handover decided in advance is
// one confirmation rather than a re-interrogation.
const prefill = (gates) => {
  const pre = {}
  for (const g of gates || []) if (g.current?.length) pre[g.owner_field] = g.many ? g.current : g.current[0]
  return pre
}

export default function StageGate({ item, statusId, statusLabel, initialGates = null, onDone, onCancel }) {
  const [gates, setGates] = useState(initialGates)
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(() => prefill(initialGates))
  const [busy, setBusy] = useState(false)
  const [fatal, setFatal] = useState('')
  // The published link is asked for HERE rather than ending the move, for the
  // same reason finish.js opens the task on that box: the thing being asked
  // for and the place to answer it belong on one screen. Landing on the final
  // stage was the one refusal this window had no answer to — it fell through
  // to `fatal`, which is a dead end with the sentence "paste the link" on it
  // and nowhere to paste one.
  const [needLink, setNeedLink] = useState('')
  // A move that books the operator over another shoot (the gate can set who
  // films and when) is asked about in the booking window. While it is up this
  // window draws nothing else — and in particular does not re-run the move,
  // which the no-gates path below does on every render. "Pick another time"
  // abandons the move; "Book anyway" makes it with force.
  const [clashUi, askClash] = useClash()
  const [clashing, setClashing] = useState(false)
  const [link, setLink] = useState(() => String(item?.post_link || '').trim())

  useEffect(() => {
    if (initialGates) return // the board already asked on our behalf
    let alive = true
    api.get(`/content/${item.id}/handover?to=${statusId}`)
      .then((d) => {
        if (!alive) return
        setGates(d.gates || [])
        setDraft(prefill(d.gates))
      })
      .catch((e) => alive && setFatal(e.message))
    return () => { alive = false }
  }, [item.id, statusId]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (extra = {}) => {
    setBusy(true)
    try {
      const body = { status_id: statusId, ...draft, ...extra }
      // reviewer_id is a list on the wire when review is shared.
      if (Array.isArray(body.reviewer_id)) { body.reviewer_ids = body.reviewer_id; delete body.reviewer_id }
      onDone(await api.patch(`/content/${item.id}`, body))
    } catch (e) {
      // The final stage wants the address of a thing that already exists. It
      // is not a handover, so it is not one of the gates — it gets its own
      // step, and a rejected link (`needs` comes back on that refusal too)
      // stays on it with the server's own sentence above the box.
      if (e.data?.needs === 'post_link') { setNeedLink(e.message); return }
      if (askClash(e, () => submit({ ...extra, force: true }), onCancel)) { setClashing(true); return }
      // The server had one more condition than we predicted — reopen on it.
      // Only a refusal that NAMES a field reopens a step: an unnamed one
      // matched any gate with no late clock (undefined === undefined) and
      // sent the window round again on a refusal no step can answer.
      const miss = e.data?.missing
      const i = miss ? (gates || []).findIndex((g) => g.owner_field === miss || g.link_field === miss || g.late?.revise_field === miss) : -1
      if (i >= 0) setStep(i)
      else setFatal(e.message)
    } finally { setBusy(false) }
  }

  if (needLink) {
    // Non-empty is the whole test. What counts as a link is the server's
    // question and deliberately a broad one — server/text.js takes a bare
    // domain because that is how half of them arrive — and a stricter rule
    // here would grey out the button on an address the server would have
    // taken, which is the dead end this window exists to remove. A refusal
    // comes back carrying `needs` and lands on this same box with the
    // server's own sentence above it, so nothing is lost by asking.
    const good = link.trim().length > 0
    return (
      <Modal title={`Moving to «${statusLabel}»`} onClose={busy ? () => {} : onCancel}>
        <div className="gate">
          <div className="gate-head">
            <Link2 size={18} />
            <div>
              <div className="gate-title">{needLink}</div>
              <div className="gate-hint">{tx('This is the address every report reads.')}</div>
            </div>
          </div>
          <label className="gate-link">
            <input className="input" placeholder={'https://instagram.com/p/…'} disabled={busy} autoFocus
              value={link} onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && good && !busy) submit({ post_link: link.trim() }) }} />
          </label>
          <div className="gate-foot">
            <button type="button" className="btn btn-primary" disabled={busy || !good}
              onClick={() => submit({ post_link: link.trim() })}>
              {busy ? 'Moving…' : <> <Check size={15} />{' '}{tx('Paste the link and finish')}</>}
            </button>
          </div>
        </div>
      </Modal>
    )
  }
  if (clashing && !fatal) return clashUi
  if (fatal) {
    return (
      <Modal title={tx("This move can’t be made")} onClose={onCancel}>
        <p className="gate-fatal"><AlertTriangle size={16} /> {fatal}</p>
      </Modal>
    )
  }
  if (!gates) {
    return <Modal title={`Moving to «${statusLabel}»`} onClose={onCancel}><p className="muted">{tx("Checking the handover…")}</p></Modal>
  }
  if (gates.length === 0) { submit(); return <Modal title={`Moving to «${statusLabel}»`} onClose={() => {}}><p className="muted">{tx("Moving…")}</p></Modal> }

  const g = gates[Math.min(step, gates.length - 1)]
  const Icon = ICON[g.role] || Eye
  const ask = ASK[g.role] || {}
  const picked = draft[g.owner_field]
  const chosen = g.many ? (Array.isArray(picked) ? picked : []) : (picked ? [picked] : [])
  const last = step >= gates.length - 1

  const advance = (over = {}) => {
    if (last) submit(over)
    else { setDraft((d) => ({ ...d, ...over })); setStep(step + 1) }
  }

  return (
    <Modal title={`Moving to «${statusLabel}»`} onClose={busy ? () => {} : onCancel}>
      <div className="gate">
        {gates.length > 1 && (
          <div className="gate-steps">
            {gates.map((x, i) => (
              <span key={x.key} className={'gate-step' + (i === step ? ' on' : i < step ? ' done' : '')}>{x.stage}</span>
            ))}
          </div>
        )}

        <div className="gate-head">
          <Icon size={18} />
          <div>
            <div className="gate-title">{ask.title}</div>
            <div className="gate-hint">{ask.hint}</div>
          </div>
        </div>

        <People gate={g} chosen={chosen} disabled={busy}
          onPick={(id) => {
            if (g.many) {
              const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]
              setDraft((d) => ({ ...d, [g.owner_field]: next }))
            } else {
              setDraft((d) => ({ ...d, [g.owner_field]: id }))
            }
          }} />

        {g.link_field && !g.link_ok && (
          <LinkAsk what={g.what_link} value={draft[g.link_field] || ''} busy={busy}
            onChange={(v) => setDraft((d) => ({ ...d, [g.link_field]: v }))} />
        )}

        {g.late && !g.late.already && (
          <div className="gate-late-box">
            <p className="gate-late">
              <AlertTriangle size={14} /> {tx('Handed over late — this was due')} <b>{g.late.was_due}</b>.
              Give the next person a date they can actually meet; the original stays on the task.
            </p>
            <label className="gate-date">
              <CalendarClock size={15} />
              <input className="input" type="date" value={draft[g.late.revise_field] || ''}
                onChange={(e) => setDraft((d) => ({ ...d, [g.late.revise_field]: e.target.value }))} />
            </label>
          </div>
        )}

        <div className="gate-foot">
          {step > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep(step - 1)}>{tx("Back")}</button>}
          <button type="button" className="btn btn-primary" disabled={busy || !ready(g, draft, chosen)}
            onClick={() => advance()}>
            {busy ? 'Moving…' : last ? <> <Check size={15} />{' '}{tx("Hand over and move")}</> : 'Next'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Everything this step insists on before it will let the move continue.
function ready(g, draft, chosen) {
  if (chosen.length === 0) return false
  if (g.link_field && !g.link_ok && !/^https?:\/\/\S+$/i.test(String(draft[g.link_field] || '').trim())) return false
  if (g.late && !g.late.already && !draft[g.late.revise_field]) return false
  return true
}

function People({ gate, chosen, disabled, onPick }) {
  const [all, setAll] = useState(false)
  const list = all ? [...gate.candidates, ...gate.others] : gate.candidates
  return (
    <>
      <div className="gate-people">
        {list.map((u) => (
          <button key={u.id} type="button" disabled={disabled}
            className={'gate-person' + (chosen.includes(u.id) ? ' on' : '')}
            onClick={() => onPick(u.id)}>
            <span className="gate-dot" style={{ background: u.color || '#A22036' }} />
            {u.name}
            {u.position && <span className="muted"> · {u.position}</span>}
            {chosen.includes(u.id) && <Check size={14} className="gate-tick" />}
          </button>
        ))}
        {list.length === 0 && (
          <p className="muted">Nobody carries the {gate.role} role yet.</p>
        )}
      </div>
      {!all && gate.others.length > 0 && (
        <button type="button" className="gate-more" onClick={() => setAll(true)}>
          Somebody else this time — show the rest of the team
        </button>
      )}
    </>
  )
}

function LinkAsk({ what, value, busy, onChange }) {
  return (
    <label className="gate-link">
      <span className="gate-hint"><Link2 size={13} /> Where is {what}? Upload it and paste the link.</span>
      <input className="input" placeholder={'https://drive.google.com/…'} disabled={busy}
        value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

import { useRef, useState } from 'react'
import { CalendarRange, FolderOpen, ExternalLink, Link2, ImageIcon, Palette, RotateCcw } from 'lucide-react'
import { dateLabel, typeInfo } from '../lib/constants.js'
import { tr as tx } from '../lib/i18n.jsx'
import { useIsPhone } from '../lib/usePhone.js'
import Avatar from './Avatar.jsx'
import Zoom from './Zoom.jsx'
import AssetThumb from './AssetThumb.jsx'

// The design board: one column per DESIGN stage, drag a card to move it.
//
// The same kanban as the content board, over a different set of columns and
// with none of its walls. Nothing here is a handover — artwork is one person's
// from brief to hand-back — so a move is just somebody saying where their own
// work stands, and the server guards it with canTouch alone.
//
// A card with no design stage yet stands in the FIRST column. Work arrives on
// this board by being handed to a designer, not by anyone remembering to file
// it, so "never sorted" and "new" are the same thing and the board says so
// rather than hiding the card.
//
// On a phone the columns become buttons and one column's cards a list — and
// each card carries its own stage picker. A phone cannot drag, and the task
// sheet moves the CONTENT stage, not this one; without the picker a designer
// on a phone could see where their work stood and never say it had moved.

export default function DesignBoard({
  items, stages, teamById, today, onMove, onOpen, folderOf, artOf, dueOf, briefedOf, isBusy, onHandIn,
}) {
  // Ref = the truth for the drop (a fast drop must not read stale state);
  // state only drives the dimming. Same reasoning as ContentBoard.
  const dragRef = useRef(null)
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const phone = useIsPhone()
  const [phoneStage, setPhoneStage] = useState(null)

  const firstId = stages[0]?.id ?? null
  const columnOf = (t) => (t.design_status_id == null ? firstId : t.design_status_id)

  const drop = (stageId) => {
    const item = items.find((i) => i.id === dragRef.current)
    if (item && columnOf(item) !== stageId) onMove(item, stageId)
    dragRef.current = null
    setDragId(null)
    setOverCol(null)
  }

  // One card, drawn the same in both layouts. The desk drags it; the phone
  // gives it a picker instead.
  const card = (t) => {
    const due = dueOf(t)
    const late = due && due < today && !t.done_at && !t.ready_at // handed in is not late
    const folder = folderOf(t)
    const art = artOf(t)
    const d = teamById[t.designer_id]
    // A round sent back to the designer is the one thing on the card that is
    // owed right now.
    const fixing = t.open_round && t.open_for === 'designer'
    // The designer's own card hands in from where it is (onHandIn decides
    // whose that is); everybody else opens the task.
    const handIn = () => (onHandIn ? onHandIn(t) : onOpen(t))
    return (
      <div
        key={t.id}
        className={`tcard${dragId === t.id ? ' dim' : ''}${late ? ' dz-late' : ''}${isBusy?.(t.id) ? ' tcard-busy' : ''}`}
        draggable={!phone}
        onDragStart={(e) => {
          dragRef.current = t.id
          setDragId(t.id)
          // Firefox refuses to start a drag without transfer data.
          try { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
        }}
        onDragEnd={() => { dragRef.current = null; setDragId(null); setOverCol(null) }}
        onClick={() => onOpen(t)}
      >
        {/* The artwork once it is back; until then the reference it is drawn from. */}
        {t.design_link
          ? <AssetThumb link={t.design_link} title={t.title} />
          : (t.photo_thumb || t.photo) && (
            <Zoom className="tcard-photo" src={t.photo_thumb || t.photo} full={t.photo || t.photo_thumb} alt={t.title} />
          )}
        <div className="tcard-title">{t.title}</div>
        <div className="tcard-badges">
          {fixing && (
            <span className="chip chip-danger"><RotateCcw size={10} /> {tx('Round {n} · to fix', { n: t.open_round })}</span>
          )}
          <span className={`chip ct-${t.type}`}>{typeInfo(t.type).label}</span>
          {/* The one state the old board had that a column cannot
              replace: a piece with no reference and no ТЗ cannot be
              started, whichever column somebody has dragged it to. */}
          {!briefedOf(t) && (
            <span className="chip chip-muted" data-tip={tx('No reference and no ТЗ yet — there is nothing to design from')}>
              <ImageIcon size={10} /> {tx('no brief')}
            </span>
          )}
          {due
            ? <span className={'chip chip-muted' + (late ? ' chip-late' : '')}><CalendarRange size={10} /> {dateLabel(due)}</span>
            : <span className="chip chip-muted">{tx('no day set')}</span>}
          {d
            ? (
              <span className="chip chip-muted" data-tip={tx('Designer — draws it')}>
                <Avatar name={d.name} color={d.color} src={d.avatar} size="xs" /> {d.name.split(' ')[0]}
              </span>
            )
            : <span className="chip chip-muted"><Palette size={10} /> {tx('nobody yet')}</span>}
        </div>
        {/* Drive is the workspace and the board admits it: the
            folder the files live in is one press from the card,
            and the finished artwork comes back as a link on it. */}
        <div className="dz-card-links" onClick={(e) => e.stopPropagation()}>
          {folder && (
            <a className="btn btn-sm" href={folder} target="_blank" rel="noreferrer"
              data-tip={tx('The channel’s shared Drive folder')}>
              <FolderOpen size={12} /> {tx('Folder')}
            </a>
          )}
          {art && (
            <a className="btn btn-sm btn-ok" href={art} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> {tx('Open asset')}
            </a>
          )}
          {(!art || fixing) && (
            <button type="button" className="btn btn-sm btn-primary" onClick={handIn}>
              <Link2 size={12} /> {tx(fixing ? 'Hand in the fix' : 'Hand it back')}
            </button>
          )}
          {/* Labelled, because a stage can be called anything — the first
              one ships as «New task», and a bare picker reading "New task"
              on every card reads as a button that makes one. */}
          {phone && (
            <label className="dsp-move-wrap">
              <span>{tx('Stage')}</span>
              <select className="select dsp-move" value={columnOf(t) ?? ''}
                onChange={(e) => { const to = Number(e.target.value); if (to !== columnOf(t)) onMove(t, to) }}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    )
  }

  if (phone) {
    const cols = stages.map((s) => ({ s, list: items.filter((t) => columnOf(t) === s.id) }))
    // Open on the first stage with work in it; an empty first column is the
    // screen this replaces.
    const shown = cols.find((c) => c.s.id === phoneStage) || cols.find((c) => c.list.length) || cols[0]
    if (!shown) return null
    return (
      <div className="dsp">
        <div className="dsp-stages" role="tablist">
          {cols.map(({ s, list }) => (
            <button key={s.id} type="button" role="tab" aria-selected={shown.s.id === s.id}
              className={'dsp-stage' + (shown.s.id === s.id ? ' on' : '') + (list.length === 0 ? ' empty' : '')}
              onClick={() => setPhoneStage(s.id)}>
              <span className="status-dot" style={{ background: s.color }} />
              {s.label}
              <b>{list.length}</b>
            </button>
          ))}
        </div>
        <div className="dsp-list">
          {shown.list.map(card)}
          {shown.list.length === 0 && <div className="dsp-empty">—</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="board design-board">
      {stages.map((s) => {
        const list = items.filter((t) => columnOf(t) === s.id)
        return (
          <div
            key={s.id}
            className={`board-col${overCol === s.id ? ' over' : ''}`}
            style={{ borderTop: `3px solid ${s.color}`, background: `color-mix(in srgb, ${s.color} 6%, transparent)` }}
            onDragOver={(e) => { e.preventDefault(); setOverCol(s.id) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol((c) => (c === s.id ? null : c)) }}
            onDrop={() => drop(s.id)}
          >
            <div className="board-col-head">
              <span className="status-dot" style={{ background: s.color }} />
              {s.label}
              <span className="count">{list.length}</span>
            </div>
            <div className="board-col-body">
              {list.map(card)}
              {list.length === 0 && <div className="board-empty">{tx('Drop here')}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

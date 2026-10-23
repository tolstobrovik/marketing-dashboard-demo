import { useRef, useState } from 'react'
import { WAIT_WORDS } from '../lib/nextStep.js'
import { Clapperboard, Send, CheckSquare, Megaphone, Plus, MessageSquare, ArrowRight, MoreHorizontal } from 'lucide-react'
import { dateLabel, dayWord, tashkentDay, typeInfo, isDeletedLabel, todayISO } from '../lib/constants.js'
import { DayChip, LaneHead, stageClass, stageKeyOf } from './CoachBits.jsx'
import { useChannels } from '../lib/channels.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import { ownersOf } from '../lib/coach.js'
import { isCarried } from '../lib/planMonth.js'
import { useIsPhone } from '../lib/usePhone.js'
import Zoom from './Zoom.jsx'
import Avatar from './Avatar.jsx'
import PostPreview from './PostPreview.jsx'
import { useAuth } from '../lib/auth.jsx'
import { usePieceColors, colorStyle } from '../lib/pieceColor.js'

// Simple kanban: one column per pipeline stage, drag a card to move it.
// Dragging into the final stage completes the task and fills its plan.
// The stage that belongs to YOUR craft is tinted and labelled — an operator
// walks in and sees the shooting column, an editor the editing one, without
// reading six headings first.
// With onMenu, a card answers a right-click the way the To-Do page's rows used
// to before that page was removed: open it, tick it off, copy it, bin it.
// With onQuickAdd, every working column grows a foot "+ Add": it opens the
// new-task form for that column — "Save as draft" on its first screen is the
// one-line add it used to be, and Next asks the rest the work needs.
//
// On a phone the columns become buttons. Six columns side by side are six
// screen-widths to swipe through, each opening on whichever stage comes first
// — usually an empty Idea column saying "Drop here" to a thumb that cannot
// drag. So a phone gets the stages as a row of buttons with their counts, and
// one stage's cards as a plain list. A card is moved by opening it, which is
// where a phone changes anything.
export default function ContentBoard({ items, statuses, absorb = {}, ideaIds = [], dept, canMove, onMove, onOpen, onMenu, onQuickAdd, campaignsById = {}, teamById = {}, myStages = [], isBusy,
  // The simple look (lib/look.js): a card is its title, one grey line and the
  // piece's next step — `stepOf` says what that is, `onStep` takes it.
  simple = false, stepOf = null, onStep = null,
  // Round 8: `pipe` names each lane's stage for its tile; `laterOf` says what a
  // piece still has to be given (lib/coach.js addLater) — a quiet "2 to add".
  pipe = null, laterOf = null }) {
  // A board may show fewer columns than the pipeline has stages — a written
  // channel runs on three. `absorb` says which stage each hidden one is shown
  // under, so a task in a stage this board does not draw sits in the column
  // that covers it instead of falling off the board. Dropping a card still
  // writes the column's OWN stage, so a move is never a surprise.
  const columnOf = (statusId) => absorb[statusId] ?? statusId
  // An idea is a thought nobody has promised anything about, so anybody who
  // can see it may shove it along — no move_tasks, no waiting on the person
  // whose name happens to be on it. The server says the same (content.js,
  // `wasAnIdea`); this is only the board agreeing, so the card is draggable
  // rather than looking broken until the drop is refused.
  const openStages = new Set(ideaIds)
  const canDrag = (item) => canMove || openStages.has(item.status_id)
  // …which means a column has to accept a drop whenever ANY card could be
  // dragged into it, not only when this person may move everything.
  const dropOpen = canMove || openStages.size > 0
  const { byKey } = useChannels()
  // Ref = source of truth for the drop (a fast drop must never read a stale
  // state value); state only drives the dimmed styling.
  const dragRef = useRef(null)
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const phone = useIsPhone()
  const [phoneStage, setPhoneStage] = useState(null)
  const meId = useAuth().user?.id
  // The makers' colours (r11), and the row of plain swatches above the board
  // that shows one colour's pieces at a time. No names: a colour means what
  // its maker decided.
  const colorOf = usePieceColors()

  // The stage after this one, for the arrow on a card. Dragging is still there
  // for anybody who likes it; nobody has to be able to do it any more. Moving
  // a card on is the commonest thing done to one (the stage was changed 169
  // times on last month's new tasks) and a drag is the hardest gesture there
  // is on a trackpad, on a tablet, and for anybody who has never seen a
  // kanban board — so it is one press, through exactly the same door a drop
  // goes through (the handover questions included).
  const order = statuses.filter((st) => !isDeletedLabel(st.label))
  const nextOf = (item) => {
    const at = order.findIndex((st) => st.id === columnOf(item.status_id))
    return at >= 0 ? order[at + 1] || null : null
  }

  const drop = (statusId) => {
    const item = items.find((i) => i.id === dragRef.current)
    // Compare the COLUMN, not the stage: a card absorbed into a column has not
    // moved when it is dropped back on the column it was already sitting in.
    if (item && canDrag(item) && columnOf(item.status_id) !== statusId) onMove(item, statusId)
    dragRef.current = null
    setDragId(null)
    setOverCol(null)
  }

  // One card, drawn the same in both layouts. Only the desk drags.
  const card = (item) => {
    const checks = item.checklist || []
    const done = checks.filter((c) => c.done).length
    const others = item.channels.filter((c) => c !== dept)
    if (simple) {
      const step = stepOf?.(item) || null
      const who = (id) => teamById[id]?.name?.split(' ')[0] || ''
      // The day the card is working to: its shoot until it is filmed, then the
      // day it goes out; once out, the day it went.
      const filming = !!item.recording_date && !item.shot_at && !item.done_at
      const day = item.done_at ? tashkentDay(item.done_at) : filming ? item.recording_date : item.release_date
      const later = laterOf?.(item) || []
      // Footage in, and the piece still on the shoot stage: it is filmed, and
      // sending it on is its owner's move. Round 11: the card says so to
      // everybody — to all but its owner it used to look like a shoot still
      // to come, "waiting for the edit" from an editor nobody had named.
      const filmed = !!item.shot_at && !item.open_round && !!pipe && pipe.live[pipe.shoot]?.id === item.status_id
      const held = filmed && !!step?.to
      // Still open from an earlier month's plan: drawn in that month's colour,
      // so it never reads as this month's work (lib/planMonth.js).
      const carried = isCarried(item, todayISO())
      // The maker's colour for it (r11): a dot by the title; the card stays white.
      const pc = colorOf(item)
      return (
        <div
          key={item.id}
          data-task={item.id}
          className={`tcard tcard-simple${carried ? ' tcard-carried' : ''}${dragId === item.id ? ' dim' : ''}${isBusy?.(item.id) ? ' tcard-busy' : ''}`}
          onContextMenu={onMenu ? (e) => onMenu(e, item) : undefined}
          draggable={!phone && canDrag(item)}
          onDragStart={(e) => {
            dragRef.current = item.id
            setDragId(item.id)
            try { e.dataTransfer.setData('text/plain', String(item.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
          }}
          onDragEnd={() => { dragRef.current = null; setDragId(null); setOverCol(null) }}
          onClick={() => onOpen(item)}
        >
          <div className="tcard-top">
            <div className="tcard-title">{pc != null && <i className="pc-dot" style={colorStyle(pc)} aria-hidden="true" />}{item.title}</div>
            {onMenu && (
              <button type="button" className="co-btn co-btn-i tcard-dots" data-notrack aria-label={tx('More for this task')}
                onClick={(e) => { e.stopPropagation(); onMenu(e, item) }}><MoreHorizontal size={16} aria-hidden="true" /></button>
            )}
          </div>
          <div className="tcard-line tcard-facts">
            {day && <DayChip day={day} today={todayISO()} done={!!item.done_at} />}
            {filming && item.recording_time && <span>{item.recording_time.slice(0, 5)}</span>}
          </div>
          {(filmed || later.length > 0) && (
            <span className="co-tag tcard-add">{held ? tx('Filmed — send it to editing')
              : filmed ? tx('Filmed. Waiting: {name}', { name: who(ownersOf(item)[0]) || tx('The team') })
                : tx('{n} to add', { n: later.length })}</span>
          )}
          {/* Out already: what went out, to watch here (the owner, 13 Oct). */}
          {item.done_at && <PostPreview item={item} />}
          {/* Who holds it now, as a face and a name (r11, the report's
              "stage and owner on every task"): yours when the next step is
              yours, else whoever the piece is waiting on. */}
          {(() => {
            // Only who it waits on: a card whose button is yours says so with the button.
            const holder = step?.wait && !filmed ? step.who : null
            const person = holder && teamById[holder]
            if (!person) return null
            return (
              <div className="tcard-line tcard-holder">
                <Avatar name={person.name} color={person.color} src={person.avatar} size="xs" />
                <span>{holder === meId ? tx('You') : who(holder)}{step?.wait ? ` · ${tx(WAIT_WORDS[step.wait])}` : ''}</span>
              </div>
            )
          })()}
          {/* Tonal, not ruby: on a board full of these, ruby has to keep meaning
              "late" (r11) — except Publish on a Ready card, the board's finish
              line and its one ruby button (S-03). */}
          {step?.to && onStep && (
            <button type="button" className={'co-btn tcard-step ' + (step.verb === 'Publish' ? 'co-btn-p' : 'co-btn-o')} data-notrack
              onClick={(e) => { e.stopPropagation(); onStep(item, step) }}>{tx(step.verb)}<ArrowRight size={16} aria-hidden="true" /></button>
          )}
        </div>
      )
    }
    return (
      <div
        key={item.id}
        className={`tcard${dragId === item.id ? ' dim' : ''}${isBusy?.(item.id) ? ' tcard-busy' : ''}`}
        onContextMenu={onMenu ? (e) => onMenu(e, item) : undefined}
        draggable={!phone && canDrag(item)}
        onDragStart={(e) => {
          dragRef.current = item.id
          setDragId(item.id)
          // Firefox refuses to start a drag without transfer data.
          try { e.dataTransfer.setData('text/plain', String(item.id)); e.dataTransfer.effectAllowed = 'move' } catch { /* ok */ }
        }}
        onDragEnd={() => { dragRef.current = null; setDragId(null); setOverCol(null) }}
        onClick={() => onOpen(item)}
      >
        {(item.photo_thumb || item.photo) && <Zoom className="tcard-photo" src={item.photo_thumb || item.photo} full={item.photo || item.photo_thumb} alt={item.title} />}
        <div className="tcard-title">{item.title}</div>
        {/* One row: what it is, when, and anything worth a glance; then the
            people as faces. The card used to carry a chip per hat — a card
            could read "Mirabbos · Mirabbos · Mirabbos" — and two date chips
            that often said the same day twice. */}
        <div className="tcard-foot">
          <div className="tcard-badges">
            <span className={`chip ct-${item.type}`}>{tx(typeInfo(item.type).label)}</span>
            {(() => {
              const rec = item.recording_date
              const rel = item.release_date
              if (rec && rel && rec === rel) {
                return <span className="chip chip-muted" data-tip={tx('Filmed and out on the same day')}><Clapperboard size={10} /><Send size={10} /> {dateLabel(rel)}</span>
              }
              return (
                <>
                  {rec && <span className="chip chip-muted" data-tip={tx('Shoot day')}><Clapperboard size={10} /> {dateLabel(rec)}</span>}
                  {rel && <span className="chip chip-muted" data-tip={tx('Goes out')}><Send size={10} /> {dateLabel(rel)}</span>}
                </>
              )
            })()}
            {item.campaign_id && campaignsById[item.campaign_id] && (
              <span className="chip chip-camp"><Megaphone size={10} /> {campaignsById[item.campaign_id].name}</span>
            )}
            {checks.length > 0 && (
              <span className="chip chip-muted"><CheckSquare size={10} /> {done}/{checks.length}</span>
            )}
            {(item.comment_count || 0) > 0 && (
              <span className="chip chip-muted" data-tip={tx("The task's thread")}><MessageSquare size={10} /> {item.comment_count}</span>
            )}
            {others.map((c) => (
              <span key={c} className="chip chip-muted">{tx('also')} {byKey[c]?.label || c}</span>
            ))}
          </div>
          {(() => {
            // Everybody on the piece, once each, in the order people ask:
            // whose it is, then who films, cuts and draws it.
            const hats = [
              ...(item.assignees?.length ? item.assignees : item.assignee_id ? [item.assignee_id] : []).map((id) => [id, tx('Whose task this is')]),
              [item.operator_id, tx('Films it')], [item.editor_id, tx('Edits it')], [item.designer_id, tx('Designs it')],
            ].filter(([id]) => id && teamById[id])
            const people = []
            for (const [id, what] of hats) {
              const had = people.find((x) => x.id === id)
              if (had) had.what.push(what)
              else people.push({ id, what: [what] })
            }
            if (!people.length) return null
            const tip = people.map((x) => `${teamById[x.id].name.split(' ')[0]} — ${x.what.join(', ').toLowerCase()}`).join(' · ')
            return (
              <span className="tcard-people" data-tip={tip} aria-label={tip}>
                {people.slice(0, 3).map((x) => (
                  <Avatar key={x.id} name={teamById[x.id].name} color={teamById[x.id].color} src={teamById[x.id].avatar} size="xs" />
                ))}
                {people.length > 3 && <span className="tcard-more">+{people.length - 3}</span>}
              </span>
            )
          })()}
        </div>
        {/* The two things a card can be asked without opening it. On a desk
            they wait until the pointer is on the card; on a touch screen,
            where nothing hovers, they are simply there. */}
        {(onMenu || (onMove && canDrag(item) && nextOf(item))) && (
          <div className="tcard-acts">
            {onMove && canDrag(item) && nextOf(item) && (
              <button type="button" className="tcard-next" data-notrack
                onClick={(e) => { e.stopPropagation(); onMove(item, nextOf(item).id) }}
                aria-label={`${tx('Move to')} ${nextOf(item).label}`}>
                <span className="status-dot" style={{ background: nextOf(item).color }} />
                {nextOf(item).label} <ArrowRight size={12} />
              </button>
            )}
            {onMenu && (
              <button type="button" className="tcard-menu" data-notrack aria-label={tx('More actions')}
                onClick={(e) => { e.stopPropagation(); onMenu(e, item) }}>
                <MoreHorizontal size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // The foot input of a column. You plan work, you don't create it published
  // or deleted.
  const quickAdd = (s) => {
    if (!onQuickAdd || isDeletedLabel(s.label) || s.is_final) return null
    return (
      <button type="button" className="board-quick-btn" onClick={() => onQuickAdd(s.id)}>
        <Plus size={13} /> {tx('Add')}
      </button>
    )
  }

  if (phone) {
    const stages = statuses.map((s) => ({ s, list: items.filter((i) => columnOf(i.status_id) === s.id) }))
    // Open on the stage worth looking at: the one you work in, if it has
    // anything; otherwise the first that does. An empty first column is the
    // screen this replaces.
    const shown = stages.find((x) => x.s.id === phoneStage)
      || stages.find((x) => myStages.includes(x.s.id) && x.list.length)
      || stages.find((x) => x.list.length)
      || stages[0]
    if (!shown) return null
    return (
      <div className="board-phone">
        <div className="bp-stages" role="tablist">
          {stages.map(({ s, list }) => (
            <button key={s.id} type="button" role="tab" aria-selected={shown.s.id === s.id}
              className={'bp-stage' + (shown.s.id === s.id ? ' on' : '') + (list.length === 0 ? ' empty' : '')}
              onClick={() => setPhoneStage(s.id)}>
              <span className="status-dot" style={{ background: s.color }} />
              {tx(s.label)}
              <b>{list.length}</b>
            </button>
          ))}
        </div>
        <div className="bp-list">
          {shown.list.map(card)}
          {shown.list.length === 0 && <div className="bp-empty">{tx('Nothing here')}</div>}
          {quickAdd(shown.s)}
        </div>
      </div>
    )
  }

  return (
    <div className={'board' + (simple ? ' board-simple' : '')}>
      {statuses.map((s) => {
        const list = items.filter((i) => columnOf(i.status_id) === s.id)
        return (
          <div
            key={s.id}
            className={`board-col${overCol === s.id ? ' over' : ''}${isDeletedLabel(s.label) ? ' dead-col' : ''}${myStages.includes(s.id) ? ' my-col' : ''}${simple && pipe ? ` co-lane ${stageClass(stageKeyOf(pipe, s.id))}` : ''}`}
            style={simple ? undefined : { borderTop: `3px solid ${s.color}`, background: `color-mix(in srgb, ${s.color} 6%, transparent)` }}
            onDragOver={(e) => { if (dropOpen) { e.preventDefault(); setOverCol(s.id) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol((c) => (c === s.id ? null : c)) }}
            onDrop={() => dropOpen && drop(s.id)}
          >
            <div className="board-col-head">
              {simple && pipe ? (
                <>
                  <LaneHead stage={stageKeyOf(pipe, s.id)} label={tx(s.label)} count={list.length} />
                </>
              ) : (
                <>
                  {!simple && <span className="status-dot" style={{ background: s.color }} />}
                  {simple ? tx(s.label) : s.label}
                  {myStages.includes(s.id) && <span className="my-col-tag">{tx("yours")}</span>}
                  <span className="count">{list.length}</span>
                </>
              )}
            </div>
            <div className="board-col-body">
              {list.map(card)}
              {list.length === 0 && <div className="board-empty">{dropOpen && !simple ? tx('Drop here') : '—'}</div>}
              {quickAdd(s)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

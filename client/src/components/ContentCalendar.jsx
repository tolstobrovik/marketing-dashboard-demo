import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, Send, Plus } from 'lucide-react'
import { WEEKDAYS, MONTHS, localISO, todayISO, addDaysISO, typeInfo, onColor, isDeletedLabel, monthName, fixMonth, fmtDay } from '../lib/constants.js'
import { tr as tx, locale, lang } from '../lib/i18n.jsx'
import { KIND, stageKindOf, StageMark } from './CoachParts.jsx'
import { WEEKDAYS as DAY_ABBR } from './builder/MiniCalendar.jsx'
import { isCarried, planMonthOf, monthShortOf } from '../lib/planMonth.js'
import { useIsPhone } from '../lib/usePhone.js'
import { usePieceColors, colorStyle } from '../lib/pieceColor.js'

function monthMatrix(year, month) {
  const first = new Date(year, month, 1)
  const startIdx = (first.getDay() + 6) % 7
  const weeks = []
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let d = 0; d < 7; d++) days.push(new Date(year, month, 1 - startIdx + w * 7 + d))
    weeks.push(days)
  }
  return weeks
}

// Monday of the week that contains the given day.
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localISO(d)
}
const fmtShort = (iso) => fmtDay(iso)
// The same, with Chromium's "M09" put right for Uzbek (constants.js, fixMonth).
const fmtShortSaid = (iso) => fixMonth(fmtShort(iso), Number(iso.slice(5, 7)) - 1)

// The content calendar, used for both date fields: mode 'release' reads
// release_date, mode 'recording' reads recording_date. Two scales:
//  - Month: the classic grid, compact pills.
//  - Week: seven tall columns with rich cards (type, stage, time) — the
//    day-to-day working view. Cards drag between days in both scales;
//    click a card to open it, a day to plan it, + to add straight there.
// `canMove` is a boolean OR a predicate on the item. It has to be per-item
// because of ideas: a thought nobody has promised anything about may be
// shoved around by anybody who can see it, with no move_tasks permission and
// no waiting on whoever's name is on it. The server already says so
// (content.js, `wasAnIdea`) and the kanban already agrees (ContentBoard's
// canDrag) — the calendar was the one surface left where an idea sat still,
// which reads as the board being broken rather than as a rule.
// Picking several: with `onToggleSelect`, a shift-, ctrl- or ⌘-click on a card
// adds it to (or takes it out of) `selected` instead of opening it — the way
// every file manager does it — and never starts a drag. `channelsOf` names
// a card's channels when more than one is on screen, so a mixed calendar says
// which account each piece is going out on.
//
// Everything below this line is the Master Calendar's alone, and off unless it
// is asked for, so the channel boards that share this grid are the grid they
// always were:
//  - `onToggleSelect` also makes each card a button a keyboard can reach —
//    Enter opens it, Space (or shift+Enter) picks it;
//  - `localized` says the month, the week and the weekday heads in the
//    reader's language (the boards stay English until the date sweep that
//    constants.js describes reaches them);
//  - `start` is the day the grid opens on (a campaign's own weeks), instead of
//    today, and moves it there if a NEW one arrives later.
export default function ContentCalendar({ items, mode, canMove, onMoveDate, onDayClick, statusesById = {}, onOpenItem, onAddAt, trayItems = [], onRange, selected = null, onToggleSelect = null, channelsOf = null, localized = false, start = null }) {
  const mayMove = typeof canMove === 'function' ? canMove : () => !!canMove
  const picking = (e) => !!onToggleSelect && (e.shiftKey || e.ctrlKey || e.metaKey)
  const isSel = (it) => !!selected && selected.has(it.id)
  // A click on a card: pick it when a modifier is held, open it otherwise.
  const cardClick = (e, it, iso) => {
    e.stopPropagation()
    if (picking(e)) { e.preventDefault(); onToggleSelect(it); return }
    if (onOpenItem) onOpenItem(it); else onDayClick(iso)
  }
  // The keyboard's way in: Enter opens a card, Space (or shift+Enter) picks
  // it — the same as a modifier-click. A calendar only a mouse can work is
  // half a calendar, and a picked state no screen reader can hear is no state
  // at all: as a role=button the card's aria-pressed finally means something.
  // Only where cards CAN be picked; elsewhere a card stays what it was.
  const cardKey = (e, it, iso) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault(); e.stopPropagation()
    if (e.key === ' ' || e.shiftKey) { onToggleSelect(it); return }
    if (onOpenItem) onOpenItem(it); else onDayClick(iso)
  }
  const keyed = (it, iso) => (onToggleSelect
    ? { role: 'button', tabIndex: 0, onKeyDown: (e) => cardKey(e, it, iso) }
    : {})
  // Day cells and the tray carry data-drop unconditionally and always did, so
  // unlike the kanban there is no second gate to widen here — deciding at
  // pick-up is the whole of it.
  const [cursor, setCursor] = useState(() => {
    const [y, m] = (start || todayISO()).split('-').map(Number) // today in Tashkent time
    return { y, m: m - 1 }
  })
  const [weekStart, setWeekStart] = useState(() => mondayOf(start || todayISO()))
  // A start that arrives after the grid is up (a project's campaigns load a
  // beat later) still moves it there — once per new day, never on a redraw.
  const opened = useRef(start)
  useEffect(() => {
    if (!start || start === opened.current) return
    opened.current = start
    const [y, m] = start.split('-').map(Number)
    setCursor({ y, m: m - 1 })
    setWeekStart(mondayOf(start))
  }, [start])
  // The last used scale is remembered — most people live in one of them. On a
  // phone the first answer is the week, not the month: a month of seven
  // columns on a 390px screen can only show a dot per piece of work, and the
  // day-to-day question is "what is on this week", which the week view answers
  // with the titles still readable. A choice, once made, is still remembered.
  // The month is the default everywhere now, a phone included. A week is a
  // horizon you check; a month is the one you PLAN in, and the planning is
  // what people open a calendar for. The week is still one press away and,
  // once chosen, is still remembered.
  // r11: the week is the default again, after the research report found the
  // calendar freezing — one week of pieces, loaded on its own, is the page
  // that stays quick. The month is one press away and is remembered.
  const [scale, setScaleState] = useState(() => localStorage.getItem('satashkent_cal_scale') || 'week')
  const setScale = (s) => { setScaleState(s); localStorage.setItem('satashkent_cal_scale', s) }
  const today = todayISO()
  const phone = useIsPhone()
  const [phoneDay, setPhoneDay] = useState(today)
  const colorOf = usePieceColors()
  const dateField = mode === 'recording' ? 'recording_date' : 'release_date'
  const timeField = mode === 'recording' ? 'recording_time' : 'release_time'
  const Icon = mode === 'recording' ? Clapperboard : Send

  // ---- dragging, by pointer ----
  // HTML5 drag-and-drop exists on desktops only — phones and tablets never
  // fire it, which used to leave the calendar immovable on touch. Pills move
  // with pointer events instead: press and slide with a mouse, press-and-HOLD
  // with a finger (a finger that moves right away is scrolling and stays
  // undisturbed). Day cells and the tray are found by what's under the
  // pointer (data-drop), and a small ghost chip rides along so the task stays
  // visible under a finger.
  const [dragId, setDragId] = useState(null)
  const [overCell, setOverCell] = useState(null) // a day's iso | 'tray' | null
  const [ghost, setGhost] = useState(null) // { x, y, title } under the pointer
  const ctx = useRef({})
  ctx.current = { items, trayItems, dateField, mayMove, onMoveDate, picks: !!onToggleSelect }
  const dnd = useRef(null)
  if (!dnd.current) {
    // Built once; everything mutable lives on this object or in ctx, so the
    // window-level listeners can never go stale between renders.
    const d = { press: null }
    d.blockScroll = (e) => { if (d.press?.started) e.preventDefault() }
    d.swallowClick = (e) => { e.stopPropagation(); e.preventDefault() }
    d.cleanup = () => {
      if (d.press?.timer) clearTimeout(d.press.timer)
      if (d.press?.raf) cancelAnimationFrame(d.press.raf)
      d.press = null
      setDragId(null); setOverCell(null); setGhost(null)
      window.removeEventListener('pointermove', d.move)
      window.removeEventListener('pointerup', d.up)
      window.removeEventListener('pointercancel', d.cancel)
      document.removeEventListener('touchmove', d.blockScroll)
    }
    d.cancel = () => d.cleanup()
    // The month grid scrolls sideways on a phone — the pill's own scrollable
    // ancestor, so a drag can walk it to columns past the screen's edge.
    d.scrollBoxOf = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 4) {
          const o = getComputedStyle(n).overflowX
          if (o === 'auto' || o === 'scroll') return n
        }
      }
      return null
    }
    d.activate = () => {
      const p = d.press
      if (!p || p.started) return
      p.started = true
      p.scrollBox = d.scrollBoxOf(p.el)
      p.px = p.x; p.py = p.y
      setDragId(p.item.id)
      setGhost({ x: p.x, y: p.y, title: p.item.title })
      p.raf = requestAnimationFrame(d.tick)
    }
    // The edge auto-scroll heartbeat: a pointer PARKED at an edge produces no
    // more move events, so the walking is driven by frames, not by movement —
    // down/up through the page, and sideways through the phone's month grid.
    d.tick = () => {
      const p = d.press
      if (!p || !p.started) return
      const sb = p.scrollBox
      const r = sb?.getBoundingClientRect()
      const down = p.py > window.innerHeight - 56
      const up = p.py < 72
      const right = r && p.px > r.right - 44
      const left = r && p.px < r.left + 44
      // Walking only begins once the pointer has DWELLED at the edge: a drop
      // aimed at a day that happens to sit near the window's edge must not
      // have the ground pulled out from under it, while a deliberate park
      // still travels to what lies beyond.
      if (down || up || right || left) {
        p.bandSince ||= Date.now()
        if (Date.now() - p.bandSince > 250) {
          if (down) window.scrollBy(0, 10)
          else if (up) window.scrollBy(0, -10)
          // slow enough to aim: about a column per beat, highlight leading the way
          if (right) sb.scrollLeft += 6
          else if (left) sb.scrollLeft -= 6
        }
      } else p.bandSince = 0
      setOverCell(d.targetAt(p.px, p.py))
      p.raf = requestAnimationFrame(d.tick)
    }
    d.targetAt = (x, y) => {
      const cx = Math.min(Math.max(x, 1), window.innerWidth - 2)
      const cy = Math.min(Math.max(y, 1), window.innerHeight - 2)
      return document.elementFromPoint(cx, cy)?.closest?.('[data-drop]')?.getAttribute('data-drop') || null
    }
    d.move = (e) => {
      const p = d.press
      if (!p) return
      if (!p.started) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y)
        if (p.touch) { if (moved > 10) d.cleanup(); return } // scrolling — let it be
        if (moved <= 4) return
        d.activate()
      }
      e.preventDefault() // no text selection while a pill is in the air
      p.px = e.clientX; p.py = e.clientY // the tick reads the parked position
      setGhost({ x: e.clientX, y: e.clientY, title: p.item.title })
      setOverCell(d.targetAt(e.clientX, e.clientY))
    }
    d.up = (e) => {
      const p = d.press
      if (p?.started) {
        const { items: its, trayItems: tray, dateField: field, onMoveDate: move } = ctx.current
        const item = its.find((i) => i.id === p.item.id) || tray.find((i) => i.id === p.item.id) || p.item
        const target = d.targetAt(e.clientX || p.px, e.clientY || p.py)
        if (target === 'tray') { if (item[field]) move(item, field, null) }
        else if (target && item[field] !== target) move(item, field, target)
        // the click that follows a finished drag must not open anything
        window.addEventListener('click', d.swallowClick, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', d.swallowClick, { capture: true }), 400)
      }
      d.cleanup()
    }
    d.start = (e, item) => {
      // A held modifier means picking only where cards CAN be picked; the
      // channel boards pass no onToggleSelect and drag exactly as they always
      // did, shift held or not.
      if (ctx.current.picks && (e.shiftKey || e.ctrlKey || e.metaKey)) return // picking, not dragging
      if (!ctx.current.mayMove(item)) return
      if (d.press) return // a second finger never steals the gesture
      if (e.button !== undefined && e.button !== 0) return
      const touch = e.pointerType === 'touch'
      const p = { item, el: e.currentTarget, x: e.clientX, y: e.clientY, touch, started: false, timer: null }
      d.press = p
      // a held finger means "pick it up" — a beat long enough to tell a hold
      // from the start of a scroll
      if (touch) p.timer = setTimeout(() => { if (d.press === p) d.activate() }, 280)
      window.addEventListener('pointermove', d.move, { passive: false })
      window.addEventListener('pointerup', d.up)
      window.addEventListener('pointercancel', d.cancel)
      // Registered at the gesture's FIRST moment on purpose: the browser
      // decides at touchstart whether this gesture's moves stay cancelable.
      // Before the hold matures it never preventDefaults, so a finger that
      // meant "scroll" scrolls; after it, the drag owns the screen.
      document.addEventListener('touchmove', d.blockScroll, { passive: false })
    }
    dnd.current = d
  }
  const startDrag = (e, it) => dnd.current.start(e, it)

  const byDate = useMemo(() => {
    const map = {}
    for (const it of items) {
      const d = it[dateField]
      if (!d) continue
      ;(map[d] = map[d] || []).push(it)
    }
    for (const k in map) map[k].sort((a, b) => (a[timeField] || '').localeCompare(b[timeField] || ''))
    return map
  }, [items, dateField, timeField])

  const weeks = monthMatrix(cursor.y, cursor.m)
  const wkDays = useMemo(() => [...Array(7)].map((_, i) => addDaysISO(weekStart, i)), [weekStart])

  const shift = (n) => {
    if (scale === 'week') return setWeekStart(addDaysISO(weekStart, n * 7))
    const d = new Date(cursor.y, cursor.m + n, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }
  const goToday = () => {
    if (scale === 'week') return setWeekStart(mondayOf(todayISO()))
    const [y, m] = todayISO().split('-').map(Number)
    setCursor({ y, m: m - 1 })
  }

  const fmtDay = localized ? fmtShortSaid : fmtShort
  const title = scale === 'week'
    ? `${fmtDay(wkDays[0])} – ${fmtDay(wkDays[6])}, ${wkDays[6].slice(0, 4)}`
    : `${localized ? monthName(cursor.y, cursor.m + 1) : MONTHS[cursor.m]} ${cursor.y}`
  // The weekday heads: the builder's day picker already has them in Russian
  // and Uzbek (MiniCalendar), and English keeps the three letters it had.
  const dayHeads = localized && lang() !== 'en' ? DAY_ABBR[lang()] || WEEKDAYS : WEEKDAYS

  // Tell the page above which span is on screen. Only the calendar knows where
  // it is parked, and the schedule pages promise their export carries exactly
  // what is shown — a promise they cannot keep without this. Held in a ref so
  // an inline arrow from the parent can't re-fire the effect every render.
  const spanFrom = scale === 'week' ? wkDays[0] : localISO(weeks[0][0])
  const spanTo = scale === 'week' ? wkDays[6] : localISO(weeks[5][6])
  const rangeRef = useRef(onRange)
  rangeRef.current = onRange
  useEffect(() => { rangeRef.current?.(spanFrom, spanTo) }, [spanFrom, spanTo])

  // One piece in the week, the same card in the desk's seven columns and the
  // phone's one-day list.
  const wkCard = (it, iso) => {
    const st = statusesById[it.status_id]
    const dead = st ? isDeletedLabel(st.label) : false
    // The card is its title and one stage mark (round 17): the kind of piece
    // is in the tooltip, where it was read once at most.
    return (
      <div
        key={it.id}
        className={`wk-card${st ? ' st-tint' : ''}${dragId === it.id ? ' dim' : ''}${dead ? ' cal-dead' : ''}${isSel(it) ? ' sel' : ''}`}
        aria-pressed={selected ? isSel(it) : undefined}
        {...keyed(it, iso)}
        style={st ? { borderLeftColor: st.color, '--st': st.color } : undefined}
        onPointerDown={(e) => startDrag(e, it)}
        onContextMenu={(e) => { if (dragId === it.id) e.preventDefault() }}
        onClick={(e) => cardClick(e, it, iso)}
        title={`${it.title} · ${typeInfo(it.type).label}${st ? ` · ${tx(st.label)}` : ''}`}
      >
        <div className="wk-title">{colorOf(it) != null && <i className="pc-dot" style={colorStyle(colorOf(it))} aria-hidden="true" />}{it.title}</div>
        <div className="wk-chips">
          {st && <StageMark status={st} size={11} className="wk-stage" />}
          {it[timeField] && <span className="chip chip-muted"><Icon size={9} /> {it[timeField]}</span>}
          {channelsOf && <span className="chip chip-muted cal-ch">{channelsOf(it)}</span>}
        </div>
      </div>
    )
  }
  // On a phone the week is a strip of its seven days and the list of the one
  // pressed (r11). Seven stacked day boxes put one piece on the screen; this
  // puts the week in one line and the day's work right under it.
  const pickedDay = wkDays.includes(phoneDay) ? phoneDay : wkDays.includes(today) ? today : wkDays[0]

  return (
    <div className={`card cal${onToggleSelect ? ' cal-picks' : ''}`}>
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} data-tip={tx("Previous")} aria-label={tx("Previous")}><ChevronLeft size={18} /></button>
        <h3>{title}</h3>
        <button className="icon-btn" onClick={() => shift(1)} data-tip={tx("Next")} aria-label={tx("Next")}><ChevronRight size={18} /></button>
        <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={goToday} data-tip={tx("Jump back to today")}>{tx("Today")}</button>
        <div className="pill-group cal-scale">
          <button className={'pill' + (scale === 'month' ? ' active' : '')} onClick={() => setScale('month')} data-tip={tx("Whole month at a glance")}>{tx("Month")}</button>
          <button className={'pill' + (scale === 'week' ? ' active' : '')} onClick={() => setScale('week')} data-tip={tx("One week with full task cards")}>{tx("Week")}</button>
        </div>

      </div>

      {/* The owner (13 Oct): no "Unscheduled" tray on the calendar — work with no
          date is on the board, and the calendar is only the days. */}
      {scale === 'week' && phone ? (
        <div className="wk-phone">
          <div className="wk-strip" role="group" aria-label={tx('Day')}>
            {wkDays.map((iso, i) => {
              const n = (byDate[iso] || []).length
              return (
                <button key={iso} type="button" aria-pressed={iso === pickedDay} onClick={() => setPhoneDay(iso)}
                  className={'wk-sday' + (iso === today ? ' today' : '')}
                  aria-label={`${dayHeads[i]} ${Number(iso.slice(8))}: ${n}`}>
                  <span>{dayHeads[i]}</span><b>{Number(iso.slice(8))}</b><i className={n ? 'on' : ''} />
                </button>
              )
            })}
          </div>
          <div className="wk-daylist" data-drop={pickedDay}>
            {(byDate[pickedDay] || []).map((it) => wkCard(it, pickedDay))}
            {!(byDate[pickedDay] || []).length && <p className="wk-none">{tx('Nothing on this day.')}</p>}
          </div>
        </div>
      ) : scale === 'week' ? (
        <div className="cal-grid wk-grid">
          {wkDays.map((iso, i) => {
            const dayItems = byDate[iso] || []
            const isToday = iso === today
            return (
              <div
                key={iso}
                data-drop={iso}
                className={`wk-col${isToday ? ' today' : ''}${i >= 5 ? ' wknd' : ''}${overCell === iso ? ' over' : ''}`}
                onClick={() => onDayClick(iso)}
              >
                <div className="wk-head">
                  <span className="wk-dow">{dayHeads[i]}</span>
                  <span className={`wk-num${isToday ? ' on' : ''}`}>{Number(iso.slice(8))}</span>
                  {dayItems.length > 0 && <span className="wk-count">{dayItems.length}</span>}
                  <span style={{ flex: 1 }} />
                  {onAddAt && (
                    <button className="icon-btn wk-add" data-tip={tx("New task on this day")} aria-label={tx("New task on this day")}
                      onClick={(e) => { e.stopPropagation(); onAddAt(iso) }}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="wk-cards">
                  {dayItems.map((it) => wkCard(it, iso))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className="cal-grid cal-weekhead">
            {WEEKDAYS.map((d, i) => <div key={d} className="cal-wd">{dayHeads[i]}</div>)}
          </div>

          {weeks.map((week, wi) => (
            <div className="cal-grid" key={wi}>
              {week.map((date) => {
                const iso = localISO(date)
                const inMonth = date.getMonth() === cursor.m
                const dayItems = byDate[iso] || []
                return (
                  <div
                    key={iso}
                    data-drop={iso}
                    className={`cal-day editable${inMonth ? '' : ' out'}${iso === today ? ' today' : ''}${overCell === iso ? ' over' : ''}`}
                    onClick={() => onDayClick(iso)}
                  >
                    <div className="cal-dayhead">
                      <span className="cal-daynum">{date.getDate()}</span>
                      {/* The cell is one height for every day now, so a day
                          holding more than fits would otherwise end in a pill
                          sliced in half with nothing saying why. The count
                          says how many are down there; the list scrolls, and
                          the day still opens whole. */}
                      {dayItems.length > 3 && <span className="cal-daycount">{dayItems.length}</span>}
                    </div>
                    <div className="cal-events">
                      {dayItems.map((it) => {
                        // Every task shows — a crowded day makes its week row
                        // taller instead of hiding work behind a "+N more".
                        // The pill wears its pipeline stage's color (To shoot =
                        // yellow, Editing = red, ...), the type's little icon
                        // (post, reel, video...) and the stage's glyph; killed
                        // work stays on the record — dimmed, struck through,
                        // its status written under the title.
                        const st = statusesById[it.status_id]
                        // One mark, the stage's (round 17): the same icon the
                        // rail, the task window and My Day wear for it.
                        const SIcon = st ? KIND[stageKindOf(st.label)].Icon : typeInfo(it.type).icon
                        const dead = st ? isDeletedLabel(st.label) : false
                        // Still open from an earlier month's plan: striped in
                        // that month's colour, with its month on the pill.
                        const carried = !dead && isCarried(it, todayISO())
                        return (
                          <div
                            key={it.id}
                            className={`rel-ev${carried ? ' rel-ev-carried' : ''}${st ? '' : ` ct-${it.type}`}${dragId === it.id ? ' dim' : ''}${dead ? ' cal-dead' : ''}${isSel(it) ? ' sel' : ''}`}
                            aria-pressed={selected ? isSel(it) : undefined}
                            data-month={carried ? monthShortOf(planMonthOf(it)) : undefined}
                            {...keyed(it, iso)}
                            style={st ? { background: st.color, color: onColor(st.color), borderLeftColor: st.color, '--st': st.color } : undefined}
                            onPointerDown={(e) => startDrag(e, it)}
                            onContextMenu={(e) => { if (dragId === it.id) e.preventDefault() }}
                            // Clicking a TASK opens that task. Only clicking
                            // the empty part of a day opens the day. Without
                            // this the click fell through to the cell and you
                            // got a day summary you then had to read to find
                            // the thing you had already pointed at. A click
                            // that ends a drag is swallowed higher up, so
                            // dropping a pill still never opens anything.
                            onClick={(e) => cardClick(e, it, iso)}
                            title={`${it.title} · ${typeInfo(it.type).label}${st ? ` · ${tx(st.label)}` : ''}${channelsOf ? ` · ${channelsOf(it)}` : ''}`}
                          >
                            <SIcon size={10} style={{ flexShrink: 0 }} />
                            <span className="ev-txt">
                              {it[timeField] ? `${it[timeField]} ` : ''}{it.title}
                              {/* Under the title: a killed piece's stage, or —
                                  with several channels on screen — whose
                                  account it goes out on. The tooltip said so
                                  already; a month of look-alike pills did not. */}
                              {dead ? <i className="ev-sub">{tx(st.label)}</i> : channelsOf && <i className="ev-sub ev-ch">{channelsOf(it)}</i>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}

      {/* The pill in flight — pinned to the pointer so the task's name stays
          visible even under a finger. */}
      {ghost && (
        // Moved by transform, not by left/top: the browser slides an already
        // painted layer instead of re-laying-out the page on every frame.
        <div className="drag-ghost" style={{ transform: `translate3d(${ghost.x + 14}px, ${ghost.y + 12}px, 0)` }}>{ghost.title}</div>
      )}
    </div>
  )
}

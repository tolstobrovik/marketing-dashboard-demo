import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, Flag, AlertCircle, Plus, CalendarDays } from 'lucide-react'
import { addDaysISO, dateLabel } from '../lib/constants.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- Programs on a timeline you can move (the owner: "easier and moveable,
// like a Notion timeline") ------------------------------------------------------
//
// Days are columns of a fixed width, so a bar is where its days are and moves
// by whole days. Drag a bar to move the program; drag either end to change its
// start or its end; the dates ride above the bar while it moves and are saved
// when it is let go (with Undo). Week / Month / Quarter set how wide a day is;
// Today brings today back into view. The empty lane under the bars makes a new
// program: a click on a day, or a drag across the days it should run. A
// program without dates is dragged from the list onto its first day. A bar
// that has focus moves a day with ←/→ (Shift: its end only).
//
// It only draws and reports. The parent saves (`onPatch`), opens (`onOpen`),
// starts a new one (`onNew`) and owns the state changes; the server checks the
// dates (an end before the start is refused) and who may edit them.

const DAY = 86400000
const day = (iso) => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (t) => new Date(t).toISOString().slice(0, 10)
const span = (a, b) => Math.round((day(b) - day(a)) / DAY)
const ZOOMS = [
  { key: 'week', label: 'Week', px: 44 },
  { key: 'month', label: 'Month', px: 18 },
  { key: 'quarter', label: 'Quarter', px: 7 },
]
const ZKEY = 'satashkent_prog_zoom'
const readZoom = () => { try { return ZOOMS.find((z) => z.key === localStorage.getItem(ZKEY)) || ZOOMS[1] } catch { return ZOOMS[1] } }

export default function ProgramsTimeline({
  dated, undated, finished = [], today, canManage, big = false,
  stateOf, platformOf, branchTxt, onOpen, onNew, onPatch, onMenu, onQuick,
}) {
  const [zoom, setZoomState] = useState(readZoom)
  const setZoom = (z) => { setZoomState(z); try { localStorage.setItem(ZKEY, z.key) } catch { /* private window */ } }
  const px = zoom.px

  // The range: a month behind today, four ahead, and every program inside it.
  const range = useMemo(() => {
    let lo = day(addDaysISO(today, -30)), hi = day(addDaysISO(today, 120))
    for (const p of dated) {
      lo = Math.min(lo, day(p.start_date) - 14 * DAY)
      hi = Math.max(hi, day(p.end_date || p.start_date) + 45 * DAY)
    }
    const from = isoOf(lo)
    return { from, n: Math.round((hi - lo) / DAY) + 1 }
  }, [dated, today])
  const x = (iso) => span(range.from, iso) * px
  const days = useMemo(() => Array.from({ length: range.n }, (_, i) => isoOf(day(range.from) + i * DAY)), [range])
  const width = range.n * px

  // ---- scrolling: today in view on open, on "Today", and after a zoom ----
  const scroller = useRef(null)
  // How far the days are scrolled: the month at the left edge stays in sight.
  const [edge, setEdge] = useState(0)
  const toToday = (smooth = true) => {
    const el = scroller.current
    if (el) el.scrollTo({ left: Math.max(0, x(today) - el.clientWidth * 0.25), behavior: smooth ? 'smooth' : 'auto' })
  }
  useEffect(() => { toToday(false) }, [px, range.from]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- dragging a bar (move / its start / its end), or drawing a new one ----
  // The listeners go on at the press itself, not in an effect after the next
  // paint: a quick click let go before the effect ran was lost, and left the
  // bar following the mouse with no button down. The refs carry the live
  // drag between events; the state only draws it.
  // drag: { id, mode, x0, start, end, s, e, moved, p } — s/e is what is drawn now.
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const [make, setMake] = useState(null) // { a, b } ISO days
  const makeRef = useRef(null)
  const lane = useRef(null)
  const dayAt = (clientX) => {
    const r = lane.current.getBoundingClientRect()
    const i = Math.max(0, Math.min(range.n - 1, Math.floor((clientX - r.left) / px)))
    return days[i]
  }
  const putDrag = (d) => { dragRef.current = d; setDrag(d) }
  const putMake = (m) => { makeRef.current = m; setMake(m) }
  // The handlers read the latest render's values through a ref, so the ones
  // added at the press are the same functions removed at the release.
  const live = useRef({})
  live.current = { px, dayAt, onOpen, onPatch, onNew }
  const handlers = useRef(null)
  if (!handlers.current) {
    const move = (ev) => {
      const { px: w, dayAt: at } = live.current
      const d = dragRef.current
      if (d) {
        const n = Math.round((ev.clientX - d.x0) / w)
        let s = d.start, e = d.end
        if (d.mode === 'move') { s = addDaysISO(d.start, n); e = addDaysISO(d.end, n) }
        else if (d.mode === 'start') { s = addDaysISO(d.start, n); if (s > e) s = e }
        else { e = addDaysISO(d.end, n); if (e < s) e = s }
        if (s !== d.s || e !== d.e || Math.abs(ev.clientX - (d.cx ?? d.x0)) > 2) putDrag({ ...d, s, e, moved: d.moved || s !== d.s || e !== d.e, cx: ev.clientX, cy: ev.clientY })
        return
      }
      const m = makeRef.current
      if (m) { const b = at(ev.clientX); if (b !== m.b) putMake({ ...m, b }) }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const { onOpen: open, onPatch: save, onNew: add } = live.current
      const d = dragRef.current
      if (d) {
        putDrag(null)
        if (!d.moved) { open(d.p); return }
        const patch = {}
        if (d.s !== d.start) patch.start_date = d.s
        // An open-ended program keeps no end unless its end was dragged.
        if (d.mode === 'end' || (!d.open && d.e !== d.end)) patch.end_date = d.e
        if (Object.keys(patch).length) save(d.p, patch)
        return
      }
      const m = makeRef.current
      if (m) {
        putMake(null)
        const [a, b] = m.a <= m.b ? [m.a, m.b] : [m.b, m.a]
        add({ start_date: a, end_date: a === b ? addDaysISO(a, 13) : b })
      }
    }
    handlers.current = {
      listen: () => {
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      },
      stop: () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      },
    }
  }
  useEffect(() => () => handlers.current.stop(), [])
  const beginBar = (ev, p, mode) => {
    if (!canManage || ev.button > 0 || dragRef.current) return
    ev.preventDefault(); ev.stopPropagation()
    const end = p.end_date || addDaysISO(today > p.start_date ? today : p.start_date, 14)
    putDrag({ id: p.id, mode, x0: ev.clientX, start: p.start_date, end, open: !p.end_date, s: p.start_date, e: end, moved: false, p })
    handlers.current.listen()
  }
  const beginMake = (ev) => {
    if (!canManage || ev.button > 0 || makeRef.current) return
    ev.preventDefault()
    putMake({ a: dayAt(ev.clientX), b: dayAt(ev.clientX) })
    handlers.current.listen()
  }

  // ---- keys on a focused bar: a day at a time, saved once the keys stop ----
  const keyTimer = useRef(null)
  const [nudge, setNudge] = useState(null) // { id, s, e, p }
  const onKey = (ev, p) => {
    if (!canManage || !['ArrowLeft', 'ArrowRight'].includes(ev.key)) return
    ev.preventDefault()
    const n = ev.key === 'ArrowLeft' ? -1 : 1
    const cur = nudge?.id === p.id ? nudge : { id: p.id, s: p.start_date, e: p.end_date, p }
    const next = ev.shiftKey
      ? { ...cur, e: cur.e ? (addDaysISO(cur.e, n) < cur.s ? cur.s : addDaysISO(cur.e, n)) : cur.e }
      : { ...cur, s: addDaysISO(cur.s, n), e: cur.e ? addDaysISO(cur.e, n) : cur.e }
    setNudge(next)
    clearTimeout(keyTimer.current)
    keyTimer.current = setTimeout(() => {
      setNudge(null)
      const patch = {}
      if (next.s !== p.start_date) patch.start_date = next.s
      if (next.e !== p.end_date) patch.end_date = next.e
      if (Object.keys(patch).length) onPatch(p, patch)
    }, 700)
  }

  // ---- a program without dates, dropped on a day ----
  const onDropDay = (ev) => {
    const id = Number(ev.dataTransfer.getData('application/x-program'))
    const p = undated.find((u) => u.id === id)
    if (!p || !lane.current) return
    ev.preventDefault()
    const d = dayAt(ev.clientX)
    onPatch(p, { start_date: d, end_date: addDaysISO(d, 13) })
  }

  // ---- the header: months, then days (Week), Mondays (Month) or weeks (Quarter) ----
  const months = useMemo(() => {
    const out = []
    days.forEach((d, i) => { if (i === 0 || d.endsWith('-01')) out.push({ i, label: new Date(day(d)).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }) }) })
    return out
  }, [days])
  const dow = (d) => new Date(day(d)).getUTCDay()
  const label = (d) => (zoom.key === 'week' ? true : dow(d) === 1)

  const drawn = (p) => {
    const d = drag?.id === p.id ? drag : nudge?.id === p.id ? { s: nudge.s, e: nudge.e || null } : null
    const s = d ? d.s : p.start_date
    const e = d ? d.e : p.end_date
    const open = !e
    const end = e || addDaysISO(today > s ? today : s, 14)
    return { s, e, open, end, live: !!d }
  }

  return (
    <div className={'card ptl' + (big ? ' ptl-big' : '')}>
      <div className="ptl-bar">
        <div className="pill-group" role="group" aria-label={tx('Zoom')}>
          {ZOOMS.map((z) => (
            <button key={z.key} type="button" className={'pill' + (z.key === zoom.key ? ' active' : '')} aria-pressed={z.key === zoom.key} onClick={() => setZoom(z)}>{tx(z.label)}</button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => toToday()}><CalendarDays size={14} /> {tx('Today')}</button>
        {canManage && <span className="stat-sub ptl-hint">{tx('Drag a bar to move it, its ends to change the dates. Click a day below to add one.')}</span>}
      </div>

      <div className="ptl-scroll" ref={scroller} onScroll={(e) => setEdge(Math.max(0, e.currentTarget.scrollLeft))}>
        <div className="ptl-grid" style={{ width: width + 240 }}>
          {/* header */}
          <div className="ptl-row ptl-head">
            <div className="ptl-name ptl-corner" />
            <div className="ptl-track" style={{ width }}>
              {months.filter((m) => m.i * px > edge + 150).map((m) => <span key={m.i} className="ptl-month" style={{ left: m.i * px }}>{m.label}</span>)}
              {days[Math.floor(edge / px)] && <span className="ptl-month ptl-month-edge" style={{ left: edge }}>{new Date(day(days[Math.floor(edge / px)])).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>}
              {days.map((d, i) => label(d) && (
                <span key={d} className={'ptl-day' + (d === today ? ' now' : '') + (dow(d) === 0 || dow(d) === 6 ? ' we' : '')} style={{ left: i * px, width: zoom.key === 'week' ? px : undefined }}>
                  {Number(d.slice(8))}
                </span>
              ))}
            </div>
          </div>

          {/* body: weekends, today, then a row per program */}
          <div className="ptl-body">
            <div className="ptl-bg" style={{ left: 240, width }} aria-hidden="true">
              {zoom.key !== 'quarter' && days.map((d, i) => (dow(d) === 0 || dow(d) === 6) && <i key={d} className="ptl-we" style={{ left: i * px, width: px }} />)}
              <i className="ptl-now" style={{ left: x(today) + px / 2 }} />
            </div>

            {dated.map((p) => {
              const st = stateOf(p.status)
              const v = drawn(p)
              const pastEnd = p.status === 'running' && p.end_date && p.end_date < today
              const left = x(v.s)
              const w = (span(v.s, v.end) + 1) * px
              return (
                <div key={p.id} className="ptl-row" onContextMenu={(e) => onMenu(e, p)}>
                  <button type="button" className="ptl-name" onClick={() => onOpen(p)}>
                    <b><span className="rp-dot" style={{ background: st.color }} />{p.name}{pastEnd && <AlertCircle size={13} className="ptl-warn" aria-label={tx('past its end date')} />}</b>
                    <span>
                      <b style={{ color: platformOf(p.platform).color }}>{platformOf(p.platform).short}</b>
                      {branchTxt(p) ? ` · ${branchTxt(p)}` : ''} · {dateLabel(p.start_date)}{p.end_date ? ` → ${dateLabel(p.end_date)}` : ` → ${tx('open-ended')}`}
                    </span>
                  </button>
                  <div className="ptl-track" style={{ width }}>
                    <div
                      role="button" tabIndex={0}
                      className={'ptl-item' + (v.open ? ' ptl-open' : '') + (p.status === 'paused' ? ' ptl-halted' : '') + (v.live ? ' ptl-live' : '') + (canManage ? ' ptl-can' : '')}
                      style={{ left, width: Math.max(px, w), '--ptl': st.color }}
                      aria-label={`${p.name}: ${dateLabel(v.s)} → ${v.e ? dateLabel(v.e) : tx('open-ended')}`}
                      onPointerDown={(e) => beginBar(e, p, 'move')}
                      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p); else onKey(e, p) }}>
                      {canManage && <i className="ptl-grip ptl-grip-s" onPointerDown={(e) => beginBar(e, p, 'start')} aria-hidden="true" />}
                      <span className="ptl-txt">{branchTxt(p) && <em>{branchTxt(p)}</em>}{p.name}</span>
                      {canManage && !v.open && <i className="ptl-grip ptl-grip-e" onPointerDown={(e) => beginBar(e, p, 'end')} aria-hidden="true" />}
                      {v.live && drag?.cx != null && <span className="ptl-when ptl-when-fixed" style={{ left: drag.cx + 14, top: drag.cy - 34 }}>{dateLabel(v.s)} → {v.e ? dateLabel(v.e) : tx('open-ended')} · {span(v.s, v.end) + 1} {tx('days')}</span>}
                    </div>
                    {canManage && (
                      <span className="ptl-quick" style={{ left: left + Math.max(px, w) + 6 }}>
                        {p.status !== 'running' && p.status !== 'done' && <button type="button" className="icon-btn" title={tx('Start / resume')} aria-label={tx('Start / resume')} onClick={() => onQuick(p, 'running')}><Play size={13} /></button>}
                        {p.status === 'running' && <button type="button" className="icon-btn" title={tx('Halt this program')} aria-label={tx('Halt this program')} onClick={() => onQuick(p, 'paused')}><Pause size={13} /></button>}
                        {p.status !== 'done' && <button type="button" className="icon-btn" title={tx('Mark as finished')} aria-label={tx('Mark as finished')} onClick={() => onQuick(p, 'done')}><Flag size={13} /></button>}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* the lane for a new one */}
            {canManage && (
              <div className="ptl-row ptl-new">
                <div className="ptl-name ptl-new-name"><Plus size={14} /> {tx('New program')}</div>
                <div className="ptl-track ptl-lane" style={{ width }} ref={lane}
                  onPointerDown={beginMake}
                  onDragOver={(e) => { if ([...e.dataTransfer.types].includes('application/x-program')) e.preventDefault() }}
                  onDrop={onDropDay}>
                  {make && (() => {
                    const [a, b] = make.a <= make.b ? [make.a, make.b] : [make.b, make.a]
                    return <span className="ptl-ghost" style={{ left: x(a), width: (span(a, b) + 1) * px }}><span className="ptl-when">{dateLabel(a)}{a !== b ? ` → ${dateLabel(b)}` : ''}</span></span>
                  })()}
                  {!make && <span className="ptl-lane-hint" style={{ left: x(today) + 8 }}>{tx('Click a day, or drag across days')}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <div className="ptl-undated">
          <span className="stat-sub"><b>{tx('Without dates')}</b>{canManage ? ` — ${tx('drag one onto the lane at its first day')}` : ''}</span>
          {undated.map((p) => (
            <button key={p.id} type="button" className="chip chip-muted" draggable={canManage}
              onDragStart={(e) => { e.dataTransfer.setData('application/x-program', String(p.id)); e.dataTransfer.effectAllowed = 'move' }}
              onClick={() => onOpen(p)}>
              <span className="rp-dot" style={{ background: stateOf(p.status).color }} />{p.name}
            </button>
          ))}
        </div>
      )}

      {/* Finished ones are off the timeline, not gone: folded here, newest
          first. Open one to look at it again; right-click to start it again
          or delete it for good. */}
      {finished.length > 0 && (
        <details className="ptl-done">
          <summary><b>{tx('Finished')}</b> <span className="count">{finished.length}</span></summary>
          <ul>
            {finished.map((p) => (
              <li key={p.id} onContextMenu={(e) => onMenu(e, p)}>
                <button type="button" className="ptl-done-row" onClick={() => onOpen(p)}>
                  <span className="rp-dot" style={{ background: stateOf(p.status).color }} />
                  <b>{p.name}</b>
                  <span className="stat-sub">
                    <b style={{ color: platformOf(p.platform).color }}>{platformOf(p.platform).short}</b>
                    {branchTxt(p) ? ` · ${branchTxt(p)}` : ''}
                    {p.start_date ? ` · ${dateLabel(p.start_date)}${p.end_date ? ` → ${dateLabel(p.end_date)}` : ''}` : ''}
                  </span>
                </button>
                {canManage && <button type="button" className="btn btn-sm" onClick={() => onQuick(p, 'running')} title={tx('Start / resume')}><Play size={13} /> {tx('Start again')}</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

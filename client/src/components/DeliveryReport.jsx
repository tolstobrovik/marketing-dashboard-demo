import { useEffect, useState } from 'react'
import { ChevronDown, ClipboardCheck, Scissors, Clapperboard, Palette, PenLine, CheckCheck, UserRound, Hourglass } from 'lucide-react'
import { api } from '../lib/api.js'
import { tr as tx, locale } from '../lib/i18n.jsx'
import { todayISO } from '../lib/constants.js'
import { monthOf, shiftMonth, monthWords } from '../lib/month.js'

// The Monthly Delivery Report: what somebody delivered, counted.
//
// The payslip says what a month came to. This says what it was made OF —
// "Reels edited: 15" — and every count opens into the task names and dates
// behind it, so nobody has to count their own cards on the board to check
// their pay. One block per hat the person actually wore that month; a hat
// they did not wear is not drawn at all.
//
// The counting is the server's (/reports/delivery/…), from the same list the
// pay run is built on; nothing is worked out here.
//
// `userId` shows somebody else's (an admin reading a person's pay); without
// it, the reader's own. `month`, when given, is the month of the window this
// sits in — the report follows it and draws no picker of its own.

const KIND = {
  reel: () => tx('Reels'), youtube: () => 'YouTube', target: () => tx('Targets'),
  post: () => tx('Posts'), other: () => tx('Other'),
}
// What each row is called, by hat. Spelled out so the translation gate sees
// every phrase; the spec's own words where it gave them.
const ROW = {
  editor: {
    reel: () => tx('Reels edited'), youtube: () => tx('YouTube videos edited'), target: () => tx('Targets edited'),
    post: () => tx('Posts edited'), other: () => tx('Other pieces edited'),
  },
  operator: (k) => `${tx('Shoots filmed')} (${KIND[k]()})`,
  designer: (k) => `${tx('Designs made')} (${KIND[k]()})`,
  reviewer: (k) => `${tx('Pieces signed off')} (${KIND[k]()})`,
  face: (k) => `${tx('Appearances on camera')} (${KIND[k]()})`,
  assignee: {
    reel: () => tx('Reels'), youtube: () => tx('YouTube videos'), target: () => tx('Targets'),
    post: () => tx('Posts'), other: () => tx('Other pieces'),
    'tg:just_post': () => tx('Just a post'), 'tg:post_plus': () => tx('Post plus'), 'tg:webinar': () => tx('Webinar'),
    guiding: () => tx('Guiding posts'),
  },
}
const rowLabel = (hat, key) => {
  const r = ROW[hat]
  if (typeof r === 'function') return r(KIND[key] ? key : 'other')
  return (r?.[key] || (() => key))()
}
const BLOCK = {
  editor: { icon: Scissors, name: () => tx('Editing') },
  operator: { icon: Clapperboard, name: () => tx('Filming') },
  designer: { icon: Palette, name: () => tx('Design') },
  assignee: { icon: PenLine, name: () => tx('Written and managed') },
  reviewer: { icon: CheckCheck, name: () => tx('Review') },
  face: { icon: UserRound, name: () => tx('On camera') },
}
const dayWords = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')

// One count, and the list behind it.
function Row({ id, label, count, items, muted = false, note = null, icon = null }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'dr-row' + (muted ? ' dr-muted' : '')}>
      <button type="button" className="dr-row-head" aria-expanded={open} aria-controls={id}
        data-tip={tx('Expand to verify')} aria-label={`${label}: ${count} — ${tx('Expand to verify')}`}
        onClick={() => setOpen((o) => !o)}>
        <span className="dr-row-label">{icon}{label}</span>
        <b className="dr-row-count">{count}</b>
        <ChevronDown size={15} className={'dr-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div id={id}>
          {note && <p className="dr-note">{note}</p>}
          <ol className="dr-items">
            {items.map((it) => (
              <li key={it.id}>
                <span className="dr-item-title">{it.title}</span>
                <span className="dr-item-day">{dayWords(it.day)}{it.stage ? ` · ${it.stage}` : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

export default function DeliveryReport({ userId = null, month: fixedMonth = null }) {
  const thisMonth = monthOf(todayISO())
  const [picked, setPicked] = useState(thisMonth)
  const month = fixedMonth || picked
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    setErr('')
    api.get(userId ? `/reports/delivery/person/${userId}?month=${month}` : `/reports/delivery/mine?month=${month}`)
      .then((d) => { if (live) setData(d) })
      .catch((e) => { if (live) { setData(null); setErr(e.message) } })
    return () => { live = false }
  }, [userId, month])

  // The last twelve months, newest first — the current payroll month on top.
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, -i))
  const blocks = data?.month === month ? (data.blocks || []) : null
  return (
    <section className="card card-pad dr">
      <div className="dr-head">
        <h2><ClipboardCheck size={17} /> {tx('Monthly Delivery Report')}</h2>
        {!fixedMonth && (
          <select className="select dr-month" value={picked} aria-label={tx('Month')}
            onChange={(e) => setPicked(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthWords(m)}</option>)}
          </select>
        )}
      </div>
      {err && <div className="form-error">{err}</div>}
      {!err && blocks === null && <div className="app-loading"><span className="spinner" /></div>}
      {blocks && blocks.length === 0 && <div className="empty">{tx('Nothing was delivered in this month.')}</div>}
      {blocks && blocks.map((b) => {
        const B = BLOCK[b.hat] || BLOCK.assignee
        return (
          <div className="dr-block" key={b.hat}>
            <div className="dr-block-head"><B.icon size={14} /> <b>{B.name()}</b> <span className="count">· {b.total}</span></div>
            {b.rows.map((r) => (
              <Row key={r.key} id={`dr-${b.hat}-${r.key}`} label={rowLabel(b.hat, r.key)} count={r.count} items={r.items}
                note={r.key === 'guiding' ? tx('Also counted in the rows above — the guiding bonus is on top.') : null} />
            ))}
            {b.pending.length > 0 && (
              <Row id={`dr-${b.hat}-pending`} muted count={b.pending.length} items={b.pending}
                icon={<Hourglass size={12} />} label={tx('Still in the works — not yet at Ready')}
                note={tx('Handed over this month, but the piece has not reached Ready yet, so it is not in the counts above.')} />
            )}
          </div>
        )
      })}
    </section>
  )
}

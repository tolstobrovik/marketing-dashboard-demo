import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, X, Scissors, Check, Play, Undo2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { monthName } from '../lib/constants.js'
import { monthCells, weekCells } from '../lib/coach.js'
import { embedOf, dayRuns } from '../lib/ambCalendar.js'
import { firstName, dayMonth, dayShort, weekdayShort } from './CoachParts.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- the Ambassadors calendar ----------------------------------------------------
//
// Which ambassador videos came in, and which still need an editor — at a
// glance, and one in two taps: the card, then the editor's button. One card a
// video, on the day it came in, in one of three states the SERVER reads off
// the task made from it (routes/ambassadors.js, GET /videos):
//
//   New          white, with a rule round it; ruby once it has waited over 2
//                days — late is the only ruby on this page
//   With editor  the cut's colour (--kind-cut), with scissors
//   Done         published: light grey, with a check
//
// Assigning makes an ordinary editing task (POST /ambassadors/cards/:id/assign)
// and is taken back for ten seconds by the board's own POST /content/:id/undo.
// On a phone the month becomes a list of the days something came in.

const UNDO_MS = 9000   // the server keeps the move for 10 s; a second is left for the way there
const shift = (month, n) => {
  const d = new Date(`${month}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 7)
}
const monthLabel = (month, style = 'long') => monthName(Number(month.slice(0, 4)), Number(month.slice(5, 7)), style)
const stateWord = (v) => (v.state === 'done' ? tx('Done') : v.state === 'editing' ? tx('With editor') : v.late ? tx('Waiting over 2 days') : tx('New'))
const waitWords = (n) => (n <= 0 ? tx('came in today') : n === 1 ? tx('waiting 1 day') : tx('waiting {n} days', { n }))

function Card({ v, onOpen, withDay = false }) {
  const cls = v.state === 'new' ? (v.late ? 'late' : 'new') : v.state
  return (
    <button type="button" className={`co-am-card ${cls}`} onClick={() => onOpen(v.id)}
      aria-label={`${v.name}: ${stateWord(v)}`} data-video={v.id}>
      <span className="co-am-nm">{firstName(v)}</span>
      {v.state === 'new' && v.late && <b className="co-am-mk" aria-hidden="true">!</b>}
      {v.state === 'editing' && <Scissors size={13} aria-hidden="true" />}
      {v.state === 'done' && <Check size={13} aria-hidden="true" />}
      {withDay && <small>{dayMonth(v.day)}</small>}
    </button>
  )
}

export default function AmbassadorsCalendar({ toggle }) {
  const [month, setMonth] = useState('')       // '' = the server's month, until it says which
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)
  const [undo, setUndo] = useState(null)       // { task, name, until }
  const [left, setLeft] = useState(0)
  const [undoing, setUndoing] = useState(false)

  const load = useCallback(() => api.get(`/ambassadors/videos${month ? `?month=${month}` : ''}`)
    .then((d) => { setData(d); setErr('') })
    .catch((e) => setErr(e.message)), [month])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!undo) return undefined
    const tick = () => { const s = Math.ceil((undo.until - Date.now()) / 1000); if (s <= 0) setUndo(null); else setLeft(s) }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [undo])

  if (err) return <div className="card card-pad empty">{err}</div>
  if (!data) return <div className="app-loading"><span className="spinner" /></div>

  const shown = month || data.month
  const today = data.today
  const all = [...data.videos, ...data.earlier]
  const open = all.find((v) => v.id === openId) || null
  const cells = monthCells(shown)
  const onDay = (day) => data.videos.filter((v) => v.day === day)

  const assigned = (v, out) => {
    setOpenId(null)
    setUndo({ task: out.task_id, name: v.name, until: Date.now() + UNDO_MS })
    load()
  }
  const takeBack = async () => {
    if (undoing || !undo) return
    setUndoing(true)
    try {
      await api.post(`/content/${undo.task}/undo`)
      toast(tx('Back to New'))
    } catch (e) { toast(e.message, 'err') } finally { setUndo(null); setUndoing(false); load() }
  }

  return (
    <div className="co-am">
      <header className="co-am-head">
        <h2>{tx('Ambassadors')}</h2>
        {undo && (
          <div className="co-note co-n-wait co-am-undo" role="status">
            <span>{tx('Given to an editor: {name}.', { name: firstName(undo) })}</span>
            <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={undoing} onClick={takeBack}>
              <Undo2 size={16} aria-hidden="true" />{tx('Undo, back to New')} · {left}
            </button>
          </div>
        )}
        {toggle}
      </header>

      <section className="co-card co-am-box">
        <div className="co-am-nav">
          <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setMonth(shift(shown, -1))}
            aria-label={tx('Previous month')}><ChevronLeft size={16} aria-hidden="true" />{monthLabel(shift(shown, -1), 'short')}</button>
          <h3>{monthLabel(shown)} {shown.slice(0, 4)}</h3>
          <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setMonth(shift(shown, 1))}
            aria-label={tx('Next month')}>{monthLabel(shift(shown, 1), 'short')}<ChevronRight size={16} aria-hidden="true" /></button>
        </div>
        <p className="co-am-legend">
          <span><i className="new" />{tx('New')}</span>
          <span><i className="late" />{tx('Waiting over 2 days')}</span>
          <span><i className="editing" />{tx('With editor')}</span>
          <span><i className="done" />{tx('Done')}</span>
        </p>

        {data.earlier.length > 0 && (
          <div className="co-am-earlier">
            <b>{tx('Sent earlier')}</b>
            {data.earlier.map((v) => <Card key={v.id} v={v} onOpen={setOpenId} withDay />)}
          </div>
        )}

        {data.videos.length === 0 ? (
          <p className="co-am-none">{tx('No videos from ambassadors this month')}</p>
        ) : (
          <>
            <div className="co-am-wk" aria-hidden="true">
              {weekCells('2024-01-01').map((d) => <span key={d}>{weekdayShort(d)}</span>)}
            </div>
            <div className="co-am-grid">
              {cells.map((d) => {
                const other = d.slice(0, 7) !== shown
                return (
                  <div key={d} className={'co-am-cell' + (other ? ' other' : '') + (d === today ? ' today' : d > today ? ' ahead' : '')}>
                    <span className="co-am-dn">{other ? dayMonth(d) : <b>{Number(d.slice(8))}</b>}</span>
                    {!other && onDay(d).map((v) => <Card key={v.id} v={v} onOpen={setOpenId} />)}
                  </div>
                )
              })}
            </div>
            <div className="co-am-days">
              {dayRuns(shown, data.videos, today).map((r) => (r.day ? (
                <div key={r.day} className="co-am-day">
                  <h4>{dayShort(r.day)}</h4>
                  {r.videos.map((v) => <Card key={v.id} v={v} onOpen={setOpenId} />)}
                </div>
              ) : (
                <p key={r.from} className="co-am-run">
                  {r.from === r.to ? dayMonth(r.from) : `${Number(r.from.slice(8))}–${dayMonth(r.to)}`}: {r.ahead ? tx('still ahead, nothing sent yet') : tx('nothing sent')}
                </p>
              )))}
            </div>
          </>
        )}
      </section>

      {open && <VideoSheet v={open} channels={data.channels} onClose={() => setOpenId(null)} onAssigned={assigned} />}
    </div>
  )
}

// ---- one video: who sent it, the video itself, and the editor's button --------
// From the right on a desk (over a scrim), from the bottom on a phone.
function VideoSheet({ v, channels, onClose, onAssigned }) {
  const [closing, setClosing] = useState(false)
  const [chan, setChan] = useState(() => (channels.find((c) => c.key === 'instagram_main') || channels[0])?.key || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const closeBtn = useRef(null)
  const close = useCallback(() => {
    if (busy) return
    setClosing(true)
    setTimeout(onClose, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 180)
  }, [busy, onClose])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  useEffect(() => {
    const opener = document.activeElement
    document.body.classList.add('co-held')
    closeBtn.current?.focus({ preventScroll: true })
    return () => {
      document.body.classList.remove('co-held')
      if (opener && document.contains(opener)) opener.focus?.({ preventScroll: true })
    }
  }, [])

  const ch = channels.find((c) => c.key === chan)
  const label = (e) => (ch.editors.filter((x) => firstName(x) === firstName(e)).length > 1 ? e.name : firstName(e))
  const assign = async (e) => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const out = await api.post(`/ambassadors/cards/${v.id}/assign`, { channel: chan, editor_id: e.id })
      onAssigned(v, out)
    } catch (x) { setErr(x.message); setBusy(false) }
  }
  const meta = [v.university, tx('sent {day}', { day: dayMonth(v.day) }), v.state === 'new' && waitWords(v.waited)].filter(Boolean).join(', ')

  return (
    <div className={'co-win co-am-win' + (closing ? ' out' : '')}>
      <div className="co-scrim" onMouseDown={close} />
      <aside className="co-panel co-am-panel" role="dialog" aria-modal="true" aria-labelledby="co-am-t">
        <header className="co-p-head">
          <h2 id="co-am-t">{v.name}</h2>
          <button type="button" className="co-x" ref={closeBtn} onClick={close} aria-label={tx('Close')}><X size={18} aria-hidden="true" /></button>
          <div className="co-p-meta">{meta}{v.format ? ` · ${v.format}` : ''}</div>
        </header>
        <div className="co-p-body">
          <Preview key={v.id} url={v.url} />
          {v.state !== 'new' && (
            <section className="co-act co-am-state">
              <h3>{v.state === 'done' ? tx('Done: published') : tx('With editor')}</h3>
              <p className="co-lead">{v.state === 'done'
                ? tx('{editor} edited it; published on {channel}.', { editor: v.task.editor || tx('The editor'), channel: v.task.channel })
                : tx('{editor} is editing it for {channel}.', { editor: v.task.editor || tx('The editor'), channel: v.task.channel })}</p>
              <Link className="co-link" to={`/brief?task=${v.task.id}`}>{tx('Open task')}</Link>
              <p className="co-after">{tx('An editor is already set, so it can’t be assigned again. Change it inside the task.')}</p>
            </section>
          )}
        </div>
        {v.state === 'new' && (
          <footer className="co-am-foot">
            {!ch ? (
              <p className="co-after">{tx('Only an admin of a channel can give a video to an editor on it.')}</p>
            ) : (
              <>
                <label className="co-lbl">{tx('Channel')}
                  <select className="select" value={chan} disabled={busy} onChange={(e) => { setChan(e.target.value); setErr('') }}>
                    {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <b className="co-am-ask">{tx('Assign editor')}</b>
                {ch.editors.length ? ch.editors.map((e) => (
                  <button key={e.id} type="button" className="co-am-ed" disabled={busy} onClick={() => assign(e)}>
                    <span>{tx('Assign {name}', { name: label(e) })}</span>
                    <small>{tx('Editing task on {channel}', { channel: ch.label })}</small>
                  </button>
                )) : <p className="co-after">{tx('Nobody edits on {channel} yet. Give somebody the editor’s role in Admin → People.', { channel: ch.label })}</p>}
                {err && <div className="form-error" role="alert">{err}</div>}
                <p className="co-after">{tx('Then the card turns violet. Undo for 10 s. Pay, reminders, deadline: as usual.')}</p>
              </>
            )}
          </footer>
        )}
      </aside>
    </div>
  )
}

// The video itself. A file plays here; YouTube and Drive play here once asked
// (their player is a page of its own, so it is not loaded for nothing); the
// link always opens in a new tab as well.
function Preview({ url }) {
  const [play, setPlay] = useState(false)
  const how = embedOf(url)
  return (
    <div className="co-am-prev">
      {how?.file && <video className="co-am-video" src={url} controls preload="metadata" playsInline />}
      {how?.src && (play
        ? <iframe className="co-am-video" src={how.src} title={tx('The video')} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        : <button type="button" className="co-btn co-btn-s" onClick={() => setPlay(true)}><Play size={16} aria-hidden="true" />{tx('Play here')}</button>)}
      <a className="co-link" href={url} target="_blank" rel="noreferrer">{tx('Open the link in a new tab')}</a>
    </div>
  )
}

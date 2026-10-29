import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Clock, ArrowRightCircle, MessageSquare, AtSign, CalendarClock, RotateCcw, UserRound, Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { tr as tx } from '../lib/i18n.jsx'
import { playNotify } from '../lib/sound.js'
import { toast } from '../lib/toast.js'
import { WhatsNew, newsSeen, markNewsSeen } from './CoachParts.jsx'

// A bell where everything wears the same arrow makes you read every line to
// find the one that needs you. Being NAMED in a thread and being asked to
// move a deadline are the two that do — so they look like themselves.
const KIND = {
  status:  { icon: ArrowRightCircle },
  comment: { icon: MessageSquare },
  mention: { icon: AtSign },
  date_request: { icon: CalendarClock },
  pravki:  { icon: RotateCcw },
  review:  { icon: Eye },
  assigned: { icon: UserRound },
}

// The bell: status changes on your tasks (written by whoever moved them)
// and deadline reminders standing a day / a week out. Reminders are derived
// server-side and never stored, so "read" for them lives in localStorage;
// events are marked read on the server. A row opens its task via the
// pasteable /brief?task= link machinery.
const SEEN_KEY = (uid) => `satashkent_rem_seen_${uid}`
const readSeen = (uid) => {
  try { const a = JSON.parse(localStorage.getItem(SEEN_KEY(uid)) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}

export default function NotificationsBell({ user }) {
  const [data, setData] = useState({ events: [], reminders: [] })
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => readSeen(user.id))
  // "What changed" (D-06): the release's lines are the first item of the
  // bell, counted in the badge until the bell is opened once after the
  // release; they stay in view for that opening and are gone after it.
  const [news, setNews] = useState(() => !newsSeen())
  const [newsShown, setNewsShown] = useState(false)
  const close = () => { setOpen(false); setNewsShown(false) }
  const wrapRef = useRef(null)
  const navigate = useNavigate()

  // "Ready for your review" is the one line that should not wait to be found
  // in a list. The newest event already seen is remembered, and a poll that
  // brings a NEWER review cue plays the ding and says so in a toast with the
  // task one press away. The first answer only sets the mark: what arrived
  // while the dashboard was closed is in the bell, not in your ears.
  const seenTop = useRef(null)
  const take = (d) => {
    if (!d) return
    const events = d.events || []
    if (seenTop.current !== null) {
      const fresh = events.filter((e) => e.kind === 'review' && !e.read_at && e.id > seenTop.current)
      if (fresh.length) {
        playNotify()
        const to = fresh[0].content_id
        toast(tx('New work ready for review'), 'ok',
          to ? { label: tx('Open'), onClick: () => navigate(`/brief?task=${to}`) } : null)
      }
    }
    seenTop.current = events.reduce((m, e) => Math.max(m, e.id), seenTop.current ?? 0)
    setData(d)
  }

  useEffect(() => {
    api.get('/notifications').then(take).catch(() => {})
    // The bell keeps the pace of the content pages (ETag-cheap 304s), so news
    // lands within seconds, not half a minute. A dashboard left open in a
    // background tab still listens — that is where a reviewer is when the cut
    // lands — only at a third of the pace.
    let tick = 0
    const id = setInterval(() => {
      tick++
      if (document.hidden && tick % 3) return
      api.pollView('/notifications').then(take).catch(() => {})
    }, 12000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // A tap anywhere else closes the panel.
  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!wrapRef.current?.contains(e.target)) close() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const unread = data.events.filter((e) => !e.read_at).length +
    data.reminders.filter((r) => !seen.includes(r.id)).length + (news ? 1 : 0)

  const markAll = async () => {
    const ids = data.reminders.map((r) => r.id).slice(0, 200)
    localStorage.setItem(SEEN_KEY(user.id), JSON.stringify(ids))
    setSeen(ids)
    try {
      await api.post('/notifications/read-all')
      take(await api.get('/notifications'))
    } catch { /* the badge just stays */ }
  }
  const go = (n) => {
    close()
    if (n.content_id) navigate(`/brief?task=${n.content_id}`)
  }

  return (
    <span className="notif-wrap" ref={wrapRef}>
      <button className="icon-btn"
        onClick={() => {
          if (open) { close(); return }
          // opening the panel asks for the freshest news right away
          api.pollView('/notifications').then(take).catch(() => {})
          if (news) { markNewsSeen(); setNews(false); setNewsShown(true) }
          setOpen(true)
        }}
        data-tip={tx("Notifications")} aria-label={`${tx('Notifications')}${unread ? ` — ${tx('{n} unread', { n: unread })}` : ''}`}>
        <Bell size={17} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel card">
          <div className="notif-head">
            <b>{tx("Notifications")}</b>
            {(data.events.length > 0 || data.reminders.length > 0) && (
              <button className="lnk" onClick={markAll}><CheckCheck size={13} />{' '}{tx("Mark all read")}</button>
            )}
          </div>
          {newsShown && <WhatsNew onClose={() => setNewsShown(false)} />}
          {data.reminders.length === 0 && data.events.length === 0 && !newsShown && (
            <div className="notif-empty">{tx("All quiet — nothing due, nothing moved.")}</div>
          )}
          {data.reminders.map((r) => (
            <button key={r.id} className={'notif-row' + (seen.includes(r.id) ? ' seen' : '')} onClick={() => go(r)}>
              <Clock size={14} className="notif-ico notif-rem" />
              <span>{r.text}</span>
            </button>
          ))}
          {data.events.map((e) => {
            const K = KIND[e.kind] || KIND.status
            return (
              <button key={e.id} className={'notif-row nr-' + (KIND[e.kind] ? e.kind : 'status') + (e.read_at ? ' seen' : '')} onClick={() => go(e)}>
                <K.icon size={14} className="notif-ico" />
                <span>{e.text}</span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Palette, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api, cache } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { can, todayISO, isDeletedLabel, tashkentDay } from '../lib/constants.js'
import { deliveryHref } from '../lib/text.js'
import ContentModal from '../components/ContentModal.jsx'
import DesignBoard from '../components/DesignBoard.jsx'
import HandIn from '../components/HandIn.jsx'
import { toast, loadFailed } from '../lib/toast.js'
import { tr as tx, locale } from '../lib/i18n.jsx'

// ---- the designer's own board ----
//
// A designer's work was scattered across channel boards built for filmed
// content: their piece sat in a column called Editing between two videos they
// had nothing to do with, their deadline was a field three sections down, and
// the folder their files actually live in was on a different page entirely.
//
// This is the same work on a board of its own, and — since this round — in
// columns of its own. The four fixed lanes it used to have were read off the
// task (has it a brief? is there a link back?) which meant the board could
// describe the work but a designer could not TELL it anything. «Sent back»
// and «On hold» are not states any field implies; they are things a person
// knows and needs somewhere to say. So the columns are real stages now, the
// admin edits them like the content ones, and a card is dragged between them.
//
// Drive is still the workspace, and the board still admits it. Every card
// opens the channel's shared folder in one press; the artwork comes back as a
// Drive link on the task. Nothing is uploaded here — the files were never
// going to live in a dashboard.

const monthOf = (iso) => iso.slice(0, 7)
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const monthWords = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })

// The day the artwork is owed. Its own deadline if it has one, otherwise the
// release it is blocking — a designer with no design deadline is not free,
// they are working to the release.
const dueOf = (t) => t.design_ready_date || t.release_date || null

// Whether there is anything to design FROM. No longer a lane of its own —
// a column is something a person chooses — but still the first thing a
// designer needs to know about a card, so it rides along as a badge.
const briefedOf = (t) => !!(t.reference_text || (t.reference_links || []).length || t.tz || t.has_photo)

export default function Design() {
  const { user } = useAuth()
  const { visible: channels, byKey } = useChannels()
  const isAdmin = user.role === 'admin'
  // Somebody who gives work out — an admin, or a planner on the channels — may
  // give a design from here and sees the design work of the whole team, the
  // planner only on the channels they work on. A designer sees their own.
  const gives = isAdmin || can(user, 'manage_content')
  const planner = gives && !isAdmin && user.role !== 'designer'
  const today = todayISO()

  const [boot] = useState(() => cache.get('design'))
  const [content, setContent] = useState(boot?.content || [])
  const [statuses, setStatuses] = useState(boot?.statuses || [])
  const [stages, setStages] = useState(boot?.stages || [])
  const [team, setTeam] = useState(boot?.team || [])
  const [loading, setLoading] = useState(!boot)
  const [openItem, setOpenItem] = useState(null) // a task, or 'new'
  const [handing, setHanding] = useState(null)
  const [busy, setBusy] = useState(() => new Set())

  // A month, as everywhere else on the board.
  const [month, setMonth] = useState(() => monthOf(today))
  const [who, setWho] = useState(isAdmin || planner ? 'all' : String(user.id))
  const [chan, setChan] = useState('all')

  // Only the design work, with its pictures — the cards draw the reference.
  // The pictures stay out of the cache, to keep localStorage light.
  const LIST = '/content?design=1&thumbs=1'
  useEffect(() => {
    Promise.all([api.get(LIST), api.cached('/statuses'), api.cached('/users'), api.get('/design-statuses')])
      .then(([c, s, u, d]) => {
        setContent(c); setStatuses(s); setTeam(u); setStages(d)
        cache.set('design', { content: c.map(({ photo_thumb: _t, ...rest }) => rest), statuses: s, team: u, stages: d })
      })
      .catch(loadFailed)
      .finally(() => setLoading(false))
  }, [])
  // Artwork handed in somewhere else — the sheet, My Day — shows up here
  // within seconds. Paused while a task is open or the tab is hidden.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || openItem) return
      api.poll(LIST).then((f) => { if (f) setContent(f) }).catch(() => {})
    }
    const id = setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(id); window.removeEventListener('focus', refresh) }
  }, [openItem])

  const teamById = useMemo(() => Object.fromEntries(team.map((u) => [u.id, u])), [team])
  const designers = useMemo(
    () => team.filter((u) => (u.crew_roles || []).includes('designer') || u.role === 'designer'),
    [team])

  // What counts as design work: a piece somebody has handed to a designer, or
  // one carrying an artwork deadline, or a post — the type that is artwork by
  // definition. A video nobody has asked for artwork on is not on this board.
  // A post going only to written channels (Telegram, X…) is typed, not drawn —
  // half the board's new column was text nobody designs (the bug hunt, 14 Oct 2026).
  const writtenOnly = (t) => (t.channels || []).length > 0 && (t.channels || []).every((k) =>
    ['text', 'short', 'repost'].includes(byKey[k]?.format) && !(t.with_media && byKey[k]?.format === 'short'))
  const mine = useMemo(() => {
    const dead = new Set(statuses.filter((s) => isDeletedLabel(s.label)).map((s) => s.id))
    return content.filter((t) => {
      if (dead.has(t.status_id)) return false
      if (!(t.designer_id || t.design_ready_date || (t.type === 'post' && !writtenOnly(t)))) return false
      if (planner && t.designer_id !== user.id && !(t.channels || []).some((k) => channels.some((c) => c.key === k))) return false
      if (who !== 'all' && t.designer_id !== Number(who)) return false
      if (chan !== 'all' && !(t.channels || []).includes(chan)) return false
      const day = t.done_at ? tashkentDay(t.done_at) : dueOf(t)
      // Undated work is always visible: it is the work most likely to be lost.
      return !day || monthOf(day) === month
    })
  }, [content, statuses, who, chan, month, planner, channels, user.id])

  // Handed in is not late: artwork delivered and waiting at Ready stayed red
  // here until somebody published the piece.
  const lateCount = useMemo(
    () => mine.filter((t) => !t.done_at && !t.ready_at && dueOf(t) && dueOf(t) < today).length,
    [mine, today])

  const updateContent = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setContent((prev) => prev.map((x) => (x.id === item.id ? u : x)))
    return u
  }
  // Given from this board, it lands in the first design column.
  const createContent = async (payload) => {
    const c = await api.post('/content', payload)
    setContent((prev) => [c, ...prev])
    return c
  }
  const deleteContent = async (item) => {
    await api.del(`/content/${item.id}`)
    setContent((prev) => prev.filter((x) => x.id !== item.id))
  }

  // A drag is one field. The card is marked busy while it is in flight and put
  // back where it came from if the server refuses — a board that shows a move
  // that did not happen is worse than one that is slow.
  const moveDesign = async (item, stageId) => {
    setBusy((b) => new Set(b).add(item.id))
    const before = item.design_status_id
    setContent((prev) => prev.map((x) => (x.id === item.id ? { ...x, design_status_id: stageId } : x)))
    try {
      const saved = await api.patch(`/content/${item.id}`, { design_status_id: stageId })
      setContent((prev) => prev.map((x) => (x.id === item.id ? saved : x)))
      const to = stages.find((s) => s.id === stageId)
      if (to) toast(`${item.title} → ${to.label}`)
    } catch (e) {
      setContent((prev) => prev.map((x) => (x.id === item.id ? { ...x, design_status_id: before } : x)))
      toast(e.message, 'err')
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(item.id); return n })
    }
  }

  // The folder this piece's files live in — the channel's shared Drive folder.
  const folderOf = (t) => {
    for (const k of t.channels || []) {
      const url = (byKey[k]?.drive_url || '').trim()
      if (url) return url
    }
    return ''
  }
  const artOf = (t) => deliveryHref(t.design_link)

  if (loading) return <div className="app-loading"><span className="spinner" /></div>

  return (
    <>
      <div className="section-head">
        <Palette size={17} style={{ color: 'var(--brand-500)' }} />
        <h2>{tx('Design')}</h2>
        {lateCount > 0 && (
          <span className="chip chip-muted" data-tip={tx('past their day')}><i className="dot dot-late" /> {lateCount}</span>
        )}
        <span className="spacer" />
        {gives && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenItem('new')}>
            <Plus size={14} /> {tx('Give a design')}
          </button>
        )}
        <div className="at-month">
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}
            aria-label={tx('Previous month')} data-tip={tx('Previous month')}><ChevronLeft size={18} /></button>
          <b>{monthWords(month)}</b>
          <button className="icon-btn" onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={tx('Next month')} data-tip={tx('Next month')}><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="dz-filters">
        {(isAdmin || planner) && designers.length > 1 && (
          <div className="pill-group">
            <button className={'pill' + (who === 'all' ? ' active' : '')} onClick={() => setWho('all')}>{tx('Everyone')}</button>
            {designers.map((u) => (
              <button key={u.id} className={'pill' + (who === String(u.id) ? ' active' : '')}
                onClick={() => setWho(String(u.id))}>{u.name.split(' ')[0]}</button>
            ))}
          </div>
        )}
        {/* One menu, not a row of twelve buttons. */}
        <select className="select co-chan-pick" aria-label={tx('Channels')} value={chan} onChange={(e) => setChan(e.target.value)}>
          <option value="all">{tx('All channels')}</option>
          {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>

      {stages.length === 0
        ? <div className="empty">{tx('No design stages yet — an admin adds them in the admin panel.')}</div>
        : (
          <DesignBoard
            items={mine}
            stages={stages}
            teamById={teamById}
            today={today}
            onMove={moveDesign}
            onOpen={setOpenItem}
            folderOf={folderOf}
            artOf={artOf}
            dueOf={dueOf}
            briefedOf={briefedOf}
            isBusy={(id) => busy.has(id)}
            onHandIn={(t) => (t.designer_id === user.id ? setHanding(t) : setOpenItem(t))}
          />
        )}

      {openItem && (
        <ContentModal key={openItem === 'new' ? 'new' : openItem.id} item={openItem === 'new' ? null : openItem} statuses={statuses}
          defaults={openItem === 'new' ? {
            type: 'post', design: true,
            ...(chan !== 'all' ? { channels: [chan] } : {}),
            ...(who !== 'all' ? { designer_id: Number(who) } : {}),
          } : undefined}
          onClose={(next) => setOpenItem(next?.id ? next : null)}
          onCreate={createContent}
          onUpdate={updateContent}
          onDelete={deleteContent}
        />
      )}
      {handing && (
        <HandIn item={handing} kind="design"
          onDone={(u) => setContent((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
          onClose={() => setHanding(null)}
          onOpenFull={setOpenItem} />
      )}
    </>
  )
}

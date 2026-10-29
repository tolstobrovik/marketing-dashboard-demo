import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useChannels } from '../../lib/channels.jsx'
import { dateLabel } from '../../lib/constants.js'
import { monthLabel } from '../../lib/month.js'
import { KIND, KindTile, Badge, Face, Chans, More } from '../CoachParts.jsx'
import ContentModal from '../ContentModal.jsx'
import DataHealth from '../DataHealth.jsx'
import { toast, loadFailed } from '../../lib/toast.js'
import { tr as tx } from '../../lib/i18n.jsx'

// ---- Numbers → People: who is late, and how late ----------------------------------
//
// "Too ambiguous, too many buttons and clicks — simple and minimal." So the
// tab answers one question: who is late, and how late. One row a person —
// how many of their steps were on time and how many late. A row opens to
// their late ones: what, which step, due, done, how late; a press opens the
// task. The month, the channel and the person come from the Numbers page's
// one picker and two menus (N-02); this was the Statistics page (/missed).
//
// Whose lateness it is and what counts is the server's (GET
// /content/stats/people, routes/content.js): each person on their own step and
// their own clock, posts by the real Instagram time, a late post with no
// recorded cut "unclear" and charged to nobody, a step in the month it was due.
// An admin sees the team; anybody else their own row, already open.
const STEP_KIND = { shoot: 'shoot', cut: 'edit', artwork: 'design', posting: 'send' }
const STEP_WORD = { shoot: () => tx('Shoot'), cut: () => tx('Editing'), artwork: () => tx('Artwork'), posting: () => tx('Posting') }
export default function People({ month, channel = 'all', person = '' }) {
  const { byKey } = useChannels()
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [team, setTeam] = useState([])
  const [statuses, setStatuses] = useState([])
  const [openItem, setOpenItem] = useState(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    api.cached('/users').then((u) => setTeam(Array.isArray(u) ? u : [])).catch(() => {})
    api.cached('/statuses').then(setStatuses).catch(() => {})
  }, [])
  useEffect(() => {
    let alive = true
    api.get(`/content/stats/people?month=${month}`)
      .then((d) => { if (alive) { setData(d); if (!d.everyone) setOpen(d.people[0]?.id ?? null) } })
      .catch(loadFailed)
    return () => { alive = false }
  }, [month, reload])
  // One person chosen on the page: their row, open.
  useEffect(() => { if (person) setOpen(Number(person)) }, [person])

  const on = (i) => channel === 'all' || i.channels.includes(channel)
  const rows = (data?.people || [])
    .map((p) => {
      const items = p.items.filter(on)
      return { ...p, any: items.length, ok: items.filter((i) => i.state === 'ok').length,
        late: items.filter((i) => i.state === 'late'), unclear: items.filter((i) => i.state === 'unclear').length }
    })
    .filter((p) => (p.any || !data.everyone) && (!person || String(p.id) === String(person)))
    .sort((a, b) => b.late.length - a.late.length || a.name.localeCompare(b.name))
  const who = (p) => team.find((u) => u.id === p.id) || { name: p.name }

  const openTask = async (id) => {
    try { setOpenItem(await api.get(`/content/${id}`)) } catch (e) { toast(e.message, 'err') }
  }
  const done = () => { setOpenItem(null); setReload((n) => n + 1) }

  return (
    <div className="co co-stats">
      <section className="co-card" aria-label={tx('Who is late')}>
        {!data || data.month !== month ? <div className="app-loading"><span className="spinner" /></div>
          : rows.length === 0 ? <p className="co-quiet">{tx('Nothing was due in {month}.', { month: monthLabel(month) })}</p>
          : rows.map((p) => {
            const isOpen = open === p.id
            return (
              <div key={p.id} className={'st-person' + (isOpen ? ' open' : '')}>
                <div className="co-row nonum">
                  <Face person={who(p)} size="md" />
                  <button type="button" className="co-row-b" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                    <span className="co-row-t">{who(p).name}</span>
                    <span className="co-row-f">{tx('{n} on time', { n: p.ok })}</span>
                  </button>
                  <span className="co-row-r">
                    {p.unclear > 0 && <span title={tx('Posted late, but nobody recorded when the edit came in — charged to nobody')}><Badge>{tx('{n} unclear', { n: p.unclear })}</Badge></span>}
                    <Badge tone={p.late.length ? 'late' : 'good'}>{tx('{n} late', { n: p.late.length })}</Badge>
                    <ChevronDown size={16} className="st-chev" aria-hidden="true" />
                  </span>
                </div>
                {isOpen && (
                  <div className="st-items">
                    {p.late.length === 0
                      ? <p className="co-quiet">{tx('Nothing late. Every step on time.')}</p>
                      : p.late.map((i) => (
                        <div key={`${i.content_id}:${i.step}`} className={`co-row nonum ${KIND[STEP_KIND[i.step]].cls}`}>
                          <KindTile kind={STEP_KIND[i.step]} />
                          <button type="button" className="co-row-b" onClick={() => openTask(i.content_id)}>
                            <span className="co-row-t">{i.title}</span>
                            <span className="co-row-f">
                              {STEP_WORD[i.step]()} · {tx('due {day}', { day: dateLabel(i.due) })} → {i.done ? dateLabel(i.done) : tx('not done yet')}
                            </span>
                            <span className="co-row-m"><Chans keys={i.channels} byKey={byKey} /></span>
                          </button>
                          <span className="co-row-r">
                            <Badge tone="late">{i.days_late === 1 ? tx('1 day late') : tx('{n} days late', { n: i.days_late })}</Badge>
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
      </section>

      {/* Not statistics — but the admin's way to put right a task whose data is
          wrong, and nothing is taken away: it waits under More. */}
      {data?.everyone && (
        <More><DataHealth onOpenPiece={openTask} onFixed={() => setReload((n) => n + 1)} /></More>
      )}

      {openItem && (
        <ContentModal key={openItem.id} item={openItem} statuses={statuses}
          onClose={(next) => (next?.id ? setOpenItem(next) : done())}
          onUpdate={(item, payload) => api.patch(`/content/${item.id}`, payload)}
          onDelete={async (item) => { await api.del(`/content/${item.id}`); done() }} />
      )}
    </div>
  )
}

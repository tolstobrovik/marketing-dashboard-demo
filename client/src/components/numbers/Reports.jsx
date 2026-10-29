import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, UserCheck, Video, Scissors, Palette, CheckSquare, CheckCircle2, Undo2 } from 'lucide-react'
import { api } from '../../lib/api.js'
import { toast } from '../../lib/toast.js'
import { todayISO, addDaysISO, dateLabel, typeInfo, onColor, deptColor, tashkentDay, CONTENT_TYPES } from '../../lib/constants.js'
import { tr as tx } from '../../lib/i18n.jsx'
import { useChannels } from '../../lib/channels.jsx'
import Avatar from '../Avatar.jsx'
import Fold from '../Fold.jsx'
import { Dot } from '../Dot.jsx'
import { money } from './Pay.jsx'

// Numbers → People and Month (N-02): the Admin panel's Reports tab, lifted
// whole and split in two — `Reports` (who did what, what everyone made, the
// register and the month's "paid") on the People tab, `Views` (what it all
// got watched, and what worked best) on the Month tab. The window and the
// channel come from the page's one picker and one menu.
/* ==================== REPORTS ==================== */
// The five ways a person can have had a hand in a piece. Each is counted on
// the day THEIR part was delivered, not on the day the piece went out.
const HATS = [
  { key: 'assignee', label: 'Ran it', icon: UserCheck, noun: 'piece', verb: 'published', tip: 'Whose piece it was — the planner who saw it out' },
  { key: 'operator', label: 'Shot it', icon: Video, noun: 'shoot', verb: 'delivered', tip: 'Counted on the day the footage reached the editor' },
  { key: 'editor', label: 'Edited it', icon: Scissors, noun: 'edit', verb: 'delivered', tip: 'Counted on the day the edit reached review' },
  { key: 'designer', label: 'Designed it', icon: Palette, noun: 'piece', verb: 'designed', tip: 'Artwork has no handover of its own, so it counts when the piece goes out' },
  { key: 'reviewer', label: 'Signed it off', icon: CheckSquare, noun: 'sign-off', verb: 'given', tip: 'Review is shared — every name on it is counted' },
]

export function Reports({ range, channel = 'all', person = '', onChannel = null }) {
  const { channels, byKey } = useChannels()
  const [hat, setHat] = useState('assignee')
  const [type, setType] = useState('')
  const [data, setData] = useState(null)

  useEffect(() => {
    setData(null)
    api.get(`/reports?from=${range.from}&to=${range.to}&hat=${hat}${type ? `&type=${type}` : ''}`)
      .then(setData).catch(() => setData(null))
  }, [range.from, range.to, hat, type])

  // What each person actually MADE — filmed, edited, and both — and the
  // register those counts came from. Same window, same channel lens.
  const [work, setWork] = useState(null)
  const loadWork = useCallback(() => {
    api.get(`/reports/work?from=${range.from}&to=${range.to}&channel=${channel}`)
      .then(setWork).catch(() => setWork(null))
  }, [range.from, range.to, channel])
  useEffect(() => { setWork(null); loadWork() }, [loadWork])

  const colorOf = useMemo(() => Object.fromEntries(channels.map((c, i) => [c.key, deptColor(i)])), [channels])
  const chStats = channel !== 'all' ? data?.byChannel?.[channel] : null
  const shownTotal = channel === 'all' ? data?.totalDone : (chStats?.total || 0)

  // People, through the selected channel's lens — the same numbers as the
  // channel breakdown, never a second calculation.
  const people = useMemo(() => {
    if (!data) return []
    if (channel === 'all') return data.report
    return data.report
      .map((r) => ({ ...r, shown: r.byChannel[channel] || 0, items: r.items.filter((it) => (it.channels || [it.channel]).includes(channel)) }))
      .filter((r) => r.shown > 0 || r.role !== 'admin')
      .sort((a, b) => (b.shown || 0) - (a.shown || 0))
  }, [data, channel])

  return (
    <>

      {/* ---- what each person actually made ---- */}
      {/* The delivery report answers "was it on time". This answers "what did
          you make" — which for an operator or an editor is the whole question,
          and the board had no way to say it. */}
      {work && (
        <>
          <div className="section-head" style={{ marginTop: 4 }}>
            <h2>{tx('What everyone made')}</h2>
            <span className="count">· {tx('filmed, edited, and both')}</span>
          </div>
          <div className="card table-wrap">
            <table className="tbl work-tbl">
              <thead>
                <tr>
                  <th>{tx('Name')}</th>
                  <th data-tip={tx('Pieces they filmed and somebody else edited')}>{tx('Filmed')}</th>
                  <th data-tip={tx('Pieces they edited and somebody else filmed')}>{tx('Edited')}</th>
                  <th data-tip={tx('Pieces they both filmed and edited — one whole piece carried alone')}>{tx('Both')}</th>
                  <th data-tip={tx('Pieces their face carries')}>{tx('In front')}</th>
                  <th data-tip={tx('Where their delivered count puts them on the ladder')}>{tx('Grade')}</th>
                  <th data-tip={tx('What the tiers pay for what they filmed and edited')}>{tx('Tier pay')}</th>
                </tr>
              </thead>
              <tbody>
                {work.people.filter((p) => !person || String(p.user_id) === String(person)).map((p) => (
                  <tr key={p.user_id}>
                    <td><b>{p.name}</b></td>
                    <td>{p.filmed || <span className="stat-sub">—</span>}</td>
                    <td>{p.edited || <span className="stat-sub">—</span>}</td>
                    <td>{p.both || <span className="stat-sub">—</span>}</td>
                    <td>{p.faced || <span className="stat-sub">—</span>}</td>
                    <td>
                      {p.grade
                        ? <b>{p.grade}</b>
                        : <span className="stat-sub">—</span>}
                      {p.next && (
                        <span className="stat-sub"> · {tx('{name} at {n}', { name: p.next, n: p.next_at })}</span>
                      )}
                    </td>
                    <td>{p.tier_pay ? money(p.tier_pay, '') : <span className="stat-sub">—</span>}</td>
                  </tr>
                ))}
                {work.people.length === 0 && (
                  <tr><td colSpan={7} className="empty">{tx('Nothing sent')}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* The register the counts came from. Anybody can check the total
              rather than take it. */}
          <Fold id="admin_work_sheet" title={tx('Every piece, one by one')} count={work.sheet.length}>
            <div className="card table-wrap">
              <table className="tbl work-sheet">
                <thead>
                  <tr>
                    <th>#</th><th>{tx('Title')}</th><th>{tx('Filmed')}</th><th>{tx('Edited')}</th>
                    <th>{tx('In front')}</th><th>{tx('Views')}</th><th>{tx('Skip')}</th>
                    <th>{tx('Where it went')}</th><th>{tx('Paid')}</th>
                  </tr>
                </thead>
                <tbody>
                  {work.sheet.map((r) => (
                    <tr key={r.id}>
                      <td className="stat-sub">{r.n}</td>
                      <td><b>{r.title}</b><div className="stat-sub">{r.day}</div></td>
                      <td>{r.filmed_by || <span className="stat-sub">—</span>}</td>
                      <td>{r.edited_by || <span className="stat-sub">—</span>}</td>
                      <td>{r.face || <span className="stat-sub">—</span>}</td>
                      <td>{r.views == null ? <span className="stat-sub">{tx('not counted')}</span> : r.views.toLocaleString()}</td>
                      <td>
                        {r.skip_rate == null
                          ? <span className="stat-sub">{tx('not measured')}</span>
                          : <>{r.skip_rate}%{r.tier && <b className="chip chip-muted"> {r.tier}</b>}</>}
                      </td>
                      <td>
                        {r.post_link
                          ? <a href={r.post_link} target="_blank" rel="noreferrer">{tx('Open it')}</a>
                          : <span className="stat-sub">—</span>}
                      </td>
                      <td>{r.paid ? <b className="paid-yes">{tx('Paid')}</b> : <span className="stat-sub">{tx('Not yet')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ladder-foot">
                <span className="stat-sub">
                  {tx('{n} of {m} paid', { n: work.sheet.filter((r) => r.paid).length, m: work.sheet.length })}
                </span>
                <span className="spacer" />
                <MonthPaid month={work.sheet[0]?.day?.slice(0, 7) || ''} sheet={work.sheet} onDone={loadWork} />
              </div>
            </div>
          </Fold>
        </>
      )}

      {/* Whose work. The report counted only the ASSIGNEE — the planner —
          which made the crew invisible: an editor who cut forty videos in a
          month showed as nothing, because somebody else's name was on the
          assignee line. Each hat is now counted on the day THAT person's work
          left their hands. */}
      <div className="section-head" style={{ marginTop: 4 }}>
        <h2>{tx('Who did what')}</h2>
        <span className="count">{tx('· completed work, one source of truth')}</span>
      </div>
      <div className="rp-filters">
        <div className="pill-group">
          {HATS.map((h) => (
            <button key={h.key} className={'pill' + (hat === h.key ? ' active' : '')}
              onClick={() => setHat(h.key)} data-tip={h.tip}>
              <h.icon size={13} /> {h.label}
            </button>
          ))}
        </div>
        <select className="select rp-type" value={type} onChange={(e) => setType(e.target.value)}
          data-tip={tx('Only one kind of piece')}>
          <option value="">{tx('Every type')}</option>
          {CONTENT_TYPES.map((c) => <option key={c.key} value={c.key}>{typeInfo(c.key).plan || c.label}</option>)}
        </select>
      </div>

      {!data ? (
        <div className="app-loading"><span className="spinner" /></div>
      ) : (
        <>
          {/* The headline: one big number and where it happened */}
          <div className="card card-pad rp-head">
            <div className="rp-big">
              <b>{shownTotal}</b>
              <span className="rp-big-label">
                {HATS.find((h) => h.key === hat)?.noun || 'task'}{shownTotal === 1 ? '' : 's'} {HATS.find((h) => h.key === hat)?.verb || 'completed'}
                {channel !== 'all' ? <> on <b style={{ color: colorOf[channel] }}>{byKey[channel]?.label || channel}</b></> : ''}
                <br /><span className="stat-sub">{range.from} → {range.to}</span>
              </span>
            </div>
            <div className="rp-chips">
              {channel === 'all'
                ? channels.map((c) => {
                    const n = data.byChannel?.[c.key]?.total || 0
                    if (n === 0) return null
                    return (
                      <button key={c.key} className="chip rp-chan" style={{ background: colorOf[c.key], color: onColor(colorOf[c.key]) }}
                        onClick={() => onChannel?.(c.key)} data-tip={`Open ${c.label}'s report`}>
                        {c.label} · {n}
                      </button>
                    )
                  })
                : Object.entries(chStats?.byType || {}).map(([k, n]) => (
                    <span key={k} className={`chip ct-${k}`}>{typeInfo(k).plan || typeInfo(k).label} · {n}</span>
                  ))}
            </div>
          </div>

          {/* People — big bold numbers, biggest first */}
          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            {people.filter((r) => !person || String(r.id) === String(person)).map((r) => {
              const n = channel === 'all' ? r.total : r.shown
              return (
                <div className="card card-pad rp-person" key={r.id}>
                  <div className="rp-person-row">
                    <Avatar name={r.name} color={r.color} src={r.avatar} />
                    <div className="rp-person-meta">
                      <div className="rp-person-name">{r.name}</div>
                      <div className="dept-chips">
                        {channel === 'all' && Object.entries(r.byChannel).map(([k, cnt]) => (
                          <span key={k} className="chip" style={{ background: colorOf[k] || '#6d6a70', color: onColor(colorOf[k] || '#6d6a70') }}>
                            {byKey[k]?.label || k} · {cnt}
                          </span>
                        ))}
                        {Object.entries(r.byType).map(([k, cnt]) => (
                          <span key={k} className={`chip ct-${k}`}>{typeInfo(k).plan || typeInfo(k).label} · {cnt}</span>
                        ))}
                      </div>
                    </div>
                    <div className="rp-person-total">
                      <b>{n}</b>
                      <span>{tx('done')}</span>
                      {r.late > 0 && (
                        <span className="rp-late" data-tip={tx('Delivered after the day they promised. A piece that arrived to them late is not counted against them.')}>
                          {r.late} late
                        </span>
                      )}
                    </div>
                  </div>
                  {r.items.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary className="stat-sub" style={{ cursor: 'pointer' }}>Show the {r.items.length} item{r.items.length === 1 ? '' : 's'}</summary>
                      <div style={{ marginTop: 6 }}>
                        {r.items.map((it) => (
                          <div key={it.id} className="report-item">
                            <span>{it.title}</span>
                            <span className="stat-sub">
                              {byKey[it.channel]?.label || it.channel} · {it.day || (it.done_at ? tashkentDay(it.done_at) : '')}
                              {it.late && <Dot tone="late" label={tx('late')} />}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )
            })}
            {people.length === 0 && <div className="card card-pad empty">{tx('Nothing completed in this period.')}</div>}
          </div>
        </>
      )}
    </>
  )
}

// Paying happens outside this system. This records that somebody said it was
// done, and who — the same shape as the sprint board recording who dropped a
// task rather than pretending the system did it.
function MonthPaid({ month, sheet, onDone }) {
  const [busy, setBusy] = useState(false)
  if (!month) return null
  const unpaid = sheet.filter((r) => !r.paid).length
  const go = async (path) => {
    setBusy(true)
    try { const r = await api.post(`/reports/work/${path}`, { month }); toast(tx('Saved — synced')); onDone(r) }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  return unpaid > 0 ? (
    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('paid')}>
      {tx('Mark {month} paid', { month })}
    </button>
  ) : (
    <button className="btn btn-sm" disabled={busy} onClick={() => go('unpaid')}>
      {tx('Re-open {month}', { month })}
    </button>
  )
}

// What it all got watched, over the same window and through the same channel
// lens as the rest of the page.
export function Views({ range, channel = 'all' }) {
  const { channels } = useChannels()
  const colorOf = useMemo(() => Object.fromEntries(channels.map((c, i) => [c.key, deptColor(i)])), [channels])
  const [views, setViews] = useState(null)
  useEffect(() => {
    setViews(null)
    api.get(`/reports/views?from=${range.from}&to=${range.to}&channel=${channel}`)
      .then(setViews).catch(() => setViews(null))
  }, [range.from, range.to, channel])
  return (
    <>
      {/* ---- what it all got watched ---- */}
      {/* The delivery report says how much went out. It said nothing at all
          about whether anybody watched it, which is a strange thing for a
          marketing board to be quiet about. Same window, same channel lens. */}
      {views && (
        <>
          <div className="section-head" style={{ marginTop: 4 }}>
            <h2>{tx('Views')}</h2>
            <span className="count">· {tx('what the work actually got')}</span>
          </div>
          <div className="card card-pad vw-card">
            <div className="vw-tiles">
              <div className="vw-tile">
                <b>{views.totals.views.toLocaleString()}</b>
                <span>{tx('views in this period')}</span>
              </div>
              <div className="vw-tile">
                <b>{views.totals.avg === null ? '—' : views.totals.avg.toLocaleString()}</b>
                <span>{tx('average per counted piece')}</span>
              </div>
              <div className="vw-tile">
                <b>{views.totals.counted}<span className="stat-sub"> / {views.totals.pieces}</span></b>
                <span>{tx('pieces with a number on them')}</span>
              </div>
            </div>
            {/* A total drawn from a third of the month reads as if it were the
                whole month unless it says so. */}
            {views.uncounted > 0 && (
              <div className="vw-warn">
                <AlertCircle size={14} />
                {views.uncounted === 1
                  ? tx('One piece went out with nobody counting its views — this total is what has been counted, not what the month got.')
                  : `${views.uncounted} ${tx('pieces went out with nobody counting their views — this total is what has been counted, not what the month got.')}`}
              </div>
            )}
            {views.totals.pieces === 0 && (
              <div className="stat-sub">{tx('Nothing went out in this period.')}</div>
            )}

            {views.byType.length > 0 && (
              <div className="vw-split">
                <div className="vw-col">
                  <h3>{tx('By type')}</h3>
                  {views.byType.map((r) => (
                    <div key={r.key} className="vw-row">
                      <span className={`chip ct-${r.key}`}>{typeInfo(r.key).label}</span>
                      <span className="vw-bar">
                        <span style={{ width: `${views.byType[0].views > 0 ? Math.round((r.views / views.byType[0].views) * 100) : 0}%` }} />
                      </span>
                      <b>{r.views.toLocaleString()}</b>
                      <span className="stat-sub">{r.counted}/{r.pieces}</span>
                    </div>
                  ))}
                </div>
                <div className="vw-col">
                  <h3>{tx('By channel')}</h3>
                  {views.byChannel.map((r) => (
                    <div key={r.key} className="vw-row">
                      <span className="vw-name">
                        <span className="rp-dot" style={{ background: colorOf[r.key] }} />{r.label}
                      </span>
                      <span className="vw-bar">
                        <span style={{ width: `${views.byChannel[0].views > 0 ? Math.round((r.views / views.byChannel[0].views) * 100) : 0}%` }} />
                      </span>
                      <b>{r.views.toLocaleString()}</b>
                      <span className="stat-sub">{r.counted}/{r.pieces}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {views.byPerson.length > 0 && (
              <div className="vw-col" style={{ marginTop: 14 }}>
                <h3>{tx('By content maker')}</h3>
                {views.byPerson.map((r) => (
                  <div key={r.id} className="vw-row">
                    <span className="vw-name">{r.name || `#${r.id}`}</span>
                    <span className="vw-bar">
                      <span style={{ width: `${views.byPerson[0].views > 0 ? Math.round((r.views / views.byPerson[0].views) * 100) : 0}%` }} />
                    </span>
                    <b>{r.views.toLocaleString()}</b>
                    <span className="stat-sub">{r.counted}/{r.pieces}</span>
                  </div>
                ))}
              </div>
            )}

            {views.top.length > 0 && (
              <div className="vw-col" style={{ marginTop: 14 }}>
                <h3>{tx('What worked best')}</h3>
                {views.top.slice(0, 8).map((r) => (
                  <div key={r.id} className="vw-row">
                    <span className="vw-name vw-title">{r.title}</span>
                    <span className={`chip ct-${r.type}`}>{typeInfo(r.type).label}</span>
                    <b>{r.views.toLocaleString()}</b>
                    <span className="stat-sub">{dateLabel(r.day)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

    </>
  )
}

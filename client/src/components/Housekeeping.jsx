import { useCallback, useEffect, useState } from 'react'
import { Archive, Check, Undo2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import { dayShort, lateWords } from './CoachParts.jsx'

// ---- the overdue, and clearing it (r11 · the research report, upgrade 7) ---------------
//
// The review found 65 overdue items. An admin's day opens on how much is late,
// split by how late, and what leaves the board next: pieces more than N days
// past their day go on Monday unless somebody keeps them (server: runWeekly-
// Archive). "Archive them now" asks first and can be taken back whole; so can
// Monday's run. Archived pieces sit on the Deleted stage, where every board
// already keeps what is no longer being made.
//
// One line (the owner: "too complicated again"): the number, one sentence and
// its buttons. The two settings — editors' reminders, and how late counts as
// long overdue — are set once, in Admin → Settings (HousekeepingSettings).
export default function Housekeeping() {
  const [s, setS] = useState(null)
  const [asking, setAsking] = useState(false)
  const [looking, setLooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api.get('/content/housekeeping/summary').then(setS).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  if (!s) return null

  const archive = async () => {
    setBusy(true)
    try {
      const out = await api.post('/content/housekeeping/archive', {})
      setAsking(false); setLooking(false)
      toast(tx('{n} pieces moved to the archive', { n: out.archived }), 'ok', { label: tx('Undo'), onClick: undo })
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const undo = async () => {
    try { const out = await api.post('/content/housekeeping/undo', {}); toast(tx('{n} pieces brought back', { n: out.back })); load() } catch (e) { toast(e.message, 'err') }
  }
  const keep = async (id) => {
    try { await api.post(`/content/housekeeping/keep/${id}`, {}); setS((x) => ({ ...x, candidates: x.candidates.filter((c) => c.id !== id), kept: x.kept + 1 })) } catch (e) { toast(e.message, 'err') }
  }

  const n = s.candidates.length
  return (
    <section className="co-card hk" aria-label={tx('Overdue on the board')}>
      <div className="hk-head">
        <span className="co-bignum hk-num">{s.overdue}</span>
        <div className="hk-what">
          <h3>{tx('Pieces past their day')}</h3>
          <p>{!s.archive_days ? tx('Nothing is archived by itself — the clearing is switched off.')
            : n ? tx('{n} of them are more than {d} days late. They go to the archive on {day} unless somebody keeps them.', { n, d: s.archive_days, day: dayShort(s.next_run) })
              : tx('Nothing is more than {d} days late.', { d: s.archive_days })}</p>
        </div>
      </div>
      {asking ? (
        <div className="co-note co-n-wait hk-ask" role="alertdialog" aria-label={tx('Move them to the archive now?')}>
          <span><b>{n === 1 ? tx('Move 1 piece to the archive now?') : tx('Move {n} pieces to the archive now?', { n })}</b> {tx('They leave every board, list and calendar. You can bring them all back with one press.')}</span>
          <span className="co-btns">
            <button type="button" className="co-btn co-btn-p co-btn-sm" disabled={busy} onClick={archive}><Archive size={16} aria-hidden="true" />{tx('Yes, archive {n}', { n })}</button>
            <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setAsking(false)}>{tx('Cancel')}</button>
          </span>
        </div>
      ) : (n > 0 || s.last_batch) && (
        <div className="co-btns">
          {n > 0 && <button type="button" className="co-btn co-btn-o co-btn-sm" onClick={() => setLooking((v) => !v)}>{looking ? tx('Hide the list') : tx('Look through the {n}', { n })}</button>}
          {n > 0 && <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => setAsking(true)}><Archive size={16} aria-hidden="true" />{tx('Archive them now')}</button>}
          {s.last_batch && <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={undo}><Undo2 size={16} aria-hidden="true" />{tx('Bring back the last {n} archived', { n: s.last_batch.count })}</button>}
        </div>
      )}
      {looking && n > 0 && (
        <div className="hk-list">
          {s.candidates.slice(0, 40).map((c) => (
            <div key={c.id} className="hk-row">
              <span className="hk-t">{c.title}</span>
              <span className="hk-late">{lateWords(c.late)}</span>
              <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => keep(c.id)}><Check size={14} aria-hidden="true" />{tx('Keep')}</button>
            </div>
          ))}
          {n > 40 && <p className="co-help">{tx('and {n} more', { n: n - 40 })}</p>}
        </div>
      )}
    </section>
  )
}

// Admin → Settings: the editors' reminders and the Monday clearing.
export function HousekeepingSettings() {
  const [s, setS] = useState(null)
  useEffect(() => { api.get('/content/housekeeping/summary').then(setS).catch(() => {}) }, [])
  if (!s) return null
  const set = async (patch) => {
    try { const out = await api.post('/content/housekeeping/settings', patch); setS((x) => ({ ...x, ...out })); toast(tx('Saved')) } catch (e) { toast(e.message, 'err') }
  }
  return (
    <div className="hk-set">
      <label className="hk-opt">
        <input type="checkbox" checked={s.edit_reminders} onChange={(e) => set({ edit_reminders: e.target.checked })} />
        <span><b>{tx('Remind editors about their edits')}</b><small>{tx('The evening before it is due (18:00) and that morning (9:00), on My Day and on Telegram.')}</small></span>
      </label>
      <label className="hk-opt">
        <span><b>{tx('Archive pieces this late, on Mondays')}</b><small>{tx('Anyone can bring one back from the Deleted stage on its board.')}</small></span>
        <select className="select" value={s.archive_days} onChange={(e) => set({ archive_days: Number(e.target.value) })}>
          <option value={7}>{tx('7 days')}</option><option value={14}>{tx('14 days')}</option><option value={30}>{tx('30 days')}</option><option value={0}>{tx('Never')}</option>
        </select>
      </label>
    </div>
  )
}

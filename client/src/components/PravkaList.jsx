import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { tr as tx } from '../lib/i18n.jsx'
import { api } from '../lib/api.js'

// A pravka round as the list of changes Gemini made of it (server/pravkalist.js):
// the person fixing it ticks each change off, everybody else reads the ticks.
// What Gemini heard in the clip is one press away, and the list says who
// wrote it — an AI's list never looks like the reviewer's own words, which
// stay above it untouched.
//
// While the list is still being written (`list_wait`) the round is asked for
// again every few seconds, for a minute; after that it simply appears the
// next time the window opens.
const ASK_EVERY = 5000
const ASK_TIMES = 12

export default function PravkaList({ taskId, round, canTick = false }) {
  const [r, setR] = useState(round)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setR(round) }, [round])

  useEffect(() => {
    if (!r?.list_wait || r.checklist?.length || !taskId) return undefined
    let n = 0
    const id = setInterval(async () => {
      n++
      try {
        const fresh = (await api.get(`/content/${taskId}/revisions`)).find((x) => x.id === r.id)
        if (fresh && (fresh.checklist?.length || !fresh.list_wait)) { setR(fresh); clearInterval(id) }
      } catch { /* the next look */ }
      if (n >= ASK_TIMES) clearInterval(id)
    }, ASK_EVERY)
    return () => clearInterval(id)
  }, [r?.id, r?.list_wait, r?.checklist?.length, taskId])

  if (!r) return null
  const list = Array.isArray(r.checklist) ? r.checklist : []
  if (!list.length) {
    return r.list_wait
      ? <p className="co-pl-wait"><Sparkles size={13} aria-hidden="true" /> {tx('Gemini is writing the list of changes…')}</p>
      : null
  }
  const open = canTick && !r.resolved_at
  const left = list.filter((c) => !c.done).length

  const tick = async (i) => {
    if (!open || busy) return
    setBusy(true); setErr('')
    try {
      const out = await api.patch(`/content/revisions/${r.id}/checklist`, { i, done: !list[i].done })
      setR((x) => ({ ...x, checklist: out.checklist }))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="co-pl">
      <div className="co-pl-head">
        <b>{tx('Changes to make')}</b>
        <span className="co-pl-count">{left ? tx('{n} left', { n: left }) : tx('All done')}</span>
      </div>
      <ul className="co-pl-items">
        {list.map((c, i) => (
          <li key={i}>
            <label className={'co-pl-item' + (c.done ? ' is-done' : '')}>
              <input type="checkbox" checked={!!c.done} disabled={!open || busy} onChange={() => tick(i)} />
              <span>{c.text}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="co-pl-foot">
        <Sparkles size={12} aria-hidden="true" /> {tx('Gemini made this list from the pravka')}
        {r.heard ? (
          <details className="co-pl-heard">
            <summary>{tx('What was said')}</summary>
            <p>{r.heard}</p>
          </details>
        ) : null}
      </div>
      {err && <div className="rround-err">{err}</div>}
    </div>
  )
}

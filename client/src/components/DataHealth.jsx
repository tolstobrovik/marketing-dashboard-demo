import { useEffect, useState } from 'react'
import { Stethoscope, ChevronDown, CalendarCheck2, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api.js'
import { dateLabel } from '../lib/constants.js'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// ---- what the numbers are standing on --------------------------------------
//
// Every figure on the page above this one is a reading of the board, and the
// board is filled in by people with a shoot to get to. So this panel reports
// on the BOARD rather than on the work: where it is thin, which number goes
// thin with it, and — where the fix is mechanical — a button that does it.
//
// The big one is the day a piece counts as published. The board stamps that
// the moment somebody moves the card, and cards get moved in batches: on one
// afternoon in August thirty-two pieces were marked published at once, the
// oldest of them promised six weeks earlier. Read literally, that is a team
// that publishes everything late. Read honestly, it is a team that publishes
// and updates the board on Fridays. The difference is not a rounding error —
// it is every punctuality figure this dashboard has ever shown — and nobody
// but the admin knows which of the two it was, so the page says what it found
// and lets them answer it.
export default function DataHealth({ onOpenPiece, onFixed }) {
  const [data, setData] = useState(null)
  const [openKey, setOpenKey] = useState('')
  const [busy, setBusy] = useState('')
  const [ask, setAsk] = useState('')

  const load = () => api.get('/reports/health').then(setData).catch(() => setData({ checks: [] }))
  useEffect(() => { load() }, [])

  if (!data) return null
  const checks = data.checks || []

  const fixBatch = async (batch) => {
    setBusy(batch.day)
    try {
      const r = await api.post('/reports/health/went-out', { ids: batch.ids, day: 'release' })
      toast(tx('{n} corrected', { n: r.changed }))
      setAsk('')
      await load()
      onFixed?.()
    } catch (e) { toast(e.message, 'err') } finally { setBusy('') }
  }

  return (
    <div className="card card-pad dh-card">
      <div className="docs-sec-head">
        <h2><Stethoscope size={17} />{' '}{tx('What these numbers are standing on')}</h2>
      </div>
      {checks.length === 0 ? (
        <p className="stat-sub">{tx('Nothing is missing — every piece on the board carries what the reports need to read it.')}</p>
      ) : (
        <div className="dh-list">
          {checks.map((c) => {
            const on = openKey === c.key
            return (
              <div key={c.key} className="dh-item">
                <button type="button" className="dh-head" onClick={() => setOpenKey(on ? '' : c.key)} aria-expanded={on}>
                  <AlertTriangle size={15} className="dh-ico" />
                  <span className="dh-title">{tx(c.title)}</span>
                  <span className="count">{c.count}</span>
                  <span className="spacer" />
                  <ChevronDown size={15} className={'dz-caret' + (on ? ' open' : '')} />
                </button>
                {on && (
                  <div className="dh-body">
                    <p className="stat-sub">{tx(c.why)}</p>

                    {c.batches && c.batches.map((b) => (
                      <div key={b.day} className="dh-batch">
                        <div className="dh-batch-main">
                          <b>{dateLabel(b.day)}</b>
                          <span className="stat-sub">
                            {tx('{n} marked published that day', { n: b.count })} ·{' '}
                            {tx('promised between {a} and {b}', { a: dateLabel(b.first_release), b: dateLabel(b.last_release) })} ·{' '}
                            {tx('{n} days after the day they were promised, in the middle', { n: b.median_lag })}
                          </span>
                        </div>
                        {/* Asked twice, in the open. This rewrites the day
                            dozens of pieces count as published — the
                            statistics, the charts and the pay run all move
                            with it — so the second press is the one that does
                            it, with what it will do written beside it rather
                            than in a browser dialog that vanishes. */}
                        {ask === b.day ? (
                          <span className="dh-confirm">
                            <span className="stat-sub">
                              {tx('Their statistics and their pay move with them, and each one keeps a line in its log saying what the day used to be.')}
                            </span>
                            <span className="dh-confirm-do">
                              <button className="btn btn-sm btn-ghost" disabled={busy === b.day}
                                onClick={() => setAsk('')}>{tx('Cancel')}</button>
                              <button className="btn btn-sm btn-primary" disabled={busy === b.day}
                                onClick={() => fixBatch(b)}>
                                <CalendarCheck2 size={14} />{' '}
                                {busy === b.day ? tx('Correcting…') : tx('Yes — correct {n}', { n: b.count })}
                              </button>
                            </span>
                          </span>
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => setAsk(b.day)}
                            data-tip={tx('Use each piece’s own release day as the day it went out')}>
                            <CalendarCheck2 size={14} />{' '}{tx('They went out on their days')}
                          </button>
                        )}
                      </div>
                    ))}

                    {(c.pieces || []).length > 0 && (
                      <div className="dh-pieces">
                        {c.pieces.map((x) => (
                          <button key={x.id} className="dh-piece" onClick={() => onOpenPiece?.(x.id)}>
                            <span className="dh-piece-t">{x.title}</span>
                            {x.day && <span className="stat-sub">{dateLabel(x.day)}</span>}
                          </button>
                        ))}
                        {c.count > (c.pieces || []).length && (
                          <span className="stat-sub">{tx('and {n} more', { n: c.count - c.pieces.length })}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {data.today && <p className="stat-sub dh-foot">{tx('Read from the board as it stands on {day}', { day: dateLabel(data.today) })}</p>}
    </div>
  )
}

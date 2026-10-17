import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'
import { typeLabel } from '../lib/constants.js'
import { PALETTE, DEFAULT_MAP, colorStyle, colorIndexOf } from '../lib/pieceColor.js'

// ---- My colours (r11) -------------------------------------------------------------------
//
// The research report found people asking for colours; the owner decided the
// content makers choose what they mean. Ten colours, no names anywhere — a
// maker picks one for each piece, or lets the pieces take one by themselves
// from their stage, their kind, their month or their channel. The crew sees
// the maker's pieces in the maker's colours. Red is not among the ten: it
// stays for the one button to press and for what is late.

const MODES = [
  ['own', () => tx('I pick them'), () => tx('You pick one of the ten colours for each piece.')],
  ['stage', () => tx('Stage'), () => tx('Idea, To shoot, Editing… each stage gets its colour by itself.')],
  ['type', () => tx('Type of piece'), () => tx('Reel, post, story, video, each in its own colour.')],
  ['month', () => tx('Month'), () => tx('This month and last month never look the same.')],
  ['channel', () => tx('Channel'), () => tx('Each of your channels in its own colour.')],
  ['none', () => tx('No colours'), () => tx('Everything stays plain.')],
]

export default function Colours() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()
  const { visible } = useChannels()
  const [mode, setMode] = useState(user.color_mode || 'own')
  const [map, setMap] = useState(() => ({ ...DEFAULT_MAP, ...Object.fromEntries(Object.entries(user.color_map || {}).map(([k, v]) => [k, { ...DEFAULT_MAP[k], ...v }])) }))
  const [statuses, setStatuses] = useState([])
  const [pieces, setPieces] = useState([])
  useEffect(() => {
    api.cached('/statuses').then((s) => setStatuses(Array.isArray(s) ? s : [])).catch(() => {})
    api.get('/content').then((c) => setPieces((Array.isArray(c) ? c : []).filter((t) => (t.assignees || []).includes(user.id) && !t.done_at).slice(0, 5))).catch(() => {})
  }, [user.id])

  const save = async (nextMode, nextMap) => {
    try {
      const u = await api.patch('/users/me', { color_mode: nextMode, color_map: nextMap })
      setUser?.({ ...user, ...u })
      window.dispatchEvent(new Event('pc-colors'))
    } catch (e) { toast(e.message, 'err') }
  }
  const pickMode = (m) => { setMode(m); save(m, map) }
  const pickFor = (m, key, i) => { const next = { ...map, [m]: { ...map[m], [key]: i } }; setMap(next); save(mode, next) }

  const values = useMemo(() => ({
    stage: statuses.filter((s) => !/deleted/i.test(s.label)).map((s) => [String(s.id), tx(s.label)]),
    type: ['reel', 'post', 'story', 'video'].map((k) => [k, typeLabel(k)]),
    month: [['last', tx('Earlier months')], ['this', tx('This month')], ['next', tx('Later months')]],
    channel: visible.map((c) => [c.key, c.label]),
  }), [statuses, visible])
  const me = { ...user, color_mode: mode, color_map: map }

  return (
    <div className="co pc-page">
      <button type="button" className="co-link pc-back" onClick={() => navigate(-1)}><ChevronLeft size={16} aria-hidden="true" />{tx('Back')}</button>
      <h1 className="co-title">{tx('My colours')}</h1>
      <p className="pc-lead">{tx('You have ten colours. Use them however you like. Everyone who works on your pieces sees the same colours.')}</p>

      <h3 className="pc-h">{tx('What should your colours mean?')}</h3>
      <div className="pc-modes">
        {MODES.map(([k, name, line]) => (
          <button key={k} type="button" className="pc-mode" aria-pressed={mode === k} onClick={() => pickMode(k)}>
            <b>{name()}</b><small>{line()}</small>
          </button>
        ))}
      </div>

      {mode === 'own' && (
        <>
          <h3 className="pc-h">{tx('Your ten colours')}</h3>
          <div className="pc-filter">{[...Array(PALETTE)].map((_, i) => <span key={i} className="pc-swatch pc-still" style={colorStyle(i)} aria-hidden="true" />)}</div>
          <p className="co-help">{tx('Pick one for a piece in its task window, or when you create it.')}</p>
        </>
      )}
      {['stage', 'type', 'month', 'channel'].includes(mode) && (
        <>
          <h3 className="pc-h">{tx('Which colour for each')}</h3>
          <div className="pc-rows">
            {values[mode].map(([key, label]) => (
              <div key={key} className="pc-row">
                <b>{label}</b>
                <span className="pc-filter" role="group" aria-label={label}>
                  {[...Array(PALETTE)].map((_, i) => (
                    <button key={i} type="button" className="pc-swatch" style={colorStyle(i)} aria-pressed={map[mode]?.[key] === i}
                      aria-label={`${label}: ${tx('Colour {n}', { n: i + 1 })}`} onClick={() => pickFor(mode, key, i)} />
                  ))}
                </span>
              </div>
            ))}
          </div>
          <p className="co-help">{tx('Every piece gets its colour by itself. Nothing to pick.')}</p>
        </>
      )}
      {mode === 'none' && <p className="co-help">{tx('Your pieces stay plain. The stage and who has it are still written on every piece.')}</p>}

      {pieces.length > 0 && (
        <>
          <h3 className="pc-h">{tx('How your pieces look')}</h3>
          <div className="pc-preview">
            {pieces.map((t) => {
              const i = colorIndexOf(t, me)
              return <div key={t.id} className={'pc-prev' + (i != null ? ' has-pc' : '')} style={colorStyle(i)}>{i != null && <i className="pc-dot" aria-hidden="true" />}{t.title}</div>
            })}
          </div>
        </>
      )}
      <p className="co-help">{tx('Red is not one of the ten: it stays for the button to press and for what is late.')}</p>
    </div>
  )
}

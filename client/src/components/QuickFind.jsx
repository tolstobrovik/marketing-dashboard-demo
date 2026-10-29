import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { useChannels } from '../lib/channels.jsx'
import { usePages } from '../lib/pages.jsx'
import { typeInfo, onColor } from '../lib/constants.js'
import ContentModal from './ContentModal.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import { StageDot } from './Dot.jsx'
import { track } from '../lib/track.js'

// Ctrl/Cmd-K quick find: one box that reaches anything from anywhere —
// pages by name, tasks by title. Enter takes the highlighted row; a task
// opens right here, a page navigates. Esc closes.
export default function QuickFind({ onClose }) {
  const { user } = useAuth()
  const { visible, byKey } = useChannels()
  const { shows } = usePages()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [tasks, setTasks] = useState([])
  const [statuses, setStatuses] = useState([])
  const [sel, setSel] = useState(0)
  const [openItem, setOpenItem] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    api.get('/content').then(setTasks).catch(() => {})
    api.cached('/statuses').then(setStatuses).catch(() => {})
    inputRef.current?.focus()
  }, [])

  const statusesById = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s])), [statuses])
  const isAdmin = user.role === 'admin'
  // The Master Calendar is offered only to somebody it is open to, the same
  // question every other door to it asks (pages.jsx). Switched off, or aimed
  // at other kinds of account, its route sends them home, and a search that
  // finds a page only to land on the front page reads as a broken search.
  const pages = useMemo(() => [
    { label: 'My Day', to: '/brief' },
    shows('releases') && { label: tx('Calendar'), to: '/calendar' },
    shows('recordings') && { label: tx('Recordings'), to: '/recordings' },
    (isAdmin || shows('missed')) && { label: tx('Numbers'), to: '/numbers' },
    shows('design') && { label: tx('Design'), to: '/design' },
    shows('docs') && { label: tx('My pay'), to: '/profile#pay' },
    shows('projects') && { label: 'Projects', to: '/projects' },
    ...visible.map((c) => ({ label: c.label, to: `/dept/${c.key}` })),
    isAdmin && shows('team') && { label: tx('Team'), to: '/team' },
    isAdmin && { label: tx('Settings'), to: '/admin' },
    { label: 'My profile', to: '/profile' },
  ].filter(Boolean), [isAdmin, visible, shows])

  const needle = q.trim().toLowerCase()
  const results = useMemo(() => {
    if (!needle) return []
    const pg = pages
      .filter((p) => p.label.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((p) => ({ kind: 'page', ...p }))
    const rank = (t) => (t.title.toLowerCase().startsWith(needle) ? 0 : 1)
    const ts = tasks
      .filter((t) => t.title.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 12)
      .map((t) => ({ kind: 'task', t }))
    return [...pg, ...ts]
  }, [needle, pages, tasks])

  useEffect(() => { setSel(0) }, [needle])
  // Whether a search found anything — never what was typed (round 13's report).
  useEffect(() => {
    if (needle.length < 2) return undefined
    const id = setTimeout(() => track('search', { k: results.length }), 1200)
    return () => clearTimeout(id)
  }, [needle, results.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (r) => {
    if (!r) return
    if (r.kind === 'page') { navigate(r.to); onClose() }
    else setOpenItem(r.t)
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, Math.max(results.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[sel]) }
    else if (e.key === 'Escape') onClose()
  }

  const updateTask = async (item, payload) => {
    const u = await api.patch(`/content/${item.id}`, payload)
    setTasks((prev) => prev.map((x) => (x.id === item.id ? u : x)))
  }
  const deleteTask = async (item) => {
    await api.del(`/content/${item.id}`)
    setTasks((prev) => prev.filter((x) => x.id !== item.id))
  }

  return (
    <>
      {!openItem && (
        <div className="qf-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
          <div className="qf card" role="dialog" aria-label={tx("Quick find")}>
            <div className="qf-box">
              <Search size={16} />
              <input
                ref={inputRef}
                className="qf-input"
                value={q}
                placeholder={tx("Find a task or page…")}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
              />
              {/* A phone has no Esc key, so naming one is a leftover from the
                  desk. Same corner, same job, a control a thumb can use. */}
              <span className="qf-esc">{tx("esc")}</span>
              <button type="button" className="qf-x" onClick={onClose} aria-label={tx("Close")}><X size={18} /></button>
            </div>
            {needle && (
              <div className="qf-list">
                {results.length === 0 && <div className="qf-none">Nothing matches “{q.trim()}”.</div>}
                {results.map((r, i) => {
                  if (r.kind === 'page') {
                    return (
                      <button key={`p${r.to}`} className={'qf-row' + (i === sel ? ' on' : '')}
                        onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                        <span className="qf-kind">{tx("Page")}</span>
                        <span className="qf-title">{r.label}</span>
                        <span className="spacer" />
                        {i === sel && <CornerDownLeft size={13} className="qf-enter" />}
                      </button>
                    )
                  }
                  const t = r.t
                  const st = statusesById[t.status_id]
                  return (
                    <button key={`t${t.id}`} className={'qf-row' + (i === sel ? ' on' : '')}
                      onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                      <span className={`chip ct-${t.type} qf-type`}>{typeInfo(t.type).label}</span>
                      <span className="qf-title">{t.title}</span>
                      <span className="spacer" />
                      {st && <StageDot status={st} />}
                      {t.channels.slice(0, 2).map((c) => <span key={c} className="chip chip-muted qf-ch">{byKey[c]?.label || c}</span>)}
                      {i === sel && <CornerDownLeft size={13} className="qf-enter" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {openItem && (
        <ContentModal key={openItem?.id || 'new'}
          item={openItem}
          statuses={statuses}
          onClose={(next) => { if (next?.id) { setOpenItem(next); return } setOpenItem(null); onClose() }}
          onUpdate={updateTask}
          onDelete={deleteTask}
        />
      )}
    </>
  )
}

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { Face } from './CoachParts.jsx'
import { jobOf } from './Sidebar.jsx'
import { tr as tx } from '../lib/i18n.jsx'

// ---- choosing a person (round 14, the owner's pick: Linear) ----------------------------
//
// "Choosing people sucks" (16 Oct 2026): a plain list of thirty names. This is a
// button that opens a short list at itself: who can do the job first, free
// before busy when the page knows it (`status`), the rest of the team one press
// away under "Everyone else", and a box to type a few letters of a name or a
// role. Arrows move, Enter picks, Esc closes and gives the focus back.
//
//   <PersonPick value={id} onChange={(id) => …} first={[user]} rest={[user]} label="Who films it?"
//               status={(u) => ({ say: 'Free', tone: 'free' | 'part' | 'busy' }) | null} />
//
// A phone gets the list as a sheet from the bottom (styles.css, r14-pp).

const norm = (s) => String(s || '').toLowerCase()

export default function PersonPick({ value = null, onChange, first = [], rest = [], label = '', status = null, disabled = false, id, empty = '' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const [at, setAt] = useState(0)
  const btn = useRef(null)
  const pop = useRef(null)
  const input = useRef(null)
  const listId = useId()
  const chosen = [...first, ...rest].find((u) => String(u.id) === String(value)) || null

  const order = { free: 0, part: 1, busy: 2 }
  const rank = (u) => order[status?.(u)?.tone] ?? 1
  const fit = [...first].sort((a, b) => rank(a) - rank(b))
  const t = norm(q).trim()
  const shown = t
    ? [...fit, ...rest].filter((u) => norm(u.name).includes(t) || norm(jobOf(u)).includes(t))
    : all || !fit.length ? [...fit, ...rest] : fit
  const pos = Math.max(0, Math.min(at, shown.length - 1))

  const close = (back = true) => { setOpen(false); setQ(''); setAll(false); setAt(0); if (back) btn.current?.focus() }
  const pick = (u) => { onChange(u.id); close() }

  // Under the button, or over it when there is no room; a phone draws it as a sheet.
  useLayoutEffect(() => {
    if (!open || !pop.current || !btn.current || window.matchMedia('(max-width: 640px)').matches) return
    const r = btn.current.getBoundingClientRect(), el = pop.current, h = el.offsetHeight, w = el.offsetWidth
    const below = r.bottom + 6 + h < window.innerHeight - 12
    el.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`
    el.style.top = `${below ? r.bottom + 6 : Math.max(12, r.top - 6 - h)}px`
    el.style.transformOrigin = below ? 'top left' : 'bottom left'
  }, [open, shown.length, all])
  useEffect(() => { if (open) input.current?.focus() }, [open])
  useEffect(() => {
    if (!open) return undefined
    const out = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) close(false) }
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }   // before the window's own Esc
    document.addEventListener('pointerdown', out, true)
    window.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('pointerdown', out, true); window.removeEventListener('keydown', esc, true) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pop.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [pos, open])

  const keys = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length) setAt((pos + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length)
    } else if (e.key === 'Enter') { e.preventDefault(); if (shown[pos]) pick(shown[pos]) }
    else if (e.key === 'Tab') close(false)
  }
  const optId = (u) => `${listId}-${u.id}`

  return (
    <>
      <button ref={btn} id={id} type="button" className={'r14-pp-trigger' + (chosen ? '' : ' empty')} disabled={disabled}
        aria-haspopup="dialog" aria-expanded={open} aria-label={label ? `${label} ${chosen ? chosen.name : tx('Nobody yet')}` : undefined}
        onClick={() => (open ? close() : setOpen(true))}>
        {chosen ? <><Face person={chosen} size="sm" /><span>{chosen.name}</span></> : <span>{empty || tx('Choose…')}</span>}
        <ChevronDown size={16} aria-hidden="true" className="r14-pp-chev" />
      </button>
      {open && createPortal(
        <div ref={pop} className="r14-pp" role="dialog" aria-label={label || tx('Choose a person')} onKeyDown={keys}>
          {label && <p className="r14-pp-h">{label}</p>}
          <input ref={input} className="r14-pp-q" type="text" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={shown[pos] ? optId(shown[pos]) : undefined} placeholder={tx('Type a name or a role')} aria-label={tx('Type a name or a role')}
            value={q} autoComplete="off" onChange={(e) => { setQ(e.target.value); setAt(0) }} />
          <ul id={listId} role="listbox" aria-label={label || tx('People')}>
            {shown.map((u, i) => {
              const s = status?.(u)
              const sep = !t && all && fit.length > 0 && i === fit.length
              return (
                <li key={u.id} role="option" id={optId(u)} aria-selected={i === pos} className={sep ? 'r14-pp-sep' : undefined}
                  onPointerMove={() => setAt(i)} onClick={() => pick(u)}>
                  <Face person={u} size="sm" />
                  <span className="r14-pp-nm">{u.name}<small>{jobOf(u)}</small></span>
                  {s?.say && <span className={`r14-pp-st ${s.tone || ''}`}>{s.say}</span>}
                </li>
              )
            })}
            {!shown.length && <li role="presentation" className="r14-pp-none">{tx('Nobody by that name. Try a role: editor, operator.')}</li>}
          </ul>
          {!t && !all && fit.length > 0 && rest.length > 0 && (
            <button type="button" className="r14-pp-more" onClick={() => { setAll(true); input.current?.focus() }}>
              {tx('Everyone else')} · {tx('{n} people', { n: rest.length })}
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

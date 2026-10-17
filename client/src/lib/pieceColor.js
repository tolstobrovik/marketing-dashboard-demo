import { useEffect, useState } from 'react'
import { api } from './api.js'
import { todayISO } from './constants.js'

// ---- the makers' ten piece colours (r11) ----------------------------------------------
//
// The research report: three people asked for colours, most likely to tell
// pieces apart at a glance. The owner's decision: the content makers choose.
// Each maker has ten colours with no names, and decides what they are for —
//
//   own       they pick one for each piece (content.color, 0–9)
//   stage     each stage gets one by itself          (keys: status ids)
//   type      each kind of piece                     (keys: reel, post, story, video…)
//   month     earlier / this / later month           (keys: last, this, next)
//   channel   each channel                           (keys: channel keys)
//   none      everything plain
//
// A piece wears its MAKER's colours (whoever the task belongs to), so the
// operator, the editor and the designer see a maker's work the way the maker
// set it up. The stage is never a colour any more: it is written in words.
// The colours themselves are --pc-1 … --pc-10 in styles.css; none is red.

export const PALETTE = 10
export const colorVar = (i) => `var(--pc-${i + 1})`
export const MODES = ['own', 'stage', 'type', 'month', 'channel', 'none']

// What a maker's automatic meanings start as, before they change any of them.
export const DEFAULT_MAP = {
  stage: { 1: 9, 2: 5, 3: 8, 4: 0, 5: 3 },
  type: { reel: 8, post: 0, story: 6, video: 3, carousel: 2, target: 7, other: 9 },
  month: { last: 7, this: 0, next: 3 },
  channel: { instagram_main: 0, instagram_uzb: 2, youtube: 6, telegram_main: 1, telegram_uzb: 4, target: 7, tiktok: 5, youtube_shorts: 8 },
}

export const ownerIdOf = (t) => (Array.isArray(t?.assignees) && t.assignees.length ? Number(t.assignees[0]) : t?.assignee_id || t?.created_by || null)

const monthOf = (t, today) => {
  const day = String(t.release_date || t.recording_date || '').slice(0, 7)
  if (!day) return 'this'
  const now = today.slice(0, 7)
  return day < now ? 'last' : day > now ? 'next' : 'this'
}

// The colour index (0–9) a piece wears for this maker, or null for none.
export function colorIndexOf(t, maker, today = todayISO()) {
  if (!t) return null
  const mode = maker?.color_mode || 'own'
  if (mode === 'none') return null
  if (mode === 'own') return Number.isInteger(t.color) && t.color >= 0 && t.color < PALETTE ? t.color : null
  const map = { ...DEFAULT_MAP[mode], ...(maker?.color_map?.[mode] || {}) }
  const key = mode === 'stage' ? String(t.status_id) : mode === 'type' ? t.type : mode === 'month' ? monthOf(t, today) : (t.channels || [])[0]
  const i = map[key]
  return Number.isInteger(i) ? i : null
}

// For a screen: `colorOf(task)` → 0–9 or null, read from the team list the
// board already caches. Re-reads when somebody changes their colours.
export function usePieceColors() {
  const [team, setTeam] = useState([])
  useEffect(() => {
    const load = () => api.cached('/users').then((u) => setTeam(Array.isArray(u) ? u : [])).catch(() => {})
    load()
    window.addEventListener('pc-colors', load)
    return () => window.removeEventListener('pc-colors', load)
  }, [])
  const today = todayISO()
  return (t) => colorIndexOf(t, team.find((u) => u.id === ownerIdOf(t)), today)
}

// The style a coloured thing takes: the colour as a custom property.
export const colorStyle = (i) => (i == null ? undefined : { '--pc': colorVar(i) })

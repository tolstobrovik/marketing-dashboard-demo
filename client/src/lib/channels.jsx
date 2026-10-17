import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, cache } from './api.js'
import { useAuth } from './auth.jsx'

// Sidebar channels come from the server so the admin can add/rename/reorder them.
const Ctx = createContext({ channels: [], visible: [], byKey: {}, reload: () => {} })

export function ChannelsProvider({ children }) {
  const { user } = useAuth()
  // Boot from the cached list (instant sidebar + home redirect), then refresh.
  // This provider wraps EVERY page, so anything it renders that is not a list
  // is not one broken page — it is the whole dashboard, on every reload for as
  // long as the cache holds it. It therefore trusts nothing: not the cache it
  // wrote, and not the answer it is handed.
  const asList = (v) => (Array.isArray(v) ? v : [])
  const [channels, setChannels] = useState(() => asList(cache.get('channels')))

  const reload = useCallback(() => {
    if (!user || user.role === 'ambassador') return // refused to them (server/auth.js)
    api.get('/channels').then((list) => {
      if (!Array.isArray(list)) return // keep the last good list rather than break
      setChannels(list)
      cache.set('channels', list)
    }).catch(() => {})
  }, [user])

  useEffect(() => { reload() }, [reload])

  const value = useMemo(() => {
    const byKey = Object.fromEntries(channels.map((c) => [c.key, c]))
    const visible = !user
      ? []
      : user.role === 'admin'
        ? channels
        : channels.filter((c) => user.departments.includes(c.key))
    return { channels, visible, byKey, reload }
  }, [channels, user])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useChannels = () => useContext(Ctx)

// What the sidebar says beside each channel in the Coach look: how many pieces
// are late and how many are in editing — { [channel key]: { late, editing } },
// counted by the server (GET /content/counts). Read once on load and then
// every minute, but only while somebody is looking: a tab left open behind
// another asks nothing, and reads again when it is looked at after a minute or
// more away. Until the first answer, and on a server that has no such address
// yet (404), it is null — draw no counts, never a zero that was not counted.
const COUNTS_EVERY = 60000
export function useChannelCounts(on = true) {
  const [counts, setCounts] = useState(null)
  useEffect(() => {
    if (!on) return undefined
    let gone = false
    let last = 0
    let timer = 0
    const stop = () => { clearInterval(timer); document.removeEventListener('visibilitychange', read) }
    function read() {
      if (document.hidden || Date.now() - last < COUNTS_EVERY - 1000) return
      last = Date.now()
      api.get('/content/counts').then((r) => {
        if (!gone && r && r.channels && typeof r.channels === 'object') setCounts(r.channels)
      }).catch((e) => {
        // Not there: stop asking. Anything else is a blip — keep the last
        // numbers and ask again in a minute.
        if (e.status === 404) { stop(); if (!gone) setCounts(null) }
      })
    }
    read()
    timer = setInterval(read, COUNTS_EVERY)
    document.addEventListener('visibilitychange', read)
    return () => { gone = true; stop() }
  }, [on])
  return counts
}

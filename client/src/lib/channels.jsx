import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, cache } from './api.js'
import { useAuth } from './auth.jsx'

// Sidebar channels come from the server so the admin can add/rename/reorder them.
const Ctx = createContext({ channels: [], visible: [], byKey: {}, reload: () => {}, failed: false, retry: () => {} })

// A first load that fails is asked again on a widening wait (S-08). One
// failed GET /api/channels after a server restart used to leave the sidebar
// with no channels and the new-idea dialog with nothing to choose, until
// somebody reloaded the page by hand. The last wait repeats, so a server that
// comes back is seen within ten seconds and nothing polls faster than that.
const BACKOFF = [1000, 3000, 10000]

export function ChannelsProvider({ children }) {
  const { user } = useAuth()
  // Boot from the cached list (instant sidebar + home redirect), then refresh.
  // This provider wraps EVERY page, so anything it renders that is not a list
  // is not one broken page — it is the whole dashboard, on every reload for as
  // long as the cache holds it. It therefore trusts nothing: not the cache it
  // wrote, and not the answer it is handed.
  const asList = (v) => (Array.isArray(v) ? v : [])
  const [channels, setChannels] = useState(() => asList(cache.get('channels')))
  // The last load failed and the next try is on its way. The screens read it
  // only when the list is empty: a failed refresh over a good list is a blip.
  const [failed, setFailed] = useState(false)
  const tries = useRef(0)
  const timer = useRef(0)

  const load = useRef(() => {})
  load.current = () => {
    if (!user || user.role === 'ambassador') return // refused to them (server/auth.js)
    clearTimeout(timer.current)
    api.get('/channels').then((list) => {
      if (!Array.isArray(list)) return // keep the last good list rather than break
      tries.current = 0
      setFailed(false)
      setChannels(list)
      cache.set('channels', list)
    }).catch(() => {
      setFailed(true)
      const wait = BACKOFF[Math.min(tries.current++, BACKOFF.length - 1)]
      timer.current = setTimeout(() => load.current(), wait)
    })
  }
  const reload = useCallback(() => load.current(), [])
  // "Retry" pressed: now, and the waits start short again.
  const retry = useCallback(() => { tries.current = 0; load.current() }, [])

  useEffect(() => {
    tries.current = 0
    load.current()
    return () => clearTimeout(timer.current)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => {
    const byKey = Object.fromEntries(channels.map((c) => [c.key, c]))
    const visible = !user
      ? []
      : user.role === 'admin'
        ? channels
        : channels.filter((c) => user.departments.includes(c.key))
    return { channels, visible, byKey, reload, failed, retry }
  }, [channels, user, reload, failed, retry])

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
    // A move made on this page: the badges read again at once (24 Oct 2026).
    const wrote = () => { last = 0; read() }
    window.addEventListener('satashkent:wrote', wrote)
    return () => { gone = true; stop(); window.removeEventListener('satashkent:wrote', wrote) }
  }, [on])
  return counts
}

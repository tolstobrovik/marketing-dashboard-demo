import { createContext, useContext, useEffect, useState } from 'react'
import { api, cache, setToken, getToken } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // Returning visitors paint instantly: the last known profile renders the
  // app shell right away while /auth/me revalidates in the background.
  const [user, setUser] = useState(() => (getToken() ? cache.get('me') : null))
  const [loading, setLoading] = useState(() => !!getToken() && !cache.get('me'))

  // `on_projects` comes from /auth/me and the login answer only. Anything else
  // that hands back the user — a profile save — does not carry it, and taking
  // that answer whole would shut the Projects page on an owner until they
  // reloaded. So a user without the key keeps the one already known.
  const rememberUser = (u) => {
    setUser((prev) => {
      const next = u && !('on_projects' in u) && prev ? { ...u, on_projects: prev.on_projects } : u
      cache.set('me', next)
      return next
    })
  }

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    // Only a real "not you" (401) ends the session. A flaky network or a
    // slow server cold-start must NOT log anyone out — retry a couple of
    // times and keep the token either way.
    ;(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { user } = await api.get('/auth/me')
          rememberUser(user)
          break
        } catch (e) {
          if (e.status === 401) { // token already cleared by api.js
            cache.clear()
            setUser(null)
            break
          }
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
        }
      }
      setLoading(false)
    })()
  }, [])

  const login = async (username, password, remember = true) => {
    const { token, user } = await api.post('/auth/login', { username, password, remember })
    cache.clear() // never show a previous account's cached data
    setToken(token, remember)
    rememberUser(user)
    return user
  }

  const logout = () => {
    setToken(null)
    cache.clear()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, setUser: rememberUser, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

// An admin scoped to particular channels is an admin ON those channels and
// nowhere else — the twin of isAdminOn in server/auth.js, which is the rule the
// server answers by. No channels ticked = the whole board.
export const adminOn = (user, chans) => {
  if (user?.role !== 'admin') return false
  const runs = user.admin_channels || []
  return runs.length === 0 || (chans || []).some((c) => runs.includes(c))
}

// May this person write to this piece at all? The server's first question on
// every write (canTouch, server/routes/content.js): an admin over one of its
// channels, anybody on one of its channels, whoever it is for, and its crew.
// Anybody may OPEN any piece, so a screen that offers a pen asks this first.
export const reachOf = (user, t) => adminOn(user, t.channels)
  || (t.channels || []).some((c) => (user.departments || []).includes(c))
  || (t.assignees?.length ? t.assignees : [t.assignee_id]).includes(user.id)
  || [t.operator_id, t.editor_id, t.designer_id].includes(user.id)

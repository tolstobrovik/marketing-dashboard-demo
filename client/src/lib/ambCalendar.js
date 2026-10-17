// ---- the Ambassadors calendar's two readings (components/AmbassadorsCalendar.jsx) ----
// Plain functions, no React and no words, so qa/ambassadors-calendar-suite.mjs
// can hold them to the brief.

// How a video link plays inside the side window:
//   { file: true }   a video file itself (.mp4, .mov, .m4v, .webm): a native player
//   { src }          YouTube or Google Drive: their own player, loaded only when
//                    "Play here" is pressed — YouTube keeps the start time (?t=)
//   null             anything else: the link opens in a new tab, and that is all
export function embedOf(url) {
  let u
  try { u = new URL(String(url || '')) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  if (/\.(mp4|mov|m4v|webm)$/i.test(u.pathname)) return { file: true }
  const host = u.hostname.replace(/^(www|m)\./, '')
  let yt = null
  if (host === 'youtu.be') yt = u.pathname.split('/')[1] || null
  else if (host === 'youtube.com') yt = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/) || [])[1] || null
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    const start = secondsOf(u.searchParams.get('t') || u.searchParams.get('start'))
    return { src: `https://www.youtube.com/embed/${yt}${start ? `?start=${start}` : ''}` }
  }
  if (host === 'drive.google.com') {
    const id = (u.pathname.match(/\/file\/d\/([\w-]+)/) || [])[1] || u.searchParams.get('id')
    if (id && /^[\w-]+$/.test(id)) return { src: `https://drive.google.com/file/d/${id}/preview` }
  }
  return null
}

// YouTube's t: "90", "90s" or "1m30s" (and "1h2m3s").
export function secondsOf(t) {
  const s = String(t || '').trim()
  if (/^\d+s?$/.test(s)) return parseInt(s, 10)
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  return m && s ? (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) : 0
}

// The phone's month: only the days with a video, and every run of empty days
// between them as ONE line — "nothing sent" before today, "still ahead" from
// today on. → [{ day, videos }] and [{ from, to, ahead }], in date order.
export function dayRuns(month, videos, today) {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  const out = []
  for (let d = 1; d <= last; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`
    const on = videos.filter((v) => v.day === day)
    if (on.length) { out.push({ day, videos: on }); continue }
    const ahead = day >= today
    const run = out[out.length - 1]
    if (run && run.from && run.ahead === ahead) run.to = day
    else out.push({ from: day, to: day, ahead })
  }
  return out
}

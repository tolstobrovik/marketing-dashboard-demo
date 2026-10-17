import { api, getToken } from './api.js'

// ---- a file, straight into the task's Google Drive folder -------------------
//
// The server opens the upload with Google and hands back a session address;
// the file goes there from this browser in pieces, so the bytes never pass
// through this app's server (nginx would stop anything over 10 MB, and a cut
// is gigabytes). Each piece reports its own progress.
//
// It does not give up on the first hiccup:
//   - a piece that fails is retried, after asking Google how much it kept —
//     so a dropped connection costs one piece, never the whole file;
//   - if the browser cannot reach Google's upload address at all (a network
//     that blocks it), the same upload carries on through /api/drive in 8 MB
//     pieces instead. The file that lands is the same file.
//
// `onProgress({ sent, total })` fires as bytes go. `signal` cancels.
const WAITS = [1000, 2500, 5000, 10000, 20000]

const auth = () => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {})

function putDirect(url, blob, start, total, onBytes, signal) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    x.setRequestHeader('Content-Range', `bytes ${start}-${start + blob.size - 1}/${total}`)
    x.upload.onprogress = (e) => onBytes(e.loaded)
    x.onload = () => {
      if (x.status === 200 || x.status === 201) {
        try { resolve({ done: true, file: JSON.parse(x.responseText), next: total }) } catch { reject(new Error('Google answered oddly')) }
      } else if (x.status === 308) {
        const m = /bytes=0-(\d+)/.exec(x.getResponseHeader('Range') || '')
        // No Range readable is not "nothing kept" — the status check below
        // asks the server, which can always read it.
        resolve({ done: false, next: m ? Number(m[1]) + 1 : null })
      } else reject(Object.assign(new Error(`Google refused a piece (${x.status})`), { status: x.status }))
    }
    // status 0: the browser never got an answer it may read — blocked,
    // offline, or refused cross-site. Told apart from a refusal on purpose.
    x.onerror = () => reject(Object.assign(new Error('Could not reach Google Drive'), { network: true }))
    x.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { cancelled: true }))
    signal?.addEventListener('abort', () => x.abort(), { once: true })
    x.send(blob)
  })
}

async function putRelay(ticket, blob, start, signal) {
  const r = await fetch('/api/drive/uploads/piece', {
    method: 'PUT', signal, body: blob,
    headers: { ...auth(), 'Content-Type': 'application/octet-stream', 'X-Upload-Ticket': ticket, 'X-Upload-Offset': String(start) },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `Upload failed (${r.status})`), { status: r.status })
  return j
}

async function askWhere(ticket, signal) {
  const r = await fetch('/api/drive/uploads/status', { signal, headers: { ...auth(), 'X-Upload-Ticket': ticket } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `Upload failed (${r.status})`), { status: r.status, final: r.status === 410 || r.status === 403 })
  return j
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Upload cancelled'), { cancelled: true })) }, { once: true })
})

// ---- carrying on after a reload ----
// A file of tens of gigabytes takes an hour, and an hour is long enough for a
// laptop to sleep or a tab to be closed. Google keeps an upload session for a
// week, so the session is remembered here, keyed by the file itself (name,
// size, when it was last changed) and the task it is for: drop the same file
// on the same task again and it carries on from the last byte Google kept.
const KEEP_DAYS = 6
const keyOf = (taskId, kind, file) => `satashkent_upload:${taskId}:${kind}:${file.name}:${file.size}:${file.lastModified || 0}`
const recall = (k) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || 'null')
    return v && v.ticket && Date.now() - (v.at || 0) < KEEP_DAYS * 864e5 ? v : null
  } catch { return null }
}
const remember = (k, v) => { try { localStorage.setItem(k, JSON.stringify({ ...v, at: Date.now() })) } catch { /* private window */ } }
const forget = (k) => { try { localStorage.removeItem(k) } catch { /* ok */ } }
// Is there an upload of this very file to this task to pick up again?
export const canResume = (taskId, kind, file) => !!recall(keyOf(taskId, kind, file))

export async function uploadToDrive({ taskId, kind, file, onProgress, signal }) {
  const key = keyOf(taskId, kind, file)
  let s = recall(key)
  let next = 0
  if (s) {
    // Where did the last attempt get to? Gone, or not ours any more: start over.
    const at = await askWhere(s.ticket, signal).catch(() => null)
    if (at?.done) {
      forget(key)
      return api.post('/drive/uploads/finish', { ticket: s.ticket, file_id: at.file.id })
    }
    if (at) next = at.next
    else { forget(key); s = null }
  }
  if (!s) {
    s = await api.post(`/drive/tasks/${taskId}/uploads`, {
      kind, name: file.name, size: file.size, mime: file.type || 'application/octet-stream',
    })
    remember(key, s)
  }
  const total = file.size
  let direct = true
  let tries = 0
  let whole = null
  onProgress?.({ sent: next, total })
  while (!whole) {
    if (signal?.aborted) throw Object.assign(new Error('Upload cancelled'), { cancelled: true })
    const size = direct ? s.chunk : s.relay_chunk
    const blob = file.slice(next, Math.min(total, next + size))
    try {
      const r = direct
        ? await putDirect(s.session_url, blob, next, total, (n) => onProgress?.({ sent: next + n, total }), signal)
        : await putRelay(s.ticket, blob, next, signal)
      if (r.done) { whole = r.file; break }
      next = r.next ?? (await askWhere(s.ticket, signal)).next
      tries = 0
      onProgress?.({ sent: next, total })
    } catch (e) {
      if (e.cancelled || signal?.aborted) throw Object.assign(new Error('Upload cancelled'), { cancelled: true })
      // Never reached Google on the very first piece: this network will not
      // let the browser talk to it. Go the long way round, same session.
      if (direct && e.network && next === 0 && tries === 0) { direct = false; continue }
      if (tries >= WAITS.length) throw e
      await sleep(WAITS[tries++], signal)
      // Where did it stop? Carry on from there — or, if Google has it all
      // (the answer was lost, not the file), it is done.
      const at = await askWhere(s.ticket, signal).catch((err) => { if (err.final) throw err; return null })
      if (at?.done) { whole = at.file; break }
      if (at) { next = at.next; onProgress?.({ sent: next, total }) }
    }
  }
  onProgress?.({ sent: total, total })
  const out = await api.post('/drive/uploads/finish', { ticket: s.ticket, file_id: whole.id })
  forget(key)
  return out
}

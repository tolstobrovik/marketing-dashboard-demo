import { useSyncExternalStore } from 'react'
import { uploadToDrive } from './driveUpload.js'

// ---- every upload in this tab, in one place ----------------------------------
//
// A cut of twenty gigabytes takes longer than anybody stays on one page. So an
// upload does not belong to the page that started it: it lives here, keeps
// going while the person opens a task, checks the calendar or goes back to
// My Day, and anything that wants to show it — the Uploads page, the hand-in
// window, the badge beside "Uploads" in the menu — reads the same list.
//
// Closing the TAB still stops it (the browser asks first); dropping the same
// file on the same task again carries on from where Google stopped
// (driveUpload.js keeps the session for a week).
//
// A job: { key, taskId, taskTitle, kind, name, size, sent, t0, state, error, status, link, fileName, file, onDone }
//   state: 'sending' | 'done' | 'failed' | 'cancelled'
//   `file` and `onDone` stay on a job that failed, so "Try again" can run the
//   same upload under the same key (24 Oct 2026) — the session is in
//   localStorage, so it carries on from the last byte Google kept.

let jobs = []
const listeners = new Set()
const ctrls = new Map()
const emit = () => { for (const f of listeners) f() }
const put = (key, patch) => { jobs = jobs.map((j) => (j.key === key ? { ...j, ...patch } : j)); emit() }

let guarded = false
const guardTab = () => {
  if (guarded) return
  guarded = true
  window.addEventListener('beforeunload', (e) => {
    if (jobs.some((j) => j.state === 'sending')) { e.preventDefault(); e.returnValue = '' }
  })
}

// The same file (name, size, last changed) on the same task and job, still
// going: one upload, one Google session. Dropped twice — on the hand-in box
// and then on the task — it used to be two uploads feeding one session, each
// undoing the other's pieces (24 Oct 2026).
const sameFile = (j, task, kind, file) => j.state === 'sending' && j.taskId === task.id && j.kind === kind
  && j.name === file.name && j.size === file.size && (j.lastModified || 0) === (file.lastModified || 0)

function run(key) {
  const job = jobs.find((j) => j.key === key)
  if (!job) return
  const { file, onDone } = job
  const ctrl = new AbortController()
  ctrls.set(key, ctrl)
  // Progress arrives many times a second; the list is redrawn at most ~6.
  // Speed is measured from where THIS attempt began: a resumed upload that
  // starts at 10 GB has not sent 10 GB in its first second.
  let last = 0
  let from = null
  uploadToDrive({
    taskId: job.taskId, kind: job.kind, file, signal: ctrl.signal,
    onProgress: ({ sent }) => {
      const now = Date.now()
      if (from === null) { from = sent; put(key, { sent, from, t0: now }); return }
      if (now - last < 160 && sent < file.size) return
      last = now
      put(key, { sent })
    },
  }).then((out) => {
    put(key, { state: 'done', sent: file.size, link: out.link, fileName: out.name, fileId: out.id })
    onDone?.(out)
  }).catch((e) => {
    put(key, e.cancelled ? { state: 'cancelled' } : { state: 'failed', error: e.message, status: e.status || null })
  }).finally(() => ctrls.delete(key))
}

export function startUpload({ task, kind, file, onDone }) {
  guardTab()
  const twin = jobs.find((j) => sameFile(j, task, kind, file))
  if (twin) return twin.key
  const key = `${task.id}:${kind}:${file.name}:${file.size}:${Date.now()}`
  jobs = [{
    key, taskId: task.id, taskTitle: task.title, kind, name: file.name, size: file.size, lastModified: file.lastModified || 0,
    sent: 0, t0: Date.now(), state: 'sending', file, onDone,
  }, ...jobs]
  emit()
  run(key)
  return key
}

// A failed upload, tried again under its own key: same file, same task, the
// session it had — so it picks up where Google stopped, not from nothing.
export function retryUpload(key) {
  const job = jobs.find((j) => j.key === key)
  if (!job || job.state === 'sending' || !job.file) return
  put(key, { state: 'sending', error: null, status: null, sent: 0, t0: Date.now(), from: null })
  run(key)
}

export const cancelUpload = (key) => ctrls.get(key)?.abort()
export const clearFinished = () => { jobs = jobs.filter((j) => j.state === 'sending'); emit() }

const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f) }
const snapshot = () => jobs
export const useUploads = () => useSyncExternalStore(subscribe, snapshot)

// Sizes and speeds, said the way people say them.
export const sizeLabel = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
export const speedOf = (j) => {
  const secs = (Date.now() - j.t0) / 1000
  const moved = j.sent - (j.from || 0)
  return secs > 2 && moved > 0 ? moved / secs : 0
}
export const etaOf = (j) => {
  const v = speedOf(j)
  if (!v) return null
  const s = Math.round((j.size - j.sent) / v)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
}

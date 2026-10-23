import { useEffect, useRef, useState } from 'react'
import { PanZoom } from './Zoom.jsx'
import { Scissors, Palette, Clapperboard, ExternalLink, Check, FolderOpen, FileText, Clock, UploadCloud, X, Send, Play, Trash2 } from 'lucide-react'
import { FullScreen, removeDriveFile } from './DriveFiles.jsx'
import Modal from './Modal.jsx'
import PravkaNote from './PravkaNote.jsx'
import { api } from '../lib/api.js'
import { useChannels } from '../lib/channels.jsx'
import { deliveryHref } from '../lib/text.js'
import { toast } from '../lib/toast.js'
import { rewardFinish } from '../lib/reward.js'
import { tr as tx } from '../lib/i18n.jsx'
import { startUpload, cancelUpload, useUploads, sizeLabel } from '../lib/uploads.js'
import { editDue, reviewDue } from '../lib/due.js'
import { todayISO, tashkentDay } from '../lib/constants.js'

// ---- hand it in --------------------------------------------------------------
//
// The whole of an editor's job, as far as this board is concerned, is one
// sentence: here is the footage, give us back the cut. Doing that used to mean
// opening a task that holds fourteen fields, finding the second of four tabs,
// telling apart two identical Drive boxes numbered 1 and 2, pressing a
// checkbox that sits ABOVE the box it depends on, and then wondering whether
// "Save changes" still needed pressing.
//
// This is that sentence and nothing else: what came in, where the result goes,
// and one button. It writes exactly what the task window's own button writes —
// the same milestone, the same link — so the two can never disagree about what
// "handed in" means. The full task is one link away for anybody who needs the
// brief, and that is the only other door.
//
// `inline` is the same sentence without a window of its own: the Coach look's
// task window (components/CoachTask.jsx) puts the box and the button straight
// under "Your step now", so handing in is not a second window on top of the
// first. Same checks, same write — only the frame, the piece's name (the
// window already says it) and the timeline notes are left out. `label` renames
// the button where the window knows a truer word for it ("Shoot is done",
// "Hand in the fix"); `onReady` tells it whether the button is awake, so it
// can say why not — and, second, whether the box has anything in it: for a
// shoot the button is awake with the box empty (the link is optional), and a
// window that ticked "paste the link" off the button would tick it for nothing.

const JOB = {
  edit: {
    seat: 'editor',
    milestone: 'edited', col: 'ready_link', file: 'ready_file', Icon: Scissors,
    title: 'Hand in the edit', field: 'Your finished edit', button: 'Hand in the edit',
    done: 'Edit handed in — the reviewer has it', needsLink: true,
  },
  design: {
    seat: 'designer',
    milestone: 'designed', col: 'design_link', file: 'design_file', Icon: Palette,
    title: 'Hand in the artwork', field: 'Your finished artwork', button: 'Hand in the artwork',
    done: 'Artwork handed in — the reviewer has it', needsLink: true,
  },
  shoot: {
    seat: 'operator',
    milestone: 'shot', col: 'shot_link', file: 'shot_file', Icon: Clapperboard,
    title: 'Mark it as filmed', field: 'Where the footage is (optional)', button: 'Mark as filmed',
    done: 'Marked as filmed — the editor can start', needsLink: false,
  },
}

// `steps` (r11): the line saying who gets it next; given, the box shows the three
// steps above its button. `sendIcon`: a paper plane on the button.
export default function HandIn({ item, kind, onDone, onClose, onOpenFull, inline = false, label = '', onReady = null, steps = '', sendIcon = false }) {
  const job = JOB[kind] || JOB.edit
  const { byKey } = useChannels()
  const [team, setTeam] = useState([])
  useEffect(() => { api.cached('/users').then(setTeam).catch(() => {}) }, [])

  // A channel with one shared Drive folder asks for WHICH file rather than the
  // whole address: the folder is the same forty times a week, and the file is
  // the part people leave out. Two channels with two folders have no single
  // answer, so the box asks for the full link.
  const folders = [...new Set((item.channels || []).map((k) => (byKey[k]?.drive_url || '').trim()).filter(Boolean))]
  const folder = folders.length === 1 ? folders[0] : ''

  // Changes asked of this seat: the box starts EMPTY — the file in it is the
  // one that was sent back — and the round's note sits above it.
  const fixing = !!item.open_round && item.open_for === job.seat
  const [round, setRound] = useState(null)
  useEffect(() => {
    if (!fixing) return
    api.get(`/content/${item.id}/revisions`)
      .then((rs) => setRound([...rs].reverse().find((r) => !r.resolved_at && r.target === job.seat) || null))
      .catch(() => {})
  }, [fixing, item.id, job.seat])
  // Empty for a fix, and for a piece put back after a delivery (ready_at): the
  // link on it is the version that came back, and one press would send it again.
  const [value, setValue] = useState(() => (fixing || (kind !== 'shoot' && item.ready_at) ? '' : String(item[job.col] || '').trim()))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // ---- or upload it, straight into the task's Drive folder ----
  // Only once an admin has connected the team's Google Drive. The file goes
  // from this browser to Google, and the link it lands at fills the box —
  // so handing in is still the one button below, pressed the same way.
  const [drive, setDrive] = useState(false)
  useEffect(() => { api.cached('/drive/status').then((s) => setDrive(!!s?.connected)).catch(() => {}) }, [])
  // The upload belongs to the whole tab (lib/uploads.js), not to this window:
  // closing the window leaves it running, and it carries on under Uploads.
  // r11 (the owner): as many videos as the shoot made, each with a preview
  // before it is sent on. Every file goes to the task's own Drive folder (so
  // the task window lists them all); the first one's link fills the box the
  // hand-in writes, as before.
  const jobs = useUploads()
  const [files, setFiles] = useState([])   // [{ key, name, url }] — url is the local preview
  const [watch, setWatch] = useState(null) // the preview pressed: played full screen
  const [over, setOver] = useState(false)
  const pick = useRef(null)
  const alive = useRef(true)
  // Set on every mount, not only the first: React's development mode mounts
  // twice, and a ref left false there never heard the upload land.
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // The previews are local copies: let them go when the box goes.
  useEffect(() => () => files.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const jobOf = (f) => jobs.find((j) => j.key === f.key) || null
  const sending = files.some((f) => jobOf(f)?.state === 'sending')
  const failed = files.find((f) => jobOf(f)?.state === 'failed')
  useEffect(() => { if (failed) setErr(jobOf(failed).error) }, [failed?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = (list) => {
    const chosen = [...(list || [])].filter(Boolean)
    if (!chosen.length || busy) return
    setErr('')
    const added = chosen.map((file) => ({
      name: file.name,
      url: /^(video|image)\//.test(file.type) ? URL.createObjectURL(file) : '',
      key: startUpload({
        task: item, kind, file,
        // Still open when it lands: the first link fills the box.
        onDone: (out) => { if (alive.current) setValue((v) => v || out.link) },
      }),
    }))
    setFiles((old) => [...old, ...added])
  }
  const gb = sizeLabel
  // Delete one: an uploaded file goes to the Drive's bin (asked first); one
  // that never landed just leaves the list. The box keeps the first link of
  // what is still there.
  const drop = async (f) => {
    const j = jobOf(f)
    if (j?.state === 'done' && j.fileId && !(await removeDriveFile(item.id, { id: j.fileId, name: j.fileName || f.name }))) return
    if (f.url) URL.revokeObjectURL(f.url)
    const rest = files.filter((x) => x.key !== f.key)
    setFiles(rest)
    if (j?.link && value === j.link) setValue(rest.map((x) => jobOf(x)).find((x) => x?.state === 'done')?.link || '')
  }
  const landedAll = files.length > 0 && files.every((f) => jobOf(f)?.state === 'done')

  const isLink = /^https?:\/\//i.test(value.trim())
  const filled = value.trim().length > 0
  // A change asked of this seat needs the new version — the footage too, which
  // is otherwise optional (the bug hunt, 14 Oct 2026: a re-shoot "sent" nothing).
  const ready = job.needsLink || fixing ? filled && (isLink || !!folder) : true
  useEffect(() => { onReady?.(ready, filled) }, [ready, filled]) // eslint-disable-line react-hooks/exhaustive-deps

  // What came IN — the thing the editor works from. For a cut that is the
  // footage and whoever shot it; for artwork and for a shoot there is no
  // upstream file on this board, so nothing is drawn rather than an empty box.
  const operator = team.find((u) => u.id === item.operator_id)
  const footage = kind === 'edit' ? deliveryHref(item.shot_link) : null

  const submit = async () => {
    if (!ready || busy || sending) return
    setBusy(true); setErr('')
    const v = value.trim()
    const body = { milestone: job.milestone }
    if (v) {
      if (isLink) body[job.col] = v
      else if (folder) body[job.file] = v
    }
    try {
      const updated = await api.patch(`/content/${item.id}`, body)
      rewardFinish()
      // A reel's cover handed in before its cut is held on Editing: said so.
      toast(updated?.held?.includes('ready_link') ? tx('Artwork handed in — it waits for the edit') : tx(job.done))
      onDone?.(updated)
      onClose?.()
    } catch (e) {
      setErr(e.message)
    } finally { setBusy(false) }
  }

  const { Icon } = job
  const body = (
      <div className={'hi' + (inline ? ' hi-inline' : '')}>
        {!inline && (
          <div className="hi-piece">
            <Icon size={16} />
            <div>
              <b>{item.title}</b>
              <span className="stat-sub">{(item.channels || []).map((k) => byKey[k]?.label || k).join(' · ')}</span>
            </div>
          </div>
        )}

        {round && (
          <div className="hi-round">
            <b>{tx('{name} asked for changes', { name: (round.requested_name || '').split(' ')[0] || tx('The team') })}</b>
            <PravkaNote text={round.note} className="hi-round-note" />
            <span className="stat-sub">{tx('Round {n} · to fix', { n: round.round })} · {tashkentDay(round.created_at)}</span>
          </div>
        )}

        {/* The booked half-hours this shoot holds. Marking it filmed is what
            ticks the slot off on their timeline — nothing else to press. Said
            only for today's: the timeline on their page is today, and an
            overdue shoot promised a tick nobody would ever see. */}
        {!inline && kind === 'shoot' && item.recording_time && item.recording_date === todayISO() && (
          <div className="hi-slot">
            <Clock size={14} />
            <span><b>{item.recording_time.slice(0, 5)}{item.recording_end ? `–${item.recording_end.slice(0, 5)}` : ''}</b> · {tx('ticked off on your timeline when you mark it filmed')}</span>
          </div>
        )}
        {/* A cut or artwork owed today sits under the same timeline, with no
            hour. Handing it in here is what ticks it off there. */}
        {!inline && kind !== 'shoot' && ((kind === 'edit' ? editDue(item) : item.design_ready_date) || reviewDue(item)) === todayISO() && (
          <div className="hi-slot">
            <Clock size={14} />
            <span><b>{tx('Today')}</b> · {tx('ticked off on your timeline when you hand it in')}</span>
          </div>
        )}

        {kind === 'edit' && (
          <div className={'hi-source' + (footage ? '' : ' hi-source-missing')}>
            <Clapperboard size={14} />
            {footage ? (
              <>
                <span>{operator ? tx('Footage from {name}', { name: operator.name.split(' ')[0] }) : tx('The footage')}</span>
                <a className="btn btn-sm" href={footage} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> {tx('Open')}
                </a>
              </>
            ) : (
              <span>
                {operator
                  ? tx('{name} has not added a footage link yet — ask them, or check the channel folder.', { name: operator.name.split(' ')[0] })
                  : tx('No footage link on this task yet.')}
              </span>
            )}
          </div>
        )}

        {/* r10 (the October survey: editors should upload the video on the
            platform itself, not through Drive). With the team's Drive
            connected, the file is dropped here first — it goes to the task's
            folder by itself and its link fills the box — and pasting a link
            is the fallback, folded below. */}
        {drive && (
          <>
            <div className={'hi-drop' + (files.length ? '' : ' hi-drop-big') + (over ? ' over' : '')} role="button" tabIndex={0} aria-label={tx('Upload to Google Drive')}
              onClick={() => pick.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.current?.click() } }}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files) }}>
              {/* Round 14 (the owner, 16 Oct: "instead of posting a link, just give a
                  container with an uploader"): the box says what to drop and where it goes. */}
              <span className="hi-drop-ic" aria-hidden="true"><UploadCloud size={files.length ? 18 : 20} /></span>
              <span className="hi-drop-t">
                <b>{files.length ? tx('Add more') : fixing ? tx('Drop the new version here') : kind === 'design' ? tx('Drop the artwork here') : kind === 'shoot' ? tx('Drop the videos from the shoot here') : tx('Drop the edit here')}</b>
                {' '}<u>{tx('or choose files')}</u>
                {!files.length && <small>{tx('Goes straight into the piece’s Drive folder.')}</small>}
              </span>
              <input ref={pick} type="file" hidden multiple accept={kind === 'design' ? 'image/*,application/pdf' : 'video/*'} onChange={(e) => { send(e.target.files); e.target.value = '' }} />
            </div>
            {/* The preview: every file chosen, playable here before it is sent on. */}
            {files.length > 0 && (
              <div className="hi-previews" aria-live="polite">
                {files.map((f) => {
                  const j = jobOf(f)
                  const pct = j ? Math.min(100, Math.floor((j.sent / Math.max(1, j.size)) * 100)) : 0
                  return (
                    <div key={f.key} className={'hi-prev' + (j?.state === 'failed' ? ' failed' : '')}>
                      {f.url ? (
                        <button type="button" className="hi-prev-open" onClick={() => setWatch(f)} aria-label={kind === 'design' ? tx('View') : tx('Play')}>
                          {kind !== 'design' ? <video src={f.url} muted playsInline preload="metadata" /> : <img src={f.url} alt="" />}
                          {kind !== 'design' && <span className="co-dfile-play"><Play size={18} aria-hidden="true" /></span>}
                        </button>
                      ) : <span className="hi-prev-none"><FileText size={22} aria-hidden="true" /></span>}
                      <span className="hi-prev-n" title={f.name}>{f.name}</span>
                      {j?.state === 'sending' ? (
                        <span className="hi-prev-up">
                          <span className="hi-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></span>
                          <button type="button" className="icon-btn" onClick={() => cancelUpload(f.key)} aria-label={tx('Cancel the upload')}><X size={13} /></button>
                        </span>
                      ) : (
                        <span className="hi-prev-up">
                          {j?.state === 'done' ? <span className="hi-prev-ok"><Check size={13} aria-hidden="true" />{tx('On Drive')} · {gb(j.size)}</span>
                            : <span className="hi-prev-bad">{tx('Not sent')}</span>}
                          <button type="button" className="icon-btn hi-prev-del" onClick={() => drop(f)} disabled={busy} aria-label={tx('Delete')} title={tx('Delete')}><Trash2 size={14} /></button>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {watch && (
              <FullScreen onClose={() => setWatch(null)}>
                {kind !== 'design' ? <video src={watch.url} controls autoPlay playsInline /> : <PanZoom src={watch.url} alt={watch.name} />}
                <p className="co-player-name">{watch.name}</p>
              </FullScreen>
            )}
          </>
        )}

        {(() => {
          const field = (
            <label className="hi-field">
              <span className="hi-label">{fixing && kind === 'shoot' ? tx('Where the new footage is') : tx(job.field)}</span>
              <input className="input" autoFocus={!inline && !drive} value={value} disabled={busy || sending}
                placeholder={folder ? tx('Drive link, or just the file name — e.g. reel 14') : 'https://drive.google.com/…'}
                onChange={(e) => { setValue(e.target.value); setErr('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
              {folder && (
                <a className="hi-folder" href={folder} target="_blank" rel="noreferrer">
                  <FolderOpen size={13} /> {tx('Open the channel folder')}
                </a>
              )}
            </label>
          )
          // Round 14: with the team's Drive connected the file is dropped, never
          // linked (the owner, 16 Oct). A link box is only for a board without Drive.
          return drive ? null : field
        })()}

        {err && <div className="form-error">{err}</div>}

        {/* r11 (the owner: "guide enhance" — the words in each step): what to
            do, in the order to do it, right where it is done. */}
        {inline && steps && (
          <ol className="hi-steps">
            <li className={files.length || value ? 'done' : ''}>{kind === 'shoot' ? tx('Upload every video from the shoot.') : kind === 'design' ? tx('Upload the artwork.') : tx('Upload the finished edit.')}</li>
            <li className={landedAll ? 'done' : ''}>{tx('Watch them in the preview — check they all play.')}</li>
            <li>{tx('Press “{button}”.', { button: label || tx(job.button) })} {steps}</li>
          </ol>
        )}
        {/* T-04: in the window the button appears when it can be pressed; the
            window's own line above it says what is still missing. The sheet
            (not inline) keeps a sleeping button, since it has no such line. */}
        {(!inline || ready || busy || sending) && (
          <button type="button" className="btn btn-primary hi-go" disabled={!ready || busy || sending} onClick={submit}>
            {sendIcon ? <Send size={16} /> : <Check size={16} />} {busy ? tx('Handing in…') : sending ? tx('Uploading…') : label || tx(job.button)}
          </button>
        )}

        {onOpenFull && !inline && (
          <button type="button" className="hi-full" onClick={() => { onClose?.(); onOpenFull(item) }}>
            <FileText size={13} /> {tx('Read the brief')}
          </button>
        )}
      </div>
  )
  if (inline) return body
  return (
    <Modal title={tx(job.title)} onClose={busy ? () => {} : () => {
      // An upload in flight carries on after this closes (lib/uploads.js).
      if (sending) toast(tx('Still uploading — follow it under Uploads'))
      onClose?.()
    }}>
      {body}
    </Modal>
  )
}

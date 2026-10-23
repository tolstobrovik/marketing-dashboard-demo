import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Shield, Plus, X, History, Pencil, Trash2, Check } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import Avatar from '../components/Avatar.jsx'
import Modal from '../components/Modal.jsx'
import { monthName, dateLabel, tashkentDay, todayISO } from '../lib/constants.js'
import { loadFailed, toast } from '../lib/toast.js'
import { tr as tx } from '../lib/i18n.jsx'

// The people board: how each month actually went, person by person.
//
// Read by superadmins only — the server refuses everybody else outright, and
// this page never draws for them because the door is not in their sidebar.
// It is deliberately not on anybody's profile: these are notes ABOUT people,
// not notes FOR them.
//
// The shape is the one the work has: a column of people on the left with the
// thing that matters next to each name — when anybody last wrote about them —
// and one person's record open beside it.

// Which month you were reading. Kept so that coming back from a summary, or
// from anywhere else, does not drop you into today when you were working
// through September.
const MONTH_KEY = 'satashkent_people_month'
// The office's month, not UTC's: before 05:00 on the 1st that is still last month.
const thisMonth = () => todayISO().slice(0, 7)
const lastMonth = () => { try { return localStorage.getItem(MONTH_KEY) || thisMonth() } catch { return thisMonth() } }

// The months to offer: this one and the eleven before it. A board that only
// ever showed the current month would make writing up a finished month
// impossible on the first of the next one, which is exactly when it is done.
// Counted in plain months, not by walking a Date backwards: setMonth() on
// the 30th lands on the 2nd of March coming out of February, and the list
// came back with March in it twice.
const MONTHS = () => {
  const now = new Date()
  const from = now.getFullYear() * 12 + now.getMonth()
  return Array.from({ length: 12 }, (_, i) => {
    const n = from - i
    return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
  })
}

const monthLabel = (m) => {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return `${monthName(Number(y), Number(mo))} ${y}`
}

// How long since anybody wrote about this person, in months. This is the
// number the board is for: a person nobody has written about since June is
// not a person having a quiet year, it is a person nobody is watching.
const monthsSince = (month) => {
  if (!month) return null
  const [y, m] = month.split('-').map(Number)
  const now = new Date()
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
}

function Staleness({ person }) {
  const gap = monthsSince(person.last_month)
  if (gap === null) return <span className="pb-stale cold">{tx('Never written about')}</span>
  if (gap <= 0) return <span className="pb-stale warm">{tx('Written this month')}</span>
  if (gap === 1) return <span className="pb-stale">{tx('Last: {m}').replace('{m}', monthLabel(person.last_month))}</span>
  return (
    <span className={`pb-stale ${gap >= 3 ? 'cold' : ''}`}>
      {tx('Nothing for {n} months').replace('{n}', String(gap))}
    </span>
  )
}

// One note, with the two things a reader needs beside it: who wrote it, and
// whether it has been changed since.
function Note({ note, mine, onEdit, onDelete, onHistory }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!draft.trim() || busy) return
    setBusy(true)
    // A refusal keeps the box open with the words still in it. Closing it on
    // a failure would lose what was typed and say nothing about why.
    try { await onEdit(draft); setEditing(false) } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <article className="pb-note">
      <header className="pb-note-head">
        <span className="pb-note-month">{monthLabel(note.month)}</span>
        <span className="pb-note-by">{note.author_name}</span>
        <span className="pb-note-at">{dateLabel(tashkentDay(note.created_at))}</span>
        {note.edited && (
          <button type="button" className="pb-note-edited" onClick={() => onHistory(note)}>
            <History size={13} /> {tx('edited')}
          </button>
        )}
        <span className="pb-note-spacer" />
        {mine && !editing && (
          <>
            <button type="button" className="icon-btn sm" title={tx('Edit')} onClick={() => { setDraft(note.body); setEditing(true) }}>
              <Pencil size={14} />
            </button>
            <button type="button" className="icon-btn sm danger" title={tx('Delete')} onClick={() => onDelete(note)}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </header>
      {editing ? (
        <div className="pb-note-edit">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            autoFocus
            /* autoFocus alone leaves the caret at position 0, so the first
               thing typed lands in front of the sentence being corrected. */
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          />
          <div className="pb-note-edit-row">
            <span className="pb-hint">{tx('The version you are replacing is kept.')}</span>
            {/* The pair stays a pair: in a narrow column a bare flex row put
                Cancel and Save on separate lines. */}
            <span className="pb-btns">
              <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>{tx('Cancel')}</button>
              <button type="button" className="btn sm" disabled={busy || !draft.trim()} onClick={save}>
                <Check size={14} /> {tx('Save')}
              </button>
            </span>
          </div>
        </div>
      ) : (
        <p className="pb-note-body">{note.body}</p>
      )}
    </article>
  )
}

export default function People() {
  const { user } = useAuth()
  const [month, setMonth] = useState(lastMonth)
  const [board, setBoard] = useState([])
  // The id, not the row. Holding the row meant holding a copy that stopped
  // being true the moment a note was added — the header went on saying "0
  // notes in all" above a note that was plainly there.
  const [pickedId, setPickedId] = useState(null)
  const [notes, setNotes] = useState([])
  const [wholeRecord, setWholeRecord] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState(null)
  const [summarising, setSummarising] = useState(false)
  const [history, setHistory] = useState(null)
  const [rankOpen, setRankOpen] = useState(false)
  const [holders, setHolders] = useState([])

  const months = useMemo(MONTHS, [])
  const picked = useMemo(() => board.find((p) => p.id === pickedId) || null, [board, pickedId])
  useEffect(() => { try { localStorage.setItem(MONTH_KEY, month) } catch { /* fine */ } }, [month])

  const loadBoard = async () => {
    try { setBoard((await api.get(`/people/board?month=${month}`)).people || []) } catch (e) { loadFailed(e) }
  }
  useEffect(() => { loadBoard() }, [month])

  const loadNotes = async (id, all) => {
    if (!id) return setNotes([])
    try {
      setNotes(await api.get(`/people/notes?about=${id}${all ? '' : `&month=${month}`}`))
    } catch (e) { loadFailed(e) }
  }
  useEffect(() => { loadNotes(pickedId, wholeRecord) }, [pickedId, month, wholeRecord])

  const open = (person) => { setPickedId(person.id); setSummary(null); setDraft('') }

  const write = async () => {
    if (!draft.trim() || saving || !picked) return
    setSaving(true)
    try {
      await api.post('/people/notes', { about_id: picked.id, month, body: draft.trim() })
      setDraft('')
      await Promise.all([loadNotes(pickedId, wholeRecord), loadBoard()])
    } catch (e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  const edit = async (note, body) => {
    await api.patch(`/people/notes/${note.id}`, { body })
    await loadNotes(pickedId, wholeRecord)
  }

  const remove = async (note) => {
    if (!window.confirm(tx('Delete this note? Its history goes with it.'))) return
    try {
      await api.del(`/people/notes/${note.id}`)
      await Promise.all([loadNotes(pickedId, wholeRecord), loadBoard()])
    } catch (e) { toast(e.message, 'err') }
  }

  const showHistory = async (note) => {
    try { setHistory(await api.get(`/people/notes/${note.id}/history`)) } catch (e) { loadFailed(e) }
  }

  const summarise = async (scope) => {
    setSummarising(true)
    setSummary(null)
    try {
      setSummary(await api.post('/people/summary', scope))
    } catch (e) { toast(e.message, 'err') } finally { setSummarising(false) }
  }

  const openRank = async () => {
    setRankOpen(true)
    try { setHolders(await api.get('/people/superadmins')) } catch (e) { loadFailed(e) }
  }
  const setRank = async (id, on) => {
    try {
      await api.put(`/people/superadmins/${id}`, { superadmin: on })
      setHolders(await api.get('/people/superadmins'))
    } catch (e) {
      // The refusals here are the point of the panel — "somebody has to be
      // able to open this board" is the server explaining a rule, not a
      // failure to load. Saying "this is the last data that reached you"
      // instead threw that away and left the reader guessing.
      toast(e.message, 'err')
      setHolders(await api.get('/people/superadmins').catch(() => holders))
    }
  }

  const held = useMemo(() => new Set(holders.map((h) => h.id)), [holders])
  const written = board.filter((p) => p.this_month > 0).length

  return (
    <div className="people-board">
      <header className="pb-top">
        <div className="pb-title">
          <h2>{tx('Notes')}</h2>
          <p className="pb-sub">{tx('What each month was like. Only superadmins read this.')}</p>
        </div>
        <div className="pb-top-right">
          <select className="pb-month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button type="button" className="btn ghost sm" onClick={() => summarise({ month })}>
            <Sparkles size={15} /> {tx('Summarise the month')}
          </button>
          <button type="button" className="icon-btn" title={tx('Who can open this board')} onClick={openRank}>
            <Shield size={16} />
          </button>
        </div>
      </header>

      <p className="pb-count">
        {tx('{a} of {b} people have a note for {m}')
          .replace('{a}', String(written)).replace('{b}', String(board.length)).replace('{m}', monthLabel(month))}
      </p>

      <div className="pb-split">
        <aside className="pb-people">
          {board.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pb-person ${pickedId === p.id ? 'on' : ''}`}
              onClick={() => open(p)}
            >
              <Avatar name={p.name} color={p.color} src={p.avatar} size="sm" />
              <span className="pb-person-who">
                <b>{p.name}</b>
                <Staleness person={p} />
              </span>
              <span className={`pb-person-n ${p.this_month ? 'has' : ''}`}>{p.this_month}</span>
            </button>
          ))}
          {!board.length && <p className="pb-empty">{tx('Nobody to write about yet.')}</p>}
        </aside>

        <section className="pb-record">
          {!picked ? (
            <div className="pb-nobody">
              <p>{tx('Pick somebody to read or add to their record.')}</p>
            </div>
          ) : (
            <>
              <header className="pb-record-head">
                <Avatar name={picked.name} color={picked.color} src={picked.avatar} />
                <div className="pb-record-who">
                  <b>{picked.name}</b>
                  <span>{tx('{n} notes in all').replace('{n}', String(picked.total || 0))}</span>
                </div>
                <div className="pb-record-acts">
                  <button
                    type="button"
                    className={`btn ghost sm ${wholeRecord ? 'on' : ''}`}
                    onClick={() => setWholeRecord((v) => !v)}
                  >
                    {wholeRecord ? tx('This month only') : tx('Their whole record')}
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => summarise({ about_id: picked.id })}>
                    <Sparkles size={15} /> {tx('Summarise')}
                  </button>
                </div>
              </header>

              <div className="pb-write">
                <textarea
                  value={draft}
                  rows={3}
                  placeholder={tx('What happened in {m}?').replace('{m}', monthLabel(month))}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="pb-write-row">
                  <span className="pb-hint">{tx('Goes on {m}. Only superadmins will read it.').replace('{m}', monthLabel(month))}</span>
                  <button type="button" className="btn sm" disabled={saving || !draft.trim()} onClick={write}>
                    <Plus size={15} /> {tx('Add')}
                  </button>
                </div>
              </div>

              <div className="pb-notes">
                {notes.map((n) => (
                  <Note
                    key={n.id}
                    note={n}
                    mine={n.author_id === user.id}
                    onEdit={(body) => edit(n, body)}
                    onDelete={remove}
                    onHistory={showHistory}
                  />
                ))}
                {!notes.length && (
                  <p className="pb-empty">
                    {wholeRecord
                      ? tx('Nothing written about them yet.')
                      : tx('Nothing for {m} yet.').replace('{m}', monthLabel(month))}
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {(summarising || summary) && (
        <Modal onClose={() => { setSummary(null); setSummarising(false) }} title={tx('What the notes say')}>
          {summarising ? (
            <p className="pb-empty">{tx('Reading…')}</p>
          ) : !summary?.notes ? (
            <p className="pb-empty">{tx('Nothing written yet to read.')}</p>
          ) : !summary.points?.length && !summary.summary ? (
            <p className="pb-empty">
              {tx('No summary came back. Check an AI key is set in Admin → AI.')}
            </p>
          ) : (
            <div className="pb-summary">
              {summary.summary && <p className="pb-summary-lead">{summary.summary}</p>}
              <ul>
                {(summary.points || []).map((p, i) => (
                  <li key={i} className={`pb-point ${p.tone}`}>{p.say}</li>
                ))}
              </ul>
              <p className="pb-hint">
                {tx('Read from {n} notes. Names were removed before this was sent out.')
                  .replace('{n}', String(summary.notes))}
              </p>
            </div>
          )}
        </Modal>
      )}

      {history && (
        <Modal onClose={() => setHistory(null)} title={tx('Every version of this note')}>
          <div className="pb-history">
            <article className="pb-version now">
              <header>{tx('Now')} · {dateLabel(tashkentDay(history.now.at))} · {history.now.by}</header>
              <p>{history.now.body}</p>
            </article>
            {history.was.map((v, i) => (
              <article key={i} className="pb-version">
                <header>{tx('Replaced')} {dateLabel(tashkentDay(v.at))} · {v.by}</header>
                <p>{v.body}</p>
              </article>
            ))}
          </div>
        </Modal>
      )}

      {rankOpen && (
        <Modal onClose={() => setRankOpen(false)} title={tx('Who can open this board')}>
          <p className="pb-hint">
            {tx('Superadmins read and write every note here. Nobody else can, including other admins.')}
          </p>
          <div className="pb-ranks">
            {board.map((p) => (
              <label key={p.id} className="pb-rank">
                <input
                  type="checkbox"
                  checked={held.has(p.id)}
                  onChange={(e) => setRank(p.id, e.target.checked)}
                />
                <Avatar name={p.name} color={p.color} src={p.avatar} size="sm" />
                <span>{p.name}</span>
                {held.has(p.id) && <span className="pb-rank-on">{tx('superadmin')}</span>}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}

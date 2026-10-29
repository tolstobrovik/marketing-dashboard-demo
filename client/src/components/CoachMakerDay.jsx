import { useState } from 'react'
import { ArrowRight, Check, Send, PenLine } from 'lucide-react'
import {
  KIND, MakerBadge, RemindButton, StartHere, More,
  firstName, dayInLine, dayShort, hoursOf, lateWords,
} from './CoachParts.jsx'
import Timeline, { timelineOf } from './Timeline.jsx'
import { api } from '../lib/api.js'
import { longDayLabel } from '../lib/constants.js'
import { reviewDue } from '../lib/due.js'
import { kindOfAct } from '../lib/coach.js'
import { toast } from '../lib/toast.js'
import { usePieceColors, colorStyle } from '../lib/pieceColor.js'
import { TaskFiles } from './DriveFiles.jsx'
import { tr as tx } from '../lib/i18n.jsx'
import { isCarried, carriedFrom, monthLongOf } from '../lib/planMonth.js'

// ---- the content maker's day, the Coach way -----------------------------------------
//
// "For the content makers… like today what has to be filmed, which one is
// pending pravka and etc in priority." So a maker's day is not one list by
// date: it is five groups, in the order the owner set —
//
//   1  Filming today      it happens at a set hour: time, and who films
//   2  Pravka             Check it — a cut or artwork came in and waits for an
//                         answer; Being fixed — changes were asked, and the
//                         crew has them (who, which round, until when, remind)
//   3  Late               past its day
//   4  Your move          the crew cannot start until the maker adds something
//   5  Ready to publish   finished: post it
//
// A group with nothing in it is not drawn at all. Other days, and the month,
// are the Calendar screen (components/CoachCalendar.jsx).
//
// Round 11: round 8 stood the day's shoots on a strip of hours above the
// groups ("the day as a line"). It said in boxes what "Filming today" says in
// words two inches lower, and the boxes were the part nobody would read. It is
// gone; a shoot is a row with its hour.
//
// Round 9 ("too complex — simplify everything"): a group is its name and its
// rows, four of them and the rest on request; a row is the title, who has it
// and one badge or one button.
//
// A piece is in exactly one group, and which one is not decided here: that is
// makerDay in lib/coach.js, pinned by qa/coach-suite.mjs. So is "Start here" —
// the first piece the maker can act on, lifted into the big card.
//
// What a row's button does: an answer that needs nothing else is taken on the
// spot (Accept); a reminder is sent on the spot; everything else opens the
// task (components/CoachTask.jsx), where the server is asked what the step is
// still missing.
//
// Pieces that are on time and in somebody else's hands are in none of the
// five — they are in the week, in the calendar, and listed under More, with
// everything else this page used to show.

// `key:` order is the owner's order; qa/coach-suite.mjs reads it from here.
const GROUPS = [
  { key: 'film', label: () => tx('Filming today'), why: () => tx('It happens at a set time, so it comes first. Check that the crew is coming.'), none: () => tx('Nothing is filmed today.') },
  { key: 'pravka', label: () => tx('Pravka'), why: () => tx('Someone waits for your answer — or fixes what was asked.'), none: () => tx('Nothing to check and nothing is being fixed.') },
  { key: 'late', label: () => tx('Overdue'), why: () => tx('Past its day. Remind the person who has it — or do your own step.'), none: () => tx('Nothing is late.') },
  { key: 'move', label: () => tx('Your move'), why: () => tx('The crew can’t start until you add your words.'), none: () => tx('Nothing waits for your words.') },
  { key: 'ready', label: () => tx('Ready to publish'), why: () => tx('Finished. Post it and press “Publish”.'), none: () => tx('Nothing is ready yet. Finished pieces land here.') },
  // A piece with no day is on no week and no calendar — so it is here, by
  // name, until it is given one (the owner, 23 Oct 2026: "I don't know where
  // to find the task").
  { key: 'nodate', label: () => tx('No day yet'), why: () => tx('Give it a day — until then it is only here.'), none: () => '' },
]
const SUBS = [
  { key: 'check', label: () => tx('Check it'), why: () => tx('An edit or artwork came in. Look and answer.'), none: () => tx('Nothing to check. New edits and artwork land here.') },
  { key: 'fix', label: () => tx('Being fixed'), why: () => tx('Changes were asked for. Nothing to press.'), none: () => tx('Nothing is being fixed.') },
]

export default function CoachMakerDay({
  model, pieces, user, today, byKey, pipe, team, roundsOf, reviewsOn, making = null, onOpen, onChanged, onNew = null, more = null, onClassic = null,
}) {
  const [busy, setBusy] = useState(false)
  const colorOf = usePieceColors()
  const name = user.name.split(' ')[0]
  const person = (id) => team.find((u) => u.id === id) || null
  const nameOf = (id) => firstName(person(id))
  // A seat somebody holds whose name has not loaded yet still gets a subject.
  const crewName = (id) => nameOf(id) || tx('The crew')

  const { rows, first, month } = model
  // Pieces still open from an earlier month's plan stand apart, in their own
  // group at the end and in their month's colour, so last month's videos do
  // not mix with what goes out now (lib/planMonth.js). Which of them is most
  // pressing is still makerDay's reading: only where it is drawn moves.
  const carried = rows.filter((r) => r.group !== 'plan' && isCarried(r.t, today))
  const carriedIds = new Set(carried.map((r) => r.t.id))
  const from = carriedFrom(carried, today, (r) => r.t)
  const inGroup = (k) => rows.filter((r) => !carriedIds.has(r.t.id) && (k === 'pravka' ? r.group === 'check' || r.group === 'fix' : r.group === k))
  const showHero = !!first
  const [openAll, setOpenAll] = useState({})   // a long group shows four; the rest on request

  // ---- what the maker can press without opening anything ----
  const accept = async (r) => {
    if (busy) return
    setBusy(true)
    try {
      const u = await api.post(`/content/${r.t.id}/approve`, {})
      toast(tx('Accepted — it is ready to publish'))
      onChanged?.(u)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  // The one line of facts: what it is, who has it and what they are doing, when.
  const release = (t) => (!reviewDue(t) ? '' : reviewDue(t) < today ? tx('was planned for {day}', { day: dayShort(reviewDue(t)) }) : tx('goes out {day}', { day: dayInLine(reviewDue(t), today) }))
  const doing = (r) => {
    const n = nameOf(r.holder)
    if (!n) return ''
    const w = r.act.wait
    return w === 'shoot' ? tx('{name} films it', { name: n }) : w === 'cut' ? tx('{name} edits it', { name: n })
      : w === 'artwork' ? tx('{name} draws it', { name: n }) : w === 'review' ? tx('{name} checks it and posts it', { name: n }) : ''
  }
  const factOf = (r) => {
    const { t, act } = r
    const bits = []
    if (r.group === 'film') bits.push(hoursOf(t), nameOf(t.operator_id) && tx('{name} films it', { name: nameOf(t.operator_id) }))
    else if (act.kind === 'check') {
      bits.push(act.what === 'cut' ? tx('{name} handed in the edit', { name: crewName(r.holder) }) : tx('{name} handed in the artwork', { name: crewName(r.holder) }))
      if (roundsOf(t) > 0) bits.push(tx('delivery {n}', { n: roundsOf(t) + 1 }))
    } else if (act.kind === 'fixing') {
      bits.push(act.seat === 'designer' ? tx('{name} fixes the artwork', { name: crewName(r.holder) })
        : act.seat === 'operator' ? tx('{name} films it again', { name: crewName(r.holder) })
          : tx('{name} fixes the edit', { name: crewName(r.holder) }),
      // Until when — the owner's line for this group is "who, which round,
      // until when". The round is the row's badge. The day is the next one
      // the piece is still promised for (fixUntil, read once in makerDay) —
      // never a day already gone; with none left, the day it was to go out.
      r.until ? tx('until {day}', { day: dayInLine(r.until, today) }) : release(t))
    } else if (r.late) bits.push(doing(r))   // how late is the badge
    else bits.push(doing(r), release(t))
    return bits.filter(Boolean).join(' · ')
  }
  // The word on the button that opens the task on the maker's own step.
  const verbOf = (act) => (act.kind === 'publish' ? tx('Publish') : act.kind === 'move' ? tx(act.verb)
    : act.kind === 'ownfix' || act.kind === 'fix' ? tx('Fix it') : act.kind === 'ask' ? tx('Answer')
      : act.kind === 'seat' ? (act.wait === 'shoot' ? tx('Name who films it') : act.wait === 'artwork' ? tx('Name who draws it') : tx('Name who edits it'))
        : tx('Open'))
  const actionOf = (r) => {
    const { act, t } = r
    if (act.kind === 'check') {
      // One button a row (round 10). "Ask for changes" is on the big card and
      // in the task, which a press on the row opens.
      return <button type="button" className="co-btn co-btn-s co-btn-sm" disabled={busy} onClick={() => accept(r)}><Check size={16} aria-hidden="true" />{tx('Accept')}</button>
    }
    if (r.actionable) {
      const Icon = act.kind === 'publish' ? Send : PenLine
      return <button type="button" className="co-btn co-btn-s co-btn-sm" onClick={() => onOpen(t)}><Icon size={16} aria-hidden="true" />{verbOf(act)}</button>
    }
    // In somebody else's hands: a reminder, where there is something to be
    // reminded of — a fix, a late step, a shoot today nobody has said yes to.
    const nudge = r.group === 'fix' || r.group === 'late' || (r.group === 'film' && r.state !== 'coming')
    return nudge && r.holder ? <RemindButton small user={user} taskId={t.id} person={person(r.holder)} today={today} /> : null
  }

  // A shoot today is a shoot, whatever step the piece is waiting on.
  const kindOf = (r) => (r.group === 'film' ? 'shoot' : kindOfAct(r.act))
  // r11 (the owner: "too complicated again"): a row is its colour, its title,
  // one line, and ONE thing on the right — its button, with "late" beside it
  // only when it is late. No icon square, no month tag, no "Waits for you".
  const row = (r) => {
    const action = actionOf(r)
    return (
      <div key={r.t.id} className={`co-row nonum ${KIND[kindOf(r)].cls}`}>
        <button type="button" className="co-row-b" onClick={() => onOpen(r.t)}>
          {making && <Timeline size="row" stops={timelineOf(r.t, pipe, making(r.t), { person, userId: user.id, today })} />}
          <span className="co-row-t">
            {colorOf(r.t) != null && <i className="pc-dot" style={colorStyle(colorOf(r.t))} aria-hidden="true" />}{r.t.title}
          </span>
          <span className="co-row-f">{factOf(r)}</span>
        </button>
        <span className="co-row-r">
          {(!action || r.late > 0) && <MakerBadge row={r} today={today} nameOf={nameOf} />}{action}
        </span>
      </div>
    )
  }

  const hero = () => {
    const r = first
    const { act, t } = r
    const why = act.kind === 'check'
      ? (act.what === 'cut'
        ? tx('{name} finished the edit and waits for your answer.', { name: crewName(r.holder) })
        : tx('{name} finished the artwork and waits for your answer.', { name: crewName(r.holder) }))
      : r.state === 'unsent' ? tx('It is planned to be filmed today, and it is not sent to the shoot yet.')
        : r.late ? tx('It is late — {late} — and the next step is yours.', { late: lateWords(r.late) })
          : act.kind === 'publish' ? (reviewDue(t) === today ? tx('It is finished and it goes out today. It only needs you to post it.') : tx('It is finished. It only needs you to post it.'))
            : act.kind === 'move' ? tx('The crew can’t start until you add your words.')
              : act.kind === 'ownfix' ? tx('Changes were asked of you. Somebody waits for the new version.')
                : tx('This step is yours, and it is next.')
    return (
      <StartHere kind={kindOf(r)} own title={t.title} onOpen={() => onOpen(t)} why={why}
        line={<MakerBadge row={r} today={today} nameOf={nameOf} />}
        /* r11 (the owner): the preview — watch what was handed in, right here. */
        extra={act.kind === 'check' ? <div className="co-here-prev"><TaskFiles taskId={t.id} /></div> : null}
        buttons={act.kind === 'check' ? (
          <>
            <button type="button" className="co-btn co-btn-p" disabled={busy} onClick={() => accept(r)}>
              <Check size={18} aria-hidden="true" />{act.what === 'cut' ? tx('Accept the edit') : tx('Accept the artwork')}
            </button>
            {reviewsOn(t).ask && <button type="button" className="co-btn co-btn-s" onClick={() => onOpen(t, { focus: 'note' })}>{tx('Ask for changes')}</button>}
          </>
        ) : (
          <button type="button" className="co-btn co-btn-p" onClick={() => onOpen(t, { focus: 'step' })}>{verbOf(act)} <ArrowRight size={18} aria-hidden="true" /></button>
        )} />
    )
  }

  const list = (k, none) => {
    const all = k === 'carried' ? carried : inGroup(k)
    const shown = all.filter((r) => !(showHero && r === first))
    if (!shown.length) return <p className="co-quiet">{all.length ? tx('The one here is the big card at the top.') : none}</p>
    return (
      <>
        {(openAll[k] ? shown : shown.slice(0, 3)).map(row)}
        {shown.length > 3 && (
          <button type="button" className="co-link co-more-rows" onClick={() => setOpenAll((old) => ({ ...old, [k]: !old[k] }))}>
            {openAll[k] ? tx('Show fewer') : tx('Show all {n}', { n: shown.length })}
          </button>
        )}
      </>
    )
  }

  const onWay = rows.filter((r) => r.group === 'plan')
  const shown = GROUPS.filter((g) => inGroup(g.key).length > 0)

  return (
    <div className="co">
      <header className="co-head">
        <p className="co-date">{longDayLabel(today)}</p>
        <h1 className="co-title">{first ? tx('{name}, start here.', { name }) : tx('{name}, nothing waits for you right now.', { name })}</h1>
      </header>

      {showHero && hero()}
      <section className="co-list" aria-label={tx('Your pieces, the most pressing first')}>
        {shown.map((g) => (
          <div key={g.key} className="co-grp">
            <div className="co-grp-h"><h3>{g.label()}<span>{inGroup(g.key).length}</span></h3></div>
            {g.key === 'pravka' ? SUBS.filter((x) => inGroup(x.key).length > 0).map((x) => (
              <div key={x.key}>
                <div className="co-sub-h">{x.label()}</div>
                {list(x.key, x.none())}
              </div>
            )) : list(g.key, g.none())}
          </div>
        ))}
        {!shown.length && <p className="co-quiet">{tx('Nothing waits for you today. What the crew is making is under More.')}</p>}
      </section>

      <More>
        <p className="co-quiet">{tx('{done} of {total} pieces are out this month', { done: month.out, total: month.total })}</p>
        {carried.length > 0 && (
          <details className="sd-fold">
            <summary>{tx('Carried over from {month}', { month: monthLongOf(from) })} <span className="count">· {carried.length}</span></summary>
            <p className="co-help">{tx('Still open from an earlier month. Move each one to a new day, or close it.')}</p>
            {list('carried', '')}
          </details>
        )}
        {onWay.length > 0 && (
          <details className="sd-fold">
            <summary>{tx('On its way — nothing for you to press')} <span className="count">· {onWay.length}</span></summary>
            {onWay.map(row)}
          </details>
        )}
        {more}
        {onClassic && (
          <button type="button" className="sd-classic" onClick={onClassic}>{tx('Bring back the previous look')}</button>
        )}
      </More>
    </div>
  )
}

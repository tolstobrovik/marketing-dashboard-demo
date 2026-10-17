import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { can } from './constants.js'
import { askedOf } from './channelFormat.js'
import { pipelineOf, makingOf, nextStepOf } from './nextStep.js'

// The next step of a piece, for THIS person (lib/nextStep.js), as one function
// every page that draws the new look can call: My Day, a channel board, the
// task window. What they may do is read the way the server reads it — an
// admin on the channels they run, a member on their own channels or their own
// piece — so the button is offered where the move would be taken.
//
// Two more readings ride along for the Coach look (lib/coach.js), from the
// same rules and the same "is this person on this piece":
//
//   makingFor(t)   what kind of making the piece is — filmed, designed or
//                  written — so the window can say who does each stop
//   reviewsOn(t)   whether they may accept a delivery on it, and whether they
//                  may send it back (the server's reviewsHere, and the
//                  request_changes ticket behind POST …/revisions)
const reviewersOf = (t) => {
  const r = Array.isArray(t.reviewers) ? t.reviewers : (() => { try { return JSON.parse(t.reviewers || '[]') } catch { return [] } })()
  return r.length ? r : t.reviewer_id ? [t.reviewer_id] : []
}

export function useNextStep(user, statuses, byKey) {
  const onChannel = (t) => (t.channels || []).some((c) => (user.departments || []).includes(c))
  const [rules, setRules] = useState(null)
  useEffect(() => { api.cached('/fields').then(setRules).catch(() => {}) }, [])
  const pipe = useMemo(() => pipelineOf(statuses), [statuses])
  const makingFor = useCallback(
    (t) => makingOf(t, rules?.crew, askedOf(rules?.channel_formats, t.channels, byKey, !!t.with_media)),
    [rules, byKey])
  const stepOf = useCallback((t) => {
    const admin = user.role === 'admin'
    const mine = t.assignees?.length ? t.assignees.includes(user.id) : t.assignee_id === user.id
    const onIt = admin
      ? !(user.admin_channels || []).length || (t.channels || []).some((c) => user.admin_channels.includes(c))
      : mine || (t.channels || []).some((c) => (user.departments || []).includes(c))
    return nextStepOf(t, pipe, makingFor(t),
      // Publishing is the channel's: a reviewer on one of its channels — the
      // named one, when it has any — as the server's canPublish reads it (the
      // bug hunt, 14 Oct 2026: owners off the channel were offered a 403).
      { move: onIt && (can(user, 'move_tasks') || mine), publish: admin ? onIt : can(user, 'review_publish') && onChannel(t) && (!reviewersOf(t).length || reviewersOf(t).includes(user.id) || mine) })
  }, [user, pipe, makingFor])
  const reviewsOn = useCallback((t) => {
    const onChannel = user.role === 'admin'
      ? !(user.admin_channels || []).length || (t.channels || []).some((c) => user.admin_channels.includes(c))
      : (t.channels || []).some((c) => (user.departments || []).includes(c))
    return {
      accept: onChannel && (can(user, 'request_changes') || can(user, 'review_publish')),
      ask: onChannel && can(user, 'request_changes'),
    }
  }, [user])
  return { stepOf, pipe, makingFor, reviewsOn }
}

// Read the way lib/constants.js reads it (isDeletedLabel). Kept here rather than
// imported so this file is plain logic a suite can load under node
// (qa/nextstep-suite.mjs), like lib/due.js.
const isDeletedLabel = (label) => /^deleted$/i.test(label || '')

// ---- what a piece needs next, and from whom ----------------------------------
//
// The board has five stages and a new person has no idea which of the five a
// card should be dragged to, or whether it is theirs to drag. The simple look
// does not ask them to know: every piece carries ONE next step, said in a verb
// ("Send to the shoot", "Publish"), and it is a button only for the person
// whose step it is. For everybody else it is a line saying who the piece is
// waiting on.
//
// Read off the same stages the server reads (resolveGates in
// server/deadlines.js — matched by label, because stages are the admin's
// data), so a renamed or removed stage moves this with it. Nothing here
// decides whether a move is allowed: the server does, and the window the
// button opens (components/NextStep.jsx) asks it what is missing.
const GATE = {
  shoot: /to\s*shoot|shooting|s[yj]omka/i,
  edit: /editing|montaj/i,
  review: /^ready$|review|tayyor/i,
}

export function pipelineOf(statuses) {
  const live = [...(statuses || [])].sort((a, b) => (a.sort - b.sort) || (a.id - b.id))
    .filter((s) => !isDeletedLabel(s.label))
  const at = (re) => live.findIndex((s) => re.test(String(s.label || '')))
  return { live, shoot: at(GATE.shoot), edit: at(GATE.edit), review: at(GATE.review), final: live.findIndex((s) => s.is_final) }
}

// What kind of making a piece is. `filmed` and `designed` are the admin's crew
// rules (/fields → crew) narrowed by where the piece is going — `asked` is the
// channel-format reader (lib/channelFormat.js); `written` is a piece that goes
// nowhere but written channels.
export function makingOf(task, crew, asked) {
  const formats = asked?.formats || []
  // 'text' is Telegram, 'short' is X / Threads / LinkedIn (see CHANNEL_FORMATS);
  // a short post with a video or a picture arrives here as 'social' already.
  const written = formats.length > 0 && formats.every((f) => f === 'text' || f === 'short')
  // 'repost' is TikTok / YouTube Shorts: a finished video posted again. It
  // arrives at Ready made, and its one step is out (server/reposts.js).
  const repost = formats.length > 0 && formats.every((f) => f === 'repost')
  const needs = (hat, fallback) => (Array.isArray(crew?.[hat]) ? crew[hat] : fallback).includes(task.type)
  const allows = (hat) => (asked ? asked.crew(hat) : true)
  return {
    written,
    repost,
    filmed: !written && !repost && needs('operator', ['reel', 'video']) && allows('operator'),
    designed: !written && !repost && needs('designer', ['post']) && allows('designer'),
  }
}

// → { to, verb }            a step this person takes: the stage it lands on and the verb on the button
// → { wait, who }           somebody else's step: what is being waited for, and whose it is
// → null                    nothing more to do (it went out, or it was killed)
//
// `can` is what this person may do on the piece: { move, publish }.
export function nextStepOf(task, pipe, making, can) {
  if (task.done_at) return null
  const at = pipe.live.findIndex((s) => s.id === task.status_id)
  if (at < 0) return null
  const stage = (i) => pipe.live[i]
  const finalAt = pipe.final
  const { written, filmed, designed } = making

  // Out of the idea stage: where the making starts.
  const ideaEnd = pipe.shoot >= 0 ? pipe.shoot : 1
  if (at < ideaEnd) {
    if (!can.move) return { wait: 'idea' }
    if (filmed && pipe.shoot >= 0) return { to: stage(pipe.shoot), verb: 'Send to the shoot' }
    if (pipe.edit >= 0) return { to: stage(pipe.edit), verb: written ? 'Start writing' : designed ? 'Send to the designer' : 'Start the work' }
    return finalAt >= 0 ? publish(task, stage(finalAt), can) : null
  }
  // Booked: the operator's — until the footage is in. A filmed piece still
  // standing here with its shoot stamped (`shot_at`) came in before it had a
  // ТЗ or an editor, and the server held it rather than send it on to nobody
  // (the 'shot' tick in server/routes/content.js). Sending it on is then the
  // step of whoever runs the piece; for everybody else it waits for the edit,
  // not for a shoot that is done. One sent back to be filmed again (an open
  // round) is the operator's as before.
  if (pipe.shoot >= 0 && at === pipe.shoot) {
    if (filmed && task.shot_at && !task.open_round && pipe.edit > at)
      return can.move ? { to: stage(pipe.edit), verb: 'Send to editing' } : { wait: 'cut', who: task.editor_id }
    return { wait: 'shoot', who: task.operator_id }
  }
  // Being made: the editor's or the designer's — or, on a written channel, the writer's own.
  if (pipe.review < 0 || at < pipe.review) {
    if (written) return finalAt >= 0 ? publish(task, stage(finalAt), can) : null
    return filmed ? { wait: 'cut', who: task.editor_id } : { wait: 'artwork', who: task.designer_id }
  }
  // Made, and up for its last look.
  if (finalAt >= 0 && at < finalAt) return publish(task, stage(finalAt), can)
  return null
}
const publish = (task, to, can) => (can.publish ? { to, verb: 'Publish' } : { wait: 'review', who: task.reviewer_id })

// The words for a wait, as one grey line: what, and whose.
export const WAIT_WORDS = {
  idea: 'still an idea',
  shoot: 'waiting for the shoot',
  cut: 'waiting for the edit',
  artwork: 'waiting for the artwork',
  review: 'waiting to be checked',
}

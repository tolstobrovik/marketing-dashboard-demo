// The next step of a piece, and whose it is.
//
// The simple look puts ONE button on every piece: its next step, in a verb.
// It is a button only for the person whose step it is; for everybody else the
// row says who the piece is waiting on. A wrong answer here is either a button
// that leads to a refusal, or a person told to wait for a step that is theirs
// — so the reading is pinned, stage by stage and kind by kind, against the
// same stage matching the server uses (resolveGates in server/deadlines.js).
//
// Pure Node, no server and no data directory.
//
//   node qa/nextstep-suite.mjs
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const ROOT = process.env.DASHB_ROOT
  ? pathToFileURL(process.env.DASHB_ROOT.replace(/[\\/]?$/, '/'))
  : new URL('../', import.meta.url)
const from = (p) => new URL(p, ROOT).href
const { pipelineOf, makingOf, nextStepOf, WAIT_WORDS } = await import(from('client/src/lib/nextStep.js'))
const { resolveGates } = await import(from('server/deadlines.js'))

let fails = 0
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? '✔' : '✘ FAIL'} ${n}${x ? ` — ${x}` : ''}`) }

const STAGES = [
  { id: 1, label: 'Idea', sort: 1 }, { id: 2, label: 'To shoot', sort: 2 }, { id: 3, label: 'Editing', sort: 3 },
  { id: 4, label: 'Ready', sort: 4 }, { id: 5, label: 'Published', sort: 5, is_final: 1 }, { id: 6, label: 'Deleted', sort: 6 },
]
const pipe = pipelineOf(STAGES)
const server = resolveGates(STAGES)
ok('the client finds the same gates the server does',
  pipe.live[pipe.shoot]?.id === server.gates.shoot.id && pipe.live[pipe.edit]?.id === server.gates.edit.id
  && pipe.live[pipe.review]?.id === server.gates.review.id && pipe.live[pipe.final]?.id === server.finalId)
ok('the Deleted stage is not a stop on the way', !pipe.live.some((s) => s.label === 'Deleted'))

// What a piece is: filmed, designed or written — the admin's crew rules, narrowed by where it goes.
const CREW = { operator: ['reel', 'video'], editor: ['reel', 'video'], designer: ['post'] }
const TABLE = { social: { crew: ['operator', 'editor', 'designer'] }, text: { crew: [] } }
const asked = (formats) => ({ formats, crew: (hat) => !formats.length || formats.some((f) => TABLE[f]?.crew.includes(hat)) })
const reel = makingOf({ type: 'reel' }, CREW, asked(['social']))
const post = makingOf({ type: 'post' }, CREW, asked(['social']))
const telegram = makingOf({ type: 'post' }, CREW, asked(['text']))
const cross = makingOf({ type: 'post' }, CREW, asked(['social', 'text']))
ok('a reel on Instagram is filmed', reel.filmed && !reel.designed && !reel.written)
ok('a post on Instagram is designed', post.designed && !post.filmed && !post.written)
ok('a post on a written channel is written — nobody films or designs it', telegram.written && !telegram.filmed && !telegram.designed)
ok('cross-posted to Instagram and Telegram it is still a designed post', cross.designed && !cross.written)

const ALL = { move: true, publish: true }
const NONE = { move: false, publish: false }
const at = (status_id, more = {}) => ({ status_id, ...more })
const says = (step) => (step?.to ? `${step.verb} → ${step.to.label}` : step?.wait ? `wait:${step.wait}` : 'nothing')

// ---- a filmed piece -----------------------------------------------------------
let s = nextStepOf(at(1), pipe, reel, ALL)
ok('an idea for a reel: send it to the shoot', s?.to?.id === 2 && s.verb === 'Send to the shoot', says(s))
s = nextStepOf(at(2, { operator_id: 7 }), pipe, reel, ALL)
ok('booked: it is the operator’s, and nobody else has a button', s?.wait === 'shoot' && s.who === 7, says(s))
s = nextStepOf(at(3, { editor_id: 8 }), pipe, reel, ALL)
ok('in Editing: it is the editor’s', s?.wait === 'cut' && s.who === 8, says(s))
s = nextStepOf(at(4), pipe, reel, ALL)
ok('at Ready: whoever may publish gets Publish', s?.to?.id === 5 && s.verb === 'Publish', says(s))
s = nextStepOf(at(4, { reviewer_id: 9 }), pipe, reel, { move: true, publish: false })
ok('…and whoever may not is told it is waiting to be checked', s?.wait === 'review' && s.who === 9, says(s))
ok('once it is out there is nothing left to do', nextStepOf(at(5, { done_at: '2026-10-02T10:00:00.000Z' }), pipe, reel, ALL) === null)
ok('a killed piece has no next step', nextStepOf(at(6), pipe, reel, ALL) === null)

// ---- a designed post ------------------------------------------------------------
s = nextStepOf(at(1), pipe, post, ALL)
ok('an idea for a post skips the shoot: send it to the designer', s?.to?.id === 3 && s.verb === 'Send to the designer', says(s))
s = nextStepOf(at(3, { designer_id: 4 }), pipe, post, ALL)
ok('in Editing: it is the designer’s', s?.wait === 'artwork' && s.who === 4, says(s))

// ---- a written piece ------------------------------------------------------------
s = nextStepOf(at(1), pipe, telegram, ALL)
ok('an idea for a Telegram post: start writing', s?.to?.id === 3 && s.verb === 'Start writing', says(s))
s = nextStepOf(at(3), pipe, telegram, ALL)
ok('being written: the writer publishes it themselves', s?.to?.id === 5 && s.verb === 'Publish', says(s))

// ---- whose step it is ------------------------------------------------------------
s = nextStepOf(at(1), pipe, reel, NONE)
ok('somebody who may not move the piece is offered no button on an idea', !s?.to && s?.wait === 'idea', says(s))
ok('every wait has words', ['idea', 'shoot', 'cut', 'artwork', 'review'].every((k) => typeof WAIT_WORDS[k] === 'string' && WAIT_WORDS[k]))

// ---- a board the admin reshaped ---------------------------------------------------
const NO_SHOOT = STAGES.filter((x) => x.id !== 2)
const p2 = pipelineOf(NO_SHOOT)
s = nextStepOf(at(1), p2, reel, ALL)
ok('with no shooting stage a reel’s first step is the making stage, not a missing one', s?.to?.id === 3, says(s))
ok('a stage that is not on the board gives no step rather than a crash', nextStepOf(at(99), pipe, reel, ALL) === null)

console.log(fails ? `\n${fails} FAILED` : '\nThe next step holds.')
process.exit(fails ? 1 : 0)

// What the Master Calendar and Recordings show, and whose work a name means
// there (the owner, 22 Oct 2026).
//
// The two calendars used to share the board's filter: a person was "anybody
// on the task — assigned, filming, editing or designing". On Recordings that
// put an editor's every task on the shoot grid, because he was on them; the
// owner: "if he is only shooting it, show only the one he is shooting". So a
// name means the SEAT the view is about: on Recordings, who films; on the
// Master Calendar, who makes what goes out — the editor or the designer — or
// whose piece it is.
import { assigneesOf } from '../components/ContentFilters.jsx'

export const BLANK = { person: '', stages: [] }

// The seats a person is matched on, per view.
export const SEATS = {
  recording: ['operator_id'],
  release: ['editor_id', 'designer_id'],
}
// Who this view's people are: the crew hats whose seat it reads.
export const HATS = {
  recording: ['operator'],
  release: ['editor', 'designer'],
}

// The people a task has in this view's seats. On the Master Calendar the
// piece's owner counts too: "mine" for an SMM is what she is handing out,
// not what she cuts.
export const seatedOf = (t, mode) => {
  const ids = SEATS[mode].map((f) => t[f]).filter(Boolean).map(Number)
  if (mode === 'release') ids.push(...assigneesOf(t))
  return [...new Set(ids)]
}

export const isOn = (f) => !!(f.person || (f.stages && f.stages.length))

export const matchesPerson = (t, person, mode) => !person || seatedOf(t, mode).includes(Number(person))
export const matchesStages = (t, stages) => !stages?.length || stages.map(String).includes(String(t.status_id))
export const matches = (t, f, mode) => matchesPerson(t, f.person, mode) && matchesStages(t, f.stages)

// Read back what was saved, whatever shape an older build saved it in.
export const cleanFilter = (raw) => ({
  person: raw?.person ? String(raw.person) : '',
  stages: Array.isArray(raw?.stages) ? raw.stages.map(String) : raw?.stage ? [String(raw.stage)] : [],
})

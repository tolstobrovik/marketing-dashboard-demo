// ---- which channel the Board opens on ----------------------------------------------
//
// The short menu (October survey: "too complicated", 3.0 of 5) has one Board
// instead of a row per channel; the channel is a picker at the top of the
// board. The Board opens on the channel this person looked at last, in this
// browser — a convenience, not a setting: everybody sees the same pages.
const KEY = (uid) => `satashkent_board_channel_${uid}`

export const lastBoardChannel = (uid, visible) => {
  let k = ''
  try { k = localStorage.getItem(KEY(uid)) || '' } catch { /* a private window forgets */ }
  return (visible.find((c) => c.key === k) || visible[0] || null)?.key || ''
}
export const rememberBoardChannel = (uid, key) => {
  try { localStorage.setItem(KEY(uid), key) } catch { /* a private window forgets */ }
}

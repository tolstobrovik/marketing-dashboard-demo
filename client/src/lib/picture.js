// A picture, ready to travel. The task sheet downscales in the browser before
// anything is uploaded — a ≤1600px JPEG for the reference itself and a ≤320px
// thumbnail for cards — so a 10 MB phone photo arrives as a few hundred KB.
// Same sizes here, so a picture added in the task builder is exactly the
// picture the sheet would have made of it.
export const PICTURE_MAX_BYTES = 15 * 1024 * 1024
export const DOC_MAX_BYTES = 4 * 1024 * 1024

const scale = (img, maxW, quality) => {
  const ratio = Math.min(1, maxW / img.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * ratio)
  canvas.height = Math.round(img.height * ratio)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

// A picture has to FIT, not just be smaller than it was.
//
// One pass at 1600px/0.85 is a guess at a size, and a guess is what it stays:
// a dense screenshot comes out of it at a megabyte and more, and a task can
// carry eight of them in ONE save. Every byte travels inside the JSON body, so
// the whole album plus the text has to pass whatever the server in front
// accepts — and past that limit nothing explains itself: nginx answers 413
// with an HTML page the app cannot read, before the app is even reached.
//
// So the picture is measured, and shrunk until it fits: quality first, because
// dropping from 0.85 to 0.6 costs a screenshot almost nothing visible and
// often halves it; then width, which costs detail and is spent last. The
// budget is per picture, so eight of them still add up to something a request
// can carry.
export const PICTURE_BUDGET = 600 * 1024

export function scaleWithin(img, maxW, quality, budget = PICTURE_BUDGET) {
  let out = scale(img, maxW, quality)
  if (out.length <= budget) return out
  for (const q of [0.7, 0.6, 0.5]) {
    out = scale(img, maxW, q)
    if (out.length <= budget) return out
  }
  for (const w of [1200, 900, 700, 500]) {
    out = scale(img, w, 0.6)
    if (out.length <= budget) return out
  }
  // Nothing fits: hand back the smallest we made rather than nothing at all.
  // A picture that is too big is still better than a save that fails with no
  // picture, and the request will say so plainly if it is still refused.
  return out
}

export const scaleExact = scale

export const isPicture = (file) => /^image\//.test(file?.type || '')

// { photo, thumb } for an image file.
export function readPicture(file) {
  return new Promise((resolve, reject) => {
    if (file.size > PICTURE_MAX_BYTES) { reject(new Error('Image is too large — keep it under 15 MB')); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try { resolve({ photo: scaleWithin(img, 1600, 0.85), thumb: scale(img, 320, 0.75) }) }
      catch { reject(new Error('Could not read that image')) }
      finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

// A document as the data URL /content/:id/files takes.
export function readDocument(file) {
  return new Promise((resolve, reject) => {
    if (file.size > DOC_MAX_BYTES) {
      reject(new Error(`“${file.name}” is ${(file.size / 1048576).toFixed(1)} MB — documents are capped at 4 MB`))
      return
    }
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('That file could not be read'))
    r.readAsDataURL(file)
  })
}

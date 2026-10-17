// ---- what a delivered link points at ----------------------------------------
// One reading of an artwork link, for every screen that wants to SHOW it
// rather than just open it: a Drive file (which has a thumbnail), a Drive
// folder (which has none), a Google document, a plain picture, or something
// else. No imports, so the suites can load it straight from Node.
//
// A delivery can be stored as "folder · label" (see splitDelivery in
// text.js): the channel's shared folder and the file somebody named in it.
// Drive has no address for "the file called X in this folder", so that reads
// as the folder, carrying the label.

const SEP = ' · '
const ID = '([\\w-]{10,})'
const DRIVE_FILE = [
  new RegExp(`^https?://drive\\.google\\.com/file/(?:u/\\d+/)?d/${ID}`, 'i'),
  new RegExp(`^https?://drive\\.google\\.com/(?:open|uc|thumbnail)\\?(?:.*&)?id=${ID}`, 'i'),
  new RegExp(`^https?://lh\\d\\.googleusercontent\\.com/d/${ID}`, 'i'),
]
const DRIVE_FOLDER = [
  new RegExp(`^https?://drive\\.google\\.com/drive/(?:u/\\d+/)?(?:mobile/)?folders/${ID}`, 'i'),
  new RegExp(`^https?://drive\\.google\\.com/(?:embedded)?folderview\\?(?:.*&)?id=${ID}`, 'i'),
]
const GOOGLE_DOC = new RegExp(`^https?://docs\\.google\\.com/(document|spreadsheets|presentation|drawings)/(?:u/\\d+/)?d/${ID}`, 'i')
const IMAGE = /^https?:\/\/[^\s?#]+\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#]|$)/i
const GOOGLE_IMAGE = /^https?:\/\/lh\d\.googleusercontent\.com\//i

// → { kind: 'drive' | 'folder' | 'doc' | 'image' | 'link' | 'none', url, id?, label?, doc? }
export function parseAsset(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { kind: 'none', url: '' }
  const at = raw.indexOf(SEP)
  const url = (at < 0 ? raw : raw.slice(0, at)).trim()
  const label = at < 0 ? '' : raw.slice(at + SEP.length).trim()
  if (!/^https?:\/\//i.test(url)) return { kind: 'none', url: '', label: label || raw }
  for (const re of DRIVE_FOLDER) {
    const m = re.exec(url)
    if (m) return { kind: 'folder', url, id: m[1], label }
  }
  // A label on anything but a folder is only a note; the link is the file.
  for (const re of DRIVE_FILE) {
    const m = re.exec(url)
    if (m) return { kind: 'drive', url, id: m[1], label }
  }
  const g = GOOGLE_DOC.exec(url)
  if (g) return { kind: 'doc', url, id: g[2], doc: g[1].toLowerCase(), label }
  if (IMAGE.test(url) || GOOGLE_IMAGE.test(url)) return { kind: 'image', url, label }
  return { kind: 'link', url, label }
}

// The picture to draw for it, at a width — or '' when there is none to draw.
// Drive answers its thumbnail address for a file anyone with the link can
// see, and an error for a private one; the caller falls back on that error.
export function thumbOf(asset, width = 640) {
  if (!asset) return ''
  if (asset.kind === 'drive' || asset.kind === 'doc') return `https://drive.google.com/thumbnail?id=${asset.id}&sz=w${width}`
  if (asset.kind === 'image') return asset.url
  return ''
}

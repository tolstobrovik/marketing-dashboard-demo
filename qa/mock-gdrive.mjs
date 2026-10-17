// A stand-in for the parts of Google the Drive upload uses: the consent
// screen, the token endpoint, folders, sharing, and resumable uploads —
// including the cross-site answers a browser needs to feed a session itself,
// and a session that drops a piece once, so resuming can be seen to work.
//
// And the parts drop-in uses: the scopes a consent granted (POST
// /__grant?scopes=… makes the next consent grant only those, as somebody
// unticking a box would), a file dropped into a folder by hand (POST /__drop),
// listings that come in pages (POST /__page?size=N), and thumbnails that need
// the key (POST /__thumb?id=… is Google finishing a preview).
//
// And the parts the task window's player and Download use: a file's bytes
// (alt=media) in the Range asked for, and a file somebody else owns that is not
// shared with the team account (__drop with hidden: true answers 404, as
// Google does). A dropped file's bytes are made up on the fly: byte i is i % 251.
//
//   node qa/mock-gdrive.mjs                (MOCK_PORT, default 9988)
//   import { startMockDrive } from './mock-gdrive.mjs'
//
// Point the server at it with GOOGLE_ACCOUNTS_BASE, GOOGLE_OAUTH_BASE and
// GOOGLE_API_BASE all set to its address. GET /__state says what it holds.
import http from 'http'
import { pathToFileURL } from 'url'

export function startMockDrive(port = Number(process.env.MOCK_PORT) || 9988) {
  const base = `http://localhost:${port}`
  const S = { files: new Map(), sessions: new Map(), permissions: [], revoked: new Set(), tokens: 0, n: 0, drops: 0, limit: 15 * 1024 ** 3, asked: '', grant: null, page: 1000, lists: 0 }
  const FOLDER = 'application/vnd.google-apps.folder'
  const id = (p) => `${p}${++S.n}`
  const fileJson = (f) => ({
    id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, size: f.size != null ? String(f.size) : undefined, trashed: !!f.trashed,
    webViewLink: f.webViewLink, appProperties: f.appProperties, createdTime: f.createdTime, hasThumbnail: !!f.thumb,
    ...(f.durationMillis ? { videoMediaMetadata: { durationMillis: String(f.durationMillis) } } : {}),
  })
  const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`
  const authed = (req) => /^Bearer at-/.test(req.headers.authorization || '')
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const read = (req) => new Promise((resolve) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => resolve(Buffer.concat(b))) })
  const cors = (req, sess) => {
    const o = req.headers.origin
    // Google answers a browser only for the origin the session was opened with.
    return o && sess && sess.origin === o
      ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Expose-Headers': 'Range, Location', 'Vary': 'Origin' }
      : {}
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, base)
    const path = u.pathname
    try {
      // How big the Drive is, for the "not enough room" test.
      if (path === '/__limit' && req.method === 'POST') { S.limit = Number(u.searchParams.get('bytes')) || S.limit; return send(res, 200, { limit: S.limit }) }
      // What the next consent grants (an empty value: whatever was asked).
      if (path === '/__grant' && req.method === 'POST') { S.grant = u.searchParams.get('scopes') || null; return send(res, 200, { grant: S.grant }) }
      if (path === '/__page' && req.method === 'POST') { S.page = Number(u.searchParams.get('size')) || 1000; return send(res, 200, { page: S.page }) }
      // Somebody puts a file into a folder by hand, in Drive itself.
      if (path === '/__drop' && req.method === 'POST') {
        const b = JSON.parse((await read(req)).toString() || '{}')
        const f = {
          id: id('drop'), name: b.name, mimeType: b.mimeType || 'video/mp4', parents: [b.parent], size: b.size ?? 1024,
          createdTime: b.createdTime || '2020-01-01T00:00:00.000Z', thumb: !!b.thumb, durationMillis: b.durationMillis || null,
          hidden: !!b.hidden, ...(b.folder ? { mimeType: FOLDER } : {}),
          // Real bytes when a check needs a file that truly plays.
          ...(b.base64 ? { bytes: Buffer.from(b.base64, 'base64'), size: Buffer.from(b.base64, 'base64').length } : {}),
        }
        f.webViewLink = `https://drive.google.com/file/d/${f.id}/view`
        S.files.set(f.id, f)
        return send(res, 200, fileJson(f))
      }
      // Google finishes making a preview.
      if (path === '/__thumb' && req.method === 'POST') {
        const f = S.files.get(u.searchParams.get('id'))
        if (f) { f.thumb = true; f.durationMillis = Number(u.searchParams.get('ms')) || f.durationMillis }
        return send(res, f ? 200 : 404, {})
      }
      if (path === '/__state') {
        return send(res, 200, {
          folders: [...S.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map(fileJson),
          files: [...S.files.values()].filter((f) => f.mimeType !== 'application/vnd.google-apps.folder').map(fileJson),
          permissions: S.permissions, revoked: [...S.revoked], drops: S.drops, gets: S.gets || 0, media: S.media || 0,
        })
      }
      // ---- signing in ----
      if (path === '/o/oauth2/v2/auth') {
        S.asked = u.searchParams.get('scope') || ''
        const to = new URL(u.searchParams.get('redirect_uri'))
        to.searchParams.set('code', 'mock-code')
        to.searchParams.set('state', u.searchParams.get('state') || '')
        res.writeHead(302, { Location: to.toString() }); return res.end()
      }
      if (path === '/token' && req.method === 'POST') {
        const p = new URLSearchParams((await read(req)).toString())
        if (!p.get('client_id') || !p.get('client_secret')) return send(res, 401, { error: 'invalid_client' })
        if (p.get('grant_type') === 'authorization_code') {
          if (p.get('code') !== 'mock-code') return send(res, 400, { error: 'invalid_grant' })
          const rt = `rt-${++S.tokens}`
          return send(res, 200, { access_token: `at-${S.tokens}`, refresh_token: rt, expires_in: 3600, scope: S.grant ?? S.asked, id_token: idToken('satashkent.test@gmail.com') })
        }
        if (p.get('grant_type') === 'refresh_token') {
          if (S.revoked.has(p.get('refresh_token'))) return send(res, 400, { error: 'invalid_grant' })
          return send(res, 200, { access_token: `at-r${++S.tokens}`, expires_in: 3600 })
        }
        return send(res, 400, { error: 'unsupported_grant_type' })
      }
      if (path === '/revoke' && req.method === 'POST') {
        S.revoked.add(new URLSearchParams((await read(req)).toString()).get('token'))
        return send(res, 200, {})
      }
      // ---- a browser feeding a session ----
      const sm = /^\/upload\/session\/(\w+)$/.exec(path)
      if (sm) {
        const sess = S.sessions.get(sm[1])
        if (req.method === 'OPTIONS') {
          return send(res, 204, undefined, {
            ...cors(req, sess), 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'Content-Range, Content-Type',
          })
        }
        if (!sess) return send(res, 404, { error: { message: 'No such session' } })
        const h = cors(req, sess)
        const range = String(req.headers['content-range'] || '')
        const body = await read(req)
        const rangeHdr = () => (sess.got > 0 ? { Range: `bytes=0-${sess.got - 1}` } : {})
        const asked = /^bytes \*\/(\d+)$/.exec(range)
        if (asked) {
          if (sess.got === sess.size) return send(res, 200, fileJson(S.files.get(sess.fileId)), h)
          return send(res, 308, undefined, { ...h, ...rangeHdr() })
        }
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)
        if (!m || Number(m[3]) !== sess.size) return send(res, 400, { error: { message: 'Bad Content-Range' } }, h)
        const [a, b] = [Number(m[1]), Number(m[2])]
        if (body.length !== b - a + 1) return send(res, 400, { error: { message: 'Length does not match range' } }, h)
        // A file named "flaky…" loses its second piece once — the connection
        // dropped, nothing kept — so a resume has something to resume from.
        if (/flaky/i.test(sess.name) && a > 0 && !sess.dropped) { sess.dropped = true; S.drops++; return send(res, 503, { error: { message: 'Backend error' } }, h) }
        if (a !== sess.got) return send(res, 308, undefined, { ...h, ...rangeHdr() })
        ;(sess.parts = sess.parts || []).push(body)
        sess.got = b + 1
        if (sess.got < sess.size) return send(res, 308, undefined, { ...h, ...rangeHdr() })
        const f = { id: id('file'), name: sess.name, mimeType: sess.mime, parents: sess.parents, size: sess.size, createdTime: new Date().toISOString(), bytes: Buffer.concat(sess.parts || []) }
        f.webViewLink = `https://drive.google.com/file/d/${f.id}/view`
        S.files.set(f.id, f)
        sess.fileId = f.id
        return send(res, 201, fileJson(f), h)
      }
      // ---- Drive itself: everything below needs a token ----
      if (!authed(req)) return send(res, 401, { error: { message: 'Login Required' } })
      if (path === '/upload/drive/v3/files' && req.method === 'POST' && u.searchParams.get('uploadType') === 'resumable') {
        const meta = JSON.parse((await read(req)).toString() || '{}')
        const sid = id('s')
        S.sessions.set(sid, {
          name: meta.name, parents: meta.parents || [], size: Number(req.headers['x-upload-content-length']),
          mime: req.headers['x-upload-content-type'], origin: req.headers.origin || null, got: 0,
        })
        return send(res, 200, {}, { Location: `${base}/upload/session/${sid}` })
      }
      if (path === '/drive/v3/files' && req.method === 'POST') {
        const meta = JSON.parse((await read(req)).toString() || '{}')
        const f = { id: id('folder'), name: meta.name, mimeType: meta.mimeType, parents: meta.parents || ['root'], appProperties: meta.appProperties || {} }
        f.webViewLink = `https://drive.google.com/drive/folders/${f.id}`
        S.files.set(f.id, f)
        return send(res, 200, fileJson(f))
      }
      if (path === '/drive/v3/files' && req.method === 'GET') {
        const q = u.searchParams.get('q') || ''
        // Any of the parents named ('a' in parents or 'b' in parents …).
        const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((m) => m[1])
        const tag = /key='(\w+)' and value='([^']*)'/.exec(q)
        const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1')
        const notFolder = q.includes(`mimeType!='${FOLDER}'`)
        const onlyFolder = q.includes(`mimeType='${FOLDER}'`)
        const hits = [...S.files.values()].filter((f) => !f.hidden && (!parents.length || parents.some((p) => f.parents.includes(p)))
          && (!tag || f.appProperties?.[tag[1]] === tag[2]) && (name == null || f.name === name)
          && !(q.includes('trashed=false') && f.trashed)
          && (!notFolder || f.mimeType !== FOLDER) && (!onlyFolder || f.mimeType === FOLDER))
        // Pages, as Google gives them: never more than asked, nor than __page allows.
        S.lists++
        const size = Math.min(Number(u.searchParams.get('pageSize')) || 100, S.page)
        const from = Number(u.searchParams.get('pageToken')) || 0
        const next = from + size < hits.length ? String(from + size) : undefined
        return send(res, 200, { files: hits.slice(from, from + size).map(fileJson), ...(next ? { nextPageToken: next } : {}) })
      }
      // A thumbnail is private like its file: the key, or nothing.
      const tm = /^\/thumb\/([\w-]+)=s\d+$/.exec(path)
      if (tm && req.method === 'GET') {
        if (!S.files.get(tm[1])?.thumb) return send(res, 404, { error: { message: 'No thumbnail' } })
        res.writeHead(200, { 'Content-Type': 'image/png' })
        return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
      }
      if (path === '/drive/v3/about' && req.method === 'GET') {
        const usage = [...S.files.values()].reduce((n, f) => n + (Number(f.size) || 0), 0)
        return send(res, 200, { storageQuota: { limit: String(S.limit), usage: String(usage) } })
      }
      const pm = /^\/drive\/v3\/files\/([\w-]+)\/permissions$/.exec(path)
      if (pm && req.method === 'POST') {
        S.permissions.push({ file: pm[1], ...JSON.parse((await read(req)).toString() || '{}') })
        return send(res, 200, { id: 'anyoneWithLink' })
      }
      const fm = /^\/drive\/v3\/files\/([\w-]+)$/.exec(path)
      // The bytes, whole or the range asked for.
      if (fm && req.method === 'GET' && u.searchParams.get('alt') === 'media') {
        const f = S.files.get(fm[1])
        if (!f || f.hidden) return send(res, 404, { error: { message: 'File not found' } })
        S.media = (S.media || 0) + 1
        const size = Number(f.size) || 0
        const byteAt = (i) => (f.bytes ? f.bytes[i] : i % 251)
        const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''))
        const a = m ? Number(m[1]) : 0
        const z = m && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1
        if (m && a >= size) return send(res, 416, { error: { message: 'Range not satisfiable' } }, { 'Content-Range': `bytes */${size}` })
        const out = Buffer.alloc(Math.max(0, z - a + 1))
        for (let i = a; i <= z; i++) out[i - a] = byteAt(i)
        res.writeHead(m ? 206 : 200, {
          'Content-Type': f.mimeType || 'application/octet-stream', 'Content-Length': String(out.length),
          ...(m ? { 'Content-Range': `bytes ${a}-${z}/${size}` } : {}),
        })
        return res.end(out)
      }
      if (fm && req.method === 'PATCH') {
        const f = S.files.get(fm[1])
        if (!f || f.hidden) return send(res, 404, { error: { message: 'File not found' } })
        Object.assign(f, JSON.parse((await read(req)).toString() || '{}'))
        return send(res, 200, fileJson(f))
      }
      if (fm && req.method === 'GET') {
        const f = S.files.get(fm[1])
        S.gets = (S.gets || 0) + 1
        return f && !f.hidden ? send(res, 200, { ...fileJson(f), ...(f.thumb ? { thumbnailLink: `${base}/thumb/${f.id}=s220` } : {}) })
          : send(res, 404, { error: { message: 'File not found' } })
      }
      return send(res, 404, { error: { message: `mock has no ${req.method} ${path}` } })
    } catch (e) {
      return send(res, 500, { error: { message: e.message } })
    }
  })
  return new Promise((resolve) => server.listen(port, () => resolve({ base, close: () => server.close(), state: S })))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  startMockDrive().then((m) => console.log(`mock Google Drive on ${m.base}`))
}

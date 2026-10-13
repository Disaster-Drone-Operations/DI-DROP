// Minimale Nextcloud für Tests (nur was di-drop braucht): Login Flow v2, OCS-Benutzer, WebDAV
// (PROPFIND, MKCOL, PUT, HEAD). Dateien landen in einem Ordner.
//   node test/support/nextcloud_mock.mjs [port] [ordner] [kbps]
//   kbps begrenzt die Upload-Geschwindigkeit, um den Fortschritt sichtbar zu machen.
//   MOCK_BLIND_HEAD=1: Größenabfrage findet nie etwas (prüft, dass PUT selbst nie überschreibt).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const port = Number(process.argv[2] ?? 8088)
const root = path.resolve(process.argv[3] ?? 'tmp/nextcloud-mock')
const kbps = Number(process.argv[4] ?? 0)
const base = `http://127.0.0.1:${port}`
const USER = { login: 'anna', id: 'anna', password: 'app-pass-123', display: 'Anna Test' }
fs.mkdirSync(path.join(root, USER.id), { recursive: true })
const flows = new Map() // token → granted

const authed = (req) => req.headers.authorization === `Basic ${Buffer.from(`${USER.login}:${USER.password}`).toString('base64')}`
const davPath = (url) => {
  const rel = decodeURIComponent(url.pathname.replace(`/remote.php/dav/files/${USER.id}`, ''))
  if (rel.split('/').includes('..')) throw new Error('bad path')
  return path.join(root, USER.id, rel)
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, base)
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  try {
    if (req.method === 'POST' && url.pathname === '/index.php/login/v2') {
      const token = Math.random().toString(36).slice(2)
      flows.set(token, false)
      return send(200, { poll: { token, endpoint: `${base}/login/v2/poll` }, login: `${base}/login/v2/flow/${token}` })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/login/v2/flow/')) {
      flows.set(url.pathname.split('/').pop(), true) // Aufruf der Seite = "Zugriff erlauben"
      return send(200, '<h1>Test-Nextcloud</h1><p>Zugriff für di-drop erlaubt. Fenster kann geschlossen werden.</p>', 'text/html; charset=utf-8')
    }
    if (req.method === 'POST' && url.pathname === '/login/v2/poll') {
      let body = ''
      for await (const c of req) body += c
      const token = new URLSearchParams(body).get('token')
      if (!flows.get(token)) return send(404, {})
      flows.delete(token)
      return send(200, { server: base, loginName: USER.login, appPassword: USER.password })
    }
    if (url.pathname === '/ocs/v2.php/cloud/user') {
      if (!authed(req)) return send(401, {})
      return send(200, { ocs: { data: { id: USER.id, 'display-name': USER.display, quota: { free: 5_000_000_000 } } } })
    }
    if (!url.pathname.startsWith(`/remote.php/dav/files/${USER.id}`)) return send(404, {})
    if (!authed(req)) return send(401, '')
    const file = davPath(url)

    if (req.method === 'PROPFIND') {
      if (!fs.existsSync(file)) return send(404, '')
      const entries = [url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`]
      const items = fs.statSync(file).isDirectory() && req.headers.depth === '1' ? fs.readdirSync(file, { withFileTypes: true }) : []
      const xml = [{ href: entries[0], dir: true }, ...items.map((d) => ({ href: `${entries[0]}${encodeURIComponent(d.name)}${d.isDirectory() ? '/' : ''}`, dir: d.isDirectory() }))]
        .map((e) => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><d:resourcetype>${e.dir ? '<d:collection/>' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`)
        .join('')
      return send(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`, 'application/xml')
    }
    if (req.method === 'MKCOL') {
      if (fs.existsSync(file)) return send(405, '')
      if (!fs.existsSync(path.dirname(file))) return send(409, '')
      fs.mkdirSync(file)
      return send(201, '')
    }
    if (req.method === 'HEAD') {
      if (process.env.MOCK_BLIND_HEAD) return send(404, '') // Test: nur If-None-Match schützt vor Überschreiben
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, '')
      res.writeHead(200, { 'Content-Length': fs.statSync(file).size })
      return res.end()
    }
    if (req.method === 'PUT') {
      if (!fs.existsSync(path.dirname(file))) return send(409, '')
      if (req.headers['if-none-match'] === '*' && fs.existsSync(file)) return send(412, '') // nicht überschreiben
      const out = fs.createWriteStream(`${file}.part`)
      for await (const chunk of req) {
        out.write(chunk)
        if (kbps) await new Promise((r) => setTimeout(r, (chunk.length / 1024 / kbps) * 1000))
      }
      await new Promise((r) => out.end(r))
      if (!req.complete) return fs.rmSync(`${file}.part`, { force: true })
      fs.renameSync(`${file}.part`, file)
      return send(201, '')
    }
    send(405, '')
  } catch (error) {
    send(500, String(error))
  }
}).listen(port, '127.0.0.1', () => console.log(`Test-Nextcloud auf ${base} (Dateien: ${root}${kbps ? `, ${kbps} KB/s` : ''})`))

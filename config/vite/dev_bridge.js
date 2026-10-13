// Nur im Vite-Dev-Server: verbindet die Browser-Variante mit dem echten Rust-Code
// (src-tauri/src/bin/didrop-dev.rs). Aktiv mit http://localhost:1420/?bridge
//
//   POST /__didrop/scan    ["/pfad", …]            → ScanResult
//   POST /__didrop/import  [{ src, dest_dir, … }]  → ImportResult[]
//   GET  /__didrop/file?path=…                     → Bilddatei (für Vorschaubilder)
//   POST /__didrop/write?path=…  (Bilddaten)       → { path }
//   POST /__didrop/open    { path, reveal }        → öffnet im Finder/Programm
//   POST /__didrop/nc      { action, … }           → Nextcloud-Verwaltung (Zugang in tmp/dev-nextcloud.json)
//   POST /__didrop/transfer?kind=copy|nc-upload&id=…  → NDJSON-Strom mit Fortschritt, letzte Zeile = Ergebnis
//   POST /__didrop/cancel  { id }                  → bricht eine Übertragung ab

import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export default function devBridge({ root }) {
  const binary = path.join(root, 'src-tauri/target/debug/didrop-dev')
  const thumbsDir = path.join(root, 'tmp/dev-thumbs')
  const mediaDir = path.join(root, 'tmp/dev-media')

  const env = { ...process.env, DIDROP_NC_ACCOUNT_FILE: path.join(root, 'tmp/dev-nextcloud.json') }
  const transfers = new Map()
  const run = (command, input) => new Promise((resolve, reject) => {
    const child = spawn(binary, [command], { env })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => reject(new Error(`${e.message} – erst "cargo build --bin didrop-dev" ausführen`)))
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `Exit ${code}`))))
    child.stdin.end(JSON.stringify(input))
  })

  const body = (req) => new Promise((resolve) => {
    let data = ''
    req.on('data', (d) => (data += d))
    req.on('end', () => resolve(data ? JSON.parse(data) : null))
  })

  return {
    name: 'di-drop:dev-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__didrop', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        try {
          if (url.pathname === '/info') {
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify({ mediaDir }))
          }
          if (url.pathname === '/thumb') {
            res.setHeader('Content-Type', 'application/json')
            return res.end(await run('thumb', { ...(await body(req)), thumbs_dir: thumbsDir }))
          }
          if (url.pathname === '/nc') {
            res.setHeader('Content-Type', 'application/json')
            return res.end(await run('nc', await body(req)))
          }
          if (url.pathname === '/transfer') {
            const id = url.searchParams.get('id')
            const child = spawn(binary, [url.searchParams.get('kind') === 'copy' ? 'copy' : 'nc-upload'], { env })
            transfers.set(id, child)
            res.setHeader('Content-Type', 'application/x-ndjson')
            let out = ''
            child.stdout.on('data', (d) => (out += d))
            child.stderr.on('data', (d) => res.write(d)) // Fortschrittszeilen direkt weiterreichen
            child.on('close', (code) => {
              transfers.delete(id)
              res.end(code === 0 ? out : `${JSON.stringify({ error: child.killed ? 'CANCELED' : `Exit ${code}` })}\n`)
            })
            child.stdin.end(JSON.stringify(await body(req)))
            return
          }
          if (url.pathname === '/cancel') {
            const { id } = await body(req)
            transfers.get(id)?.kill()
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify(transfers.has(id)))
          }
          if (url.pathname === '/scan') {
            res.setHeader('Content-Type', 'application/json')
            return res.end(await run('scan', await body(req)))
          }
          if (url.pathname === '/import') {
            res.setHeader('Content-Type', 'application/json')
            return res.end(await run('import', { items: await body(req), thumbs_dir: thumbsDir }))
          }
          if (url.pathname === '/file') {
            const file = url.searchParams.get('path')
            if (!/\.(jpe?g|png)$/i.test(file) || !fs.existsSync(file)) return res.writeHead(404).end()
            res.setHeader('Content-Type', /png$/i.test(file) ? 'image/png' : 'image/jpeg')
            return fs.createReadStream(file).pipe(res)
          }
          if (url.pathname === '/write') {
            let target = url.searchParams.get('path')
            if (!/\.(jpe?g|png)$/i.test(target)) return res.writeHead(400).end('Nur .jpg/.png')
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            fs.mkdirSync(path.dirname(target), { recursive: true })
            const ext = path.extname(target)
            const base = target.slice(0, -ext.length)
            for (let n = 2; fs.existsSync(target); n++) target = `${base}_${n}${ext}`
            fs.writeFileSync(target, Buffer.concat(chunks))
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify({ path: target }))
          }
          if (url.pathname === '/rename') {
            const { from, to, dir } = await body(req)
            if (path.dirname(from) !== path.dirname(to)) return res.writeHead(400).end('Nur im selben Ordner')
            let target = to
            const same = fs.existsSync(to) && fs.realpathSync(from) === fs.realpathSync(to)
            if (fs.existsSync(to) && !same) {
              const ext = dir ? '' : path.extname(to)
              const base = ext ? to.slice(0, -ext.length) : to
              for (let n = 2; fs.existsSync(target); n++) target = `${base}_${n}${ext}`
            }
            fs.renameSync(from, target)
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify({ path: target }))
          }
          if (url.pathname === '/open') {
            const { path: target, reveal } = await body(req)
            execFile('open', reveal ? ['-R', target] : [target])
            return res.end('{}')
          }
          res.writeHead(404).end()
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error.message ?? error))
        }
      })
    },
  }
}

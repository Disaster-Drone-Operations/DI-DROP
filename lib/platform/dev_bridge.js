// Browser-Variante + echter Rust-Code über den Vite-Dev-Server (config/vite/dev_bridge.js).
// Nur zum Entwickeln und Testen: http://localhost:1420/?bridge

import browser from '/lib/platform/browser.js'

const post = async (url, data) => {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(data) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const info = await fetch('/__didrop/info').then((r) => r.json())

// Antworten der Kommandozeile: { error } → Ausnahme wie bei Tauri
async function nc(request) {
  const result = await post('/__didrop/nc', request)
  if (result?.error) throw result.error
  return result
}

async function streamTransfer(kind, id, request, onProgress) {
  const response = await fetch(`/__didrop/transfer?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(request) })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let last = null
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines.filter(Boolean)) {
      const msg = JSON.parse(line)
      if ('done' in msg && 'total' in msg) onProgress(msg)
      else last = msg
    }
    if (done) break
  }
  if (buffer.trim()) last = JSON.parse(buffer)
  if (!last || last.error) throw last?.error ?? 'Keine Antwort'
  return last
}

export default {
  ...browser,
  name: 'dev-bridge',
  capabilities: { folders: false, media: true },

  joinPath: async (...parts) => parts.join('/').replace(/\/+/g, '/'),
  defaultMediaDir: async () => info.mediaDir,
  async readImage(path) {
    const res = await fetch(`/__didrop/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error(`Bild nicht lesbar: ${path}`)
    return res.blob()
  },
  async writeImage(path, blob) {
    const res = await fetch(`/__didrop/write?path=${encodeURIComponent(path)}`, { method: 'POST', body: blob })
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()).path
  },
  renameFile: async (from, to) => (await post('/__didrop/rename', { from, to })).path,
  renameDir: async (from, to) => (await post('/__didrop/rename', { from, to, dir: true })).path,
  openPath: (path) => post('/__didrop/open', { path }),
  revealPath: (path) => post('/__didrop/open', { path, reveal: true }),

  // Bereitstellen über den echten Rust-Code (didrop-dev); Fortschritt als NDJSON-Strom
  transfer: {
    copy: (id, src, dest, onProgress) => streamTransfer('copy', id, { src, dest }, onProgress),
    nextcloud: (id, src, dir, fileName, onProgress) => streamTransfer('nc-upload', id, { src, dir, file_name: fileName }, onProgress),
    cancel: (id) => post('/__didrop/cancel', { id }),
  },
  nextcloud: {
    account: () => nc({ action: 'account' }),
    loginStart: (server) => nc({ action: 'login_start', server }),
    loginPoll: (server, endpoint, token) => nc({ action: 'login_poll', server, endpoint, token }),
    loginManual: (server, login, password) => nc({ action: 'login_manual', server, login, password }),
    test: () => nc({ action: 'test' }),
    forget: () => nc({ action: 'forget' }),
    list: (path) => nc({ action: 'list', path }),
    mkdir: (path) => nc({ action: 'mkdir', path }),
  },

  media: {
    async thumbnail(path) {
      const result = await post('/__didrop/thumb', { path })
      if (result?.error) throw result.error
      return result
    },
    scan: (paths) => post('/__didrop/scan', paths),
    async import(items, onProgress) {
      onProgress({ done: 0, total: items.length, name: '' })
      const results = await post('/__didrop/import', items)
      onProgress({ done: items.length, total: items.length, name: '' })
      return results
    },
    thumbUrl: (path) => (path ? `/__didrop/file?path=${encodeURIComponent(path)}` : null),
    onDragDrop: async () => () => {},
  },
}

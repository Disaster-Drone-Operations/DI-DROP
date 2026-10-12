// Browser-Variante + echter Rust-Code über den Vite-Dev-Server (config/vite/dev_bridge.js).
// Nur zum Entwickeln und Testen: http://localhost:1420/?bridge

import browser from '/lib/platform/browser.js'

const post = async (url, data) => {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(data) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const info = await fetch('/__didrop/info').then((r) => r.json())

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

  media: {
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

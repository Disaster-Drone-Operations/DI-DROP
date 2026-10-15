// Browser variant: SQLite runs as WebAssembly (sql.js), the database content
// is saved to IndexedDB after every change. Same migrations and
// same SQL as in the desktop app.

import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

const IDB_NAME = 'di-drop'
const IDB_STORE = 'sqlite'
const IDB_KEY = 'main'

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const tx = req.result.transaction(IDB_STORE, mode)
      const r = fn(tx.objectStore(IDB_STORE))
      tx.oncomplete = () => resolve(r?.result)
      tx.onerror = () => reject(tx.error)
    }
  })
}

export default {
  name: 'browser',
  capabilities: { folders: false, media: false },

  async openDatabase() {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    const saved = await idb('readonly', (s) => s.get(IDB_KEY)).catch(() => null)
    const db = saved ? new SQL.Database(saved) : new SQL.Database()
    // Batched saving: only once for many consecutive writes (import)
    let timer = null
    const persist = () => {
      clearTimeout(timer)
      timer = setTimeout(() => idb('readwrite', (s) => s.put(db.export(), IDB_KEY)), 50)
    }
    addEventListener('pagehide', () => timer && idb('readwrite', (s) => s.put(db.export(), IDB_KEY)))

    return {
      async select(sql, params = []) {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        const rows = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      },
      async execute(sql, params = []) {
        // without parameters via exec → also several statements at once (migrations)
        if (params.length) db.run(sql, params)
        else db.exec(sql)
        const rowsAffected = db.getRowsModified()
        const lastInsertId = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0]
        persist()
        return { rowsAffected, lastInsertId }
      },
    }
  },

  async confirm(message) {
    return window.confirm(message)
  },

  async pickFolder() {
    return null
  },

  // Image import needs file system access → desktop app only
  async pickFiles() {
    return []
  },
  joinPath: async (...parts) => parts.join('/'),
  defaultMediaDir: async () => '',
  readImage: async () => { throw new Error('Nur in der Desktop-App') },
  writeImage: async () => { throw new Error('Nur in der Desktop-App') },
  renameFile: async () => { throw new Error('Nur in der Desktop-App') },
  renameDir: async () => { throw new Error('Nur in der Desktop-App') },
  nativeMenu: false,
  onMenu: async () => () => {},
  async toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  },
  openUrl: async (url) => window.open(url, '_blank', 'noopener'),
  flightlogs: null, // flight logs only in the desktop app
  sdcard: null, // memory card detection only in the desktop app
  updater: null, // updates only in the desktop app
  transfer: null, // provisioning (folder/Nextcloud) only in the desktop app
  nextcloud: null,
  places: null, // updating the place list only in the desktop app
  async reverseGeocode(lat, lon) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&zoom=18&addressdetails=1&accept-language=de`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Address service responded with status ${response.status}`)
    return response.json()
  },
  cloudflare: null, // setup only in the desktop app
  openPath: async () => {},
  revealPath: async () => {},
  media: null,
}

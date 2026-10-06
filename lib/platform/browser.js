// Browser-Variante: SQLite läuft als WebAssembly (sql.js), der Datenbankinhalt
// wird nach jeder Änderung in IndexedDB gesichert. Dieselben Migrations und
// dasselbe SQL wie in der Desktop-App.

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
  capabilities: { folders: false },

  async openDatabase() {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    const saved = await idb('readonly', (s) => s.get(IDB_KEY)).catch(() => null)
    const db = saved ? new SQL.Database(saved) : new SQL.Database()
    const persist = () => idb('readwrite', (s) => s.put(db.export(), IDB_KEY))

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
        db.run(sql, params)
        const rowsAffected = db.getRowsModified()
        const lastInsertId = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0]
        await persist()
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
}

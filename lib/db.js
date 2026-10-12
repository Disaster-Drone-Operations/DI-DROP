// Datenbankverbindung + Migrations im Rails-Stil.
// Migrations liegen als .sql-Dateien in db/migrate/ und werden in
// Dateinamen-Reihenfolge genau einmal ausgeführt (Tabelle schema_migrations).

import platform from '/lib/platform/index.js'

const migrations = import.meta.glob('/db/migrate/*.sql', { query: '?raw', import: 'default', eager: true })

let connection = null

export const db = {
  select: (sql, params) => connection.select(sql, params),
  execute: (sql, params) => connection.execute(sql, params),
}

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}

export async function connect() {
  connection = await platform.openDatabase()
  await migrate()
}

async function migrate() {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)')
  const done = new Set((await db.select('SELECT version FROM schema_migrations')).map((r) => r.version))

  for (const [file, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    const version = file.split('/').pop().split('_')[0]
    if (done.has(version)) continue
    console.info(`[db] Migration ${file}`)
    // Ganz oder gar nicht: alle Anweisungen + Versionseintrag in einer Transaktion,
    // als *ein* Aufruf (die Desktop-DB nutzt einen Verbindungspool – getrennte Aufrufe
    // könnten auf verschiedenen Verbindungen landen)
    const statements = splitStatements(sql)
    if (!/^\d+$/.test(version)) throw new Error(`Ungültiger Migrationsname: ${file}`)
    statements.push(`INSERT INTO schema_migrations (version) VALUES ('${version}')`)
    // Tabellen-Umbau (neu anlegen → kopieren → alte löschen → umbenennen) nach SQLite-Doku:
    // Fremdschlüssel-Prüfung währenddessen aus, danach Prüfung aller Verweise.
    // Kennzeichnung in der Migration: "-- migrate: foreign_keys=off"
    const rebuild = /--\s*migrate:\s*foreign_keys=off/.test(sql)
    const body = `BEGIN;\n${statements.join(';\n')};\nCOMMIT;`
    try {
      await db.execute(rebuild ? `PRAGMA foreign_keys = OFF;\n${body}\nPRAGMA foreign_keys = ON;` : body)
      if (rebuild) {
        const broken = await db.select('PRAGMA foreign_key_check')
        if (broken.length) console.warn('[db] Verweise nach Migration fehlerhaft:', broken)
      }
    } catch (error) {
      await db.execute('ROLLBACK').catch(() => {})
      await db.execute('PRAGMA foreign_keys = ON').catch(() => {})
      throw new Error(`Migration ${file} fehlgeschlagen: ${error?.message ?? error}`)
    }
  }
}

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
    for (const statement of splitStatements(sql)) await db.execute(statement)
    await db.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version])
  }
}

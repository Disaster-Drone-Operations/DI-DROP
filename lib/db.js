// Database connection + Rails-style migrations.
// Migrations live as .sql files in db/migrate/ and are run exactly once
// in file name order (table schema_migrations).

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
    // All or nothing: all statements + version entry in one transaction,
    // as *one* call (the desktop DB uses a connection pool – separate calls
    // could end up on different connections)
    const statements = splitStatements(sql)
    if (!/^\d+$/.test(version)) throw new Error(`Invalid migration name: ${file}`)
    statements.push(`INSERT INTO schema_migrations (version) VALUES ('${version}')`)
    // Table rebuild (create new → copy → drop old → rename) as per the SQLite docs:
    // foreign key checks off meanwhile, afterwards check all references.
    // Marker in the migration: "-- migrate: foreign_keys=off"
    const rebuild = /--\s*migrate:\s*foreign_keys=off/.test(sql)
    const body = `BEGIN;\n${statements.join(';\n')};\nCOMMIT;`
    try {
      await db.execute(rebuild ? `PRAGMA foreign_keys = OFF;\n${body}\nPRAGMA foreign_keys = ON;` : body)
      if (rebuild) {
        const broken = await db.select('PRAGMA foreign_key_check')
        if (broken.length) console.warn('[db] Broken references after migration:', broken)
      }
    } catch (error) {
      await db.execute('ROLLBACK').catch(() => {})
      await db.execute('PRAGMA foreign_keys = ON').catch(() => {})
      throw new Error(`Migration ${file} failed: ${error?.message ?? error}`)
    }
  }
}

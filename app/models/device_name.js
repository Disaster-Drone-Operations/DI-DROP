import { db } from '/lib/db.js'

// Eigene Namen für Seriennummern von Drohnen und Akkus ("Akku A" statt "87UPN2LCA00061")
export default class DeviceName {
  static KINDS = ['aircraft', 'battery']

  // → Map "kind:serial" → Name
  static async all() {
    const rows = await db.select('SELECT kind, serial, name FROM device_names')
    return new Map(rows.map((r) => [`${r.kind}:${r.serial}`, r.name]))
  }

  // Leerer Name = Benennung entfernen (dann wird wieder die Seriennummer gezeigt)
  static async set(kind, serial, name) {
    if (!DeviceName.KINDS.includes(kind) || !serial) throw new Error('Unbekanntes Gerät')
    const clean = String(name ?? '').trim().slice(0, 60)
    if (!clean || clean === serial) {
      await db.execute('DELETE FROM device_names WHERE kind = ? AND serial = ?', [kind, serial])
      return null
    }
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO device_names (kind, serial, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, serial) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      [kind, serial, clean, now, now],
    )
    return clean
  }
}

import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { parseLocal } from '/lib/time.js'

// Ein Flug – entsteht beim Import (ein Import nach der Landung = ein Flug).
// Start und Ende ergeben sich aus der ersten und letzten Aufnahme.
// Ein Flug kann mehrere Aufträge bedienen.
export default class Flight extends Record {
  static tableName = 'flights'

  static attributes = {
    mission_id: 'integer',
    number: 'integer',
    kind: 'string',
    flown_at: 'datetime',
    landed_at: 'datetime',
    task: 'text',
    notes: 'text',
    media_dir: 'string',
  }

  // Bilder innerhalb dieses Abstands zu einem bestehenden Flug gehören zu ihm
  static MERGE_MINUTES = 10

  static defaults() {
    return { kind: 'flug' }
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'flown_at')
    for (const attr of ['flown_at', 'landed_at']) {
      if (this[attr] && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(this[attr])) this.addError(attr, 'ist kein gültiger Zeitpunkt')
    }
  }

  async beforeSave() {
    if (this.number == null) {
      const [row] = await db.select('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM flights WHERE mission_id = ?', [this.mission_id])
      this.number = Number(row.next)
    }
  }

  get flownAt() {
    return parseLocal(this.flown_at)
  }

  get landedAt() {
    return parseLocal(this.landed_at)
  }

  // Aufträge, die in diesem Flug bedient wurden → [{ id, title, kind, shots }]
  static async assignmentsByFlight(missionId) {
    const rows = await db.select(
      `SELECT media_files.flight_id, assignments.id, assignments.title, assignments.kind, COUNT(DISTINCT media_files.shot_key) AS shots
         FROM media_files JOIN assignments ON assignments.id = media_files.assignment_id
        WHERE media_files.mission_id = ?
        GROUP BY media_files.flight_id, assignments.id ORDER BY MIN(media_files.taken_at)`, [missionId])
    const map = new Map()
    for (const r of rows) {
      const id = Number(r.flight_id)
      if (!map.has(id)) map.set(id, [])
      map.get(id).push({ id: Number(r.id), title: r.title, kind: r.kind, shots: Number(r.shots) })
    }
    return map
  }

  // Dateien auf der Festplatte bleiben erhalten – nur die Einträge verschwinden
  async destroy() {
    await db.execute('DELETE FROM media_files WHERE flight_id = ?', [this.id])
    await super.destroy()
  }
}

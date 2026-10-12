import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { toLocalDateTime } from '/lib/time.js'
import Assignment from '/app/models/assignment.js'

// Serie wiederkehrender Aufträge – derzeit Kontrollflüge. Erledigt man einen,
// plant die App auf Wunsch den nächsten ("Kontrollflug 4 um 14:25").
export default class AssignmentSeries extends Record {
  static tableName = 'assignment_series'

  static attributes = {
    mission_id: 'integer',
    kind: 'string',
    interval_minutes: 'integer',
    status: 'string',
  }

  static defaults() {
    return { kind: 'kontrolle', status: 'aktiv' }
  }

  static active(missionId) {
    return this.findBy('mission_id = ? AND status = ?', [missionId, 'aktiv'], { order: 'id DESC' })
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'kind')
  }

  // Nächsten Kontrollflug der Serie anlegen (dueAt: Date oder null = sofort).
  // Die Nummer zählt über den ganzen Einsatz weiter – auch wenn eine neue Serie beginnt.
  async plan({ dueAt = null, notes = null } = {}) {
    const [row] = await db.select(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM assignments WHERE mission_id = ? AND kind = 'kontrolle'", [this.mission_id])
    const sequence = Number(row.next)
    return Assignment.create({
      mission_id: this.mission_id,
      series_id: this.id,
      sequence,
      kind: 'kontrolle',
      title: `Kontrollflug ${sequence}`,
      due_at: dueAt ? toLocalDateTime(dueAt) : null,
      notes,
    })
  }

  // Serie starten (oder die laufende nehmen) und den ersten Kontrollflug planen
  static async start(missionId, { intervalMinutes, dueAt } = {}) {
    let series = await this.active(missionId)
    if (!series) series = await this.create({ mission_id: missionId, interval_minutes: intervalMinutes })
    else if (intervalMinutes) await series.update({ interval_minutes: intervalMinutes })
    return series.plan({ dueAt })
  }

  async finish() {
    return this.update({ status: 'beendet' })
  }
}

import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { toLocalDateTime } from '/lib/time.js'
import Assignment from '/app/models/assignment.js'

// Series of recurring assignments – currently control flights. When one is completed,
// the app optionally schedules the next one ("Kontrollflug 4 um 14:25").
export default class AssignmentSeries extends Record {
  static tableName = 'assignment_series'

  static attributes = {
    mission_id: 'integer',
    kind: 'string',
    interval_minutes: 'integer',
    status: 'string',
  }

  static defaults() {
    return { kind: 'control', status: 'active' }
  }

  static active(missionId) {
    return this.findBy('mission_id = ? AND status = ?', [missionId, 'active'], { order: 'id DESC' })
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'kind')
  }

  // Create the next control flight of the series (dueAt: Date or null = immediately).
  // The number keeps counting across the whole mission – even when a new series starts.
  async plan({ dueAt = null, notes = null } = {}) {
    const [row] = await db.select(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM assignments WHERE mission_id = ? AND kind = 'control'", [this.mission_id])
    const sequence = Number(row.next)
    return Assignment.create({
      mission_id: this.mission_id,
      series_id: this.id,
      sequence,
      kind: 'control',
      title: `Kontrollflug ${sequence}`,
      due_at: dueAt ? toLocalDateTime(dueAt) : null,
      notes,
    })
  }

  // Start a series (or take the running one) and schedule the first control flight
  static async start(missionId, { intervalMinutes, dueAt } = {}) {
    let series = await this.active(missionId)
    if (!series) series = await this.create({ mission_id: missionId, interval_minutes: intervalMinutes })
    else if (intervalMinutes) await series.update({ interval_minutes: intervalMinutes })
    return series.plan({ dueAt })
  }

  async finish() {
    return this.update({ status: 'ended' })
  }
}

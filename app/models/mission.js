import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { toDate, toTime, parseLocal, addMinutes } from '/lib/time.js'
import Setting from '/app/models/setting.js'
import Flight from '/app/models/flight.js'

export default class Mission extends Record {
  static tableName = 'missions'

  static attributes = {
    kind: 'string',
    title: 'string',
    reference: 'string',
    date: 'date',
    start_time: 'string',
    location: 'string',
    coordinates: 'string',
    requested_by: 'string',
    group_leader: 'string',
    pilot: 'string',
    observer: 'string',
    operator: 'string',
    control_interval_minutes: 'integer',
    status: 'string',
    notes: 'text',
  }

  static KINDS = { einsatz: 'Einsatz', uebung: 'Übung' }
  static STATUSES = { aktiv: 'Aktiv', abgeschlossen: 'Abgeschlossen' }

  // Die vier Rollen in der Drohnengruppe
  static ROLES = {
    group_leader: 'Gruppenführer',
    pilot: 'Pilot',
    observer: 'Luftraumbeobachter',
    operator: 'Drone Operator',
  }

  static defaults() {
    return {
      kind: Setting.get('general.default_mission_kind'),
      date: toDate(),
      start_time: toTime(),
      status: 'aktiv',
      operator: Setting.get('general.operator_name'),
      control_interval_minutes: Setting.get('flights.control_interval_minutes'),
    }
  }

  static FLIGHT_COUNT = '(SELECT COUNT(*) FROM flights WHERE flights.mission_id = missions.id) AS flights_count'

  static withFlightCounts(clause, params, options = {}) {
    return this.where(clause, params, { select: `missions.*, ${this.FLIGHT_COUNT}`, ...options })
  }

  static active() {
    return this.withFlightCounts('status = ?', ['aktiv'], { order: 'date DESC, start_time DESC' })
  }

  static archived() {
    return this.withFlightCounts('status = ?', ['abgeschlossen'], { order: 'date DESC, start_time DESC' })
  }

  validate() {
    this.validatesPresenceOf('title', 'date', 'location')
    this.validatesInclusionOf('kind', Object.keys(Mission.KINDS))
    this.validatesInclusionOf('status', Object.keys(Mission.STATUSES))
    if (this.date && !/^\d{4}-\d{2}-\d{2}$/.test(this.date)) this.addError('date', 'ist kein gültiges Datum')
    if (this.start_time && !/^\d{2}:\d{2}$/.test(this.start_time)) this.addError('start_time', 'ist keine gültige Uhrzeit')
    if (this.control_interval_minutes != null && this.control_interval_minutes < 1) {
      this.addError('control_interval_minutes', 'muss größer als 0 sein')
    }
    if (this.coordinates && !/^-?\d{1,2}(\.\d+)?\s*[,;]\s*-?\d{1,3}(\.\d+)?$/.test(this.coordinates)) {
      this.addError('coordinates', 'bitte als "Breite, Länge" angeben, z. B. 50.6789, 10.9876')
    }
  }

  get isActive() {
    return this.status === 'aktiv'
  }

  get kindLabel() {
    return Mission.KINDS[this.kind] ?? this.kind
  }

  get startsAt() {
    return parseLocal(this.start_time ? `${this.date}T${this.start_time}` : this.date)
  }

  flights() {
    return Flight.where('mission_id = ?', [this.id], { order: 'number ASC' })
  }

  // Wann ist der nächste Kontrollflug fällig? Basis ist der letzte Kontrollflug.
  // Ohne bisherigen Kontrollflug gibt es (noch) keinen Takt → null.
  nextControlFlightAt(flights) {
    if (!this.isActive || !this.control_interval_minutes) return null
    const last = flights.filter((f) => f.kind === 'kontrolle').at(-1)
    if (!last) return null
    return addMinutes(parseLocal(last.flown_at), this.control_interval_minutes)
  }

  async destroy() {
    await db.execute('DELETE FROM flights WHERE mission_id = ?', [this.id])
    await super.destroy()
  }
}

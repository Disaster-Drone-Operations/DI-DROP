import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { now as clockNow } from '/lib/clock.js'
import { toDate, toTime, parseLocal } from '/lib/time.js'
import { dateFolder, sanitizeFolderName } from '/lib/folders.js'
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
    control_interval_minutes: 'integer',
    status: 'string',
    notes: 'text',
    media_dir: 'string',
    nextcloud_path: 'string',
    closed_at: 'string', // UTC – set when closed, cleared when reopened
  }

  static KINDS = { operation: 'Einsatz', exercise: 'Übung' }
  static STATUSES = { active: 'Aktiv', closed: 'Abgeschlossen' }

  // The four roles in the drone unit – who fills them: MissionCrew (names: roleLabel in mission_helper.js;
  // the old text columns group_leader … operator are only kept for older backups)
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
      status: 'active',
      control_interval_minutes: Setting.get('flights.control_interval_minutes'),
    }
  }

  static FLIGHT_COUNT = '(SELECT COUNT(*) FROM flights WHERE flights.mission_id = missions.id) AS flights_count'

  static withFlightCounts(clause, params, options = {}) {
    return this.where(clause, params, { select: `missions.*, ${this.FLIGHT_COUNT}`, ...options })
  }

  static active() {
    return this.withFlightCounts('status = ?', ['active'], { order: 'date DESC, start_time DESC' })
  }

  static archived() {
    return this.withFlightCounts('status = ?', ['closed'], { order: 'date DESC, start_time DESC' })
  }

  validate() {
    this.validatesPresenceOf('title', 'date', 'location')
    // Nextcloud folder always as "/folder/subfolder"
    if (this.nextcloud_path) this.nextcloud_path = `/${this.nextcloud_path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}`.replace(/\/{2,}/g, '/')
    if (this.nextcloud_path === '/') this.nextcloud_path = null
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

  async beforeSave() {
    if (this.status === 'closed') this.closed_at ??= clockNow().toISOString()
    else this.closed_at = null
  }

  get isActive() {
    return this.status === 'active'
  }

  get kindLabel() {
    return Mission.KINDS[this.kind] ?? this.kind
  }

  get startsAt() {
    return parseLocal(this.start_time ? `${this.date}T${this.start_time}` : this.date)
  }

  // Folder name for the images: "2026_10_06__Waldbrand Hohe Warte"
  get folderName() {
    return `${dateFolder(this.date)}__${sanitizeFolderName(this.title)}`
  }

  flights() {
    return Flight.where('mission_id = ?', [this.id], { order: 'number ASC' })
  }

  async destroy() {
    // Image files on disk are kept; already provided files stay at their target – only the history goes.
    // Order: whatever references something comes first (foreign keys)
    for (const table of ['upload_items', 'upload_batches', 'comparisons', 'media_files', 'viewpoints', 'assignments',
      'assignment_series', 'flights', 'mission_crew']) {
      await db.execute(`DELETE FROM ${table} WHERE mission_id = ?`, [this.id])
    }
    // Flight logs stay – they only lose the assignment (and may be assigned automatically again)
    await db.execute('UPDATE flight_logs SET mission_id = NULL, mission_source = NULL WHERE mission_id = ?', [this.id])
    await super.destroy()
  }
}

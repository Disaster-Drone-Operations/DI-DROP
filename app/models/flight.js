import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { toLocalDateTime, parseLocal } from '/lib/time.js'

export default class Flight extends Record {
  static tableName = 'flights'

  static attributes = {
    mission_id: 'integer',
    number: 'integer',
    kind: 'string',
    flown_at: 'datetime',
    task: 'text',
    notes: 'text',
  }

  static KINDS = {
    initial: 'Initialflug',
    kontrolle: 'Kontrollflug',
    spezial: 'Spezialauftrag',
  }

  static DESCRIPTIONS = {
    initial: 'Erster Überblick, ad hoc ohne viel Vorplanung',
    kontrolle: 'Regelmäßiger Flug im festen Zeitfenster, gleiche Stellen auf Veränderung prüfen',
    spezial: 'Einzelauftrag außerhalb der Zeitplanung',
  }

  static defaults() {
    return { flown_at: toLocalDateTime() }
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'kind', 'flown_at')
    this.validatesInclusionOf('kind', Object.keys(Flight.KINDS))
    if (this.kind === 'spezial') this.validatesPresenceOf('task')
    if (this.flown_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(this.flown_at)) {
      this.addError('flown_at', 'ist kein gültiger Zeitpunkt')
    }
  }

  async beforeSave() {
    if (this.number == null) {
      const [row] = await db.select('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM flights WHERE mission_id = ?', [this.mission_id])
      this.number = Number(row.next)
    }
  }

  get kindLabel() {
    return Flight.KINDS[this.kind] ?? this.kind
  }

  get flownAt() {
    return parseLocal(this.flown_at)
  }
}

import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { now as clockNow } from '/lib/clock.js'
import { toDate } from '/lib/time.js'

// Kinds of qualifications the unit records (Settings → Einheit), e.g. „EU A2“
export class QualificationType extends Record {
  static tableName = 'qualification_types'
  static attributes = { name: 'string', position: 'integer' }

  static ordered() {
    return this.all({ order: 'position ASC, id ASC' })
  }

  validate() {
    this.validatesPresenceOf('name')
  }

  async save() {
    if (!this.isValid) return false
    const twin = await QualificationType.findBy('name = ? COLLATE NOCASE AND id <> ?', [this.name, this.id ?? 0])
    if (twin) {
      this.addError('name', 'gibt es schon')
      return false
    }
    return super.save()
  }

  // Together with the entries of the people
  async destroy() {
    await db.execute('DELETE FROM person_qualifications WHERE type_id = ?', [this.id])
    await super.destroy()
  }
}

// Who holds which qualification until when
//   await PersonQualification.byPerson()   // Map(personId → Map(typeId → valid_until | null))
//   await PersonQualification.replace(personId, { 3: { has: '1', valid_until: '2027-03-31' } })
export class PersonQualification {
  static async byPerson() {
    const map = new Map()
    for (const q of await db.select('SELECT person_id, type_id, valid_until FROM person_qualifications')) {
      if (!map.has(q.person_id)) map.set(q.person_id, new Map())
      map.get(q.person_id).set(q.type_id, q.valid_until ?? null)
    }
    return map
  }

  static async replace(personId, entries = {}) {
    const now = clockNow().toISOString()
    await db.execute('DELETE FROM person_qualifications WHERE person_id = ?', [personId])
    for (const [typeId, entry] of Object.entries(entries)) {
      if (entry?.has !== '1') continue
      const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(entry.valid_until ?? '') ? entry.valid_until : null
      await db.execute('INSERT INTO person_qualifications (person_id, type_id, valid_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [personId, Number(typeId), validUntil, now, now])
    }
  }
}

// State of a qualification: expired | soon (within SOON_DAYS) | valid
export const SOON_DAYS = 60
export function qualificationState(validUntil, today = toDate()) {
  if (!validUntil) return 'valid'
  if (validUntil < today) return 'expired'
  const soon = new Date(`${today}T00:00`)
  soon.setDate(soon.getDate() + SOON_DAYS)
  return validUntil <= toDate(soon) ? 'soon' : 'valid'
}

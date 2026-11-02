import Record from '/lib/record.js'
import { parseLocal } from '/lib/time.js'
import { db } from '/lib/db.js'

// Crew of a mission as a history: from from_at on, `role` is filled by `person_id` (null = nobody).
//
//   const crew = await MissionCrew.forMission(3)
//   MissionCrew.at(crew, 'pilot', new Date())   // → person_id or null
export default class MissionCrew extends Record {
  static tableName = 'mission_crew'

  static attributes = {
    mission_id: 'integer',
    role: 'string',
    person_id: 'integer',
    from_at: 'string', // local time "2026-06-20T14:05"
  }

  // Ids of the missions that have anyone in their crew
  static async missionsWithCrew() {
    return new Set((await db.select('SELECT DISTINCT mission_id FROM mission_crew WHERE person_id IS NOT NULL')).map((r) => Number(r.mission_id)))
  }

  static forMission(missionId) {
    return this.where('mission_id = ?', [missionId], { order: 'from_at ASC, id ASC' })
  }

  // Who had the role at that time (entries of one mission, sorted)
  static at(entries, role, date) {
    const t = date.getTime()
    let personId = null
    for (const e of entries) if (e.role === role && parseLocal(e.from_at).getTime() <= t) personId = e.person_id
    return personId
  }

  // Set the role from a point in time on; an entry at exactly that time is replaced → { entry, previous }
  static async change(missionId, role, personId, fromAt) {
    const existing = await this.findBy('mission_id = ? AND role = ? AND from_at = ?', [missionId, role, fromAt])
    if (existing) {
      const previous = existing.person_id
      await existing.update({ person_id: personId })
      return { entry: existing, previous, replaced: true }
    }
    return { entry: await this.create({ mission_id: missionId, role, person_id: personId, from_at: fromAt }), replaced: false }
  }
}

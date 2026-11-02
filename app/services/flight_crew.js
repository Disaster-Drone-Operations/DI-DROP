// Pilot and airspace observer of each flight (flight_logs.pilot_id / observer_id)
//
// Automatic (source NULL/'auto'): who had the role in the crew of the flight's mission at the flight's start
// time (MissionCrew – not the time of the import); flights without a mission: nobody.
// By hand: setCrew(ids, role, personId | null) – kept by the automatic assignment; resetCrew → automatic again

import { db } from '/lib/db.js'
import { now as clockNow } from '/lib/clock.js'
import MissionCrew from '/app/models/mission_crew.js'

export const FLIGHT_ROLES = ['pilot', 'observer']

const placeholders = (ids) => ids.map(() => '?').join(',')

// Bring all automatic entries up to date (after crew changes, new flights, other mission) → number of changes
export async function assignCrew() {
  const flights = await db.select('SELECT id, mission_id, started_at, pilot_id, pilot_source, observer_id, observer_source FROM flight_logs')
  if (!flights.length) return 0
  const crew = new Map()
  for (const e of await db.select('SELECT mission_id, role, person_id, from_at FROM mission_crew ORDER BY from_at, id')) {
    if (!crew.has(e.mission_id)) crew.set(e.mission_id, [])
    crew.get(e.mission_id).push(e)
  }
  let changed = 0
  for (const flight of flights) {
    for (const role of FLIGHT_ROLES) {
      if (flight[`${role}_source`] === 'manual') continue
      const personId = flight.mission_id ? MissionCrew.at(crew.get(flight.mission_id) ?? [], role, new Date(flight.started_at)) : null
      if ((personId ?? null) === (flight[`${role}_id`] ?? null)) continue
      await db.execute(`UPDATE flight_logs SET ${role}_id = ?, ${role}_source = ?, updated_at = ? WHERE id = ?`,
        [personId, personId ? 'auto' : null, clockNow().toISOString(), flight.id])
      changed++
    }
  }
  return changed
}

// By hand (personId null = nobody)
export async function setCrew(ids, role, personId) {
  if (!ids.length || !FLIGHT_ROLES.includes(role)) return
  await db.execute(`UPDATE flight_logs SET ${role}_id = ?, ${role}_source = 'manual', updated_at = ? WHERE id IN (${placeholders(ids)})`,
    [personId, clockNow().toISOString(), ...ids])
}

// Back to the automatic assignment
export async function resetCrew(ids, role) {
  if (!ids.length || !FLIGHT_ROLES.includes(role)) return
  await db.execute(`UPDATE flight_logs SET ${role}_id = NULL, ${role}_source = NULL WHERE id IN (${placeholders(ids)})`, ids)
  await assignCrew()
}

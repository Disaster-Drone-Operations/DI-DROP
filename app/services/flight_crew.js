// Roles derived from the crew of a mission (MissionCrew) – stored, so statistics can simply count them
//
// Flights (flight_logs.pilot_id / observer_id): who had the role at the flight's start time (not the time of the
//   import); flights without a mission: nobody. By hand: setCrew(ids, role, personId | null); resetCrew → automatic
// Assignments (assignments.operator_id): who was Drone Operator when its first images were imported – without
//   images: when it was done (open without images: not decided yet). By hand: setOperator(id, personId | null)
// Automatic = source NULL/'auto'; 'manual' entries are kept.

import { db } from '/lib/db.js'
import { now as clockNow } from '/lib/clock.js'
import MissionCrew from '/app/models/mission_crew.js'

export const FLIGHT_ROLES = ['pilot', 'observer']

const placeholders = (ids) => ids.map(() => '?').join(',')

// mission id → its crew entries (sorted)
async function crewByMission() {
  const crew = new Map()
  for (const e of await db.select('SELECT mission_id, role, person_id, from_at FROM mission_crew ORDER BY from_at, id')) {
    if (!crew.has(e.mission_id)) crew.set(e.mission_id, [])
    crew.get(e.mission_id).push(e)
  }
  return crew
}

// Flights: bring all automatic entries up to date (after crew changes, new flights, other mission) → number of changes
export async function assignCrew() {
  const flights = await db.select('SELECT id, mission_id, started_at, pilot_id, pilot_source, observer_id, observer_source FROM flight_logs')
  if (!flights.length) return 0
  const crew = await crewByMission()
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

// When the Drone Operator of an assignment is decided: at the first image import – never after it was done
// (backfilled missions: images imported long after the mission ended). Without images: when done.
export function operatorMoment({ first_import: imported, completed_at: done }) {
  if (imported && done) return Date.parse(imported) < Date.parse(done) ? imported : done
  return imported ?? done ?? null
}

// Drone Operator of the assignments (of one mission, or of all) → number of changes
export async function assignOperators(missionId = null) {
  const assignments = await db.select(
    `SELECT a.id, a.mission_id, a.completed_at, a.operator_id, a.operator_source,
            (SELECT MIN(f.created_at) FROM media_files f WHERE f.assignment_id = a.id) AS first_import
       FROM assignments a WHERE ${missionId ? 'a.mission_id = ?' : '1 = 1'}`,
    missionId ? [missionId] : [],
  )
  const crew = await crewByMission()
  let changed = 0
  for (const a of assignments) {
    if (a.operator_source === 'manual') continue
    const at = operatorMoment(a)
    const personId = at ? MissionCrew.at(crew.get(a.mission_id) ?? [], 'operator', new Date(at)) : null
    if ((personId ?? null) === (a.operator_id ?? null)) continue
    await db.execute('UPDATE assignments SET operator_id = ?, operator_source = ? WHERE id = ?', [personId, personId ? 'auto' : null, a.id])
    changed++
  }
  return changed
}

// By hand – „auto“ goes back to the automatic one
export async function setOperator(id, choice) {
  if (choice === 'auto') {
    await db.execute('UPDATE assignments SET operator_id = NULL, operator_source = NULL WHERE id = ?', [id])
    return assignOperators()
  }
  await db.execute("UPDATE assignments SET operator_id = ?, operator_source = 'manual' WHERE id = ?", [choice, id])
}


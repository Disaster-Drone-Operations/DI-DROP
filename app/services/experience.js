// Experience of the people of the unit (page „Einheit“) – in a period and in total, split by
// Einsatz / Übung / ohne Einsatz:
//   pilot, observer   flights and flight time (flight_logs.pilot_id / observer_id)
//   operator          assignments (and their missions) – at the time of their first import, otherwise when done
//   group_leader      missions and hours: the periods of the crew (from a change to the next one or the mission's end)
//
//   const { people } = await experience('3m')   // Map(personId → { pilot: { period, total }, … })
//   people.get(3).pilot.period → { count, seconds, missions, byKind: { operation: { count, seconds }, … } }

import { db } from '/lib/db.js'
import { parseLocal } from '/lib/time.js'
import { now as clockNow } from '/lib/clock.js'
import { assignFlights } from '/app/services/flight_missions.js'
import { assignOperators, operatorMoment } from '/app/services/flight_crew.js'
import Setting from '/app/models/setting.js'

export const PERIODS = {
  '30d': { label: '30 Tage', days: 30 },
  '3m': { label: '3 Monate', months: 3 },
  '12m': { label: '12 Monate', months: 12 },
  all: { label: 'Gesamt' },
}
export const DEFAULT_PERIOD = '3m'

export const ROLE_KEYS = ['pilot', 'observer', 'operator', 'group_leader']
export const KINDS = { operation: 'Einsatz', exercise: 'Übung', none: 'ohne Einsatz' }

// Start of the period (null = everything)
export function periodStart(key, now = clockNow()) {
  const p = PERIODS[key]
  if (!p?.days && !p?.months) return null
  const d = new Date(now)
  if (p.days) d.setDate(d.getDate() - p.days)
  else d.setMonth(d.getMonth() - p.months)
  return d
}

const LAST_ACTIVITY_SLACK_MS = 30 * 60_000 // closed earlier without closed_at: last activity + 30 min

const emptyStat = () => ({ count: 0, seconds: 0, missions: new Set(), byKind: {} })

function add(stat, kind, { count = 1, seconds = 0, missionId = null } = {}) {
  stat.count += count
  stat.seconds += seconds
  if (missionId) stat.missions.add(missionId)
  const k = (stat.byKind[kind] ??= { count: 0, seconds: 0 })
  k.count += count
  k.seconds += seconds
}

export async function experience(periodKey = DEFAULT_PERIOD) {
  await assignFlights() // missions + pilot/observer of the flights up to date
  await assignOperators()
  const now = clockNow()
  const from = periodStart(periodKey, now)
  const people = new Map()
  const statsOf = (personId, role) => {
    if (!people.has(personId)) people.set(personId, Object.fromEntries(ROLE_KEYS.map((r) => [r, { period: emptyStat(), total: emptyStat() }])))
    return people.get(personId)[role]
  }
  // counts in the total, and in the period if the moment lies in it
  const count = (personId, role, kind, at, values) => {
    const s = statsOf(personId, role)
    add(s.total, kind, values)
    if (!from || at >= from) add(s.period, kind, values)
  }

  const missions = new Map((await db.select('SELECT id, kind, status, date, start_time, closed_at FROM missions')).map((m) => [m.id, m]))
  const kindOf = (missionId) => missions.get(missionId)?.kind ?? 'none'

  // Flights: pilot and airspace observer
  for (const f of await db.select('SELECT started_at, duration_s, mission_id, pilot_id, observer_id FROM flight_logs WHERE pilot_id IS NOT NULL OR observer_id IS NOT NULL')) {
    const at = new Date(f.started_at)
    const values = { seconds: f.duration_s ?? 0, missionId: f.mission_id }
    if (f.pilot_id) count(f.pilot_id, 'pilot', kindOf(f.mission_id), at, values)
    if (f.observer_id) count(f.observer_id, 'observer', kindOf(f.mission_id), at, values)
  }

  // Assignments: Drone Operator (moment: first import – at the latest done –, otherwise created)
  const assignments = await db.select(
    `SELECT a.mission_id, a.operator_id, a.completed_at, a.created_at,
            (SELECT MIN(f.created_at) FROM media_files f WHERE f.assignment_id = a.id) AS first_import
       FROM assignments a WHERE a.operator_id IS NOT NULL`,
  )
  for (const a of assignments) {
    count(a.operator_id, 'operator', kindOf(a.mission_id), new Date(operatorMoment(a) ?? a.created_at), { missionId: a.mission_id })
  }

  // Group leader: periods from the crew history
  const ends = await missionEnds(missions, now)
  const crew = await db.select("SELECT mission_id, person_id, from_at FROM mission_crew WHERE role = 'group_leader' ORDER BY mission_id, from_at, id")
  for (const [i, e] of crew.entries()) {
    if (!e.person_id || !missions.has(e.mission_id)) continue
    const next = crew[i + 1]?.mission_id === e.mission_id ? parseLocal(crew[i + 1].from_at) : null
    const start = parseLocal(e.from_at)
    const end = new Date(Math.min(next?.getTime() ?? Infinity, ends.get(e.mission_id) ?? now.getTime()))
    if (end <= start) continue
    const kind = kindOf(e.mission_id)
    const s = statsOf(e.person_id, 'group_leader')
    add(s.total, kind, { count: 0, seconds: (end - start) / 1000, missionId: e.mission_id })
    const periodFrom = from ? new Date(Math.max(start, from)) : start
    if (end > periodFrom) add(s.period, kind, { count: 0, seconds: (end - periodFrom) / 1000, missionId: e.mission_id })
  }
  // group leader: „count“ = number of missions
  for (const p of people.values()) for (const s of [p.group_leader.period, p.group_leader.total]) s.count = s.missions.size

  return { period: periodKey, from, people, practice: await pilotPractice(now) }
}

// Flight practice as pilot in the last N days (Settings → Einheit) → { days, minFlights, minMinutes,
//   people: Map(personId → { count, seconds }) } – who flew before and is below the minimum gets a hint
async function pilotPractice(now) {
  const days = Number(Setting.get('unit.recency_days')) || 90
  const since = new Date(now)
  since.setDate(since.getDate() - days)
  const people = new Map()
  for (const f of await db.select('SELECT pilot_id, started_at, duration_s FROM flight_logs WHERE pilot_id IS NOT NULL')) {
    const at = new Date(f.started_at)
    if (at < since || at > now) continue
    const p = people.get(f.pilot_id) ?? { count: 0, seconds: 0 }
    p.count++
    p.seconds += f.duration_s ?? 0
    people.set(f.pilot_id, p)
  }
  return { days, minFlights: Number(Setting.get('unit.min_flights')) || 0, minMinutes: Number(Setting.get('unit.min_minutes')) || 0, people }
}

// End of every mission (ms): closed → closed_at (older ones: last activity), active → now
async function missionEnds(missions, now) {
  const last = new Map((await db.select(
    `SELECT mission_id, MAX(at) AS at FROM (
       SELECT mission_id, taken_at AS at FROM media_files UNION ALL
       SELECT mission_id, completed_at FROM assignments)
     WHERE at IS NOT NULL GROUP BY mission_id`,
  )).map((r) => [r.mission_id, r.at]))
  const ends = new Map()
  for (const m of missions.values()) {
    if (m.status !== 'closed') ends.set(m.id, now.getTime())
    else if (m.closed_at) ends.set(m.id, Date.parse(m.closed_at))
    else if (last.get(m.id)) ends.set(m.id, parseLocal(last.get(m.id)).getTime() + LAST_ACTIVITY_SLACK_MS)
    else ends.set(m.id, parseLocal(`${m.date}T${m.start_time || '00:00'}`).getTime()) // nothing happened: no hours
  }
  return ends
}

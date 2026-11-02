import { parseLocal, toDate, toLocalDateTime } from '/lib/time.js'
import { now as clockNow } from '/lib/clock.js'
import { formatDate, formatTime } from '/app/helpers/application_helper.js'

// Crew of a mission (missions/_crew.ejs, mission_crew.js)

// The entry that applies to the role at that time (entries sorted by from_at) – or null
export function crewEntryAt(crew, role, date) {
  let entry = null
  for (const e of crew) if (e.role === role && parseLocal(e.from_at) <= date) entry = e
  return entry
}

// What the box shows: the crew now – for a closed mission the last one
export const crewMoment = (mission) => (mission.isActive ? clockNow() : new Date(8.64e15))

// "14:05 Uhr" on the day of the mission, otherwise with the date
export function crewTime(fromAt, mission) {
  const d = parseLocal(fromAt)
  return toDate(d) === mission.date ? `${formatTime(d)} Uhr` : `${formatDate(d, { weekday: false })}, ${formatTime(d)} Uhr`
}

export const localNow = () => toLocalDateTime()
export const parseLocalTime = (value) => parseLocal(value)

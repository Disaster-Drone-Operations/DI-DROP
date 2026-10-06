import Mission from '/app/models/mission.js'
import Flight from '/app/models/flight.js'
import { escapeHtml, icon } from '/app/helpers/application_helper.js'

export const missionKindOptions = () => Object.entries(Mission.KINDS)
export const missionRoles = () => Object.entries(Mission.ROLES)
export const flightKindOptions = () => Object.entries(Flight.KINDS)
export const flightKindDescription = (kind) => Flight.DESCRIPTIONS[kind] ?? ''

export const intervalOptions = (current) => {
  const options = [15, 20, 30, 45, 60, 90, 120].map((m) => [String(m), m < 120 ? `alle ${m} Min.` : 'alle 2 Std.'])
  if (current && !options.some(([v]) => v === String(current))) options.push([String(current), `alle ${current} Min.`])
  return [['', 'kein festes Intervall'], ...options]
}

export function kindBadge(mission) {
  return `<span class="badge badge--${escapeHtml(mission.kind)}">${escapeHtml(mission.kindLabel)}</span>`
}

export function flightKindBadge(flight) {
  return `<span class="badge badge--flight-${escapeHtml(flight.kind)}">${icon(flight.kind, { size: 12 })}${escapeHtml(flight.kindLabel)}</span>`
}

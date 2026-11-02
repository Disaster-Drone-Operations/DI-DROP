import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import Setting from '/app/models/setting.js'
import { escapeHtml, icon } from '/app/helpers/application_helper.js'
import { addMinutes } from '/lib/time.js'

export const missionKindOptions = () => Object.entries(Mission.KINDS)
// Role names as the unit calls them (Settings → Allgemein)
export const roleLabel = (role) => Setting.get(`general.role_${role}`) || Mission.ROLES[role]
export const missionRoles = () => Object.keys(Mission.ROLES).map((role) => [role, roleLabel(role)])
export const roleList = () => {
  const names = missionRoles().map(([, label]) => label)
  return `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`
}

export const intervalOptions = (current) => {
  const options = [15, 20, 30, 45, 60, 90, 120].map((m) => [String(m), m < 120 ? `alle ${m} Min.` : 'alle 2 Std.'])
  if (current && !options.some(([v]) => v === String(current))) options.push([String(current), `alle ${current} Min.`])
  return [['', 'kein festes Intervall'], ...options]
}

// What's still to be added to a closed mission (e.g. backfilled from old images) – from the unit's records.
// hasCrew: anyone in the crew; Einsatznummer and "angefordert von" only for real operations
export function missingDetails(mission, hasCrew) {
  if (mission.isActive) return []
  const missing = hasCrew ? [] : ['Besetzung']
  if (mission.kind === 'operation') {
    if (!mission.reference) missing.push('Einsatznummer')
    if (!mission.requested_by) missing.push('angefordert von')
  }
  return missing
}

export function kindBadge(mission) {
  return `<span class="badge badge--${escapeHtml(mission.kind)}">${escapeHtml(mission.kindLabel)}</span>`
}

// ── Assignments ─────────────────────────────────────────────────────────────

const ASSIGNMENT_ICONS = { initial: 'initial', control: 'control', special: 'special', other: 'clock', mapping: 'images', position: 'pin', area: 'pin' }

export const assignmentKind = (kind) => ({ key: kind, label: Assignment.KINDS[kind], description: Assignment.DESCRIPTIONS[kind] })
export const assignmentKindOptions = () => Object.entries(Assignment.KINDS)
export const commonAssignmentKinds = () => Assignment.COMMON_KINDS.map(assignmentKind)
export const moreAssignmentKinds = () => Assignment.MORE_KINDS.map(assignmentKind)
export const namedAssignmentKinds = () => Assignment.NAMED_KINDS

// Badge with the assignment's kind. If the assignment is named like its kind
// ("Lageerkundung"), the icon suffices – otherwise it would appear twice.
export function assignmentBadge(assignment) {
  const kind = assignment.kind
  const label = Assignment.KINDS[kind] ?? kind
  const text = assignment.title === label || assignment.title?.startsWith(`${label} `) ? '' : escapeHtml(label)
  return `<span class="badge badge--task-${escapeHtml(kind)}" title="${escapeHtml(label)}">${icon(ASSIGNMENT_ICONS[kind] ?? 'missions', { size: 12 })}${text}</span>`
}

export const addMinutesTo = (date, minutes) => addMinutes(date, minutes)

// Name of a viewpoint – renamable by double-click (wherever it is shown)
export function viewpointNameTag(id, name, cls = '') {
  if (!id) return escapeHtml(name)
  return `<span class="renamable ${escapeHtml(cls)}" data-controller="viewpoint-name" data-viewpoint-name-id-value="${escapeHtml(id)}" title="Doppelklick zum Umbenennen">${escapeHtml(name)}</span>`
}

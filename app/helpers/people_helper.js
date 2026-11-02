import { formatFlightDuration } from '/app/helpers/flight_log_helper.js'
import { pluralize } from '/app/helpers/application_helper.js'
import { KINDS, PERIODS } from '/app/services/experience.js'

export const experiencePeriods = () => PERIODS

// Experience of a person in one role (people/index.ejs, app/services/experience.js)
//   → { main, sub, title } – main is empty without any experience
export function experienceText(role, stat) {
  if (!stat?.count && !stat?.seconds) return { main: '', sub: '', title: '' }
  const flights = role === 'pilot' || role === 'observer'
  const main = flights ? formatFlightDuration(stat.seconds)
    : role === 'operator' ? pluralize(stat.count, 'Auftrag', 'Aufträge')
      : pluralize(stat.count, 'Einsatz', 'Einsätze')
  const sub = flights ? pluralize(stat.count, 'Flug', 'Flüge')
    : role === 'operator' ? pluralize(stat.missions.size, 'Einsatz', 'Einsätze')
      : formatFlightDuration(stat.seconds)
  const title = Object.entries(KINDS)
    .filter(([kind]) => stat.byKind[kind])
    .map(([kind, label]) => `${label}: ${flights ? `${formatFlightDuration(stat.byKind[kind].seconds)} (${pluralize(stat.byKind[kind].count, 'Flug', 'Flüge')})`
      : role === 'operator' ? pluralize(stat.byKind[kind].count, 'Auftrag', 'Aufträge') : formatFlightDuration(stat.byKind[kind].seconds)}`)
    .join(' · ')
  return { main, sub, title }
}

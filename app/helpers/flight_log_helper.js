// Display of flight data: duration, distance, time of day (computer's local time)

// Hours and minutes, rounded up to full minutes (seconds say nothing here):
// 754 s → "13 min", 3900 s → "1 h 5 min", 55 920 s → "15 h 32 min", 7200 s → "2 h"
export function formatFlightDuration(seconds) {
  if (seconds == null) return ''
  const minutes = Math.ceil(Math.max(0, seconds) / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

// 830 → "830 m", 1832 → "1,83 km", 12345 → "12,3 km"
export function formatDistance(meters) {
  if (meters == null) return ''
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  return `${km.toFixed(km < 10 ? 2 : 1).replace('.', ',')} km`
}

export const localTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '')
export const localDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '')
export const localMonth = (iso) => new Date(iso).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
export const localDay = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')

// 7.46 → "7,5 h", 0.4 → "24 min"
export function formatHours(hours) {
  if (hours == null) return ''
  if (hours < 1) return `${Math.round(hours * 60)} min`
  return `${hours.toFixed(1).replace('.', ',')} h`
}

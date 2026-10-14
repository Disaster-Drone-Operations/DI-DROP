// Anzeige von Flugdaten: Dauer, Strecke, Uhrzeit (lokale Zeit des Rechners)

// 754 s → "12:34 min", 3900 s → "1:05 h"
export function formatFlightDuration(seconds) {
  if (seconds == null) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m}:${String(s).padStart(2, '0')} min`
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

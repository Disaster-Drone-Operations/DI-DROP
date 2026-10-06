// Datum/Uhrzeit-Hilfen. Gespeichert wird bewusst in *lokaler* Zeit ohne
// Zeitzone ("2026-10-05T14:30"), so wie sie im Einsatz abgelesen wird.

const pad = (n) => String(n).padStart(2, '0')

export const toDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const toTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
export const toLocalDateTime = (d = new Date()) => `${toDate(d)}T${toTime(d)}`

// "2026-10-05T14:30" → Date in lokaler Zeit
export const parseLocal = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00` : s) : null)

export const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000)

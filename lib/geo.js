// Small geo helpers for distances and directions (accuracy fully sufficient for a few 100 m)

const R = 6_371_000
const rad = (d) => (d * Math.PI) / 180

// Distance in meters
export function distance(lat1, lon1, lat2, lon2) {
  const x = rad(lon2 - lon1) * Math.cos(rad((lat1 + lat2) / 2))
  const y = rad(lat2 - lat1)
  return Math.sqrt(x * x + y * y) * R
}

// Direction from point 1 to point 2, 0° = north, clockwise
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

// Smallest angle between two directions (0…180)
export function angleDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

export const normalizeDeg = (d) => ((d % 360) + 360) % 360

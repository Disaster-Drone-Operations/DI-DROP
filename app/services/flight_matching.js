// Which flight (flight log) was an image taken in? Pure functions – also used without a database
// (backfilling older missions, app/services/history_grouping.js).

export const SLACK_MS = 2 * 60_000

// Serial numbers: the flight log stores 16 characters, the image (XMP DroneSerialNumber) all of them
export const sameSerial = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a))

// Flight an image was taken in: start − 2 min … landing + 2 min. Several candidates (two drones in the
// air) → the one with the image's drone serial number, otherwise the one whose start is closest.
//   at: time of the image in ms, serial: DroneSerialNumber or null
//   logs: [{ id, started_at, landed_at, aircraft_sn }]  → id or null
export function flightLogFor({ at, serial = null }, logs) {
  if (at == null || Number.isNaN(at)) return null
  const hits = logs.filter((l) => {
    const start = Date.parse(l.started_at)
    return at >= start - SLACK_MS && at <= Date.parse(l.landed_at ?? l.started_at) + SLACK_MS
  })
  if (hits.length <= 1) return hits[0]?.id ?? null
  const bySerial = hits.filter((l) => sameSerial(serial, l.aircraft_sn))
  const pool = bySerial.length ? bySerial : hits
  return pool.sort((a, b) => Math.abs(at - Date.parse(a.started_at)) - Math.abs(at - Date.parse(b.started_at)))[0].id
}

// For many images: only the flights that may contain a point in time (sorted by start, binary search)
//   const near = flightIndex(logs); flightLogFor({ at, serial }, near(at))
export function flightIndex(logs) {
  const sorted = logs.map((l) => ({ ...l, from: Date.parse(l.started_at) })).filter((l) => !Number.isNaN(l.from))
    .sort((a, b) => a.from - b.from)
  const longest = Math.max(0, ...sorted.map((l) => Date.parse(l.landed_at ?? l.started_at) - l.from))
  return (at) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) { // first flight starting after at + slack
      const mid = (lo + hi) >> 1
      if (sorted[mid].from <= at + SLACK_MS) lo = mid + 1
      else hi = mid
    }
    const near = []
    for (let i = lo - 1; i >= 0 && sorted[i].from >= at - longest - SLACK_MS; i--) near.push(sorted[i])
    return near
  }
}

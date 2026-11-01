// Which flight (flight log of the remote controller) belongs to which mission?
//
// Automatic (only flights not assigned by hand, flight_logs.mission_source NULL/auto):
//   1. Images: the mission whose images were taken during the flight (start … landing, ± 2 min) – most images win
//   2. Otherwise time: the flight lies in the time window of exactly one mission
//      (alarm … last image + 3 h, without images: alarm + 12 h)
// By hand: assign(ids, missionId | null) – also "Kein Einsatz"; reset(ids) → automatic again

import { db } from '/lib/db.js'
import { parseLocal } from '/lib/time.js'
import { now as clockNow } from '/lib/clock.js'

const SLACK_MS = 2 * 60_000
const AFTER_LAST_IMAGE_MS = 3 * 3600_000
const WITHOUT_IMAGES_MS = 12 * 3600_000

const missionStart = (m) => parseLocal(`${m.date}T${m.start_time || '00:00'}`)?.getTime() ?? null

// Time windows of all missions: [{ id, from, to }]
async function missionWindows() {
  const missions = await db.select(
    `SELECT m.id, m.date, m.start_time, MAX(f.taken_at) AS last_image
       FROM missions m LEFT JOIN media_files f ON f.mission_id = m.id GROUP BY m.id`,
  )
  return missions.map((m) => {
    const from = missionStart(m)
    const last = parseLocal(m.last_image)?.getTime()
    return { id: m.id, from, to: last ? Math.max(last + AFTER_LAST_IMAGE_MS, from ?? 0) : from + WITHOUT_IMAGES_MS }
  }).filter((w) => w.from != null)
}

// Mission for one flight: { missionId, reason } or null
function decide(flight, images, windows) {
  const start = Date.parse(flight.started_at) - SLACK_MS
  const end = Date.parse(flight.landed_at ?? flight.started_at) + SLACK_MS
  const counts = new Map()
  for (const image of images) {
    if (image.at >= start && image.at <= end) counts.set(image.missionId, (counts.get(image.missionId) ?? 0) + 1)
  }
  if (counts.size) {
    const [missionId] = [...counts].sort((a, b) => b[1] - a[1])[0]
    return missionId
  }
  const candidates = windows.filter((w) => Date.parse(flight.started_at) >= w.from && Date.parse(flight.started_at) <= w.to)
  return candidates.length === 1 ? candidates[0].id : null
}

// Assign all flights that weren't assigned by hand; returns the number of changed flights
export async function assignFlights() {
  const flights = await db.select(
    `SELECT id, started_at, landed_at, mission_id FROM flight_logs WHERE mission_source IS NULL OR mission_source = 'auto'`,
  )
  if (!flights.length) return 0
  const images = (await db.select('SELECT mission_id, taken_at FROM media_files WHERE taken_at IS NOT NULL'))
    .map((r) => ({ missionId: r.mission_id, at: parseLocal(r.taken_at)?.getTime() }))
    .filter((i) => i.at)
  const windows = await missionWindows()
  let changed = 0
  for (const flight of flights) {
    const missionId = decide(flight, images, windows)
    if ((missionId ?? null) === (flight.mission_id ?? null)) continue
    await db.execute('UPDATE flight_logs SET mission_id = ?, mission_source = ?, updated_at = ? WHERE id = ?',
      [missionId, missionId ? 'auto' : null, clockNow().toISOString(), flight.id])
    changed++
  }
  return changed
}

// By hand: these flights belong to the mission (or to none: missionId null) – kept by the automatic assignment
export async function assign(ids, missionId) {
  if (!ids.length) return
  await db.execute(`UPDATE flight_logs SET mission_id = ?, mission_source = 'manual', updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    [missionId, clockNow().toISOString(), ...ids])
}

// Back to the automatic assignment
export async function reset(ids) {
  if (!ids.length) return
  await db.execute(`UPDATE flight_logs SET mission_source = NULL, mission_id = NULL WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
  await assignFlights()
}

// Suggestions for the selected flights: missions whose time window contains one of them, best first
export async function suggestedMissions(ids) {
  if (!ids.length) return []
  const flights = await db.select(`SELECT started_at FROM flight_logs WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
  const windows = await missionWindows()
  const hits = new Map()
  for (const f of flights) {
    const t = Date.parse(f.started_at)
    for (const w of windows) if (t >= w.from - 6 * 3600_000 && t <= w.to) hits.set(w.id, (hits.get(w.id) ?? 0) + 1)
  }
  return [...hits].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

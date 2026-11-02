// Which flight (flight log of the remote controller) belongs to which mission?
//
// Automatic (only flights not assigned by hand, flight_logs.mission_source NULL/auto):
//   1. Images: the mission whose images were taken during the flight (start … landing, ± 2 min) – most images win
//   2. Otherwise time: the flight lies in the time window of exactly one mission
//      (alarm … last image + 3 h, without images: alarm + 12 h)
// By hand: assign(ids, missionId | null) – also "Kein Einsatz"; reset(ids) → automatic again
//
// Images ↔ flights: media_files.flight_log_id – the flight an image was taken in (linkMedia; rules: flight_matching.js)

import { db } from '/lib/db.js'
import { parseLocal } from '/lib/time.js'
import { now as clockNow } from '/lib/clock.js'
import { assignCrew } from '/app/services/flight_crew.js'
import { SLACK_MS, flightLogFor, flightIndex } from '/app/services/flight_matching.js'

const AFTER_LAST_IMAGE_MS = 3 * 3600_000
const WITHOUT_IMAGES_MS = 12 * 3600_000

const missionStart = (m) => parseLocal(`${m.date}T${m.start_time || '00:00'}`)?.getTime() ?? null

// Time windows of all missions: [{ id, from, to }]
export async function missionWindows() {
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

// Mission for one flight: the mission with most images taken in it (linkMedia), otherwise
// the one mission whose time window contains its start – or null
function decide(flight, imagesByFlight, windows) {
  const counts = imagesByFlight.get(flight.id)
  if (counts?.length) return [...counts].sort((a, b) => b.count - a.count)[0].missionId
  const candidates = windows.filter((w) => Date.parse(flight.started_at) >= w.from && Date.parse(flight.started_at) <= w.to)
  return candidates.length === 1 ? candidates[0].id : null
}

// Link all images to their flight (media_files.flight_log_id); returns the number of changed images
export async function linkMedia() {
  const near = flightIndex(await db.select('SELECT id, started_at, landed_at, aircraft_sn FROM flight_logs WHERE started_at IS NOT NULL'))
  const images = await db.select(
    `SELECT id, taken_at, flight_log_id, json_extract(metadata, '$.DroneSerialNumber') AS serial FROM media_files`,
  )
  const changes = new Map() // flight log id (or null) → image ids
  for (const image of images) {
    const at = parseLocal(image.taken_at)?.getTime()
    const id = at ? flightLogFor({ at, serial: image.serial }, near(at)) : null
    if (id === (image.flight_log_id ?? null)) continue
    if (!changes.has(id)) changes.set(id, [])
    changes.get(id).push(image.id)
  }
  let changed = 0
  for (const [logId, ids] of changes) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      await db.execute(`UPDATE media_files SET flight_log_id = ? WHERE id IN (${chunk.map(() => '?').join(',')})`, [logId, ...chunk])
    }
    changed += ids.length
  }
  return changed
}

// Assign all flights that weren't assigned by hand; returns the number of changed flights.
// Pilot and airspace observer follow (their mission's crew at the start time).
export async function assignFlights() {
  await linkMedia()
  const changed = await assignMissions()
  await assignCrew()
  return changed
}

async function assignMissions() {
  const flights = await db.select(
    `SELECT id, started_at, landed_at, mission_id FROM flight_logs WHERE mission_source IS NULL OR mission_source = 'auto'`,
  )
  if (!flights.length) return 0
  const imagesByFlight = new Map()
  const rows = await db.select(
    'SELECT flight_log_id, mission_id, COUNT(*) AS count FROM media_files WHERE flight_log_id IS NOT NULL GROUP BY flight_log_id, mission_id',
  )
  for (const r of rows) {
    if (!imagesByFlight.has(r.flight_log_id)) imagesByFlight.set(r.flight_log_id, [])
    imagesByFlight.get(r.flight_log_id).push({ missionId: r.mission_id, count: Number(r.count) })
  }
  const windows = await missionWindows()
  let changed = 0
  for (const flight of flights) {
    const missionId = decide(flight, imagesByFlight, windows)
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
  await assignCrew()
}

// Back to the automatic assignment
export async function reset(ids) {
  if (!ids.length) return
  await db.execute(`UPDATE flight_logs SET mission_source = NULL, mission_id = NULL WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
  await assignFlights()
}

// Suggestions for the selected flights: missions whose time window contains one of them, best first
// Flights of a mission according to the flight logs → { count, duration, distance }
export async function flightStats(missionId) {
  const [row] = await db.select(
    'SELECT COUNT(*) AS count, COALESCE(SUM(duration_s), 0) AS duration, COALESCE(SUM(distance_m), 0) AS distance FROM flight_logs WHERE mission_id = ?',
    [missionId],
  )
  return { count: Number(row?.count ?? 0), duration: Number(row?.duration ?? 0), distance: Number(row?.distance ?? 0) }
}

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

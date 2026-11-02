// Backfilling older missions from image folders and flight logs ("Ältere Einsätze nachtragen").
//
//   await scanFolder(root, onProgress)   finds all images below root (however deeply nested), reads their metadata
//   await deviceChoices()                drones/cameras found – own drones preselected, later the chosen ones
//   choose(keys)                         use the images of these devices
//   await proposals()                    missions to create: grouped by time and place (history_grouping.js),
//                                        with place name and overlapping missions – also without any folder
//                                        (flight logs without mission)
//
// The scan result is kept in memory until clear() – choosing devices regroups without scanning again.

import platform from '/lib/platform/index.js'
import { db } from '/lib/db.js'
import MediaFile from '/app/models/media_file.js'
import { missionWindows } from '/app/services/flight_missions.js'
import { nearPlace } from '/app/services/address_service.js'
import { deviceList, groupHistory } from '/app/services/history_grouping.js'

let scan = null // { root, files, known, skipped, selected: Set of device keys | null (= preselection) }

export const current = () => scan
export const clear = () => { scan = null }

// onProgress({ done, total }) – files scanned so far
export async function scanFolder(root, onProgress = () => {}) {
  const dirs = await platform.media.list(root)
  const total = dirs.reduce((n, d) => n + d.files.length, 0)
  const files = []
  const skipped = []
  let done = 0
  onProgress({ done, total })
  for (const dir of dirs) {
    const result = await platform.media.scan(dir.files) // per folder: the files of one shot stay together
    files.push(...result.files)
    skipped.push(...result.skipped)
    done += dir.files.length
    onProgress({ done, total })
  }
  // Already in di-drop (any mission) → not again
  const known = await MediaFile.findByFingerprints(files.map((f) => f.fingerprint), null)
  const seen = new Set()
  const fresh = files.filter((f) => !known.has(f.fingerprint) && !seen.has(f.fingerprint) && seen.add(f.fingerprint))
  scan = { root, files: fresh, known: files.length - fresh.length, skipped, selected: null }
  return scan
}

const allLogs = () => db.select(
  `SELECT id, started_at, landed_at, duration_s, aircraft_sn, latitude, longitude, mission_id, mission_source
     FROM flight_logs WHERE started_at IS NOT NULL ORDER BY started_at`,
)

export async function deviceChoices() {
  const own = (await db.select('SELECT DISTINCT aircraft_sn FROM flight_logs WHERE aircraft_sn IS NOT NULL')).map((r) => r.aircraft_sn)
  const devices = deviceList(scan?.files ?? [], own)
  if (scan?.selected) for (const d of devices) d.selected = scan.selected.has(d.key)
  return devices
}

export function choose(keys) {
  if (scan) scan.selected = new Set(keys)
}

// → { proposals, undated }; proposals with location (place name), coordinates and overlaps [{ id, title, date }]
export async function proposals() {
  const selectedKeys = (await deviceChoices()).filter((d) => d.selected).map((d) => d.key)
  const [logs, windows, missions] = await Promise.all([
    allLogs(), missionWindows(), db.select('SELECT id, title, date, kind FROM missions'),
  ])
  const byId = new Map(missions.map((m) => [m.id, m]))
  const result = groupHistory({ files: scan?.files ?? [], logs, windows, selected: new Set(selectedKeys), root: scan?.root ?? '' })
  for (const p of result.proposals) {
    p.overlaps = p.overlaps.map((id) => byId.get(id)).filter(Boolean)
    p.coordinates = p.lat != null ? `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}` : null
    const place = p.lat != null ? await nearPlace(p.lat, p.lon).catch(() => null) : null
    p.location = place?.text ?? p.coordinates
    p.placeName = place?.name ?? null
  }
  return result
}

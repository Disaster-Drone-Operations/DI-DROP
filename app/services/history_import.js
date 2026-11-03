// Backfilling older missions from image folders and flight logs ("Ältere Einsätze nachtragen").
//
//   await scanFolder(root, onProgress)   finds all images below root (however deeply nested), reads their metadata
//   await deviceChoices()                drones/cameras found – own drones preselected, later the chosen ones
//   choose(keys)                         use the images of these devices
//   await proposals()                    missions to create: grouped by time and place (history_grouping.js),
//                                        with place name and overlapping missions – also without any folder
//                                        (flight logs without mission)
//   await apply(rows, onProgress)        creates the chosen missions: closed, all assignments done, images
//                                        copied like a normal import, flight logs assigned
//
// The scan result is kept in memory until clear() – choosing devices regroups without scanning again.

import platform from '/lib/platform/index.js'
import { db } from '/lib/db.js'
import MediaFile from '/app/models/media_file.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import MediaImporter from '/app/services/media_importer.js'
import { missionWindows, assign } from '/app/services/flight_missions.js'
import { nearPlace } from '/app/services/address_service.js'
import { deviceList, groupHistory, assignmentHint } from '/app/services/history_grouping.js'
import { toDate } from '/lib/time.js'
import { now as clockNow } from '/lib/clock.js'

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

// ── Create ────────────────────────────────────────────────────────────────

// rows (table order): [{ key, title, kind, action: 'create' | 'add:<missionId>' | 'none' | 'skip', merge }]
// "merge": together with the row above (missions over several days). onProgress({ done, total, title })
// → { created: [mission], added: [mission], none: number of flights, failed: [{ title, error }] }
export async function apply(rows, onProgress = () => {}) {
  const { proposals: list } = await proposals()
  const byKey = new Map(list.map((p) => [p.key, p]))
  const groups = []
  for (const row of rows) {
    const p = byKey.get(row.key)
    if (!p) continue
    if (row.merge && groups.length) groups.at(-1).parts.push(p)
    else groups.push({ row, parts: [p] })
  }

  const work = groups.filter((g) => g.row.action === 'create' || g.row.action?.startsWith('add:'))
  const total = work.reduce((n, g) => n + g.parts.reduce((m, p) => m + p.files.length, 0), 0)
  let done = 0
  const result = { created: [], added: [], none: 0, failed: [] }

  for (const { row, parts } of groups) {
    const flightIds = parts.flatMap((p) => p.flightIds)
    if (row.action === 'none') {
      await assign(flightIds, null)
      result.none += flightIds.length
      continue
    }
    if (row.action !== 'create' && !row.action?.startsWith('add:')) continue
    const files = parts.flatMap((p) => p.files)
    try {
      const progress = ({ done: d }) => onProgress({ done: done + d, total, title: row.title })
      const mission = row.action === 'create'
        ? await createMission(row, parts, files, progress)
        : await addToMission(Number(row.action.slice(4)), parts, files, progress)
      result[row.action === 'create' ? 'created' : 'added'].push(mission)
      if (flightIds.length) await assign(flightIds, mission.id)
    } catch (error) {
      console.error('[history] ', error)
      result.failed.push({ title: row.title, error: error?.message ?? String(error) })
    }
    done += files.length
    onProgress({ done, total, title: row.title })
  }
  await forgetImported()
  return result
}

async function createMission(row, parts, files, onProgress) {
  const first = parts[0]
  const end = new Date(Math.max(...parts.map((p) => p.to.getTime())))
  const located = parts.find((p) => p.location)
  const mission = new Mission({
    kind: row.kind,
    title: row.title,
    date: first.date,
    start_time: first.startTime,
    location: located?.location ?? row.title,
    coordinates: located?.coordinates ?? null,
    status: 'closed',
    closed_at: end.toISOString(),
    notes: `Nachgetragen am ${toDate(clockNow()).split('-').reverse().join('.')}${scan?.root ? ` aus dem Ordner „${scan.root}“` : ''}.`,
  })
  if (!(await mission.save())) throw new Error(Object.values(mission.errors).flat().join(', '))
  const initial = await Assignment.create({ mission_id: mission.id, kind: 'initial', title: Assignment.KINDS.initial })
  if (files.length) await importImages(mission, files, first.titleHint, String(initial.id), onProgress)
  await finishAssignments(mission.id, null, end)
  return mission
}

// Images of a proposal that overlaps an existing mission: into new assignments there (done)
async function addToMission(missionId, parts, files, onProgress) {
  const mission = await Mission.find(missionId)
  const end = new Date(Math.max(...parts.map((p) => p.to.getTime())))
  const assignments = files.length ? await importImages(mission, files, parts[0].titleHint, null, onProgress) : []
  await finishAssignments(mission.id, assignments.map((a) => a.id), end)
  return mission
}

// One block (folder, media_importer.js) per assignment: named after its folder, mapping flights
// → "Kartierung", the rest → fallbackTarget (the Lageerkundung) or "Nachgetragene Bilder". Never a control
// flight series – that would plan due times.
async function importImages(mission, files, titleHint, fallbackTarget, onProgress) {
  const importer = new MediaImporter({ mission })
  const review = await importer.scan([], { scanned: { files, skipped: [] } })
  const blocks = review.blocks.map((b) => {
    const name = assignmentHint(b.shots[0].files[0], scan?.root ?? '', titleHint)
    if (name) return { id: b.id, target: 'new', newKind: 'special', newTitle: name }
    if (b.isMapping) return { id: b.id, target: 'new', newKind: 'mapping', newTitle: 'Kartierung' }
    return fallbackTarget ? { id: b.id, target: fallbackTarget } : { id: b.id, target: 'new', newKind: 'special', newTitle: 'Nachgetragene Bilder' }
  })
  const { failed, assignments } = await importer.import({
    blocks, shotKeys: new Set(review.shots.map((s) => s.key)), variants: new Set(review.variants),
  }, onProgress)
  if (failed.length) console.warn('[history] not imported', failed)
  return assignments ?? []
}

// Backfilled work is done: completed when the mission ended (ids null = all open ones of the mission)
async function finishAssignments(missionId, ids, end) {
  const list = (await Assignment.forMission(missionId)).filter((a) => a.isOpen && (!ids || ids.includes(a.id)))
  for (const a of list) await a.update({ status: 'done', completed_at: end.toISOString() })
}

// Imported images no longer count as new
async function forgetImported() {
  if (!scan) return
  const known = await MediaFile.findByFingerprints(scan.files.map((f) => f.fingerprint), null)
  scan.known += scan.files.filter((f) => known.has(f.fingerprint)).length
  scan.files = scan.files.filter((f) => !known.has(f.fingerprint))
}

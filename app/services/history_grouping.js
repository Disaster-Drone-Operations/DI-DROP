// Backfilling older missions: which images come from which drone, and which images and flights
// belong together? Pure functions (no database, no platform) – app/services/history_import.js feeds them.
//
//   droneOf(file)                       → { key, drone, make, model, serial }
//   deviceList(files, ownSerials)       → [{ key, label, drone, count, from, to, selected }]
//   groupHistory({ files, logs, windows, selected, root }) → [proposal]   (oldest first)
//
// Grouping: images are attached to the flight they were taken in (flight_matching.js); flights and
// images without a flight then form one proposal as long as there's no gap > 4 h and the place stays
// within 5 km (take-off point of the flight, otherwise the image position). Folder names are only
// hints for the title – the folder structure can't be relied upon.

import { distance } from '/lib/geo.js'
import { parseLocal, toDate, toTime } from '/lib/time.js'
import { flightLogFor, flightIndex, sameSerial } from '/app/services/flight_matching.js'

export const GAP_MS = 4 * 3600_000
export const DISTANCE_M = 5000

// Brands of other drones – only counted as drone images with a height above take-off point
const DRONE_MAKES = /^(dji|autel|parrot|skydio|yuneec)/i

// Time of a file in ms: capture time (local), otherwise from the DJI file name (DJI_20260911114817_0001_T.JPG)
export function fileTime(file) {
  const taken = parseLocal(file.meta?.taken_at)?.getTime()
  if (taken) return taken
  const m = /DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/i.exec(file.name ?? '')
  return m ? parseLocal(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`).getTime() : null
}

const isDjiVideo = (file) => file.kind === 'video' && /^DJI_/i.test(file.name ?? '')

// Drone and device of an image; everything else (phone, camera …) is 'other'
export function droneOf(file) {
  const dji = file.meta?.dji ?? {}
  const isDji = Object.keys(dji).length > 0
  const make = (file.meta?.make ?? '').trim() || (isDji ? 'DJI' : '')
  const drone = isDji || (DRONE_MAKES.test(make) && file.meta?.rel_alt != null)
  if (!drone) return { key: 'other', drone: false }
  const model = (dji.DroneModel || dji.ProductName || file.meta?.model || '').trim()
  const serial = (dji.DroneSerialNumber ?? '').trim() || null
  return { key: `drone|${make}|${model}|${serial ?? ''}`, drone: true, make, model, serial }
}

// Devices found (drones by model + serial number, other cameras together); DJI videos carry no
// metadata and simply go along with the drone images. Preselected: our own drones (serial number in the
// flight logs) – without any flight logs all drones.
export function deviceList(files, ownSerials = []) {
  const devices = new Map()
  for (const file of files) {
    if (isDjiVideo(file)) continue
    const d = droneOf(file)
    if (!devices.has(d.key)) {
      const label = d.drone
        ? `${d.model || d.make || 'Drohne'}${d.serial ? ` · SN …${d.serial.slice(-5)}` : ' · ohne Seriennummer'}`
        : 'Andere Kameras (Handy, Fotoapparat …)'
      const own = d.drone && (ownSerials.length ? ownSerials.some((sn) => sameSerial(sn, d.serial)) : true)
      devices.set(d.key, { key: d.key, label, drone: d.drone, serial: d.serial ?? null, count: 0, from: null, to: null, selected: own })
    }
    const device = devices.get(d.key)
    device.count++
    const at = fileTime(file)
    if (at) {
      device.from = device.from == null ? at : Math.min(device.from, at)
      device.to = device.to == null ? at : Math.max(device.to, at)
    }
  }
  return [...devices.values()].sort((a, b) => (b.drone - a.drone) || (b.count - a.count))
}

// ── Folder names as hints ────────────────────────────────────────────────

// "2025_09_05 Waldbrand Musterberg", "2025-09-05_1355_Suche", "05.09.2025 Übung" → { date, title }
export function parseFolderName(name) {
  let rest = name
  let date = null
  let m = /^(\d{4})[-_.](\d{2})[-_.](\d{2})(?:[-_ T]+(\d{2})[-_:.h]?(\d{2})(?:[-_:.]?(\d{2}))?(?!\d))?/.exec(rest)
  if (m) date = `${m[1]}-${m[2]}-${m[3]}`
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(rest))) date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (m) rest = rest.slice(m[0].length)
  const title = rest.replace(/[_]+/g, ' ').replace(/^[\s\-–.]+/, '').replace(/\s+/g, ' ').trim()
  return { date, title }
}

// Names that say nothing about a mission (camera folders, generic words, numbers)
const GENERIC = /^(eins(ä|ae)tze|einsatz|(ü|ue)bungen|(ü|ue)bung|trainings?|archiv|dcim|\d{3}[a-z_]*|dji[ _]?\d*|media|panorama|pano|photos?|fotos?|bilder|images?|videos?|raw|drohnen?|sd[ -]?karte|card|\d+|neuer ordner|new folder)$/i
export const isMeaningful = (title) => !!title && !GENERIC.test(title)

// Folders between the chosen folder and the file
export function folderSegments(path, root) {
  const rel = root && path.startsWith(root) ? path.slice(root.length) : path
  return rel.split(/[\\/]/).filter(Boolean).slice(0, -1)
}

const EXERCISE = /(übung|uebung|ubung|training|ausbildung)/i
const OPERATION = /einsatz/i

// Title of a proposal: the first meaningful folder name (from the top) that only occurs in this proposal –
// folders spanning several proposals ("Einsätze", "2025", "Übungen") are containers. Kind from any folder name.
function nameHints(groups, root) {
  const groupsOf = new Map() // folder path prefix → Set of group indices
  const prefixes = (file) => folderSegments(file.path, root).map((_, i, segs) => segs.slice(0, i + 1).join('/'))
  groups.forEach((g, i) => {
    for (const file of g.files) for (const p of prefixes(file)) (groupsOf.get(p) ?? groupsOf.set(p, new Set()).get(p)).add(i)
  })
  groups.forEach((g, i) => {
    const counts = new Map()
    let kind = null
    for (const file of g.files) {
      const segs = folderSegments(file.path, root)
      for (const s of segs) {
        if (EXERCISE.test(s)) kind = 'exercise'
        else if (!kind && OPERATION.test(s)) kind = 'operation'
      }
      const pre = prefixes(file)
      const own = segs.map((s, k) => ({ title: parseFolderName(s).title, single: groupsOf.get(pre[k]).size === 1 }))
        .filter((s) => isMeaningful(s.title))
      const pick = own.find((s) => s.single) ?? own[0]
      if (pick) counts.set(pick.title, (counts.get(pick.title) ?? 0) + 1)
    }
    g.titleHint = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    g.kind = kind
  })
}

// Name of an assignment within a mission: the deepest meaningful folder below the one that gave the
// mission its name (titleHint) – null if there's none
export function assignmentHint(file, root, titleHint) {
  const titles = folderSegments(file.path, root).map((s) => parseFolderName(s).title).filter(isMeaningful)
  const at = titles.findIndex((t) => t.toLowerCase() === (titleHint ?? '').toLowerCase())
  const below = at >= 0 ? titles.slice(at + 1) : titles.slice(1)
  return below.at(-1) ?? null
}

// ── Grouping ─────────────────────────────────────────────────────────────

const position = (lat, lon) => (lat && lon ? { lat, lon } : null) // 0/0 = missing

// files: scanned files not yet in di-drop; logs: all flight logs; windows: missionWindows() (flight_missions.js);
// selected: Set of device keys. A flight log is "free" without mission and not set to "kein Einsatz" by hand.
export function groupHistory({ files = [], logs = [], windows = [], selected = new Set(), root = '' }) {
  const near = flightIndex(logs)
  const byId = new Map(logs.map((l) => [l.id, l]))
  const free = (l) => l.mission_id == null && l.mission_source !== 'manual'
  const units = new Map() // flight log id → { from, to, pos, log, files }
  const unitOf = (log) => units.get(log.id) ?? units.set(log.id, {
    from: Date.parse(log.started_at),
    to: Date.parse(log.landed_at ?? log.started_at),
    pos: position(log.latitude, log.longitude),
    log,
    files: [],
  }).get(log.id)
  for (const log of logs) if (free(log)) unitOf(log)

  const loose = []
  const undated = []
  for (const file of files) {
    if (!isDjiVideo(file) && !selected.has(droneOf(file).key)) continue
    const at = fileTime(file)
    if (at == null) { undated.push(file); continue }
    file.at = at
    const log = byId.get(flightLogFor({ at, serial: file.meta?.dji?.DroneSerialNumber ?? null }, near(at)))
    if (log && !(log.mission_id == null && log.mission_source === 'manual')) unitOf(log).files.push(file)
    else loose.push({ from: at, to: at, pos: position(file.meta?.lat, file.meta?.lon), log: null, files: [file] })
  }

  const all = [...units.values(), ...loose].sort((a, b) => a.from - b.from)
  const groups = []
  for (const u of all) {
    const g = groups.at(-1)
    const far = g?.pos && u.pos && distance(g.pos.lat, g.pos.lon, u.pos.lat, u.pos.lon) > DISTANCE_M
    if (!g || u.from - g.to > GAP_MS || far) groups.push({ from: u.from, to: u.to, pos: null, homePos: null, units: [] })
    const group = groups.at(-1)
    group.units.push(u)
    group.to = Math.max(group.to, u.to)
    group.pos ??= u.pos
    if (u.log && u.pos) group.homePos ??= u.pos
  }

  const proposals = groups
    .map((g) => {
      const logsIn = g.units.map((u) => u.log).filter(Boolean)
      const groupFiles = g.units.flatMap((u) => u.files).sort((a, b) => a.at - b.at)
      const pos = g.homePos ?? g.pos
      const missionIds = new Set(logsIn.map((l) => l.mission_id).filter((id) => id != null))
      for (const w of windows) if (g.from <= w.to && g.to >= w.from) missionIds.add(w.id)
      const from = new Date(g.from)
      return {
        key: String(g.from),
        from,
        to: new Date(g.to),
        date: toDate(from),
        startTime: toTime(from),
        files: groupFiles,
        shots: new Set(groupFiles.map((f) => `${folderSegments(f.path, '').join('/')}|${f.shot_key}`)).size,
        bytes: groupFiles.reduce((n, f) => n + (f.size ?? 0), 0),
        flightIds: logsIn.filter(free).map((l) => l.id),
        flightCount: logsIn.length,
        flightSeconds: logsIn.reduce((n, l) => n + (l.duration_s ?? 0), 0),
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        posSource: g.homePos ? 'home' : pos ? 'image' : null,
        overlaps: [...missionIds],
      }
    })
    // only videos and nothing else (no flight, no image): not a mission of its own
    .filter((p) => p.flightCount || p.files.some((f) => !isDjiVideo(f)))
  nameHints(proposals, root)
  return { proposals, undated }
}

import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { parseLocal } from '/lib/time.js'

// An imported image or video file
export default class MediaFile extends Record {
  static tableName = 'media_files'

  static attributes = {
    mission_id: 'integer',
    flight_id: 'integer',
    assignment_id: 'integer',
    kind: 'string',
    shot_key: 'string',
    variant: 'string',
    original_name: 'string',
    original_path: 'string',
    path: 'string',
    thumb_path: 'string',
    size: 'integer',
    fingerprint: 'string',
    taken_at: 'datetime',
    camera: 'string',
    width: 'integer',
    height: 'integer',
    lat: 'float',
    lon: 'float',
    abs_alt: 'float',
    rel_alt: 'float',
    gimbal_yaw: 'float',
    gimbal_pitch: 'float',
    flight_yaw: 'float',
    focal_length: 'float',
    focal_length_35mm: 'float',
    digital_zoom: 'float',
    image_source: 'string',
    flight_line: 'string',
    target_lat: 'float',
    target_lon: 'float',
    target_distance: 'float',
    metadata: 'text',
  }

  // File suffixes of the DJI cameras. The M4TD delivers "V" (visible image – depending on the
  // setting from the wide or zoom camera) and "T" (thermal). Other models separate W/Z.
  static VARIANTS = { V: 'Sichtbild', W: 'Weitwinkel', Z: 'Zoom', T: 'Wärmebild' }
  static VARIANT_ORDER = ['V', 'W', 'Z', 'T']
  static SOURCES = { WideCamera: 'Weitwinkel', ZoomCamera: 'Zoom', InfraredCamera: 'Wärmebild' }

  validate() {
    this.validatesPresenceOf('mission_id', 'flight_id', 'assignment_id', 'path', 'fingerprint', 'shot_key')
  }

  static forFlight(flightId) {
    return this.where('flight_id = ?', [flightId], { order: 'taken_at ASC, shot_key ASC, variant ASC' })
  }

  // Which fingerprints have already been imported in this mission – and where?
  // → Map(fingerprint → { flight_number, mission_title })
  static async findByFingerprints(fingerprints, missionId) {
    const found = new Map()
    for (let i = 0; i < fingerprints.length; i += 400) {
      const chunk = fingerprints.slice(i, i + 400)
      if (!chunk.length) continue
      const rows = await db.select(
        `SELECT media_files.fingerprint, media_files.flight_id, media_files.mission_id,
                flights.number AS flight_number, missions.title AS mission_title
           FROM media_files
           JOIN flights ON flights.id = media_files.flight_id
           JOIN missions ON missions.id = media_files.mission_id
          WHERE media_files.mission_id = ? AND media_files.fingerprint IN (${chunk.map(() => '?').join(', ')})`,
        [missionId, ...chunk],
      )
      for (const row of rows) found.set(row.fingerprint, row)
    }
    return found
  }

  // Number of shots/files per flight → Map(flight_id → { shots, files })
  static async countsByFlight(missionId) {
    const rows = await db.select(
      `SELECT flight_id, COUNT(*) AS files, COUNT(DISTINCT shot_key) AS shots
         FROM media_files WHERE mission_id = ? GROUP BY flight_id`,
      [missionId],
    )
    return new Map(rows.map((r) => [Number(r.flight_id), { files: Number(r.files), shots: Number(r.shots) }]))
  }

  get variantLabel() {
    return MediaFile.VARIANTS[this.variant] ?? this.variant ?? 'Datei'
  }

  // Which camera took the image? "Zoomkamera", "Weitwinkelkamera" …
  get cameraLabel() {
    const source = MediaFile.SOURCES[this.image_source]
    return source && this.variant !== 'T' ? `${source}kamera` : null
  }

  get takenAt() {
    return parseLocal(this.taken_at)
  }

  get isVideo() {
    return this.kind === 'video'
  }
}

// Group files into shots: [{ key, takenAt, files, byVariant, primary }]
// Works for MediaFile instances as well as for scan results from Rust.
export function groupShots(files) {
  const shots = new Map()
  for (const file of files) {
    const key = file.shot_key
    if (!shots.has(key)) shots.set(key, { key, files: [], byVariant: {} })
    const shot = shots.get(key)
    shot.files.push(file)
    if (file.variant) shot.byVariant[file.variant] = file
  }
  return [...shots.values()]
    .map((shot) => {
      const order = (f) => {
        const i = MediaFile.VARIANT_ORDER.indexOf(f.variant)
        return i === -1 ? 99 : i
      }
      shot.files.sort((a, b) => order(a) - order(b))
      shot.primary = shot.files[0]
      shot.taken_at = shot.files.map((f) => f.taken_at ?? f.meta?.taken_at).filter(Boolean).sort()[0] ?? null
      return shot
    })
    .sort((a, b) => (a.taken_at ?? a.key).localeCompare(b.taken_at ?? b.key))
}

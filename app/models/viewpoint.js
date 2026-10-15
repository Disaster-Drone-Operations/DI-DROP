import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { bearing, distance, angleDiff, normalizeDeg } from '/lib/geo.js'
import MediaFile from '/app/models/media_file.js'

// A viewpoint: the same camera position and viewing direction, usually visited in
// several flights. Basis for comparison images.
//
// Assigning a shot:
//   1. DJI waypoint identifier (FlightLineInfo) – exact, for waypoint missions
//   2. otherwise geometry: target point or position, heading, pitch, zoom
//
// Name = the side of the incident site that is seen: if the drone photographs from the
// north towards the south, the viewpoint is called "Nord". Numbers only when ambiguous.
export default class Viewpoint extends Record {
  static tableName = 'viewpoints'

  static attributes = {
    mission_id: 'integer',
    flight_line: 'string',
    direction: 'string',
    side_deg: 'float',
    custom_name: 'string',
    lat: 'float',
    lon: 'float',
    rel_alt: 'float',
    target_lat: 'float',
    target_lon: 'float',
    gimbal_yaw: 'float',
    gimbal_pitch: 'float',
    digital_zoom: 'float',
  }

  static DIRECTIONS = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest']
  static TOP_DOWN = 'Draufsicht'
  static TOP_DOWN_PITCH = -78 // steeper than this → top-down view

  // Tolerances for geometric matching (shots without a waypoint identifier)
  static MATCH = { targetMeters: 10, positionMeters: 12, altitudeMeters: 10, yawDeg: 15, pitchDeg: 8, zoomRatio: 1.25 }

  // ── Direction ───────────────────────────────────────────────────────────────

  static directionFor({ lat, lon, target_lat, target_lon, gimbal_yaw, gimbal_pitch }) {
    if (gimbal_pitch != null && gimbal_pitch <= Viewpoint.TOP_DOWN_PITCH) return { direction: Viewpoint.TOP_DOWN, side_deg: null }

    let side = null
    if (target_lat != null && lat != null) side = bearing(target_lat, target_lon, lat, lon) // from the target to the drone
    else if (gimbal_yaw != null) side = normalizeDeg(gimbal_yaw + 180) // opposite of the viewing direction
    if (side == null) return { direction: 'Unbekannt', side_deg: null }
    return { direction: Viewpoint.DIRECTIONS[Math.round(side / 45) % 8], side_deg: side }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  // All viewpoints of a mission with a unique display name ("Ost 1", "Ost 2", "Nord" …)
  // Viewpoints visited in several flights get numbers first (in route order),
  // single shots afterwards.
  static async forMission(missionId) {
    const viewpoints = await this.where('mission_id = ?', [missionId], { order: 'id ASC' })
    const rows = await db.select(
      'SELECT viewpoint_id, COUNT(DISTINCT flight_id) AS flights FROM media_files WHERE mission_id = ? AND viewpoint_id IS NOT NULL GROUP BY viewpoint_id',
      [missionId],
    )
    const flights = new Map(rows.map((r) => [Number(r.viewpoint_id), Number(r.flights)]))
    for (const v of viewpoints) v.flightCount = flights.get(v.id) ?? 0
    const ordered = [...viewpoints.filter((v) => v.flightCount > 1), ...viewpoints.filter((v) => v.flightCount <= 1)]

    // Numbers stay stable: if "Ost 1" is renamed, the others keep their names "Ost 2", "Ost 3" …
    const counts = {}
    for (const v of viewpoints) counts[v.direction] = (counts[v.direction] ?? 0) + 1
    const seen = {}
    for (const v of ordered) {
      const number = (seen[v.direction] = (seen[v.direction] ?? 0) + 1)
      if (v.custom_name) v.name = v.custom_name
      else v.name = counts[v.direction] > 1 ? `${v.direction} ${number}` : v.direction
    }
    return viewpoints
  }

  // ── Matching ──────────────────────────────────────────────────────────────

  // Does a shot (without a waypoint identifier) geometrically match this viewpoint?
  matches(file) {
    const m = Viewpoint.MATCH
    if (file.gimbal_pitch == null || this.gimbal_pitch == null) return false
    if (Math.abs(file.gimbal_pitch - this.gimbal_pitch) > m.pitchDeg) return false
    const topDown = this.gimbal_pitch <= Viewpoint.TOP_DOWN_PITCH
    if (!topDown && (file.gimbal_yaw == null || angleDiff(file.gimbal_yaw, this.gimbal_yaw ?? 0) > m.yawDeg)) return false

    const zoomA = file.digital_zoom || 1
    const zoomB = this.digital_zoom || 1
    if (Math.max(zoomA, zoomB) / Math.min(zoomA, zoomB) > m.zoomRatio) return false

    if (file.target_lat != null && this.target_lat != null) {
      return distance(file.target_lat, file.target_lon, this.target_lat, this.target_lon) <= m.targetMeters
    }
    if (file.lat == null || this.lat == null) return false
    return distance(file.lat, file.lon, this.lat, this.lon) <= m.positionMeters &&
      Math.abs((file.rel_alt ?? 0) - (this.rel_alt ?? 0)) <= m.altitudeMeters
  }

  // Assigns all not yet assigned images of a mission to a viewpoint
  // (creates new viewpoints where needed). Returns the number of assigned shots.
  static async sync(missionId) {
    const files = await MediaFile.where('mission_id = ? AND viewpoint_id IS NULL AND kind = ?', [missionId, 'image'],
      { order: 'taken_at ASC, id ASC' })
    if (!files.length) return 0

    const shots = new Map()
    for (const f of files) {
      const key = `${f.flight_id}/${f.shot_key}`
      if (!shots.has(key)) shots.set(key, [])
      shots.get(key).push(f)
    }

    const viewpoints = await this.where('mission_id = ?', [missionId], { order: 'id ASC' })
    for (const shotFiles of shots.values()) {
      // Reference: preferably a file with a laser target point, otherwise the first with orientation
      const ref = shotFiles.find((f) => f.target_lat != null) ?? shotFiles.find((f) => f.gimbal_pitch != null) ?? shotFiles[0]
      const line = shotFiles.map((f) => f.flight_line).find(Boolean)

      let viewpoint = line
        ? viewpoints.find((v) => v.flight_line === line)
        : viewpoints.find((v) => v.matches(ref))

      if (!viewpoint) {
        viewpoint = new Viewpoint({
          mission_id: missionId,
          flight_line: line ?? null,
          ...Viewpoint.directionFor(ref),
          lat: ref.lat, lon: ref.lon, rel_alt: ref.rel_alt,
          target_lat: ref.target_lat, target_lon: ref.target_lon,
          gimbal_yaw: ref.gimbal_yaw, gimbal_pitch: ref.gimbal_pitch, digital_zoom: ref.digital_zoom,
        })
        await viewpoint.save()
        viewpoints.push(viewpoint)
      }
      const ids = shotFiles.map((f) => Number(f.id))
      await db.execute(`UPDATE media_files SET viewpoint_id = ? WHERE id IN (${ids.map(() => '?').join(', ')})`, [viewpoint.id, ...ids])
    }
    return shots.size
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'direction')
  }
}

import Record from '/lib/record.js'
import { db } from '/lib/db.js'

// A flight from the DJI remote controller's log (key data; original file at `path`)
export default class FlightLog extends Record {
  static tableName = 'flight_logs'

  static attributes = {
    file_name: 'string',
    path: 'string',
    size: 'integer',
    log_version: 'integer',
    started_at: 'datetime',
    landed_at: 'datetime',
    duration_s: 'float',
    distance_m: 'float',
    max_height_m: 'float',
    max_speed_ms: 'float',
    battery_sn: 'string',
    aircraft_name: 'string',
    aircraft_sn: 'string',
    rc_sn: 'string',
    camera_sn: 'string',
    latitude: 'float',
    longitude: 'float',
    photos: 'integer',
    video_s: 'integer',
    app_version: 'string',
    mission_id: 'integer',
    notes: 'text',
  }

  static async knownFileNames() {
    return (await db.select('SELECT file_name FROM flight_logs')).map((r) => r.file_name)
  }

  // Take over key data from Rust (src-tauri/src/flightlogs.rs); already known files are kept
  static async addSummaries(summaries) {
    let added = 0
    for (const s of summaries) {
      const landed = new Date(Date.parse(s.start_time) + s.duration_s * 1000).toISOString()
      const result = await db.execute(
        `INSERT OR IGNORE INTO flight_logs (file_name, path, size, log_version, started_at, landed_at, duration_s, distance_m,
           max_height_m, max_speed_ms, battery_sn, aircraft_name, aircraft_sn, rc_sn, camera_sn, latitude, longitude,
           photos, video_s, app_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.file_name, s.path, s.size, s.log_version, new Date(s.start_time).toISOString(), landed, s.duration_s, s.distance_m,
          s.max_height_m, s.max_speed_ms, s.battery_sn || null, s.aircraft_name || null, s.aircraft_sn || null, s.rc_sn || null,
          s.camera_sn || null, s.latitude, s.longitude, s.photos, s.video_s, s.app_version || null,
          new Date().toISOString(), new Date().toISOString()],
      )
      added += result?.rowsAffected ?? 1
    }
    return added
  }
}

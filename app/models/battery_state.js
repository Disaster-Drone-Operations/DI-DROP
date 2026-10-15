import { db } from '/lib/db.js'

// Whether a battery is still in service (retired batteries don't count for recommendations)
export default class BatteryState {
  // → Map serial → retired_at (only retired batteries)
  static async retired() {
    const rows = await db.select('SELECT serial, retired_at FROM battery_states WHERE retired_at IS NOT NULL')
    return new Map(rows.map((r) => [r.serial, r.retired_at]))
  }

  static async setRetired(serial, retired) {
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO battery_states (serial, retired_at, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(serial) DO UPDATE SET retired_at = excluded.retired_at, updated_at = excluded.updated_at`,
      [serial, retired ? now : null, now, now],
    )
  }
}

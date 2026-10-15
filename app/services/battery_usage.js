// Battery usage from the flight logs: flight time per battery, normalized to its time in service.
//
//   hours per service year = flight hours / (first flight → today, or → retirement)
//
// Comparing per service year keeps newer batteries from looking "underused" just because they are
// young. The recommendation picks the active batteries with the fewest hours per service year.
// Number of starts is shown only: a battery may fly several short flights on one charge.

import { db } from '/lib/db.js'
import DeviceName from '/app/models/device_name.js'
import BatteryState from '/app/models/battery_state.js'

const DAY = 86_400_000
export const STORAGE_WARNING_DAYS = 60 // DJI: don't leave batteries unused for months
export const RECOMMEND_COUNT = 2 // operations always use several batteries
const MIN_SERVICE_DAYS = 30 // very new batteries: avoid inflated per-year rates
const RECENT_DAYS = 90

export async function batteryUsage(now = Date.now()) {
  const rows = await db.select(
    `SELECT battery_sn AS serial, COUNT(*) AS starts, SUM(duration_s) AS seconds,
            MIN(started_at) AS first, MAX(started_at) AS last,
            SUM(CASE WHEN started_at >= ? THEN duration_s ELSE 0 END) AS recent_seconds
       FROM flight_logs WHERE battery_sn IS NOT NULL AND battery_sn <> '' GROUP BY battery_sn`,
    [new Date(now - RECENT_DAYS * DAY).toISOString()],
  )
  const names = await DeviceName.all()
  const retired = await BatteryState.retired()

  const batteries = rows.map((r) => {
    const retiredAt = retired.get(r.serial) ?? null
    const end = retiredAt ? Date.parse(retiredAt) : now
    const serviceDays = Math.max(MIN_SERVICE_DAYS, (end - Date.parse(r.first)) / DAY)
    const hours = (r.seconds ?? 0) / 3600
    const idleDays = Math.floor((now - Date.parse(r.last)) / DAY)
    return {
      serial: r.serial,
      name: names.get(`battery:${r.serial}`) ?? null,
      starts: r.starts,
      hours,
      recentHours: (r.recent_seconds ?? 0) / 3600,
      perYear: hours / (serviceDays / 365.25),
      averageMinutes: r.starts ? (r.seconds ?? 0) / 60 / r.starts : 0,
      first: r.first,
      last: r.last,
      idleDays,
      retiredAt,
      storageWarning: !retiredAt && idleDays >= STORAGE_WARNING_DAYS,
    }
  })

  const active = batteries.filter((b) => !b.retiredAt)
  const recommended = [...active].sort((a, b) => a.perYear - b.perYear).slice(0, RECOMMEND_COUNT).map((b) => b.serial)
  const average = (key) => (active.length ? active.reduce((s, b) => s + b[key], 0) / active.length : 0)

  // Active first (most used per year on top), retired at the end
  batteries.sort((a, b) => (!!a.retiredAt - !!b.retiredAt) || b.perYear - a.perYear)
  return {
    batteries,
    recommended,
    averages: { hours: average('hours'), perYear: average('perYear') },
    storageWarningDays: STORAGE_WARNING_DAYS,
  }
}

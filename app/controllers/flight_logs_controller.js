import ApplicationController from '/app/controllers/application_controller.js'
import FlightLog from '/app/models/flight_log.js'
import DeviceName from '/app/models/device_name.js'
import platform from '/lib/platform/index.js'
import { flightLogDir, syncLocal, isAvailable } from '/app/services/flightlog_importer.js'

// Module "Flugprotokolle": all flights from the remote controller's logs
export default class FlightLogsController extends ApplicationController {
  async index() {
    if (isAvailable()) await syncLocal().catch((e) => console.warn('[flight logs]', e))
    const battery = this.params.battery || null // "Flüge" link in the battery module
    const logs = battery
      ? await FlightLog.where('battery_sn = ?', [battery], { order: 'started_at DESC' })
      : await FlightLog.all({ order: 'started_at DESC' })
    // Grouped by drone (serial number), most recently flown first
    const groups = []
    for (const log of logs) {
      const sn = log.aircraft_sn ?? ''
      let group = groups.find((g) => g.sn === sn)
      if (!group) groups.push((group = { sn, model: log.aircraft_name ?? 'Drohne', logs: [] }))
      group.logs.push(log)
    }
    await this.render('flight_logs/index', {
      logs,
      groups,
      names: await DeviceName.all(),
      battery,
      available: isAvailable(),
      dir: isAvailable() ? await flightLogDir() : null,
      canPickFolder: platform.capabilities.folders,
    }, { title: 'Flugprotokolle' })
  }
}

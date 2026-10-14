import ApplicationController from '/app/controllers/application_controller.js'
import FlightLog from '/app/models/flight_log.js'
import platform from '/lib/platform/index.js'
import { flightLogDir, syncLocal, isAvailable } from '/app/services/flightlog_importer.js'

// Modul "Flugprotokolle": alle Flüge aus den Protokollen der Fernsteuerung
export default class FlightLogsController extends ApplicationController {
  async index() {
    if (isAvailable()) await syncLocal().catch((e) => console.warn('[Flugprotokolle]', e))
    const logs = await FlightLog.all({ order: 'started_at DESC' })
    await this.render('flight_logs/index', {
      logs,
      available: isAvailable(),
      dir: isAvailable() ? await flightLogDir() : null,
      canPickFolder: platform.capabilities.folders,
    }, { title: 'Flugprotokolle' })
  }
}

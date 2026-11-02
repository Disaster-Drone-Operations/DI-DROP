import ApplicationController from '/app/controllers/application_controller.js'
import platform from '/lib/platform/index.js'
import { current, deviceChoices, choose, proposals } from '/app/services/history_import.js'

// "Ältere Einsätze nachtragen": proposals from image folders (scanned by history_import_controller.js)
// and from flight logs without a mission – decide per row, then create (app/services/history_import.js)
export default class HistoryController extends ApplicationController {
  async index() {
    const scan = current()
    const devices = scan ? await deviceChoices() : []
    const { proposals: rows, undated } = await proposals()
    await this.render('history/index', {
      scan,
      devices,
      rows,
      undated,
      canPick: platform.capabilities.media,
    }, { title: 'Ältere Einsätze nachtragen' })
  }

  // Which drones/cameras count – changing it groups the images anew
  async devices() {
    choose(Object.values(this.params.devices ?? {}).filter((key) => key && key !== '0'))
    this.redirectTo('/missions/history')
  }

  async create() {
    this.redirectTo('/missions/history', { alert: 'Anlegen folgt im nächsten Schritt.' })
  }
}

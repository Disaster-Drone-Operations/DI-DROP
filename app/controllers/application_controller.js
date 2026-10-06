import Controller from '/lib/controller.js'
import { RecordNotFound } from '/lib/record.js'
import Mission from '/app/models/mission.js'
import Setting from '/app/models/setting.js'

export default class ApplicationController extends Controller {
  // Daten für die Seitenleiste
  async layoutLocals() {
    return {
      unitName: Setting.get('general.unit_name'),
      activeMissions: await Mission.active(),
    }
  }

  async renderError(error) {
    const notFound = error instanceof RecordNotFound
    await this.render('errors/show', {
      heading: notFound ? 'Nicht gefunden' : 'Da ist etwas schiefgelaufen',
      message: notFound ? 'Diese Seite oder dieser Eintrag existiert nicht (mehr).' : error.message,
      details: notFound ? null : error.stack,
    }, { title: 'Fehler' })
  }
}

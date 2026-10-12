import ApplicationController from '/app/controllers/application_controller.js'
import { relayBaseUrl } from '/app/services/location_service.js'

// "Mein Standort" – Position und Übertragung leben im LocationService (Arbeitsspeicher);
// die Seite selbst zeichnet der Stimulus-Controller "location".
export default class LocationController extends ApplicationController {
  async show() {
    await this.render('location/show', { configured: !!relayBaseUrl() }, { title: 'Mein Standort' })
  }
}

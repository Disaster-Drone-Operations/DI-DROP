import ApplicationController from '/app/controllers/application_controller.js'
import { relayBaseUrl } from '/app/services/location_service.js'

// "Mein Standort" – position and transfer live in the LocationService (memory);
// the page itself is drawn by the Stimulus controller "location".
export default class LocationController extends ApplicationController {
  async show() {
    await this.render('location/show', { configured: !!relayBaseUrl() }, { title: 'Mein Standort' })
  }
}

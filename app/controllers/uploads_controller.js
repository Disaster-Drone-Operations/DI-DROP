import ApplicationController from '/app/controllers/application_controller.js'

// Übersicht aller Uploads – die Liste zeichnet der Stimulus-Controller "uploads" live
export default class UploadsController extends ApplicationController {
  async index() {
    await this.render('uploads/index', {}, { title: 'Uploads' })
  }
}

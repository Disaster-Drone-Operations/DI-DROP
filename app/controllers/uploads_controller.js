import ApplicationController from '/app/controllers/application_controller.js'

// Overview of all uploads – the list is drawn live by the Stimulus controller "uploads"
export default class UploadsController extends ApplicationController {
  async index() {
    await this.render('uploads/index', {}, { title: 'Uploads' })
  }
}

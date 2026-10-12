import ApplicationController from '/app/controllers/application_controller.js'
import pkg from '/package.json'

// "Über di-drop": Version, Quellenangaben (OpenStreetMap, GeoNames) und Lizenzen der Bibliotheken
export default class AboutController extends ApplicationController {
  async show() {
    await this.render('about/show', { version: pkg.version }, { title: 'Über di-drop' })
  }
}

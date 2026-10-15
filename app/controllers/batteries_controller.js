import ApplicationController from '/app/controllers/application_controller.js'
import BatteryState from '/app/models/battery_state.js'
import { batteryUsage } from '/app/services/battery_usage.js'

// Module "Akkunutzung": flight hours per battery, recommendation, storage hints
export default class BatteriesController extends ApplicationController {
  async index() {
    await this.render('batteries/index', await batteryUsage(), { title: 'Akkunutzung' })
  }

  async retire() {
    await BatteryState.setRetired(this.params.serial, true)
    this.redirectTo('/batteries', { notice: 'Akku außer Dienst gestellt – er zählt nicht mehr für Empfehlung und Durchschnitt.' })
  }

  async activate() {
    await BatteryState.setRetired(this.params.serial, false)
    this.redirectTo('/batteries', { notice: 'Akku wieder in Dienst gestellt.' })
  }
}

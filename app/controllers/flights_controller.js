import ApplicationController from '/app/controllers/application_controller.js'
import MissionsController from '/app/controllers/missions_controller.js'
import Mission from '/app/models/mission.js'
import Flight from '/app/models/flight.js'

export default class FlightsController extends ApplicationController {
  async beforeAction() {
    this.mission = await Mission.find(this.params.mission_id)
  }

  async create() {
    const flight = new Flight({ ...this.params.flight, mission_id: this.mission.id })
    if (await flight.save()) {
      return this.redirectTo(`/missions/${this.mission.id}`, { notice: `Flug ${flight.number} (${flight.kindLabel}) erfasst.` })
    }
    // Fehler → Einsatzseite mit ausgefülltem Formular erneut rendern
    const missions = new MissionsController({ ...this, action: 'show' })
    await missions.renderShow(this.mission, flight)
  }

  async destroy() {
    const flight = await Flight.findBy('id = ? AND mission_id = ?', [Number(this.params.id), this.mission.id])
    if (flight) await flight.destroy()
    this.redirectTo(`/missions/${this.mission.id}`, { notice: `Flug ${flight?.number ?? ''} gelöscht.` })
  }
}

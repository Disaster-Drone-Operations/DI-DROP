import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import Flight from '/app/models/flight.js'
import Setting from '/app/models/setting.js'

export default class MissionsController extends ApplicationController {
  async beforeAction() {
    if (['show', 'edit', 'update', 'destroy'].includes(this.action)) {
      this.mission = await Mission.find(this.params.id)
    }
  }

  async index() {
    await this.render('missions/index', {
      active: await Mission.active(),
      archived: await Mission.archived(),
      needsSetup: !Setting.isSet('general.operator_name'),
    }, { title: 'Einsätze' })
  }

  async show() {
    await this.renderShow(this.mission)
  }

  // Wird auch vom FlightsController genutzt, um Formularfehler anzuzeigen
  async renderShow(mission, flight = null) {
    const flights = await mission.flights()
    // Vorschlag für den nächsten Flug: solange noch Initialflüge laufen → Initialflug, danach Kontrollflug
    const lastKind = flights.at(-1)?.kind
    flight ??= new Flight({ mission_id: mission.id, kind: !lastKind || lastKind === 'initial' ? 'initial' : 'kontrolle' })
    await this.render('missions/show', {
      mission,
      flights,
      flight,
      nextControlAt: mission.nextControlFlightAt(flights),
    }, { title: mission.title })
  }

  async new() {
    await this.render('missions/new', { mission: new Mission() }, { title: 'Neuer Einsatz' })
  }

  async create() {
    const mission = new Mission(this.params.mission)
    if (await mission.save()) {
      return this.redirectTo(`/missions/${mission.id}`, { notice: `${mission.kindLabel} „${mission.title}“ angelegt.` })
    }
    await this.render('missions/new', { mission }, { title: 'Neuer Einsatz' })
  }

  async edit() {
    await this.render('missions/edit', { mission: this.mission }, { title: `${this.mission.title} bearbeiten` })
  }

  async update() {
    const wasActive = this.mission.isActive
    if (await this.mission.update(this.params.mission)) {
      let notice = 'Änderungen gespeichert.'
      if (wasActive && !this.mission.isActive) notice = `„${this.mission.title}“ abgeschlossen.`
      if (!wasActive && this.mission.isActive) notice = `„${this.mission.title}“ wieder geöffnet.`
      return this.redirectTo(`/missions/${this.mission.id}`, { notice })
    }
    await this.render('missions/edit', { mission: this.mission }, { title: `${this.mission.title} bearbeiten` })
  }

  async destroy() {
    await this.mission.destroy()
    this.redirectTo('/', { notice: `„${this.mission.title}“ gelöscht.` })
  }
}

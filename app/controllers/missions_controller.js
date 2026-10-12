import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import Viewpoint from '/app/models/viewpoint.js'
import Setting from '/app/models/setting.js'
import platform from '/lib/platform/index.js'
import { syncFileNames } from '/app/services/file_namer.js'
import { completionOptions } from '/app/services/control_planner.js'

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
      upcoming: await Assignment.upcoming(),
      needsSetup: !Setting.isSet('general.operator_name'),
    }, { title: 'Einsätze' })
  }

  async show() {
    await this.renderShow(this.mission)
  }

  // Auch vom AssignmentsController genutzt (Fehler im Dialog "Neuer Auftrag")
  async renderShow(mission, { newAssignment = null, newAssignmentParams = {} } = {}) {
    // Wegpunkte zuordnen und Dateinamen nachziehen (auch für früher importierte Bilder)
    await Viewpoint.sync(mission.id)
    await syncFileNames(mission.id)

    const [open, done, timeline, counts] = await Promise.all([
      Assignment.open(mission.id),
      Assignment.done(mission.id),
      Assignment.timeline(mission.id),
      Assignment.mediaCounts(mission.id),
    ])
    for (const a of open) a.completion = await completionOptions(a)

    // Verlauf: alle Aufträge mit Bildern, die jüngsten zuerst
    const history = [...open, ...done]
      .filter((a) => timeline.has(a.id))
      .sort((a, b) => (timeline.get(b.id).last ?? '').localeCompare(timeline.get(a.id).last ?? ''))

    await this.render('missions/show', {
      mission,
      open,
      done,
      history,
      timeline,
      counts,
      canImport: platform.capabilities.media,
      newAssignment: newAssignment ?? new Assignment({ mission_id: mission.id }),
      newAssignmentParams,
      showNewAssignment: !!newAssignment,
    }, { title: mission.title })
  }

  async new() {
    await this.render('missions/new', { mission: new Mission() }, { title: 'Neuer Einsatz' })
  }

  // Jeder Einsatz beginnt mit dem Auftrag "Lageerkundung"
  async create() {
    const mission = new Mission(this.params.mission)
    if (await mission.save()) {
      await Assignment.create({ mission_id: mission.id, kind: 'initial', title: Assignment.KINDS.initial })
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

import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import Viewpoint from '/app/models/viewpoint.js'
import Setting from '/app/models/setting.js'
import platform, { trainingId } from '/lib/platform/index.js'
import { syncFileNames } from '/app/services/file_namer.js'
import { completionOptions } from '/app/services/control_planner.js'
import { hasDraft } from '/lib/drafts.js'
import { assignmentStates, cardSteps, missionProgress } from '/app/services/next_step.js'
import { missionSuggestion } from '/app/services/training.js'
import { flightStats } from '/app/services/flight_missions.js'

export default class MissionsController extends ApplicationController {
  async beforeAction() {
    if (['show', 'edit', 'update', 'destroy'].includes(this.action)) {
      this.mission = await Mission.find(this.params.id)
    }
  }

  async index() {
    // Started a "Neuer Einsatz"? → go back there (draft, see form_draft_controller)
    if (hasDraft('mission-new')) return this.redirectTo('/missions/new')
    const active = await Mission.active()
    const upcoming = await Assignment.upcoming()
    // Per active mission: where it stands (open assignments, next one, not yet provided)
    const status = new Map()
    const steps = new Map()
    for (const mission of active) {
      const assignments = await Assignment.forMission(mission.id)
      const states = await assignmentStates(assignments, await Assignment.mediaCounts(mission.id))
      const open = assignments.filter((a) => a.isOpen).sort((a, b) => a.effectiveDue - b.effectiveDue)
      status.set(mission.id, {
        open: open.length,
        next: open[0] ?? null,
        missing: open.reduce((n, a) => n + (states.get(a.id)?.missing ?? 0), 0), // like „Nächster Schritt“: open ones only
      })
      for (const a of assignments) steps.set(a.id, cardSteps(a, states.get(a.id)))
    }
    for (const a of upcoming) a.completion = await completionOptions(a)
    await this.render('missions/index', {
      active,
      archived: await Mission.archived(),
      upcoming,
      status,
      steps,
      needsSetup: !trainingId && !Setting.isSet('general.operator_name'), // training: own settings, no welcome
    }, { title: 'Einsätze' })
  }

  async show() {
    await this.renderShow(this.mission)
  }

  // Also used by AssignmentsController (errors in the "Neuer Auftrag" dialog)
  async renderShow(mission, { newAssignment = null, newAssignmentParams = {} } = {}) {
    // Assign viewpoints and update file names (also for previously imported images)
    await Viewpoint.sync(mission.id)
    await syncFileNames(mission.id)

    // Where does each assignment stand, and what is the one next step of the mission?
    const [{ open, done, counts, steps, nextStep }, timeline] = await Promise.all([
      missionProgress(mission),
      Assignment.timeline(mission.id),
    ])

    // History: all assignments with images, most recent first
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
      steps,
      nextStep,
      canImport: platform.capabilities.media,
      newAssignment: newAssignment ?? new Assignment({ mission_id: mission.id }),
      newAssignmentParams,
      showNewAssignment: !!newAssignment,
      flightStats: await flightStats(mission.id),
    }, { title: mission.title })
  }

  async new() {
    await this.render('missions/new', { mission: new Mission(), suggestion: missionSuggestion() }, { title: 'Neuer Einsatz' })
  }

  // Every mission starts with the "Lageerkundung" assignment
  async create() {
    const mission = new Mission(this.params.mission)
    if (await mission.save()) {
      await Assignment.create({ mission_id: mission.id, kind: 'initial', title: Assignment.KINDS.initial })
      return this.redirectTo(`/missions/${mission.id}`, { notice: `${mission.kindLabel} „${mission.title}“ angelegt.` })
    }
    await this.render('missions/new', { mission, suggestion: missionSuggestion() }, { title: 'Neuer Einsatz' })
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

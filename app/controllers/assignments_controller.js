import ApplicationController from '/app/controllers/application_controller.js'
import MissionsController from '/app/controllers/missions_controller.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import AssignmentSeries from '/app/models/assignment_series.js'
import MediaFile, { groupShots } from '/app/models/media_file.js'
import Viewpoint from '/app/models/viewpoint.js'
import platform from '/lib/platform/index.js'
import { syncFileNames } from '/app/services/file_namer.js'
import { toDate, parseLocal } from '/lib/time.js'
import { completionOptions, completeAssignment, revertCompletion } from '/app/services/control_planner.js'
import undo from '/lib/undo.js'

export default class AssignmentsController extends ApplicationController {
  async beforeAction() {
    this.mission = await Mission.find(this.params.mission_id)
    if (this.params.id) {
      this.assignment = await Assignment.findBy('id = ? AND mission_id = ?', [Number(this.params.id), this.mission.id])
      if (!this.assignment) await Assignment.find(-1) // → "Nicht gefunden"
    }
    this.returnTo = this.params.return_to?.startsWith('/') ? this.params.return_to : `/missions/${this.mission.id}`
  }

  // Auftrag mit seinen Bildern, chronologisch
  async show() {
    await Viewpoint.sync(this.mission.id)
    await syncFileNames(this.mission.id)
    const files = await MediaFile.where('assignment_id = ?', [this.assignment.id], { order: 'taken_at ASC, shot_key ASC, variant ASC' })
    const viewpointNames = new Map((await Viewpoint.forMission(this.mission.id)).map((v) => [v.id, v.name]))
    const variant = this.params.variant || null

    const shots = groupShots(files)
      .map((shot) => ({
        ...shot,
        forcedVariant: variant,
        viewpointName: viewpointNames.get(shot.files.find((f) => f.viewpoint_id)?.viewpoint_id),
      }))
      .filter((shot) => !variant || shot.byVariant[variant])

    await this.render('assignments/show', {
      mission: this.mission,
      assignment: this.assignment,
      shots,
      variant,
      variants: MediaFile.VARIANT_ORDER.filter((v) => files.some((f) => f.variant === v)),
      shotCount: groupShots(files).length,
      timeline: (await Assignment.timeline(this.mission.id)).get(this.assignment.id),
      canImport: platform.capabilities.media,
      completion: await completionOptions(this.assignment),
    }, { title: `${this.assignment.title} – ${this.mission.title}` })
  }

  // Neuer Auftrag (aus dem Dialog auf der Einsatzseite)
  async create() {
    const p = this.params.assignment ?? {}
    const dueAt = p.when === 'at' && p.time ? parseLocal(`${toDate()}T${p.time}`) : null

    if (p.kind === 'kontrolle') {
      const interval = Number(p.interval) || this.mission.control_interval_minutes || 30
      const assignment = await AssignmentSeries.start(this.mission.id, { intervalMinutes: interval, dueAt })
      this.recordCreate(assignment)
      return this.redirectTo(this.returnTo, { notice: `${assignment.title} geplant.`, undo: true })
    }

    const assignment = new Assignment({
      mission_id: this.mission.id,
      kind: p.kind,
      title: (p.title ?? '').trim() || (Assignment.NAMED_KINDS.includes(p.kind) ? '' : Assignment.KINDS[p.kind]),
      due_at: dueAt ? `${toDate(dueAt)}T${p.time}` : null,
      notes: p.notes,
    })
    if (await assignment.save()) {
      this.recordCreate(assignment)
      return this.redirectTo(this.returnTo, { notice: `Auftrag „${assignment.title}“ angelegt.`, undo: true })
    }
    // Fehler → Einsatzseite mit offenem Dialog
    const missions = new MissionsController({ ...this, action: 'show', params: { id: this.mission.id } })
    await missions.renderShow(this.mission, { newAssignment: assignment, newAssignmentParams: p })
  }

  // Erledigt. Bei Kontrollflügen: nächsten planen oder Serie beenden.
  // Erledigt. Bei Kontrollflügen: nächsten planen oder Serie beenden.
  async complete() {
    const id = this.assignment.id
    const next = this.params.next ?? {}
    let result = await completeAssignment(this.assignment, next)
    undo.record({
      label: `„${this.assignment.title}“ erledigt`,
      undo: () => revertCompletion(id, result),
      redo: async () => (result = await completeAssignment(await Assignment.find(id), next)),
    })
    this.redirectTo(this.returnTo, { notice: result.notice, undo: true })
  }

  async reopen() {
    const id = this.assignment.id
    await this.assignment.reopen()
    undo.record({
      label: `„${this.assignment.title}“ wieder geöffnet`,
      undo: async () => (await Assignment.find(id)).complete(),
      redo: async () => (await Assignment.find(id)).reopen(),
    })
    this.redirectTo(this.returnTo, { notice: `„${this.assignment.title}“ ist wieder offen.`, undo: true })
  }

  // Angelegter Auftrag → Widerrufen löscht ihn wieder (solange er keine Bilder hat)
  recordCreate(assignment) {
    const attrs = undo.snapshot(assignment)
    let id = assignment.id
    undo.record({
      label: `Auftrag „${assignment.title}“ angelegt`,
      undo: async () => {
        if (await MediaFile.count('assignment_id = ?', [id])) throw new Error('er hat inzwischen Bilder')
        await (await Assignment.find(id)).destroy()
      },
      redo: async () => (id = (await Assignment.create(attrs)).id),
    })
  }

  // Nur Aufträge ohne Bilder
  async destroy() {
    const files = await MediaFile.count('assignment_id = ?', [this.assignment.id])
    if (files) return this.redirectTo(this.returnTo, { alert: 'Aufträge mit Bildern können nicht gelöscht werden.' })
    const attrs = undo.snapshot(this.assignment)
    let id = this.assignment.id
    await this.assignment.destroy()
    undo.record({
      label: `Auftrag „${this.assignment.title}“ gelöscht`,
      undo: async () => (id = (await Assignment.create(attrs)).id),
      redo: async () => (await Assignment.find(id)).destroy(),
    })
    this.redirectTo(`/missions/${this.mission.id}`, { notice: `Auftrag „${this.assignment.title}“ gelöscht.`, undo: true })
  }
}

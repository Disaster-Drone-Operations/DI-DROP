import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import Setting from '/app/models/setting.js'
import platform from '/lib/platform/index.js'
import { TARGETS, availableTargets, assignmentFolderName } from '/app/services/upload_targets.js'
import { enqueue } from '/app/services/upload_queue.js'
import { chooseTarget, baseFor, resolveBase, providedKeys, pendingKeys, missingFor, categoryOf, entriesFor } from '/app/services/provisioning.js'

// "Alles bereitstellen": everything of a mission that is not yet at the chosen target, per assignment.
// Same queue and rules as for a single assignment (provisions_controller) – thermal images first.
const KINDS = { thermal: 'Wärmebilder', comparison: 'Vergleichsbilder', visible: 'Sichtbilder' }
const kindOf = (file) => (categoryOf(file) === 'thermal' ? 'thermal' : 'visible')

export default class MissionProvisionsController extends ApplicationController {
  async beforeAction() {
    this.mission = await Mission.find(this.params.id)
    this.path = `/missions/${this.mission.id}`
  }

  // Per assignment: what is missing at the target (neither provided nor on its way)
  async missing(targetKey) {
    const assignments = await Assignment.forMission(this.mission.id)
    const ids = assignments.map((a) => a.id)
    const skip = new Set([...(await providedKeys(ids, targetKey)), ...(await pendingKeys(ids, targetKey))])
    const rows = []
    for (const assignment of assignments) {
      const { files, comparisons } = await missingFor(assignment, skip)
      if (!files.length && !comparisons.length) continue
      const counts = { thermal: 0, comparison: comparisons.length, visible: 0 }
      for (const f of files) counts[kindOf(f)]++
      rows.push({ assignment, files, comparisons, counts, size: files.reduce((n, f) => n + (f.size ?? 0), 0) })
    }
    return rows
  }

  async new() {
    const targetKey = chooseTarget(this.params.target)
    const target = TARGETS[targetKey]
    await this.render('mission_provisions/new', {
      mission: this.mission,
      path: this.path,
      targets: availableTargets(),
      target,
      status: target ? await target.status() : null,
      base: target ? baseFor(targetKey, this.mission) : null,
      rows: target ? await this.missing(targetKey) : [],
      kinds: KINDS,
      canPickFolder: platform.capabilities.folders,
    }, { title: `Alles bereitstellen – ${this.mission.title}` })
  }

  async create() {
    const targetKey = chooseTarget(this.params.target)
    const target = TARGETS[targetKey]
    if (!target) return this.redirectTo(this.path, { alert: 'Bereitstellen ist hier nicht möglich.' })
    const { base, error } = await resolveBase(targetKey, this.mission, this.params.base)
    if (error) return this.redirectTo(`${this.path}/provide?target=${targetKey}`, { alert: error })

    const chosen = new Set(Object.keys(this.params.assignments ?? {}).map(Number))
    const kinds = new Set(Object.keys(this.params.kinds ?? {}))
    let total = 0
    for (const row of await this.missing(targetKey)) {
      if (!chosen.has(row.assignment.id)) continue
      const files = row.files.filter((f) => kinds.has(kindOf(f)))
      const comparisons = kinds.has('comparison') ? row.comparisons : []
      const entries = await entriesFor(files, comparisons)
      if (!entries.length) continue
      await enqueue({
        mission: this.mission,
        assignment: row.assignment,
        target: targetKey,
        destination: target.join(base, assignmentFolderName(row.assignment)),
        label: `${row.assignment.title} → ${target.label}`,
        entries,
      })
      total += entries.length
    }
    if (!total) return this.redirectTo(`${this.path}/provide?target=${targetKey}`, { alert: 'Nichts ausgewählt.' })
    await Setting.set('uploads.last_target', targetKey)
    this.redirectTo(this.path, { notice: `${total} ${total === 1 ? 'Bild wird' : 'Bilder werden'} bereitgestellt (${target.label}) – Wärmebilder zuerst. Fortschritt links unten.` })
  }
}

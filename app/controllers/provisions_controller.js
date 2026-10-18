import ApplicationController from '/app/controllers/application_controller.js'
import { db } from '/lib/db.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import MediaFile, { groupShots } from '/app/models/media_file.js'
import Comparison from '/app/models/comparison.js'
import Viewpoint from '/app/models/viewpoint.js'
import Setting from '/app/models/setting.js'
import UploadItem from '/app/models/upload_item.js'
import platform from '/lib/platform/index.js'
import { TARGETS, availableTargets, assignmentFolderName } from '/app/services/upload_targets.js'
import { enqueue, pendingBytes, rememberedSpeed } from '/app/services/upload_queue.js'

// Provisioning an assignment: select files and hand them to a target (Nextcloud, folder …).
// One target per run; for a second target simply provision again.
export default class ProvisionsController extends ApplicationController {
  async beforeAction() {
    this.mission = await Mission.find(this.params.mission_id)
    this.assignment = await Assignment.findBy('id = ? AND mission_id = ?', [Number(this.params.id), this.mission.id])
    if (!this.assignment) await Assignment.find(-1) // → "Nicht gefunden" (not found)
    this.path = `/missions/${this.mission.id}/assignments/${this.assignment.id}`
  }

  get targetKey() {
    const keys = availableTargets().map((t) => t.key)
    const wanted = this.params.target ?? Setting.get('uploads.last_target')
    return keys.includes(wanted) ? wanted : keys[0] ?? null
  }

  async new() {
    const targetKey = this.targetKey
    const target = TARGETS[targetKey]
    const files = await MediaFile.where('assignment_id = ?', [this.assignment.id], { order: 'taken_at ASC, shot_key ASC' })
    const names = new Map((await Viewpoint.forMission(this.mission.id)).map((v) => [v.id, v.name]))
    const shots = groupShots(files).map((shot) => ({
      ...shot,
      viewpointId: shot.files.find((f) => f.viewpoint_id)?.viewpoint_id ?? null,
      viewpointName: names.get(shot.files.find((f) => f.viewpoint_id)?.viewpoint_id) ?? null,
    }))
    const comparisons = await this.comparisons()
    for (const c of comparisons) await c.ensureThumbnail()
    const provided = target ? await this.providedKeys(targetKey) : new Set()
    const previous = await this.previousProvision()

    // Preselection: like the last control flight, otherwise everything – excluding already uploaded files
    const lastKey = (f) => `${f.viewpoint_id ?? ''}|${f.variant ?? ''}`
    const selected = new Set()
    for (const f of files) {
      if (provided.has(`m${f.id}`)) continue
      if (!previous || previous.keys.has(lastKey(f))) selected.add(`m${f.id}`)
    }
    for (const c of comparisons) if (!provided.has(`c${c.id}`)) selected.add(`c${c.id}`)

    await this.render('provisions/new', {
      mission: this.mission,
      assignment: this.assignment,
      path: this.path,
      targets: availableTargets(),
      target,
      status: target ? await target.status() : null,
      base: target ? this.baseFor(targetKey) : null,
      folderRoot: Setting.get('uploads.folder_path') ?? '',
      assignmentFolder: assignmentFolderName(this.assignment),
      shots,
      comparisons,
      provided,
      previous,
      lastKeys: previous?.keys ?? new Set(),
      selected,
      pending: target ? pendingBytes(targetKey) : 0,
      speed: target ? rememberedSpeed(targetKey) : null,
      canPickFolder: platform.capabilities.folders,
    }, { title: `Bereitstellen – ${this.assignment.title}` })
  }

  async create() {
    const targetKey = this.targetKey
    const target = TARGETS[targetKey]
    if (!target) return this.redirectTo(this.path, { alert: 'Bereitstellen ist hier nicht möglich.' })
    const selection = JSON.parse(this.params.selection || '{}')
    let base = (this.params.base ?? '').trim()

    if (targetKey === 'folder') {
      if (!base) return this.redirectTo(`${this.path}/provide?target=folder`, { alert: 'Bitte einen Zielordner wählen.' })
      await Setting.set('uploads.folder_path', base)
      base = target.join(base, this.mission.folderName)
    } else if (targetKey === 'nextcloud') {
      base = `/${base.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}`
      if (base === '/') return this.redirectTo(`${this.path}/provide?target=nextcloud`, { alert: 'Bitte einen Nextcloud-Ordner für den Einsatz wählen.' })
      if (base !== this.mission.nextcloud_path) await this.mission.update({ nextcloud_path: base })
    }
    const destination = target.join(base, assignmentFolderName(this.assignment))

    const fileIds = (selection.files ?? []).map(Number)
    const files = fileIds.length
      ? await MediaFile.where(`assignment_id = ? AND id IN (${fileIds.map(() => '?').join(',')})`, [this.assignment.id, ...fileIds], { order: 'taken_at ASC, id ASC' })
      : []
    const comparisonIds = new Set((selection.comparisons ?? []).map(Number))
    const comparisons = (await this.comparisons()).filter((c) => comparisonIds.has(c.id))

    const entries = [
      ...files.map((f) => ({
        media_file_id: f.id,
        category: UploadItem.categoryOf(f.variant),
        variant: f.variant,
        viewpoint_id: f.viewpoint_id,
        source_path: f.path,
        file_name: f.path.split(/[\\/]/).pop(),
        size: f.size ?? 0,
      })),
      ...(await Promise.all(comparisons.map(async (c) => ({
        comparison_id: c.id,
        category: 'comparison',
        variant: c.variant,
        viewpoint_id: c.viewpoint_id,
        source_path: c.path,
        file_name: c.fileName,
        size: await platform.readImage(c.path).then((b) => b.size).catch(() => 0),
      })))),
    ]
    if (!entries.length) return this.redirectTo(`${this.path}/provide?target=${targetKey}`, { alert: 'Keine Dateien ausgewählt.' })

    await enqueue({
      mission: this.mission,
      assignment: this.assignment,
      target: targetKey,
      destination,
      label: `${this.assignment.title} → ${target.label}`,
      entries,
    })
    await Setting.set('uploads.last_target', targetKey)
    this.redirectTo(this.path, { notice: `${entries.length} ${entries.length === 1 ? 'Datei wird' : 'Dateien werden'} bereitgestellt (${target.label}). Fortschritt links unten.` })
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  baseFor(targetKey) {
    if (targetKey === 'folder') return Setting.get('uploads.folder_path') ?? ''
    return TARGETS[targetKey].missionBase(this.mission)
  }

  // Comparison images of this assignment (stored in the assignment's folder)
  comparisons() {
    return Comparison.forAssignment(this.assignment)
  }

  // Already provisioned to this target: "m<id>" (image) or "c<id>" (comparison image)
  async providedKeys(targetKey) {
    const rows = await db.select(
      `SELECT media_file_id, comparison_id FROM upload_items WHERE assignment_id = ? AND target = ? AND status = 'done'`,
      [this.assignment.id, targetKey],
    )
    return new Set(rows.map((r) => (r.media_file_id ? `m${r.media_file_id}` : `c${r.comparison_id}`)))
  }

  // What was provisioned for the previous control flight (viewpoint + camera) – as a suggestion
  async previousProvision() {
    if (this.assignment.kind !== 'control') return null
    const rows = await db.select(
      `SELECT a.id, a.title, MAX(u.finished_at) AS at FROM assignments a
         JOIN upload_items u ON u.assignment_id = a.id AND u.status = 'done'
       WHERE a.mission_id = ? AND a.kind = 'control' AND a.id <> ? AND COALESCE(a.sequence, 0) < ?
       GROUP BY a.id ORDER BY a.sequence DESC LIMIT 1`,
      [this.mission.id, this.assignment.id, this.assignment.sequence ?? 1e9],
    )
    if (!rows.length) return null
    const items = await db.select(
      `SELECT DISTINCT viewpoint_id, variant, category FROM upload_items WHERE assignment_id = ? AND status = 'done'`,
      [rows[0].id],
    )
    const keys = new Set(items.filter((i) => i.category !== 'comparison').map((i) => `${i.viewpoint_id ?? ''}|${i.variant ?? ''}`))
    return {
      title: rows[0].title,
      at: rows[0].at,
      keys,
      viewpoints: new Set(items.map((i) => i.viewpoint_id).filter(Boolean)).size,
      comparisons: items.some((i) => i.category === 'comparison'),
    }
  }
}

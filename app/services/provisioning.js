// Shared parts of "Bereitstellen" (provisions_controller) and of the next step (next_step.js): what is
// already at a target or on its way, which base folder applies, and the entries for the upload queue
// (app/services/upload_queue.js).

import { db } from '/lib/db.js'
import Setting from '/app/models/setting.js'
import UploadItem from '/app/models/upload_item.js'
import { TARGETS, availableTargets } from '/app/services/upload_targets.js'
import Annotation from '/app/models/annotation.js'
import MediaFile from '/app/models/media_file.js'
import Comparison from '/app/models/comparison.js'
import { markedPath } from '/app/services/annotations.js'

// Key of an upload item: "m<id>" image, "c<id>" comparison image, "a<id>:<version>" marked copy (a changed
// marking is a new version → not provided yet)
const itemKey = (r) => (r.annotation_id ? `a${r.annotation_id}:${r.annotation_version}` : r.media_file_id ? `m${r.media_file_id}` : `c${r.comparison_id}`)
export const markedKey = (annotation) => `a${annotation.id}:${annotation.version}`

// Marked images and comparison images of these assignments → [{ annotation, source, key, comparison }]
export async function markedFor(assignments) {
  const ids = assignments.map((a) => a.id)
  if (!ids.length) return []
  const files = await db.select(
    `SELECT f.id FROM media_files f JOIN annotations a ON a.media_file_id = f.id WHERE f.assignment_id IN (${ids.map(() => '?').join(',')})`, ids)
  const comparisons = (await Promise.all(assignments.map((a) => Comparison.forAssignment(a)))).flat()
  const [byFile, byComparison] = await Promise.all([
    Annotation.byMediaFiles(files.map((f) => f.id)), Annotation.byComparisons(comparisons.map((c) => c.id)),
  ])
  const sources = files.length ? await MediaFile.where(`id IN (${files.map(() => '?').join(',')})`, files.map((f) => f.id), { order: 'taken_at ASC, id ASC' }) : []
  return [
    ...sources.map((f) => ({ annotation: byFile.get(f.id), source: f, comparison: false })),
    ...comparisons.filter((c) => byComparison.has(c.id)).map((c) => ({ annotation: byComparison.get(c.id), source: c, comparison: true })),
  ].map((m) => ({ ...m, key: markedKey(m.annotation) }))
}
// Target from the request or the last one used
export function chooseTarget(wanted) {
  const keys = availableTargets().map((t) => t.key)
  const key = wanted ?? Setting.get('uploads.last_target')
  return keys.includes(key) ? key : keys[0] ?? null
}

// Base folder shown in the form
export function baseFor(targetKey, mission) {
  if (targetKey === 'folder') return Setting.get('uploads.folder_path') ?? ''
  return TARGETS[targetKey].missionBase(mission)
}

// Base folder from the form → { base } or { error } (remembers it for the mission / the next export)
export async function resolveBase(targetKey, mission, raw) {
  const target = TARGETS[targetKey]
  let base = (raw ?? '').trim()
  if (targetKey === 'folder') {
    if (!base) return { error: 'Bitte einen Zielordner wählen.' }
    await Setting.set('uploads.folder_path', base)
    return { base: target.join(base, mission.folderName) }
  }
  if (targetKey === 'nextcloud') {
    base = `/${base.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}`
    if (base === '/') return { error: 'Bitte einen Nextcloud-Ordner für den Einsatz wählen.' }
    if (base !== mission.nextcloud_path) await mission.update({ nextcloud_path: base })
  }
  return { base }
}

// Already provided at this target (or any target, targetKey = null): Set of "m<id>" / "c<id>"
export async function providedKeys(assignmentIds, targetKey = null) {
  if (!assignmentIds.length) return new Set()
  const rows = await db.select(
    `SELECT media_file_id, comparison_id, annotation_id, annotation_version FROM upload_items
      WHERE assignment_id IN (${assignmentIds.map(() => '?').join(',')}) AND status = 'done'${targetKey ? ' AND target = ?' : ''}`,
    targetKey ? [...assignmentIds, targetKey] : assignmentIds,
  )
  return new Set(rows.map(itemKey))
}

// On its way (queued, running, paused, failed – will be retried): Set of "m<id>" / "c<id>"
export async function pendingKeys(assignmentIds, targetKey = null) {
  if (!assignmentIds.length) return new Set()
  const rows = await db.select(
    `SELECT media_file_id, comparison_id, annotation_id, annotation_version FROM upload_items
      WHERE assignment_id IN (${assignmentIds.map(() => '?').join(',')}) AND status NOT IN ('done', 'canceled')${targetKey ? ' AND target = ?' : ''}`,
    targetKey ? [...assignmentIds, targetKey] : assignmentIds,
  )
  return new Set(rows.map(itemKey))
}

// Queue entries for files + comparison images (+ marked copies: [{ annotation, source }] from markedFor)
export async function entriesFor(files, comparisons, marked = []) {
  return [
    ...marked.map(({ annotation, source }) => ({
      annotation_id: annotation.id,
      annotation_version: String(annotation.version),
      category: 'marked',
      variant: source.variant,
      viewpoint_id: source.viewpoint_id,
      source_path: markedPath(source.path),
      file_name: markedPath(source.path).split(/[\\/]/).pop(),
      size: annotation.marked_size ?? 0,
    })),
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
      size: await c.ensureSize(),
    })))),
  ]
}

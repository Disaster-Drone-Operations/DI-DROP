// Shared parts of "Bereitstellen" for one assignment (provisions_controller) and for a whole mission
// ("Alles bereitstellen", mission_provisions_controller): what is still missing at a target, which base
// folder applies, and the entries for the upload queue (app/services/upload_queue.js).

import { db } from '/lib/db.js'
import platform from '/lib/platform/index.js'
import MediaFile from '/app/models/media_file.js'
import Comparison from '/app/models/comparison.js'
import Setting from '/app/models/setting.js'
import UploadItem from '/app/models/upload_item.js'
import { TARGETS, availableTargets } from '/app/services/upload_targets.js'

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
    `SELECT media_file_id, comparison_id FROM upload_items
      WHERE assignment_id IN (${assignmentIds.map(() => '?').join(',')}) AND status = 'done'${targetKey ? ' AND target = ?' : ''}`,
    targetKey ? [...assignmentIds, targetKey] : assignmentIds,
  )
  return new Set(rows.map((r) => (r.media_file_id ? `m${r.media_file_id}` : `c${r.comparison_id}`)))
}

// On its way (queued, running, paused, failed – will be retried): Set of "m<id>" / "c<id>"
export async function pendingKeys(assignmentIds, targetKey = null) {
  if (!assignmentIds.length) return new Set()
  const rows = await db.select(
    `SELECT media_file_id, comparison_id FROM upload_items
      WHERE assignment_id IN (${assignmentIds.map(() => '?').join(',')}) AND status NOT IN ('done', 'canceled')${targetKey ? ' AND target = ?' : ''}`,
    targetKey ? [...assignmentIds, targetKey] : assignmentIds,
  )
  return new Set(rows.map((r) => (r.media_file_id ? `m${r.media_file_id}` : `c${r.comparison_id}`)))
}

// Files and comparison images of an assignment that are not yet provided (at the target).
// skip: provided (and/or pending) keys. Once some of its images were provided, the selection for that
// assignment counts as made (e.g. only thermal images of a control flight) – only comparison images
// created afterwards are still missing; more single images can be added on the assignment page.
export async function missingFor(assignment, skip) {
  const all = await MediaFile.where('assignment_id = ?', [assignment.id], { order: 'taken_at ASC, id ASC' })
  const selectionMade = all.some((f) => skip.has(`m${f.id}`))
  const files = selectionMade ? [] : all
  const comparisons = (await Comparison.forAssignment(assignment)).filter((c) => !skip.has(`c${c.id}`))
  return { files, comparisons }
}

// Category for the queue order (thermal → comparison → visible …)
export const categoryOf = (file) => UploadItem.categoryOf(file.variant)

// Queue entries for files + comparison images
export async function entriesFor(files, comparisons) {
  return [
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
}

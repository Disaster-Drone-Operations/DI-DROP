// Removing the imported images of an assignment completely – e.g. to try the same import again:
// copies (incl. "…_markiert" and comparison images containing them) go to the trash, and di-drop forgets them
// (images, markings, comparison images, provisioning history, viewpoints/flights left without images).
// Already provided files stay where they are (Nextcloud, USB stick); the originals on the memory card too.
//
//   const preview = await removalPreview(assignment)   → { files, shots, comparisons, provided, active }
//   const result = await removeAssignmentMedia(assignment) → { removed, trashed, skipped }

import platform from '/lib/platform/index.js'
import { db } from '/lib/db.js'
import MediaFile from '/app/models/media_file.js'
import Comparison from '/app/models/comparison.js'
import Annotation from '/app/models/annotation.js'
import { markedPath } from '/app/services/annotations.js'
import { forget } from '/app/services/upload_queue.js'
import { assignFlights } from '/app/services/flight_missions.js'
import { assignOperators } from '/app/services/flight_crew.js'

const placeholders = (list) => list.map(() => '?').join(',')

async function collect(assignment) {
  const files = await MediaFile.where('assignment_id = ?', [assignment.id])
  const ids = new Set(files.map((f) => f.id))
  // Comparison images with at least one of these images – and those stored in this assignment's folder
  const own = new Set((await Comparison.forAssignment(assignment)).map((c) => c.id))
  const comparisons = (await Comparison.forMission(assignment.mission_id)).filter((c) => {
    if (own.has(c.id)) return true
    try {
      return JSON.parse(c.media_file_ids || '[]').some((id) => ids.has(Number(id)))
    } catch {
      return false
    }
  })
  return { files, comparisons }
}

// What would be removed – for the confirmation; active = uploads still running/queued (then not possible)
export async function removalPreview(assignment) {
  const { files, comparisons } = await collect(assignment)
  const [row] = await db.select(
    `SELECT SUM(status = 'done') AS provided, SUM(status IN ('queued', 'running', 'paused', 'failed')) AS active
       FROM upload_items WHERE assignment_id = ?`, [assignment.id])
  return {
    files: files.length,
    shots: new Set(files.map((f) => `${f.flight_id}/${f.shot_key}`)).size,
    comparisons: comparisons.length,
    provided: Number(row?.provided ?? 0),
    active: Number(row?.active ?? 0),
  }
}

export async function removeAssignmentMedia(assignment) {
  const { files, comparisons } = await collect(assignment)
  const fileIds = files.map((f) => f.id)
  const comparisonIds = comparisons.map((c) => c.id)
  const [byFile, byComparison] = await Promise.all([Annotation.byMediaFiles(fileIds), Annotation.byComparisons(comparisonIds)])
  const annotationIds = [...byFile.values(), ...byComparison.values()].map((a) => a.id)

  // 1. Files to the trash – then empty assignment folders go too
  const paths = [
    ...files.map((f) => f.path),
    ...files.filter((f) => byFile.has(f.id)).map((f) => markedPath(f.path)),
    ...comparisons.map((c) => c.path),
    ...comparisons.filter((c) => byComparison.has(c.id)).map((c) => markedPath(c.path)),
  ]
  const dirs = [...new Set([assignment.media_dir, ...files.map((f) => f.path.replace(/[\\/][^\\/]*$/, ''))].filter(Boolean))]
  const report = paths.length ? await platform.media.trash(paths, dirs) : { trashed: [], skipped: [], removed_dirs: [] }

  // 2. Forget everything about them
  const uploads = await db.select(
    `SELECT id FROM upload_items WHERE assignment_id = ?
        OR media_file_id IN (${placeholders(fileIds) || 'NULL'}) OR comparison_id IN (${placeholders(comparisonIds) || 'NULL'})
        OR annotation_id IN (${placeholders(annotationIds) || 'NULL'})`,
    [assignment.id, ...fileIds, ...comparisonIds, ...annotationIds],
  )
  const uploadIds = uploads.map((u) => u.id)
  if (uploadIds.length) await db.execute(`DELETE FROM upload_items WHERE id IN (${placeholders(uploadIds)})`, uploadIds)
  forget(uploadIds)
  await db.execute('DELETE FROM upload_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM upload_items WHERE batch_id IS NOT NULL)')
  if (annotationIds.length) await db.execute(`DELETE FROM annotations WHERE id IN (${placeholders(annotationIds)})`, annotationIds)
  if (comparisonIds.length) await db.execute(`DELETE FROM comparisons WHERE id IN (${placeholders(comparisonIds)})`, comparisonIds)
  if (fileIds.length) await db.execute(`DELETE FROM media_files WHERE id IN (${placeholders(fileIds)})`, fileIds)
  // Viewpoints and (internal) flights of the mission that have no image left
  await db.execute(
    `DELETE FROM viewpoints WHERE mission_id = ? AND id NOT IN (SELECT DISTINCT viewpoint_id FROM media_files WHERE viewpoint_id IS NOT NULL)
       AND id NOT IN (SELECT DISTINCT viewpoint_id FROM comparisons WHERE viewpoint_id IS NOT NULL)`, [assignment.mission_id])
  await db.execute('DELETE FROM flights WHERE mission_id = ? AND id NOT IN (SELECT DISTINCT flight_id FROM media_files WHERE flight_id IS NOT NULL)',
    [assignment.mission_id])
  // The next import creates the folder anew (named after the time of its first image)
  await assignment.update({ media_dir: null })

  await assignFlights().catch((e) => console.warn('[remove] Flüge zuordnen', e)) // flight logs ↔ mission without these images
  await assignOperators(assignment.mission_id)
  return { removed: files.length, comparisons: comparisons.length, trashed: report.trashed.length, skipped: report.skipped }
}

// Provisioning status for assignments and images (icon + progress in overviews).
// Based on upload_items (including older, finished ones); running bytes come from the queue.

import { db } from '/lib/db.js'
import { progressOf } from '/app/services/upload_queue.js'

const placeholders = (list) => list.map(() => '?').join(',')

// rows: upload_items of an assignment or image → { state, percent, done, files }
//   state: none | queued | running | paused | failed | done
export function summarize(rows) {
  if (!rows.length) return { state: 'none', percent: 0, done: 0, files: 0 }
  const has = (status) => rows.some((r) => r.status === status)
  const total = rows.reduce((s, r) => s + (r.size || 0), 0)
  const done = rows.reduce((s, r) => s + (r.status === 'done' ? r.size || 0 : progressOf(r) || 0), 0)
  const state = has('running') ? 'running' : has('queued') ? 'queued' : has('failed') ? 'failed' : has('paused') ? 'paused' : 'done'
  return {
    state,
    percent: total ? Math.min(100, Math.round((done / total) * 100)) : 100,
    done: rows.filter((r) => r.status === 'done').length,
    files: rows.length,
  }
}

// All items for the given assignments/images (canceled ones don't count)
export async function load({ assignmentIds = [], fileIds = [] }) {
  if (!assignmentIds.length && !fileIds.length) return []
  const where = []
  const params = []
  if (assignmentIds.length) {
    where.push(`assignment_id IN (${placeholders(assignmentIds)})`)
    params.push(...assignmentIds)
  }
  if (fileIds.length) {
    where.push(`media_file_id IN (${placeholders(fileIds)})`)
    params.push(...fileIds)
  }
  return db.select(
    `SELECT id, assignment_id, media_file_id, status, size FROM upload_items WHERE status <> 'canceled' AND (${where.join(' OR ')})`,
    params,
  )
}

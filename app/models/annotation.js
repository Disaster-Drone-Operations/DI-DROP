import Record from '/lib/record.js'
import { db } from '/lib/db.js'

// Markings on an image (media_file_id) or a comparison image (comparison_id) – shapes see
// app/services/annotation_renderer.js; saving and the marked copy: app/services/annotations.js
export default class Annotation extends Record {
  static tableName = 'annotations'

  static attributes = {
    media_file_id: 'integer',
    comparison_id: 'integer',
    shapes: 'text',
    marked_size: 'integer',
    version: 'integer', // +1 per change (what was provided: upload_items.annotation_version)
  }

  get list() {
    try {
      return JSON.parse(this.shapes || '[]')
    } catch {
      return []
    }
  }

  static forMediaFile(id) {
    return this.findBy('media_file_id = ?', [id])
  }

  static forComparison(id) {
    return this.findBy('comparison_id = ?', [id])
  }

  // Map(media_file_id → annotation) for these images
  static async byMediaFiles(ids) {
    const map = new Map()
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400)
      if (!chunk.length) continue
      for (const a of await this.where(`media_file_id IN (${chunk.map(() => '?').join(',')})`, chunk)) map.set(a.media_file_id, a)
    }
    return map
  }

  static async byComparisons(ids) {
    if (!ids.length) return new Map()
    return new Map((await this.where(`comparison_id IN (${ids.map(() => '?').join(',')})`, ids)).map((a) => [a.comparison_id, a]))
  }

  // Ids of all marked images / comparison images
  static async markedIds() {
    const rows = await db.select('SELECT media_file_id, comparison_id FROM annotations')
    return {
      mediaFiles: new Set(rows.filter((r) => r.media_file_id).map((r) => Number(r.media_file_id))),
      comparisons: new Set(rows.filter((r) => r.comparison_id).map((r) => Number(r.comparison_id))),
    }
  }
}

import Record from '/lib/record.js'
import platform from '/lib/platform/index.js'

// A generated comparison image (for overview and later filing)
export default class Comparison extends Record {
  static tableName = 'comparisons'

  static attributes = {
    mission_id: 'integer',
    viewpoint_id: 'integer',
    variant: 'string',
    path: 'string',
    media_file_ids: 'text',
    thumb_path: 'string',
  }

  static forMission(missionId) {
    return this.where('mission_id = ?', [missionId], { order: 'id DESC' })
  }

  // Comparison images belong to the assignment whose folder they are stored in
  // (the folder of the newest shot, see comparison_renderer.js)
  static async forAssignment(assignment) {
    const dir = assignment.media_dir?.replace(/[\\/]+$/, '')
    if (!dir) return []
    return (await this.forMission(assignment.mission_id)).filter((c) => c.path.startsWith(`${dir}/`) || c.path.startsWith(`${dir}\\`))
  }

  // Create the thumbnail or catch up on it (older comparison images don't have one yet)
  async ensureThumbnail() {
    if (this.thumb_path || !platform.media?.thumbnail) return this.thumb_path
    try {
      await this.update({ thumb_path: await platform.media.thumbnail(this.path) })
    } catch (error) {
      console.warn('Thumbnail for comparison image missing:', error)
    }
    return this.thumb_path
  }

  get fileName() {
    return this.path.split(/[\\/]/).pop()
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'path')
  }
}

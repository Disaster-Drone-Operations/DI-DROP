import Record from '/lib/record.js'
import platform from '/lib/platform/index.js'

// Ein erzeugtes Vergleichsbild (für Übersicht und spätere Ablage)
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

  // Vorschaubild erzeugen bzw. nachholen (ältere Vergleichsbilder haben noch keins)
  async ensureThumbnail() {
    if (this.thumb_path || !platform.media?.thumbnail) return this.thumb_path
    try {
      await this.update({ thumb_path: await platform.media.thumbnail(this.path) })
    } catch (error) {
      console.warn('Vorschau für Vergleichsbild fehlt:', error)
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

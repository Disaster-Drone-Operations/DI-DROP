import Record from '/lib/record.js'

// Ein erzeugtes Vergleichsbild (für Übersicht und spätere Ablage)
export default class Comparison extends Record {
  static tableName = 'comparisons'

  static attributes = {
    mission_id: 'integer',
    viewpoint_id: 'integer',
    variant: 'string',
    path: 'string',
    media_file_ids: 'text',
  }

  static forMission(missionId) {
    return this.where('mission_id = ?', [missionId], { order: 'id DESC' })
  }

  get fileName() {
    return this.path.split(/[\\/]/).pop()
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'path')
  }
}

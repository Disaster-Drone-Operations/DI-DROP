import Record from '/lib/record.js'

// Ein Bereitstellungs-Vorgang: die ausgewählten Dateien eines Auftrags → ein Ziel
export default class UploadBatch extends Record {
  static tableName = 'upload_batches'

  static attributes = {
    mission_id: 'integer',
    assignment_id: 'integer',
    target: 'string',
    destination: 'string',
    label: 'string',
  }

  validate() {
    this.validatesPresenceOf('mission_id', 'target', 'destination')
  }
}

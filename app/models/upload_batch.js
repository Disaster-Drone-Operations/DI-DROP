import Record from '/lib/record.js'

// A provisioning run: the selected files of an assignment → one target
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

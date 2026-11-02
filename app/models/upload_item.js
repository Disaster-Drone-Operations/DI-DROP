import Record from '/lib/record.js'

// A file in the upload queue (control: app/services/upload_queue.js)
export default class UploadItem extends Record {
  static tableName = 'upload_items'

  static attributes = {
    batch_id: 'integer',
    mission_id: 'integer',
    assignment_id: 'integer',
    target: 'string',
    media_file_id: 'integer',
    comparison_id: 'integer',
    annotation_id: 'integer', // marked copy of an image/comparison image (with annotation_version)
    annotation_version: 'string',
    category: 'string',
    variant: 'string',
    viewpoint_id: 'integer',
    source_path: 'string',
    dest_path: 'string',
    size: 'integer',
    position: 'float',
    status: 'string',
    skipped: 'boolean',
    error: 'text',
    started_at: 'datetime',
    finished_at: 'datetime',
  }

  // Upload order: marked images were marked for a reason, thermal images are small and most important,
  // visible images large
  static CATEGORY_ORDER = ['marked', 'thermal', 'comparison', 'visible', 'other']
  static CATEGORY_LABELS = { marked: 'Markiertes Bild', thermal: 'Wärmebild', comparison: 'Vergleichsbild', visible: 'Sichtbild', other: 'Datei' }
  static ACTIVE = ['queued', 'running', 'paused', 'failed']

  static categoryOf(variant) {
    if (variant === 'T') return 'thermal'
    if (['V', 'W', 'Z'].includes(variant)) return 'visible'
    return 'other'
  }

  get fileName() {
    return this.dest_path.split(/[\\/]/).pop()
  }

  validate() {
    this.validatesPresenceOf('batch_id', 'mission_id', 'target', 'source_path', 'dest_path', 'status')
  }
}

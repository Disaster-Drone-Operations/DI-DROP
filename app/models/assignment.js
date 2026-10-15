import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { parseLocal } from '/lib/time.js'

// A task for the drone unit, e.g. "Lageerkundung", "Kontrollflug 3",
// "Bagger-Zufahrt prüfen". Belongs to a mission; its images come from one
// or more flights. One flight can serve several assignments.
export default class Assignment extends Record {
  static tableName = 'assignments'

  static attributes = {
    mission_id: 'integer',
    series_id: 'integer',
    sequence: 'integer',
    kind: 'string',
    title: 'string',
    status: 'string',
    due_at: 'datetime',
    completed_at: 'string',
    media_dir: 'string',
    notes: 'text',
  }

  static KINDS = {
    initial: 'Lageerkundung',
    special: 'Spezialauftrag',
    control: 'Kontrollflug',
    other: 'Sonstiges',
    mapping: 'Kartierung (Orthophoto)',
    position: 'Positionsaufnahme',
    area: 'Gebietszuordnung',
  }

  static DESCRIPTIONS = {
    initial: 'Erster Überblick über die Lage vor Ort',
    special: 'Einzelne Prüfung, z. B. „Kommt der Bagger über den Forstweg?“',
    control: 'Wiederkehrend: gleiche Stellen im festen Takt auf Veränderung prüfen',
    other: 'Alles andere, z. B. Live-Bild zur Lagebesprechung',
    mapping: 'Luftbild einer Fläche für eine Karte',
    position: 'Lage von Objekten oder Personen erfassen',
    area: 'Suchgebiete zuordnen',
  }

  // Common kinds first, the rest subtly behind
  static COMMON_KINDS = ['special', 'control', 'other']
  static MORE_KINDS = ['initial', 'mapping', 'position', 'area']

  // These kinds need their own title; the others are named after their kind
  static NAMED_KINDS = ['special', 'other', 'mapping', 'position', 'area']

  static STATUSES = { open: 'Offen', done: 'Erledigt' }

  static defaults() {
    return { status: 'open', kind: 'special' }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  static forMission(missionId) {
    return this.where('mission_id = ?', [missionId], { order: 'id ASC' })
  }

  // Open assignments, most due first ("sofort" counts from creation)
  static async open(missionId) {
    const list = await this.where('mission_id = ? AND status = ?', [missionId, 'open'])
    return list.sort((a, b) => a.effectiveDue - b.effectiveDue)
  }

  static done(missionId) {
    return this.where('mission_id = ? AND status = ?', [missionId, 'done'], { order: 'completed_at DESC' })
  }

  // Upcoming assignments of all active missions
  static async upcoming() {
    const list = await this.where(
      "status = 'open' AND mission_id IN (SELECT id FROM missions WHERE status = 'active')", [],
      { select: 'assignments.*, (SELECT title FROM missions WHERE missions.id = assignments.mission_id) AS mission_title' },
    )
    return list.sort((a, b) => a.effectiveDue - b.effectiveDue)
  }

  // Number of shots per assignment → Map(id → { shots, files })
  static async mediaCounts(missionId) {
    const rows = await db.select(
      `SELECT assignment_id, COUNT(*) AS files, COUNT(DISTINCT shot_key) AS shots
         FROM media_files WHERE mission_id = ? GROUP BY assignment_id`, [missionId])
    return new Map(rows.map((r) => [Number(r.assignment_id), { files: Number(r.files), shots: Number(r.shots) }]))
  }

  // History: per assignment the time span, number of shots and a few thumbnails (thermal preferred)
  // → Map(id → { first, last, shots, thumbs: [path] })
  static async timeline(missionId, { thumbs = 6 } = {}) {
    const rows = await db.select(
      `SELECT assignment_id, flight_id, shot_key, variant, thumb_path, taken_at
         FROM media_files WHERE mission_id = ? ORDER BY taken_at ASC`, [missionId])
    const map = new Map()
    for (const r of rows) {
      const id = Number(r.assignment_id)
      if (!map.has(id)) map.set(id, { first: r.taken_at, last: r.taken_at, shotKeys: new Map() })
      const entry = map.get(id)
      entry.last = r.taken_at ?? entry.last
      const key = `${r.flight_id}/${r.shot_key}`
      const current = entry.shotKeys.get(key)
      // Thermal beats everything else
      if (r.thumb_path && (!current || r.variant === 'T')) entry.shotKeys.set(key, r.thumb_path)
      else if (!current) entry.shotKeys.set(key, null)
    }
    for (const entry of map.values()) {
      entry.shots = entry.shotKeys.size
      entry.thumbs = [...entry.shotKeys.values()].filter(Boolean).slice(0, thumbs)
      delete entry.shotKeys
    }
    return map
  }

  // ── Validation ────────────────────────────────────────────────────────────

  validate() {
    this.validatesPresenceOf('mission_id', 'kind')
    this.validatesInclusionOf('kind', Object.keys(Assignment.KINDS))
    this.validatesInclusionOf('status', Object.keys(Assignment.STATUSES))
    if (!this.title) this.addError('title', Assignment.NAMED_KINDS.includes(this.kind) ? 'bitte angeben' : 'fehlt')
    if (this.due_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(this.due_at)) this.addError('due_at', 'ist keine gültige Uhrzeit')
  }

  // ── Properties ──────────────────────────────────────────────────────────

  get kindLabel() {
    return Assignment.KINDS[this.kind] ?? this.kind
  }

  get isOpen() {
    return this.status === 'open'
  }

  get dueAt() {
    return parseLocal(this.due_at)
  }

  // For sorting: scheduled time, otherwise time of creation ("sofort")
  get effectiveDue() {
    return this.dueAt ?? (this.created_at ? new Date(this.created_at) : new Date())
  }

  get isControl() {
    return this.kind === 'control'
  }

  // Which processing fits? (step 2 in the image module)
  get processing() {
    return { control: 'comparison', mapping: 'orthophoto' }[this.kind] ?? 'situation'
  }

  // Start of work = first shot (basis for "30 Min. nach Start")
  async startedAt() {
    const [row] = await db.select('SELECT MIN(taken_at) AS t FROM media_files WHERE assignment_id = ?', [this.id])
    return parseLocal(row?.t ?? null)
  }

  async complete() {
    return this.update({ status: 'done', completed_at: new Date().toISOString() })
  }

  async reopen() {
    return this.update({ status: 'open', completed_at: null })
  }
}

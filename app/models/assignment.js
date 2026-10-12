import Record from '/lib/record.js'
import { db } from '/lib/db.js'
import { parseLocal } from '/lib/time.js'

// Ein Auftrag an die Drohnengruppe, z. B. "Lageerkundung", "Kontrollflug 3",
// "Bagger-Zufahrt prüfen". Gehört zum Einsatz; die Bilder dazu kommen aus einem
// oder mehreren Flügen. Ein Flug kann mehrere Aufträge bedienen.
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
    spezial: 'Spezialauftrag',
    kontrolle: 'Kontrollflug',
    sonstiges: 'Sonstiges',
    kartierung: 'Kartierung (Orthophoto)',
    position: 'Positionsaufnahme',
    gebiet: 'Gebietszuordnung',
  }

  static DESCRIPTIONS = {
    initial: 'Erster Überblick über die Lage vor Ort',
    spezial: 'Einzelne Prüfung, z. B. „Kommt der Bagger über den Forstweg?“',
    kontrolle: 'Wiederkehrend: gleiche Stellen im festen Takt auf Veränderung prüfen',
    sonstiges: 'Alles andere, z. B. Live-Bild zur Lagebesprechung',
    kartierung: 'Luftbild einer Fläche für eine Karte',
    position: 'Lage von Objekten oder Personen erfassen',
    gebiet: 'Suchgebiete zuordnen',
  }

  // Häufige Arten zuerst, der Rest dezent dahinter
  static COMMON_KINDS = ['spezial', 'kontrolle', 'sonstiges']
  static MORE_KINDS = ['initial', 'kartierung', 'position', 'gebiet']

  // Diese Arten brauchen einen eigenen Namen; die anderen heißen wie ihre Art
  static NAMED_KINDS = ['spezial', 'sonstiges', 'kartierung', 'position', 'gebiet']

  static STATUSES = { offen: 'Offen', erledigt: 'Erledigt' }

  static defaults() {
    return { status: 'offen', kind: 'spezial' }
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  static forMission(missionId) {
    return this.where('mission_id = ?', [missionId], { order: 'id ASC' })
  }

  // Offene Aufträge, die fälligsten zuerst ("sofort" zählt ab dem Anlegen)
  static async open(missionId) {
    const list = await this.where('mission_id = ? AND status = ?', [missionId, 'offen'])
    return list.sort((a, b) => a.effectiveDue - b.effectiveDue)
  }

  static done(missionId) {
    return this.where('mission_id = ? AND status = ?', [missionId, 'erledigt'], { order: 'completed_at DESC' })
  }

  // Anstehende Aufträge aller aktiven Einsätze
  static async upcoming() {
    const list = await this.where(
      "status = 'offen' AND mission_id IN (SELECT id FROM missions WHERE status = 'aktiv')", [],
      { select: 'assignments.*, (SELECT title FROM missions WHERE missions.id = assignments.mission_id) AS mission_title' },
    )
    return list.sort((a, b) => a.effectiveDue - b.effectiveDue)
  }

  // Zahl der Aufnahmen je Auftrag → Map(id → { shots, files })
  static async mediaCounts(missionId) {
    const rows = await db.select(
      `SELECT assignment_id, COUNT(*) AS files, COUNT(DISTINCT shot_key) AS shots
         FROM media_files WHERE mission_id = ? GROUP BY assignment_id`, [missionId])
    return new Map(rows.map((r) => [Number(r.assignment_id), { files: Number(r.files), shots: Number(r.shots) }]))
  }

  // Verlauf: je Auftrag Zeitraum, Anzahl Aufnahmen und einige Vorschaubilder (Wärmebild bevorzugt)
  // → Map(id → { first, last, shots, thumbs: [Pfad] })
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
      // Wärmebild schlägt alles andere
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

  // ── Validierung ────────────────────────────────────────────────────────────

  validate() {
    this.validatesPresenceOf('mission_id', 'kind')
    this.validatesInclusionOf('kind', Object.keys(Assignment.KINDS))
    this.validatesInclusionOf('status', Object.keys(Assignment.STATUSES))
    if (!this.title) this.addError('title', Assignment.NAMED_KINDS.includes(this.kind) ? 'bitte angeben' : 'fehlt')
    if (this.due_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(this.due_at)) this.addError('due_at', 'ist keine gültige Uhrzeit')
  }

  // ── Eigenschaften ──────────────────────────────────────────────────────────

  get kindLabel() {
    return Assignment.KINDS[this.kind] ?? this.kind
  }

  get isOpen() {
    return this.status === 'offen'
  }

  get dueAt() {
    return parseLocal(this.due_at)
  }

  // Für die Sortierung: geplante Zeit, sonst Zeitpunkt des Anlegens ("sofort")
  get effectiveDue() {
    return this.dueAt ?? (this.created_at ? new Date(this.created_at) : new Date())
  }

  get isControl() {
    return this.kind === 'kontrolle'
  }

  // Welche Bearbeitung passt? (Schritt 2 im Bildmodul)
  get processing() {
    return { kontrolle: 'vergleich', kartierung: 'orthophoto' }[this.kind] ?? 'lagebild'
  }

  // Beginn der Arbeit = erste Aufnahme (Grundlage für "30 Min. nach Start")
  async startedAt() {
    const [row] = await db.select('SELECT MIN(taken_at) AS t FROM media_files WHERE assignment_id = ?', [this.id])
    return parseLocal(row?.t ?? null)
  }

  async complete() {
    return this.update({ status: 'erledigt', completed_at: new Date().toISOString() })
  }

  async reopen() {
    return this.update({ status: 'offen', completed_at: null })
  }
}

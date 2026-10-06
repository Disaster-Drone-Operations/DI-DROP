// Minimaler ActiveRecord-Ersatz.
//
//   class Mission extends Record {
//     static tableName = 'missions'
//     static attributes = { title: 'string', date: 'date', interval: 'integer' }
//     validate() { this.validatesPresenceOf('title') }
//   }
//
//   await Mission.find(1)
//   await Mission.where('status = ?', ['aktiv'], { order: 'date DESC' })
//   const m = new Mission(params.mission); await m.save()  // → true/false, m.errors

import { db } from '/lib/db.js'

export class RecordNotFound extends Error {}

const casts = {
  string: (v) => (v == null || String(v).trim() === '' ? null : String(v).trim()),
  text: (v) => (v == null || String(v).trim() === '' ? null : String(v).replace(/\s+$/, '')),
  date: (v) => (v == null || v === '' ? null : String(v)),
  datetime: (v) => (v == null || v === '' ? null : String(v)),
  integer: (v) => {
    if (v == null || v === '') return null
    const n = Number.parseInt(v, 10)
    return Number.isNaN(n) ? null : n
  },
  boolean: (v) => v === true || v === 1 || v === '1' || v === 'true',
}

export class Record {
  static tableName = null
  static attributes = {}

  // Standardwerte für neue Datensätze (kann überschrieben werden)
  static defaults() {
    return {}
  }

  // ── Abfragen ─────────────────────────────────────────────────────────────

  static async where(clause = '1 = 1', params = [], { order = 'id DESC', select = '*', limit } = {}) {
    let sql = `SELECT ${select} FROM ${this.tableName} WHERE ${clause} ORDER BY ${order}`
    if (limit) sql += ` LIMIT ${Number(limit)}`
    const rows = await db.select(sql, params)
    return rows.map((row) => this.instantiate(row))
  }

  static all(options) {
    return this.where(undefined, [], options)
  }

  static async findBy(clause, params = [], options = {}) {
    const [record] = await this.where(clause, params, { ...options, limit: 1 })
    return record ?? null
  }

  static async find(id) {
    const record = await this.findBy('id = ?', [Number(id)])
    if (!record) throw new RecordNotFound(`${this.name} mit id=${id} nicht gefunden`)
    return record
  }

  static async count(clause = '1 = 1', params = []) {
    const [row] = await db.select(`SELECT COUNT(*) AS n FROM ${this.tableName} WHERE ${clause}`, params)
    return Number(row?.n ?? 0)
  }

  static instantiate(row) {
    const record = new this()
    Object.assign(record, row)
    record.persisted = true
    return record
  }

  static async create(attrs) {
    const record = new this(attrs)
    await record.save()
    return record
  }

  // ── Instanz ──────────────────────────────────────────────────────────────

  constructor(attrs = {}) {
    this.id = null
    this.persisted = false
    this.errors = {}
    this.assign({ ...this.constructor.defaults(), ...attrs })
  }

  get isNewRecord() {
    return !this.persisted
  }

  // Nur deklarierte Attribute übernehmen (wie strong parameters)
  assign(attrs = {}) {
    for (const [name, type] of Object.entries(this.constructor.attributes)) {
      if (name in attrs) this[name] = casts[type](attrs[name])
      else if (!(name in this)) this[name] = null
    }
    return this
  }

  // ── Validierung ──────────────────────────────────────────────────────────

  validate() {}

  addError(attr, message) {
    ;(this.errors[attr] ||= []).push(message)
  }

  validatesPresenceOf(...attrs) {
    for (const attr of attrs) {
      if (this[attr] == null || this[attr] === '') this.addError(attr, 'darf nicht leer sein')
    }
  }

  validatesInclusionOf(attr, list) {
    if (this[attr] != null && !list.includes(this[attr])) this.addError(attr, 'ist kein gültiger Wert')
  }

  get isValid() {
    this.errors = {}
    this.validate()
    return Object.keys(this.errors).length === 0
  }

  // ── Persistenz ───────────────────────────────────────────────────────────

  async beforeSave() {}

  async save() {
    if (!this.isValid) return false
    await this.beforeSave()

    const now = new Date().toISOString()
    const columns = Object.keys(this.constructor.attributes)
    const table = this.constructor.tableName

    if (this.isNewRecord) {
      const cols = [...columns, 'created_at', 'updated_at']
      const values = [...columns.map((c) => this[c]), now, now]
      const result = await db.execute(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        values,
      )
      this.id = Number(result.lastInsertId)
      this.created_at = now
      this.persisted = true
    } else {
      const sets = [...columns, 'updated_at'].map((c) => `${c} = ?`).join(', ')
      await db.execute(`UPDATE ${table} SET ${sets} WHERE id = ?`, [...columns.map((c) => this[c]), now, this.id])
    }
    this.updated_at = now
    return true
  }

  async update(attrs) {
    this.assign(attrs)
    return this.save()
  }

  async destroy() {
    await db.execute(`DELETE FROM ${this.constructor.tableName} WHERE id = ?`, [this.id])
    this.persisted = false
  }
}

export default Record

// Key/Value-Einstellungen. Alle Werte werden beim Start einmal geladen und
// liegen danach im Speicher – Setting.get() ist deshalb synchron.

import { db } from '/lib/db.js'
import schema from '/config/settings.js'

const cache = new Map()

export default class Setting {
  static schema = schema

  static async load() {
    cache.clear()
    for (const row of await db.select('SELECT key, value FROM settings')) {
      cache.set(row.key, JSON.parse(row.value))
    }
  }

  static section(key) {
    return schema.find((s) => s.key === key) ?? null
  }

  static field(fullKey) {
    const [sectionKey, fieldKey] = fullKey.split('.')
    return this.section(sectionKey)?.fields.find((f) => f.key === fieldKey) ?? null
  }

  static get(fullKey) {
    if (cache.has(fullKey)) return cache.get(fullKey)
    return this.field(fullKey)?.default ?? null
  }

  static isSet(fullKey) {
    const value = this.get(fullKey)
    return value != null && String(value).trim() !== ''
  }

  static async set(fullKey, value) {
    const json = JSON.stringify(value)
    await db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [fullKey, json, new Date().toISOString()],
    )
    cache.set(fullKey, value)
  }

  // Speichert alle Felder einer Rubrik; liefert { feld: [fehler] }
  static async updateSection(sectionKey, values = {}) {
    const section = this.section(sectionKey)
    const errors = {}
    const clean = {}

    for (const field of section.fields) {
      let value = (values[field.key] ?? '').toString().trim()
      if (field.type === 'url' && value && !/^https?:\/\/\S+$/i.test(value)) {
        ;(errors[field.key] ||= []).push('muss mit http:// oder https:// beginnen')
      }
      if (field.type === 'number' && value && Number.isNaN(Number(value))) {
        ;(errors[field.key] ||= []).push('muss eine Zahl sein')
      }
      if (field.type === 'select' && value && !field.options.some(([v]) => v === value)) {
        ;(errors[field.key] ||= []).push('ist kein gültiger Wert')
      }
      clean[field.key] = value
    }

    if (Object.keys(errors).length) return errors
    for (const [key, value] of Object.entries(clean)) await this.set(`${sectionKey}.${key}`, value)
    return null
  }
}

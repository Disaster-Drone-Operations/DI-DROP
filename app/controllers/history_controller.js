import ApplicationController from '/app/controllers/application_controller.js'
import platform from '/lib/platform/index.js'
import { current, deviceChoices, choose, proposals, apply } from '/app/services/history_import.js'

// "Ältere Einsätze nachtragen": proposals from image folders (scanned by history_import_controller.js)
// and from flight logs without a mission – decide per row, then create (app/services/history_import.js)
export default class HistoryController extends ApplicationController {
  async index() {
    await this.renderIndex()
  }

  // values/errors: the submitted rows again (by key) after a missing choice
  async renderIndex({ values = {}, errors = new Set() } = {}) {
    const scan = current()
    const devices = scan ? await deviceChoices() : []
    const { proposals: rows, undated } = await proposals()
    await this.render('history/index', {
      scan,
      devices,
      rows,
      undated,
      values,
      errors,
      canPick: platform.capabilities.media,
    }, { title: 'Ältere Einsätze nachtragen' })
  }

  // Which drones/cameras count – changing it groups the images anew
  async devices() {
    choose(Object.values(this.params.devices ?? {}).filter((key) => key && key !== '0'))
    this.redirectTo('/missions/history')
  }

  async create() {
    const rows = Object.entries(this.params.rows ?? {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, r]) => ({ key: r.key, title: (r.title ?? '').trim(), kind: r.kind || null, action: r.action, merge: r.merge === '1' }))
    // The first row of a (merged) mission decides; missions need a kind and a title
    const errors = new Set()
    for (const r of rows) if (!r.merge && r.action === 'create' && (!r.kind || !r.title)) errors.add(r.key)
    if (errors.size) {
      this.flash = { alert: 'Bitte bei jeder Zeile mit „Anlegen“ Titel und Art (Einsatz oder Übung) angeben.' }
      return this.renderIndex({ values: Object.fromEntries(rows.map((r) => [r.key, r])), errors })
    }

    const progress = (detail) => window.dispatchEvent(new CustomEvent('history:progress', { detail }))
    const result = await apply(rows, progress)
    const parts = []
    if (result.created.length) parts.push(`${result.created.length} ${result.created.length === 1 ? 'Einsatz' : 'Einsätze'} nachgetragen`)
    if (result.added.length) parts.push(`${result.added.length} ergänzt`)
    if (result.none) parts.push(`${result.none} ${result.none === 1 ? 'Flug' : 'Flüge'} ohne Einsatz`)
    const flash = result.failed.length
      ? { alert: `Nicht angelegt: ${result.failed.map((f) => `„${f.title}“ (${f.error})`).join('; ')}` }
      : { notice: parts.length ? `${parts.join(', ')}. Besetzung und weitere Angaben jetzt im jeweiligen Einsatz ergänzen.` : 'Nichts ausgewählt.' }
    const { proposals: rest } = await proposals()
    this.redirectTo(rest.length ? '/missions/history' : '/', flash)
  }
}

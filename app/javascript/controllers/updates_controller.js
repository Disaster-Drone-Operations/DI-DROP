import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import updates from '/app/services/updates.js'

// Einstellungen → Aktualisierungen: Liste mit Stand und Knopf je Eintrag
export default class extends Controller {
  connect() {
    this.states = Object.fromEntries(updates.map((u) => [u.key, {}]))
    this.paint()
    updates.forEach(async (u) => {
      const status = await u.status().catch(() => null)
      this.update(u.key, { status })
    })
  }

  update(key, changes) {
    Object.assign(this.states[key], changes)
    this.paint()
  }

  paint() {
    morph(this.element, updates.map((item) => render('settings/_update_item', { item, state: this.states[item.key] })).join(''))
  }

  async run({ params: { key } }) {
    const item = updates.find((u) => u.key === key)
    this.update(key, { busy: true, error: null, done: false })
    try {
      this.update(key, { busy: false, done: true, status: await item.run() })
    } catch (error) {
      this.update(key, { busy: false, error: String(error?.message ?? error) })
    }
  }
}

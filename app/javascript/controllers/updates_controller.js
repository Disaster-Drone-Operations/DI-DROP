import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import updates from '/app/services/updates.js'

// Settings → updates: list with status and a button per entry
export default class extends Controller {
  connect() {
    this.states = Object.fromEntries(updates.map((u) => [u.key, {}]))
    this.paint()
    updates.forEach(async (u) => {
      const status = await u.status().catch(() => null)
      if (!this.states[u.key].busy) this.update(u.key, { status })
    })
    // From the menu „Nach Updates suchen …“ or after „Installieren“ at startup
    if (/[?&](check|install)=1/.test(location.hash) && updates.find((u) => u.key === 'app')?.available()) {
      this.run({ params: { key: 'app' } })
    }
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
    this.update(key, { busy: true, error: null, done: false, status: null })
    try {
      const report = (status) => this.update(key, { status })
      this.update(key, { busy: false, done: true, status: await item.run(report) })
    } catch (error) {
      this.update(key, { busy: false, error: String(error?.message ?? error) })
    }
  }
}

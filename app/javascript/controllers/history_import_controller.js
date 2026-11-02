import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { scanFolder } from '/app/services/history_import.js'

// "Ältere Einsätze nachtragen": choose a folder, scan it with progress, then show the proposals
export default class extends Controller {
  static targets = ['pick', 'progress']

  async pick() {
    const root = await platform.pickFolder({ title: 'Ordner mit alten Drohnenbildern wählen (Unterordner werden mit durchsucht)' })
    if (!root) return
    this.pickTarget.disabled = true
    this.progressTarget.hidden = false
    try {
      await scanFolder(root, ({ done, total }) => this.showProgress(done, total))
      document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: '/missions/history' } }))
    } catch (error) {
      this.progressTarget.hidden = true
      this.pickTarget.disabled = false
      platform.confirm(`Der Ordner konnte nicht durchsucht werden:\n${error?.message ?? error}`, { okLabel: 'OK' })
    }
  }

  showProgress(done, total) {
    const n = (v) => v.toLocaleString('de-DE')
    this.progressTarget.innerHTML = `<progress class="progress" max="${total || 1}" value="${done}"></progress>
      <p class="subtle">${total ? `${n(done)} von ${n(total)} Dateien durchsucht …` : 'Suche Bilder …'}</p>`
  }

  // Device checkboxes: regroup right away
  submit(event) {
    event.currentTarget.requestSubmit()
  }
}

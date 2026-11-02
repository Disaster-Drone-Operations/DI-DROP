import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { scanFolder } from '/app/services/history_import.js'

// "Ältere Einsätze nachtragen": choose a folder, scan it with progress, then show the proposals
export default class extends Controller {
  static targets = ['pick', 'progress']

  // Creating the missions (history_controller#create) reports its progress here
  connect() {
    this.onProgress = ({ detail: { done, total, title } }) => {
      this.progressTarget.hidden = false
      this.showProgress(done, total, title ? `„${title}“: Bilder kopieren …` : null)
      if (done === 0) this.progressTarget.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('history:progress', this.onProgress)
  }

  disconnect() {
    window.removeEventListener('history:progress', this.onProgress)
  }

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

  showProgress(done, total, label = null) {
    const n = (v) => v.toLocaleString('de-DE')
    const text = label ? `${label} ${n(done)} von ${n(total)} Dateien` : total ? `${n(done)} von ${n(total)} Dateien durchsucht …` : 'Suche Bilder …'
    this.progressTarget.innerHTML = `<progress class="progress" max="${total || 1}" value="${done}"></progress><p class="subtle"></p>`
    this.progressTarget.querySelector('p').textContent = text
  }

  // Device checkboxes: regroup right away
  submit(event) {
    event.currentTarget.requestSubmit()
  }
}

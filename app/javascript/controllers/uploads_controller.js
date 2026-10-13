import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'
import * as queue from '/app/services/upload_queue.js'

// Seite "Uploads": alle Dateien der Warteschlange mit Fortschritt und Steuerung
export default class extends Controller {
  connect() {
    this.onChange = () => this.paint()
    window.addEventListener('uploads:changed', this.onChange)
    this.timer = setInterval(this.onChange, 1000)
    this.paint()
  }

  disconnect() {
    window.removeEventListener('uploads:changed', this.onChange)
    clearInterval(this.timer)
  }

  paint() {
    const { active, finished, batches, retries } = queue.list()
    morph(this.element, render('uploads/_list', { s: queue.summary(), active, finished, batches, retries, progressOf: queue.progressOf }))
  }

  pause({ params: { id } }) { queue.pause(id) }
  resume({ params: { id } }) { queue.resume(id) }
  toFront({ params: { id } }) { queue.moveToFront(id) }
  toEnd({ params: { id } }) { queue.moveToEnd(id) }
  pauseAll() { queue.pauseAll() }
  resumeAll() { queue.resumeAll() }
  retryFailed() { queue.retryFailed() }
  clearFinished() { queue.clearFinished() }

  async cancel({ params: { id } }) {
    if (await platform.confirm('Diesen Upload abbrechen? Die Datei wird dann nicht bereitgestellt.', { okLabel: 'Abbrechen', cancelLabel: 'Weiter hochladen' })) queue.cancel(id)
  }
}

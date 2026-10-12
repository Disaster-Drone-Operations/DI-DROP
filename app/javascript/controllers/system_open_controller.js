import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Dateien mit dem Standardprogramm öffnen (Vorschau, Fotos …) oder im Finder/Explorer zeigen
//   <button data-action="system-open#open" data-system-open-path-param="/pfad/bild.jpg">
export default class extends Controller {
  open({ params }) {
    platform.openPath(params.path).catch((e) => this.fail(e))
  }

  reveal({ params }) {
    platform.revealPath(params.path).catch((e) => this.fail(e))
  }

  fail(error) {
    console.error(error)
    platform.confirm(`Konnte nicht geöffnet werden:\n${error}`, { okLabel: 'OK' })
  }
}

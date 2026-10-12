import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Vorschau-Karte einer Aufnahme: Wärme/Sicht umschalten, Klick aufs Bild öffnet die Galerie
// mit allen Aufnahmen der Seite (in der Reihenfolge, in der sie angezeigt werden).
export default class extends Controller {
  static targets = ['image', 'chip']
  static values = { data: Object, variant: String }

  connect() {
    // Umbenannter Wegpunkt → auch in den Galerie-Daten dieser Aufnahme
    this.renamed = ({ detail }) => {
      if (this.dataValue.viewpointId === detail.id) this.dataValue = { ...this.dataValue, viewpointName: detail.name }
    }
    window.addEventListener('viewpoint:renamed', this.renamed)
    // Datei umbenannt → neuen Pfad übernehmen (für Galerie, "Im Ordner zeigen")
    this.moved = ({ detail }) => {
      const map = new Map(detail.changes.map((c) => [c.from, c.to]))
      const files = Object.fromEntries(Object.entries(this.dataValue.files).map(([v, f]) => [v, map.has(f.path) ? { ...f, path: map.get(f.path) } : f]))
      this.dataValue = { ...this.dataValue, files }
    }
    window.addEventListener('media:renamed', this.moved)
  }

  disconnect() {
    window.removeEventListener('viewpoint:renamed', this.renamed)
    window.removeEventListener('media:renamed', this.moved)
  }

  show({ params }) {
    const file = this.dataValue.files[params.variant]
    if (!file) return
    this.variantValue = params.variant
    if (this.hasImageTarget && file.thumb) this.imageTarget.src = file.thumb
    this.chipTargets.forEach((c) => c.classList.toggle('is-active', c.dataset.variant === params.variant))
  }

  open() {
    const file = this.dataValue.files[this.variantValue]
    if (file?.video) return platform.openPath(file.path) // Videos im Systemprogramm

    const shots = [...document.querySelectorAll('[data-controller~="shot"]')]
    const items = shots.map((el) => this.application.getControllerForElementAndIdentifier(el, 'shot')?.dataValue).filter(Boolean)
    window.dispatchEvent(new CustomEvent('gallery:open', {
      detail: { items, index: shots.indexOf(this.element), variant: this.variantValue },
    }))
  }

  reveal() {
    const file = this.dataValue.files[this.variantValue] ?? Object.values(this.dataValue.files)[0]
    platform.revealPath(file.path).catch((e) => console.error(e))
  }
}

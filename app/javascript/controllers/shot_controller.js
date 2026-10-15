import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Preview card of a shot: toggle thermal/visual, clicking the image opens the gallery
// with all shots on the page (in the order they are displayed).
export default class extends Controller {
  static targets = ['image', 'chip']
  static values = { data: Object, variant: String }

  connect() {
    // Renamed viewpoint → also in this shot's gallery data
    this.renamed = ({ detail }) => {
      if (this.dataValue.viewpointId === detail.id) this.dataValue = { ...this.dataValue, viewpointName: detail.name }
    }
    window.addEventListener('viewpoint:renamed', this.renamed)
    // File renamed → take over the new path (for gallery, "Im Ordner zeigen")
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
    if (file?.video) return platform.openPath(file.path) // videos in the system app

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

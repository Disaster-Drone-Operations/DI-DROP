import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { isVariantSpace } from '/lib/keys.js'
import { toggledVariant } from '/app/helpers/media_helper.js'
import { drawOnThumbnail } from '/app/services/annotation_renderer.js'

// Preview card of a shot: toggle thermal/visual (chips, or space for all images of the page),
// clicking the image opens the gallery with all shots on the page (in the order they are displayed).
export default class extends Controller {
  static targets = ['image', 'chip', 'marked', 'marks']
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
    // Markings drawn over the thumbnail – redrawn when the card changes size
    if (this.hasMarksTarget) {
      this.resize = new ResizeObserver(() => this.drawMarks())
      this.resize.observe(this.imageTarget)
      if (this.imageTarget.complete) requestAnimationFrame(() => this.drawMarks()) // loaded before connecting: no load event
    }
  }

  disconnect() {
    window.removeEventListener('viewpoint:renamed', this.renamed)
    window.removeEventListener('media:renamed', this.moved)
    this.resize?.disconnect()
  }

  drawMarks() {
    if (!this.hasMarksTarget || !this.hasImageTarget) return
    drawOnThumbnail(this.marksTarget, this.imageTarget, this.dataValue.files[this.variantValue]?.shapes)
  }

  // Marked in the gallery (annotations:changed) → badge on the card
  marked({ detail }) {
    if (!this.hasMarkedTarget || !detail.mediaFileId) return
    const entry = Object.entries(this.dataValue.files).find(([, f]) => f.mediaFileId === detail.mediaFileId)
    if (!entry) return
    const [variant, file] = entry
    this.dataValue = { ...this.dataValue, files: { ...this.dataValue.files, [variant]: { ...file, shapes: detail.shapes } } }
    this.drawMarks()
    this.markedIds ??= new Set(this.markedTarget.hidden ? [] : [detail.mediaFileId])
    if (detail.marked) this.markedIds.add(detail.mediaFileId)
    else this.markedIds.delete(detail.mediaFileId)
    this.markedTarget.hidden = !this.markedIds.size
    this.markedTarget.title = 'Markiert'
  }

  show({ params }) {
    const file = this.dataValue.files[params.variant]
    if (!file) return
    if (this.variantValue !== 'T') this.lastVisible = this.variantValue
    this.variantValue = params.variant
    if (this.hasImageTarget && file.thumb) this.imageTarget.src = file.thumb // load → drawMarks
    this.drawMarks()
    this.chipTargets.forEach((c) => c.classList.toggle('is-active', c.dataset.variant === params.variant))
  }

  // Space (keydown@window): thermal ↔ visible – every card of the page switches
  key(event) {
    if (!isVariantSpace(event)) return
    event.preventDefault()
    const variant = toggledVariant(this.variantValue, Object.keys(this.dataValue.files), this.lastVisible)
    if (!variant) return
    this.show({ params: { variant } })
    // „Anzeigen: Wärmebild | Sichtbild“ above the overview shows what is visible now
    document.querySelectorAll('[data-variant-link]').forEach((a) => a.classList.toggle('is-active', a.dataset.variantLink === variant))
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

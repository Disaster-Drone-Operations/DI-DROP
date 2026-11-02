import { Controller } from '@hotwired/stimulus'
import { drawOnThumbnail } from '/app/services/annotation_renderer.js'

// Markings over a thumbnail that always shows the same file (e.g. a comparison image tile) – image shots have
// their own in shot_controller.js. Updated live after marking in the gallery (annotations:changed).
//   <span data-controller="marked-thumb" data-marked-thumb-comparison-value="7" data-marked-thumb-shapes-value="[…]"
//         data-action="annotations:changed@window->marked-thumb#changed">
//     <img data-marked-thumb-target="image" data-action="load->marked-thumb#draw"><canvas data-marked-thumb-target="marks"></canvas>
export default class extends Controller {
  static targets = ['image', 'marks']
  static values = { comparison: Number, mediaFile: Number, shapes: Array }

  connect() {
    this.resize = new ResizeObserver(() => this.draw())
    this.resize.observe(this.imageTarget)
    if (this.imageTarget.complete) requestAnimationFrame(() => this.draw()) // loaded before connecting: no load event
  }

  disconnect() {
    this.resize.disconnect()
  }

  draw() {
    drawOnThumbnail(this.marksTarget, this.imageTarget, this.shapesValue)
  }

  changed({ detail }) {
    const mine = (detail.comparisonId && detail.comparisonId === this.comparisonValue) || (detail.mediaFileId && detail.mediaFileId === this.mediaFileValue)
    if (!mine) return
    this.shapesValue = detail.shapes ?? []
    this.draw()
  }
}

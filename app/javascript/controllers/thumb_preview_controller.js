import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Thumbnail of an image that isn't imported yet (memory card preview).
// Thumbnails are created a few at a time so the card isn't flooded with reads.
//   <img data-controller="thumb-preview" data-thumb-preview-path-value="/Volumes/…/DJI_0001_V.JPG">
const PARALLEL = 3
const queue = []
let running = 0

function next() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift()
    if (!job.element.isConnected) continue
    running++
    platform.media.thumbnail(job.path)
      .then((thumb) => (job.element.src = platform.media.thumbUrl(thumb)))
      .catch(() => job.element.classList.add('is-missing'))
      .finally(() => {
        running--
        next()
      })
  }
}

export default class extends Controller {
  static values = { path: String }

  connect() {
    if (!platform.media?.thumbnail) return
    queue.push({ element: this.element, path: this.pathValue })
    next()
  }
}

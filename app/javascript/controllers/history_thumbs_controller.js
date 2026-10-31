import { Controller } from '@hotwired/stimulus'
import { isVariantSpace } from '/lib/keys.js'

// Mission page, history: space switches the thumbnails between thermal and visible image
//   <img data-thumb-t="…" data-thumb-visible="…">
export default class extends Controller {
  key(event) {
    if (!isVariantSpace(event)) return
    const thumbs = [...this.element.querySelectorAll('img[data-thumb-t]')]
    if (!thumbs.length) return
    event.preventDefault()
    this.thermal = !(this.thermal ?? true)
    for (const img of thumbs) img.src = this.thermal ? img.dataset.thumbT : img.dataset.thumbVisible
  }
}

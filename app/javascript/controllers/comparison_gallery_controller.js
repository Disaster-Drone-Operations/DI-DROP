import { Controller } from '@hotwired/stimulus'

// Comparison images of an assignment: a click opens the large view (gallery) with all of them
//   data-comparison-gallery-items-value='[{ key, files: { T: { path, thumb, name } }, variant, … }]'
export default class extends Controller {
  static values = { items: Array }

  open({ params: { index } }) {
    const item = this.itemsValue[index]
    window.dispatchEvent(new CustomEvent('gallery:open', {
      detail: { items: this.itemsValue, index, variant: item?.variant },
    }))
  }
}

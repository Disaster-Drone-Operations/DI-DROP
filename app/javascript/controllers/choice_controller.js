import { Controller } from '@hotwired/stimulus'

// Options with their own input field ("um [15:00] Uhr"): clicking into the field
// automatically selects the corresponding option.
//   <input type="radio" id="x"> … <input type="time" data-choice="x">
export default class extends Controller {
  connect() {
    this.select = (event) => {
      const id = event.target.dataset?.choice
      if (!id) return
      const radio = this.element.querySelector(`#${CSS.escape(id)}`)
      if (radio && !radio.checked) {
        radio.checked = true
        radio.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    this.element.addEventListener('focusin', this.select)
    this.element.addEventListener('input', this.select)
  }

  disconnect() {
    this.element.removeEventListener('focusin', this.select)
    this.element.removeEventListener('input', this.select)
  }
}

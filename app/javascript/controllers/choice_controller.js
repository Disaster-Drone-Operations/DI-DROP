import { Controller } from '@hotwired/stimulus'

// Options with their own input field ("um [15:00] Uhr"): clicking into the field
// automatically selects the corresponding option.
//   <input type="radio" id="x"> … <input type="time" data-choice="x">
//   data-choice-on-value="input": only when something is entered, not already on focus (e.g. tabbing through)
export default class extends Controller {
  static values = { on: { type: String, default: 'focusin input' } }

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
    this.events = this.onValue.split(/\s+/).filter(Boolean)
    for (const name of this.events) this.element.addEventListener(name, this.select)
  }

  disconnect() {
    for (const name of this.events) this.element.removeEventListener(name, this.select)
  }
}

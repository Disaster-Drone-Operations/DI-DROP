import { Controller } from '@hotwired/stimulus'

// Blendet Hinweise nach ein paar Sekunden aus
export default class extends Controller {
  static values = { delay: { type: Number, default: 3500 } }

  connect() {
    this.timeout = setTimeout(() => this.dismiss(), this.delayValue)
  }

  disconnect() {
    clearTimeout(this.timeout)
  }

  dismiss() {
    this.element.classList.add('is-leaving')
    this.element.addEventListener('animationend', () => this.element.remove(), { once: true })
  }
}

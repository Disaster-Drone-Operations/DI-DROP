import { Controller } from '@hotwired/stimulus'

// Zeigt "in 12 Min." bzw. "seit 3 Min. fällig" und aktualisiert sich selbst
export default class extends Controller {
  static values = { at: String }
  static targets = ['label']

  connect() {
    this.update()
    this.timer = setInterval(() => this.update(), 15_000)
  }

  disconnect() {
    clearInterval(this.timer)
  }

  update() {
    const minutes = Math.round((new Date(this.atValue) - Date.now()) / 60_000)
    const overdue = minutes < 0
    const abs = Math.abs(minutes)
    const span = abs >= 60 ? `${Math.floor(abs / 60)} Std. ${abs % 60} Min.` : `${abs} Min.`

    this.labelTarget.textContent = minutes === 0 ? 'jetzt fällig' : overdue ? `seit ${span} fällig` : `in ${span}`
    this.element.classList.toggle('is-due', minutes <= 5 && !overdue)
    this.element.classList.toggle('is-overdue', overdue)
  }
}

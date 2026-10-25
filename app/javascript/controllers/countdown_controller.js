import { Controller } from '@hotwired/stimulus'
import { nowMs, isSimulated } from '/lib/clock.js'

// Shows "in 12 Min." or "seit 3 Min. fällig" and updates itself
export default class extends Controller {
  static values = { at: String }
  static targets = ['label']

  connect() {
    this.update()
    // Faster when the training clock runs in fast motion
    this.timer = setInterval(() => this.update(), isSimulated() ? 2_000 : 15_000)
    this.onClock = () => this.update()
    window.addEventListener('clock:changed', this.onClock)
  }

  disconnect() {
    clearInterval(this.timer)
    window.removeEventListener('clock:changed', this.onClock)
  }

  update() {
    const minutes = Math.round((new Date(this.atValue) - nowMs()) / 60_000)
    const overdue = minutes < 0
    const abs = Math.abs(minutes)
    const span = abs >= 60 ? `${Math.floor(abs / 60)} Std. ${abs % 60} Min.` : `${abs} Min.`
    // Long overdue: in days instead of "seit 769 Std. 44 Min."
    const days = Math.floor(abs / 1440)
    const since = days >= 1 ? `${days} ${days === 1 ? 'Tag' : 'Tagen'}` : span

    this.labelTarget.textContent = minutes === 0 ? 'jetzt fällig' : overdue ? `seit ${since} fällig` : `in ${span}`
    this.element.classList.toggle('is-due', minutes <= 5 && !overdue)
    this.element.classList.toggle('is-overdue', overdue)
  }
}

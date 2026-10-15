import { Controller } from '@hotwired/stimulus'

// Battery usage chart: switch between total hours and hours per service year (choice is remembered)
export default class extends Controller {
  static targets = ['chart', 'legend']

  connect() {
    let mode = 'perYear'
    try {
      mode = localStorage.getItem('batteries.chart') ?? mode
    } catch {
      // no storage – default
    }
    this.show(mode)
  }

  switch(event) {
    this.show(event.target.value)
    try {
      localStorage.setItem('batteries.chart', event.target.value)
    } catch {
      // ignore
    }
  }

  show(mode) {
    for (const el of [...this.chartTargets, ...this.legendTargets]) el.hidden = el.dataset.mode !== mode
    const radio = this.element.querySelector(`input[name=battery_chart][value="${mode}"]`)
    if (radio) radio.checked = true
  }
}

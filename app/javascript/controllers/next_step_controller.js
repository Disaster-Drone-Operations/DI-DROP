import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import Mission from '/app/models/mission.js'
import { missionProgress } from '/app/services/next_step.js'

// Mission page: keeps „Nächster Schritt“ and the steps on the assignment cards up to date while
// images are being provided (e.g. „Alles bereitstellen“ → „Erledigt“ as soon as the queue is through)
// and when an assignment becomes due (real time or the training clock).
//   <div data-controller="next-step" data-next-step-mission-value="3" data-next-step-can-import-value="true">
export default class extends Controller {
  static values = { mission: Number, canImport: Boolean }

  connect() {
    this.onChange = () => this.schedule()
    window.addEventListener('uploads:changed', this.onChange)
    window.addEventListener('clock:changed', this.onChange)
    this.interval = setInterval(this.onChange, 30_000)
  }

  disconnect() {
    window.removeEventListener('uploads:changed', this.onChange)
    window.removeEventListener('clock:changed', this.onChange)
    clearInterval(this.interval)
    clearTimeout(this.timer)
  }

  // „Auftrag anlegen …“ → the „Neuer Auftrag“ dialog of the assignment list
  newAssignment() {
    const host = document.querySelector('.tasks__header [data-controller~="dialog"]')
    this.application.getControllerForElementAndIdentifier(host, 'dialog')?.open()
  }

  // At most about every 1.5 s
  schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = null
      this.update()
    }, 1500)
  }

  async update() {
    if (this.element.querySelector('dialog[open]')) return this.schedule() // don't redraw an open „Erledigt …“ dialog
    const mission = await Mission.find(this.missionValue)
    const { nextStep, steps } = await missionProgress(mission)
    if (!this.element.isConnected) return
    morph(this.element, nextStep ? render('missions/_next_step', { mission, step: nextStep, canImport: this.canImportValue }) : '')
    for (const list of document.querySelectorAll('[data-card-steps]')) {
      const items = steps.get(Number(list.dataset.cardSteps)) ?? []
      morph(list, items.map((s) => `<li class="${s.done ? 'is-done' : ''}">${s.label}</li>`).join(''))
    }
  }
}

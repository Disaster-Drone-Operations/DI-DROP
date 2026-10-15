import { Controller } from '@hotwired/stimulus'
import Assignment from '/app/models/assignment.js'

const PLACEHOLDERS = {
  special: 'z. B. Bagger-Zufahrt prüfen',
  other: 'z. B. Live-Bild zur Lagebesprechung',
  mapping: 'z. B. Brandfläche Nordhang',
  position: 'z. B. Einsatzfahrzeuge',
  area: 'z. B. Suchgebiet A–C',
}

// "Neuer Auftrag": name only where needed; interval only for control flights
export default class extends Controller {
  static targets = ['titleField', 'title', 'intervalField']

  connect() {
    this.update()
  }

  update() {
    const kind = this.element.querySelector('[name="assignment[kind]"]:checked')?.value
    const named = Assignment.NAMED_KINDS.includes(kind)
    this.titleFieldTarget.hidden = !named
    this.titleTarget.placeholder = PLACEHOLDERS[kind] ?? ''
    this.intervalFieldTarget.hidden = kind !== 'control'
  }
}

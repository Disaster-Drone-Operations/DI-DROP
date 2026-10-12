import { Controller } from '@hotwired/stimulus'
import Assignment from '/app/models/assignment.js'

const PLACEHOLDERS = {
  spezial: 'z. B. Bagger-Zufahrt prüfen',
  sonstiges: 'z. B. Live-Bild zur Lagebesprechung',
  kartierung: 'z. B. Brandfläche Nordhang',
  position: 'z. B. Einsatzfahrzeuge',
  gebiet: 'z. B. Suchgebiet A–C',
}

// "Neuer Auftrag": Name nur, wo nötig; Takt nur bei Kontrollflügen
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
    this.intervalFieldTarget.hidden = kind !== 'kontrolle'
  }
}

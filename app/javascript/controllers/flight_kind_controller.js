import { Controller } from '@hotwired/stimulus'
import Flight from '/app/models/flight.js'

// Zeigt zur gewählten Flugart eine kurze Erklärung an
export default class extends Controller {
  static targets = ['description']

  update(event) {
    if (event.target.name !== 'flight[kind]') return
    this.descriptionTarget.textContent = Flight.DESCRIPTIONS[event.target.value] ?? ''
    this.element.querySelector('[name="flight[task]"]').placeholder =
      event.target.value === 'spezial' ? 'z. B. Rauchentwicklung am Nordhang prüfen' : 'optional – was wird beflogen?'
  }
}

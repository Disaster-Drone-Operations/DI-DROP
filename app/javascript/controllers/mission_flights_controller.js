import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import { flightStats } from '/app/services/flight_missions.js'

// Mission page: „N Flüge laut Flugprotokoll“ – updated as soon as new flight logs were imported
//   <div data-controller="mission-flights" data-mission-flights-mission-value="3">
export default class extends Controller {
  static values = { mission: Number }

  connect() {
    this.onChange = () => this.update()
    window.addEventListener('flightlogs:changed', this.onChange)
  }

  disconnect() {
    window.removeEventListener('flightlogs:changed', this.onChange)
  }

  async update() {
    const stats = await flightStats(this.missionValue)
    if (this.element.isConnected) morph(this.element, render('missions/_flights', { mission: { id: this.missionValue }, flightStats: stats }))
  }
}

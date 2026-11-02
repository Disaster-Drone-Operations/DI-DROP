import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import FlightLog from '/app/models/flight_log.js'
import DeviceName from '/app/models/device_name.js'
import Person from '/app/models/person.js'

// Assignment page: the real flights its images were taken in – updated as soon as new flight logs were imported
//   <div data-controller="assignment-flights" data-assignment-flights-assignment-value="3">
export default class extends Controller {
  static values = { assignment: Number }

  connect() {
    this.onChange = () => this.update()
    window.addEventListener('flightlogs:changed', this.onChange)
  }

  disconnect() {
    window.removeEventListener('flightlogs:changed', this.onChange)
  }

  async update() {
    const [flights, names, people] = await Promise.all([FlightLog.forAssignment(this.assignmentValue), DeviceName.all(), Person.roster()])
    if (this.element.isConnected) morph(this.element, render('assignments/_flights', { flights, names, people }))
  }
}

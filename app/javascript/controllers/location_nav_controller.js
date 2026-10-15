import { Controller } from '@hotwired/stimulus'
import { isLive } from '/app/services/location_service.js'

// Sidebar: "Live" next to "Mein Standort" while the smartphone is continuously sending
export default class extends Controller {
  static targets = ['live']

  connect() {
    this.update = () => (this.liveTarget.hidden = !isLive())
    window.addEventListener('location:changed', this.update)
    this.update()
  }

  disconnect() {
    window.removeEventListener('location:changed', this.update)
  }
}

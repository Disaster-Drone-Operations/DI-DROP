import { Controller } from '@hotwired/stimulus'
import { isLive } from '/app/services/location_service.js'

// Seitenleiste: "Live" neben "Mein Standort", solange das Smartphone laufend sendet
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

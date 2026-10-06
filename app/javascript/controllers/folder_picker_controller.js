import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Öffnet den nativen Ordner-Dialog des Betriebssystems
export default class extends Controller {
  static targets = ['input']

  async pick() {
    const folder = await platform.pickFolder({ defaultPath: this.inputTarget.value })
    if (folder) this.inputTarget.value = folder
  }
}

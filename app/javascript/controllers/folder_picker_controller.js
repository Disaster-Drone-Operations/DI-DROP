import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Opens the operating system's native folder dialog
export default class extends Controller {
  static targets = ['input']

  async pick() {
    const folder = await platform.pickFolder({ defaultPath: this.inputTarget.value })
    if (folder) this.inputTarget.value = folder
  }
}

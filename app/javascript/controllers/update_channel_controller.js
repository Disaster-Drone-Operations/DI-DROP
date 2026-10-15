import { Controller } from '@hotwired/stimulus'
import { isAvailable, includePrereleases, setIncludePrereleases } from '/app/services/app_updater.js'

// Settings → updates: opt in to pre-releases (test versions) via the normal updater
export default class extends Controller {
  static targets = ['checkbox']

  connect() {
    this.element.hidden = !isAvailable()
    this.checkboxTarget.checked = includePrereleases()
  }

  async toggle() {
    await setIncludePrereleases(this.checkboxTarget.checked)
  }
}

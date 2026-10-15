import { Controller } from '@hotwired/stimulus'

// "Alle auswählen" checkbox for a list
export default class extends Controller {
  static targets = ['toggle', 'item']

  toggleAll() {
    this.enabledItems.forEach((item) => (item.checked = this.toggleTarget.checked))
  }

  sync() {
    const checked = this.enabledItems.filter((i) => i.checked).length
    this.toggleTarget.checked = checked === this.enabledItems.length
    this.toggleTarget.indeterminate = checked > 0 && checked < this.enabledItems.length
  }

  get enabledItems() {
    return this.itemTargets.filter((i) => !i.disabled)
  }
}

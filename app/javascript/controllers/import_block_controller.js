import { Controller } from '@hotwired/stimulus'
import Assignment from '/app/models/assignment.js'

// Ein Bildblock im Import-Dialog: Auftrag wählen oder direkt einen neuen anlegen
export default class extends Controller {
  static targets = ['select', 'newFields', 'kind', 'title']
  static values = { id: String }

  connect() {
    this.update()
  }

  update() {
    const isNew = this.selectTarget.value === 'new'
    this.newFieldsTarget.hidden = !isNew
    this.titleTarget.hidden = !Assignment.NAMED_KINDS.includes(this.kindTarget.value)
    this.titleTarget.setCustomValidity('')
  }

  // Für den Import: Auswahl dieses Blocks; meldet fehlenden Namen direkt am Feld
  choice() {
    const target = this.selectTarget.value
    const newKind = this.kindTarget.value
    const newTitle = this.titleTarget.value.trim()
    if (target === 'new' && Assignment.NAMED_KINDS.includes(newKind) && !newTitle) {
      this.titleTarget.setCustomValidity('Bitte dem neuen Auftrag einen Namen geben.')
      this.titleTarget.reportValidity()
      return null
    }
    return { id: this.idValue, target, newKind, newTitle }
  }
}

import { Controller } from '@hotwired/stimulus'
import Assignment from '/app/models/assignment.js'

// One image block in the import dialog: choose an assignment or create a new one directly
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

  // For the import: this block's choice; reports a missing name directly at the field
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

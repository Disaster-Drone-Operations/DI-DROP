import { Controller } from '@hotwired/stimulus'

// Modaler Dialog (natives <dialog>). Mit data-dialog-open-value="true" öffnet er sich sofort,
// z. B. wenn ein Formular darin mit Fehlern zurückkommt.
export default class extends Controller {
  static targets = ['dialog']

  // Der Dialog kann auch selbst das Controller-Element sein
  get dialog() {
    return this.hasDialogTarget ? this.dialogTarget : this.element
  }
  static values = { open: Boolean }

  connect() {
    if (this.openValue) this.open()
  }

  open() {
    if (!this.dialog.open) this.dialog.showModal()
    this.dialog.querySelector('[autofocus], input[type=text]:not([hidden])')?.focus()
  }

  close() {
    this.dialog.close()
  }
}

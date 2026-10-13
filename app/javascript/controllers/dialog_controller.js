import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Modaler Dialog (natives <dialog>). Mit data-dialog-open-value="true" öffnet er sich sofort,
// z. B. wenn ein Formular darin mit Fehlern zurückkommt.
// Mit data-dialog-confirm-param="…" am Knopf wird vorher nachgefragt.
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

  async open(event) {
    const message = event?.params?.confirm
    if (message && !(await platform.confirm(message, { okLabel: 'Trotzdem erledigt' }))) return
    if (!this.dialog.open) this.dialog.showModal()
    this.dialog.querySelector('[autofocus], input[type=text]:not([hidden])')?.focus()
  }

  close() {
    this.dialog.close()
  }
}

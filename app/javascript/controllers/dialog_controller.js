import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Modal dialog (native <dialog>). With data-dialog-open-value="true" it opens immediately,
// e.g. when a form inside it comes back with errors.
// With data-dialog-confirm-param="…" on the button, a confirmation is asked first.
export default class extends Controller {
  static targets = ['dialog']

  // The dialog can also be the controller element itself
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

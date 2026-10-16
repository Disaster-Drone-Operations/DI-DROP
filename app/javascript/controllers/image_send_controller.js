import { Controller } from '@hotwired/stimulus'
import QRCode from 'qrcode'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import { currentImageShare, closeImageShare, updateRelayAndSend } from '/app/services/image_share.js'

// Dialog "An Telefon senden" (partial images/_send_dialog in the layout).
// Opens by itself when sendImageToPhone() starts a transfer.
export default class extends Controller {
  static targets = ['dialog', 'body']

  connect() {
    this.onChange = () => this.refresh()
    window.addEventListener('image-share:changed', this.onChange)
    this.refresh()
  }

  disconnect() {
    window.removeEventListener('image-share:changed', this.onChange)
  }

  async refresh() {
    const session = currentImageShare()
    if (session && session.id !== this.shownFor) {
      this.shownFor = session.id
      if (!this.dialogTarget.open) this.dialogTarget.showModal()
    }
    if (session?.qrUrl && session.qrUrl !== this.qrFor) {
      this.qrFor = session.qrUrl
      this.qrDataUrl = await QRCode.toDataURL(session.qrUrl, { errorCorrectionLevel: 'M', margin: 2, width: 480 })
    }
    if (!session?.qrUrl) this.qrFor = this.qrDataUrl = null
    morph(this.bodyTarget, render('images/_send', { session, qrDataUrl: this.qrDataUrl }))
  }

  close() {
    this.dialogTarget.close()
  }

  updateRelay() {
    updateRelayAndSend()
  }

  // Relay not set up / key missing → settings (closes the dialog and the image view)
  openSettings() {
    this.close()
    document.querySelector('dialog.gallery[open]')?.close()
    location.hash = '#/settings/relay'
  }

  // Closed (also via Esc): end the transfer – the image only goes to a phone while the dialog is open
  closed() {
    if (currentImageShare()) closeImageShare()
  }
}

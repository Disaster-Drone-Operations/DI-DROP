import { Controller } from '@hotwired/stimulus'
import QRCode from 'qrcode'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import { currentLocation, stopTransfer, closeTransfer } from '/app/services/location_service.js'

// QR-Dialog für die Standort-Übertragung (Partial location/_transfer_dialog).
// Wer eine Übertragung braucht, ruft nur startTransfer() aus dem LocationService auf –
// der Dialog öffnet sich dann von selbst.
export default class extends Controller {
  static targets = ['dialog', 'body']

  connect() {
    this.onChange = () => this.refresh()
    window.addEventListener('location:changed', this.onChange)
    this.onShow = () => this.show()
    window.addEventListener('location:show-transfer', this.onShow) // z. B. „QR-Code zeigen“
    // Kopplung noch nicht abgeschlossen → Dialog wieder zeigen (eine laufende Live-Übertragung nicht)
    const { session } = currentLocation()
    if (['connecting', 'waiting', 'pairing', 'paired'].includes(session?.status)) {
      this.shownFor = session.id
      this.show()
    }
    this.refresh()
  }

  disconnect() {
    window.removeEventListener('location:changed', this.onChange)
    window.removeEventListener('location:show-transfer', this.onShow)
    clearTimeout(this.autoClose)
  }

  async refresh() {
    const { session } = currentLocation()
    if (session && session.id !== this.shownFor && session.status === 'connecting') {
      this.shownFor = session.id
      this.show()
    }
    if (session?.qrUrl && session.qrUrl !== this.qrFor) {
      this.qrFor = session.qrUrl
      this.qrDataUrl = await QRCode.toDataURL(session.qrUrl, { errorCorrectionLevel: 'M', margin: 2, width: 480 })
    }
    if (!session?.qrUrl) this.qrFor = this.qrDataUrl = null
    morph(this.bodyTarget, render('location/_transfer', { session, qrDataUrl: this.qrDataUrl }))
    // Einzelabfrage erfolgreich → Dialog schließt sich kurz darauf von selbst
    if (session?.status === 'done' && this.dialogTarget.open) {
      clearTimeout(this.autoClose)
      this.autoClose = setTimeout(() => this.close(), 1200)
    }
  }

  show() {
    if (!this.dialogTarget.open) this.dialogTarget.showModal()
  }

  hide() {
    this.dialogTarget.close()
  }

  close() {
    clearTimeout(this.autoClose)
    this.dialogTarget.close()
  }

  async stop() {
    await stopTransfer()
  }

  // Dialog zu (auch per Esc): eine laufende Live-Übertragung bleibt bestehen, alles andere wird beendet
  closed() {
    const { session } = currentLocation()
    const live = session?.mode === 'stream' && ['streaming', 'paired', 'reconnecting'].includes(session.status)
    if (session && !live) closeTransfer()
  }
}

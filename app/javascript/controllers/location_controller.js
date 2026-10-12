import { Controller } from '@hotwired/stimulus'
import QRCode from 'qrcode'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'
import { formatDecimal, formatDms, formatUtm, mapLinks } from '/lib/location/coordinates.js'
import { currentLocation, startTransfer, stopTransfer, closeTransfer } from '/app/services/location_service.js'

// Seite "Mein Standort": zeichnet Position und Übertragungsdialog bei jeder Änderung neu
export default class extends Controller {
  static targets = ['panel', 'dialog', 'transfer']
  static values = { configured: Boolean }

  connect() {
    this.onChange = () => this.refresh()
    window.addEventListener('location:changed', this.onChange)
    this.ticker = setInterval(() => this.renderPanel(), 15_000) // "vor 2 Min." aktuell halten
    this.refresh()
    // Kopplung noch nicht abgeschlossen → QR-Dialog wieder zeigen (eine laufende Live-Übertragung nicht)
    if (['connecting', 'waiting', 'pairing', 'paired'].includes(currentLocation().session?.status)) this.showTransfer()
  }

  disconnect() {
    window.removeEventListener('location:changed', this.onChange)
    clearInterval(this.ticker)
  }

  async refresh() {
    const { session } = currentLocation()
    if (session?.qrUrl && session.qrUrl !== this.qrFor) {
      this.qrFor = session.qrUrl
      this.qrDataUrl = await QRCode.toDataURL(session.qrUrl, { errorCorrectionLevel: 'M', margin: 2, width: 480 })
    }
    if (!session?.qrUrl) this.qrFor = this.qrDataUrl = null
    this.renderPanel()
    this.renderTransfer()
    // Einzelabfrage erfolgreich → Dialog schließt sich kurz darauf von selbst
    if (session?.status === 'done' && this.dialogTarget.open) {
      clearTimeout(this.autoClose)
      this.autoClose = setTimeout(() => this.closeTransfer(), 1200)
    }
  }

  renderPanel() {
    const { position, session } = currentLocation()
    const coords = position && {
      decimal: formatDecimal(position.lat, position.lon),
      dms: formatDms(position.lat, position.lon),
      utm: formatUtm(position.lat, position.lon),
      links: mapLinks(position.lat, position.lon),
      age: age(position.timestamp),
    }
    morph(this.panelTarget, render('location/_panel', { position, session, configured: this.configuredValue, coords }))
  }

  renderTransfer() {
    const { session } = currentLocation()
    morph(this.transferTarget, render('location/_transfer', { session, qrDataUrl: this.qrDataUrl }))
  }

  async start({ params: { mode } }) {
    this.showTransfer()
    await startTransfer(mode)
  }

  async stop() {
    await stopTransfer()
  }

  showTransfer() {
    if (!this.dialogTarget.open) this.dialogTarget.showModal()
  }

  hideTransfer() {
    this.dialogTarget.close()
  }

  closeTransfer() {
    clearTimeout(this.autoClose)
    this.dialogTarget.close()
  }

  // Dialog zu (auch per Esc): eine laufende Live-Übertragung bleibt bestehen, alles andere wird beendet
  dialogClosed() {
    const { session } = currentLocation()
    const live = session?.mode === 'stream' && ['streaming', 'paired', 'reconnecting'].includes(session.status)
    if (session && !live) closeTransfer()
  }

  async copy({ params: { text }, currentTarget }) {
    await navigator.clipboard.writeText(text)
    const label = currentTarget.querySelector('span')
    label.textContent = 'Kopiert'
    setTimeout(() => (label.textContent = 'Kopieren'), 1500)
  }

  openMap({ params: { url } }) {
    platform.openUrl(url)
  }
}

function age(timestamp) {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  return `vor ${hours} Std.${minutes % 60 ? ` ${minutes % 60} Min.` : ''}`
}

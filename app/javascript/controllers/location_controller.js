import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'
import { distance } from '/lib/geo.js'
import { formatDecimal, formatDms, formatUtm, mapLinks } from '/lib/location/coordinates.js'
import { currentLocation, startTransfer, stopTransfer } from '/app/services/location_service.js'
import { describeLocation } from '/app/services/address_service.js'

// "Mein Standort" page: redraws the position on every change (dialog: location-transfer)
export default class extends Controller {
  static values = { configured: Boolean }

  connect() {
    this.onChange = () => this.refresh()
    window.addEventListener('location:changed', this.onChange)
    this.ticker = setInterval(() => this.paint(), 15_000) // keep "vor 2 Min." up to date
    this.refresh()
  }

  disconnect() {
    window.removeEventListener('location:changed', this.onChange)
    clearInterval(this.ticker)
  }

  refresh() {
    this.lookupAddress()
    this.paint()
  }

  // Only look up the address again when the position has moved noticeably (live: not on every update)
  lookupAddress() {
    const { position } = currentLocation()
    if (!position) return
    const last = this.addressFor
    if (last && distance(last.lat, last.lon, position.lat, position.lon) < 30) return
    this.addressFor = { lat: position.lat, lon: position.lon }
    this.address = null
    const current = () => this.addressFor?.lat === position.lat && this.addressFor?.lon === position.lon
    describeLocation(position.lat, position.lon, (result) => {
      if (!current()) return
      this.address = { ...result, final: false }
      this.paint()
    }).then((result) => {
      if (!current()) return
      this.address = { ...result, final: true }
      this.paint()
    })
  }

  paint() {
    const { position, session } = currentLocation()
    const coords = position && {
      decimal: formatDecimal(position.lat, position.lon),
      dms: formatDms(position.lat, position.lon),
      utm: formatUtm(position.lat, position.lon),
      links: mapLinks(position.lat, position.lon),
      age: age(position.timestamp),
    }
    morph(this.element, render('location/_panel', { position, session, configured: this.configuredValue, coords, address: this.address }))
  }

  start({ params: { mode } }) {
    startTransfer(mode)
  }

  stop() {
    stopTransfer()
  }

  showTransfer() {
    window.dispatchEvent(new CustomEvent('location:show-transfer'))
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

import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { escapeHtml, icon } from '/app/helpers/index.js'
import { currentLocation, freshPosition, startTransfer } from '/app/services/location_service.js'
import { describeLocation } from '/app/services/address_service.js'

// Einsatzformular: „Hier“ neben dem Einsatzort übernimmt den Standort vom Smartphone,
// trägt die Koordinaten ein und leitet daraus eine Ortsangabe ab.
//   Frische Position (≤ 5 Min., z. B. Live) → sofort; sonst QR-Dialog (location-transfer)
export default class extends Controller {
  static targets = ['hint']
  static values = { configured: Boolean }

  connect() {
    this.onChange = () => this.received()
    window.addEventListener('location:changed', this.onChange)
  }

  disconnect() {
    window.removeEventListener('location:changed', this.onChange)
  }

  get locationInput() {
    return this.element.querySelector('#mission_location')
  }

  get coordinatesInput() {
    return this.element.querySelector('#mission_coordinates')
  }

  async here() {
    const fresh = freshPosition()
    if (fresh) return this.apply(fresh)
    if (!this.configuredValue) {
      const ok = await platform.confirm('Damit das Smartphone seinen Standort senden kann, muss die Standort-Übertragung einmalig eingerichtet werden. Jetzt einrichten? (Die Eingaben in diesem Formular gehen dabei verloren.)', { okLabel: 'Einrichten' })
      if (ok) location.hash = '#/settings/relay'
      return
    }
    this.pendingSince = Date.now()
    startTransfer('single')
  }

  received() {
    if (!this.pendingSince) return
    const { position, session } = currentLocation()
    if (position && position.receivedAt >= this.pendingSince) {
      this.pendingSince = null
      return this.apply(position)
    }
    if (!session || ['error', 'stopped'].includes(session.status)) this.pendingSince = null
  }

  apply(position) {
    const { lat, lon } = position
    if (this.coordinatesInput) this.coordinatesInput.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    // Nur ausfüllen, was leer ist (oder von uns stammt) – sonst als Vorschlag anbieten
    const input = this.locationInput
    const ours = !input.value.trim() || input.value === this.filled
    const accuracy = position.accuracy != null ? ` (± ${Math.round(position.accuracy)} m)` : ''
    this.showHint(`Standort vom Smartphone${accuracy} · Ort wird ermittelt …`)

    this.lookup = describeLocation(lat, lon, (result) => {
      if (this.lookup !== current) return
      if (ours) {
        input.value = this.filled = result.text
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    const current = this.lookup
    current.then((result) => {
      if (this.lookup !== current) return
      const where = result.source === 'online' ? '' : ' · ohne Internet nur der nächste Ort'
      let html = `${icon('check')}<span>Standort vom Smartphone${escapeHtml(accuracy)} übernommen – Koordinaten stehen unter „Weitere Angaben“${where}.</span>`
      if (!ours && result.text && result.text !== input.value) {
        html += `<button type="button" class="button" data-action="mission-location#takeSuggestion">„${escapeHtml(result.text)}“ übernehmen</button>`
        this.suggestion = result.text
      }
      html += result.source === 'online'
        ? '<span class="osm-credit">© OpenStreetMap-Mitwirkende</span>'
        : '<span class="osm-credit">Ortsnamen: GeoNames (CC BY 4.0)</span>'
      if (!result.text) html = `${icon('check')}<span>Koordinaten übernommen. Ein Ortsname ließ sich nicht ermitteln.</span>`
      this.showHint(html, { html: true })
    })
  }

  takeSuggestion() {
    this.locationInput.value = this.filled = this.suggestion
    this.showHint(`${icon('check')}<span>Ort übernommen.</span>`, { html: true })
  }

  showHint(content, { html = false } = {}) {
    if (html) this.hintTarget.innerHTML = content
    else this.hintTarget.textContent = content
    this.hintTarget.hidden = false
  }
}

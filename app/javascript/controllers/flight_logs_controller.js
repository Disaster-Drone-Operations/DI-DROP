import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { formatFlightDuration, formatDistance } from '/app/helpers/index.js'
import { importFromFolder, importFromDevice, connectedDevices } from '/app/services/flightlog_importer.js'

// Seite "Flugprotokolle": Auswahl wie in macOS-Listen (Klick, ⌘/Strg-Klick, ⇧-Klick) und
// Summenleiste unten wie in Numbers (Anzahl, Gesamtdauer, Gesamtstrecke)
export default class extends Controller {
  static targets = ['row', 'all', 'sum', 'deviceButton']

  async connect() {
    this.anchor = null
    this.updateSum()
    if (this.hasDeviceButtonTarget) {
      this.devices = await connectedDevices()
      if (this.devices.length) {
        this.deviceButtonTarget.hidden = false
        this.deviceButtonTarget.title = this.devices.map((d) => d.name).join(', ')
      }
    }
  }

  // ── Auswahl ──────────────────────────────────────────────────────────

  select(event) {
    const row = event.currentTarget
    const index = this.rowTargets.indexOf(row)
    const onCheckbox = event.target.matches('input[type=checkbox]')
    if (event.shiftKey && this.anchor != null) {
      const [from, to] = [Math.min(this.anchor, index), Math.max(this.anchor, index)]
      this.rowTargets.forEach((r, i) => this.mark(r, i >= from && i <= to))
    } else if (event.metaKey || event.ctrlKey || onCheckbox) {
      this.mark(row, onCheckbox ? event.target.checked : !this.isSelected(row))
      this.anchor = index
    } else {
      const only = this.isSelected(row) && this.selected.length === 1
      this.rowTargets.forEach((r) => this.mark(r, !only && r === row))
      this.anchor = index
    }
    window.getSelection()?.removeAllRanges() // ⇧-Klick markiert sonst Text
    this.updateSum()
  }

  toggleAll(event) {
    this.rowTargets.forEach((r) => this.mark(r, event.target.checked))
    this.updateSum()
  }

  isSelected(row) {
    return row.classList.contains('is-selected')
  }

  mark(row, on) {
    row.classList.toggle('is-selected', on)
    row.querySelector('input').checked = on
  }

  get selected() {
    return this.rowTargets.filter((r) => this.isSelected(r))
  }

  updateSum() {
    if (!this.hasSumTarget) return
    const selected = this.selected
    const rows = selected.length ? selected : this.rowTargets
    const duration = rows.reduce((s, r) => s + Number(r.dataset.duration), 0)
    const distance = rows.reduce((s, r) => s + Number(r.dataset.distance), 0)
    const label = selected.length
      ? `${selected.length} von ${this.rowTargets.length} ${this.rowTargets.length === 1 ? 'Flug' : 'Flügen'} ausgewählt`
      : `Alle ${this.rowTargets.length} ${this.rowTargets.length === 1 ? 'Flug' : 'Flüge'}`
    this.sumTarget.innerHTML = `
      <span class="flightlogs__sum-label">${label}</span>
      <span class="flightlogs__sum-value"><span>Anzahl</span><strong>${rows.length}</strong></span>
      <span class="flightlogs__sum-value"><span>Flugdauer</span><strong>${formatFlightDuration(duration)}</strong></span>
      <span class="flightlogs__sum-value"><span>Strecke</span><strong>${formatDistance(distance)}</strong></span>`
    if (this.hasAllTarget) {
      this.allTarget.checked = selected.length > 0 && selected.length === this.rowTargets.length
      this.allTarget.indeterminate = selected.length > 0 && selected.length < this.rowTargets.length
    }
  }

  // ── Übernehmen ───────────────────────────────────────────────────────

  async importFolder() {
    const folder = await platform.pickFolder({ title: 'Ordner mit Flugprotokollen wählen (z. B. „FlightRecord“ auf dem USB-Stick)' })
    if (!folder) return
    this.finish(() => importFromFolder(folder))
  }

  async importDevice() {
    const device = this.devices?.[0]
    if (device) this.finish(() => importFromDevice(device))
  }

  async finish(run) {
    try {
      const { added, failed } = await run()
      const flash = failed.length
        ? { alert: `${added} übernommen, ${failed.length} nicht lesbar: ${failed.slice(0, 2).map(([n, e]) => `${n} (${e})`).join('; ')}` }
        : { notice: added ? `${added} ${added === 1 ? 'Flugprotokoll' : 'Flugprotokolle'} übernommen.` : 'Keine neuen Flugprotokolle – alles schon da.' }
      document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: '/flightlogs', flash } }))
    } catch (error) {
      platform.confirm(`Flugprotokolle konnten nicht übernommen werden:\n${error?.message ?? error}`, { okLabel: 'OK' })
    }
  }
}

import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { formatFlightDuration, formatDistance } from '/app/helpers/index.js'
import { importFromFolder, importFromDevice, connectedDevices } from '/app/services/flightlog_importer.js'
import { suggestedMissions } from '/app/services/flight_missions.js'

// "Flugprotokolle" page: selection like in macOS lists (click, ⌘/Ctrl-click, ⇧-click) and
// a totals bar at the bottom like in Numbers (count, total duration, total distance); selected flights
// can be assigned to a mission („Einsatz zuordnen …“)
export default class extends Controller {
  static targets = ['row', 'all', 'sum', 'deviceButton', 'table', 'assignDialog', 'assignIds', 'assignTitle', 'assignList']

  async connect() {
    this.anchor = null
    this.updateSum()
    this.stackStickyRows()
    if (this.hasDeviceButtonTarget) {
      this.devices = await connectedDevices()
      if (this.devices.length) {
        this.deviceButtonTarget.hidden = false
        this.deviceButtonTarget.title = this.devices.map((d) => d.name).join(', ')
      }
    }
  }

  disconnect() {
    this.resizeObserver?.disconnect()
  }

  // Column header → drone → month stay on top while scrolling. Their heights depend on font and rendering
  // (desktop app vs. browser), so the offsets are measured instead of fixed – otherwise a gap shows the rows below.
  stackStickyRows() {
    if (!this.hasTableTarget) return
    const table = this.tableTarget
    const measure = () => {
      const head = table.querySelector('thead')?.getBoundingClientRect().height ?? 0
      const drone = table.querySelector('.flightlogs__drone')?.getBoundingClientRect().height ?? 0
      table.style.setProperty('--sticky-head', `${head}px`)
      table.style.setProperty('--sticky-drone', `${drone}px`)
    }
    measure()
    this.resizeObserver = new ResizeObserver(measure)
    for (const el of [table.querySelector('thead'), table.querySelector('.flightlogs__drone')]) if (el) this.resizeObserver.observe(el)
  }

  // ── Selection ────────────────────────────────────────────────────────

  select(event) {
    if (event.detail >= 2) return // second click of a double-click (e.g. for renaming)
    if (event.target.closest('.renamable__input')) return
    const row = event.currentTarget
    const index = this.rowTargets.indexOf(row)
    // The whole checkbox cell counts as the checkbox – a click just beside it adds to the selection too
    const box = event.target.closest('.flightlogs__check')?.querySelector('input[type=checkbox]')
    if (event.shiftKey && this.anchor != null) {
      const [from, to] = [Math.min(this.anchor, index), Math.max(this.anchor, index)]
      this.rowTargets.forEach((r, i) => this.mark(r, i >= from && i <= to))
    } else if (event.metaKey || event.ctrlKey || box) {
      this.mark(row, event.target === box ? box.checked : !this.isSelected(row))
      this.anchor = index
    } else if (event.target.closest('.flightlogs__mission') && this.isSelected(row) && this.selected.length > 1) {
      // Maybe the start of a double-click (change the mission of all selected) → only then select just this row
      clearTimeout(this.pendingOnly)
      this.pendingOnly = setTimeout(() => this.selectOnly(row), 350)
      this.anchor = index
    } else {
      this.selectOnly(row)
      this.anchor = index
    }
    window.getSelection()?.removeAllRanges() // otherwise ⇧-click selects text
    this.updateSum()
  }

  // Header: a click beside the „Alle auswählen“ checkbox counts as a click on it
  allCell(event) {
    if (event.target === event.currentTarget) this.allTarget.click()
  }

  selectOnly(row) {
    const only = this.isSelected(row) && this.selected.length === 1
    this.rowTargets.forEach((r) => this.mark(r, !only && r === row))
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
      <span class="flightlogs__sum-value"><span>Strecke</span><strong>${formatDistance(distance)}</strong></span>
      ${selected.length && this.hasAssignDialogTarget ? '<button type="button" class="button button--small" data-action="flight-logs#openAssign">Einsatz zuordnen …</button>' : ''}`
    if (this.hasAllTarget) {
      this.allTarget.checked = selected.length > 0 && selected.length === this.rowTargets.length
      this.allTarget.indeterminate = selected.length > 0 && selected.length < this.rowTargets.length
    }
  }

  // ── Mission ──────────────────────────────────────────────────────────

  // Dialog for the selection: missions that fit the flight times on top (and preselected)
  async openAssign() {
    const rows = this.selected
    const ids = rows.map((r) => Number(r.dataset.id))
    this.assignIdsTarget.value = ids.join(',')
    this.assignTitleTarget.textContent = ids.length === 1 ? 'Flug einem Einsatz zuordnen' : `${ids.length} Flüge einem Einsatz zuordnen`
    const suggested = await suggestedMissions(ids)
    const options = [...this.assignListTarget.querySelectorAll('[data-mission-option]')]
    const rank = (o) => { const i = suggested.indexOf(Number(o.dataset.missionOption)); return i < 0 ? Infinity : i }
    options.sort((a, b) => rank(a) - rank(b) || options.indexOf(a) - options.indexOf(b))
    for (const option of options) {
      option.classList.toggle('is-suggested', rank(option) < Infinity)
      this.assignListTarget.append(option)
    }
    // Preselection: the mission all of them already belong to, otherwise the best suggestion
    const current = new Set(rows.map((r) => r.dataset.mission))
    const value = current.size === 1 && [...current][0] ? [...current][0] : suggested[0] ? String(suggested[0]) : null
    for (const radio of this.assignDialogTarget.querySelectorAll('input[name="mission"]')) radio.checked = radio.value === value
    this.assignDialogTarget.showModal()
    this.assignListTarget.scrollTop = 0
  }

  // Double-click on the mission of a flight: change it – for all selected flights if it is one of them
  editMission(event) {
    clearTimeout(this.pendingOnly)
    const row = event.currentTarget.closest('[data-flight-logs-target~="row"]')
    if (!this.isSelected(row)) this.rowTargets.forEach((r) => this.mark(r, r === row))
    this.updateSum()
    this.openAssign()
  }

  closeAssign() {
    this.assignDialogTarget.close()
  }

  // ── Import ───────────────────────────────────────────────────────────

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

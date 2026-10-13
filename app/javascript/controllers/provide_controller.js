import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { formatBytes, formatDuration, formatSpeed } from '/app/helpers/index.js'

// Seite "Bereitstellen": Auswahl zählen, Größe und Dauer schätzen, Ziel wählen
export default class extends Controller {
  static targets = ['item', 'selection', 'summary', 'submit', 'base', 'destination']
  static values = { target: String, pending: Number, speed: Number, missionFolder: String, assignmentFolder: String }

  connect() {
    this.update()
  }

  ignore() {}

  get selected() {
    return this.itemTargets.filter((i) => i.checked)
  }

  update() {
    const all = this.itemTargets
    const chosen = this.selected
    const size = (list) => list.reduce((s, i) => s + Number(i.dataset.size || 0), 0)
    const bytes = size(chosen)
    let text = `<strong>${chosen.length} von ${all.length} Dateien</strong> · ${formatBytes(bytes)} von ${formatBytes(size(all))}`
    if (chosen.length) {
      if (this.speedValue) {
        text += ` · Dauer ${formatDuration(bytes / this.speedValue)}`
        if (this.pendingValue) text += ` (+ ${formatDuration(this.pendingValue / this.speedValue)} für bereits Wartendes)`
        text += ` <span class="hint">bei zuletzt ${formatSpeed(this.speedValue)}</span>`
      } else {
        text += ' · <span class="hint">Dauer wird nach dem ersten Upload geschätzt</span>'
      }
    }
    this.summaryTarget.innerHTML = text
    if (this.hasSubmitTarget) this.submitTarget.disabled = !chosen.length || this.submitTarget.dataset.blocked === '1' || !this.baseValue()
    this.showDestination()
  }

  // ── Schnellauswahl ───────────────────────────────────────────────────

  toggleKind({ params: { kind } }) {
    const items = this.itemTargets.filter((i) => i.dataset.kind === kind)
    const on = !items.every((i) => i.checked)
    items.forEach((i) => (i.checked = on))
    this.update()
  }

  selectLast() {
    this.itemTargets.forEach((i) => {
      if (i.dataset.kind === 'comparison') return
      i.checked = i.dataset.last === '1' && !i.closest('.is-provided')
    })
    this.update()
  }

  selectNone() {
    this.itemTargets.forEach((i) => (i.checked = false))
    this.update()
  }

  submit(event) {
    if (!this.selected.length || !this.baseValue()) return event.preventDefault()
    const files = []
    const comparisons = []
    for (const i of this.selected) (i.dataset.key.startsWith('c') ? comparisons : files).push(Number(i.dataset.key.slice(1)))
    this.selectionTarget.value = JSON.stringify({ files, comparisons })
  }

  // ── Ziel ─────────────────────────────────────────────────────────────

  baseValue() {
    return this.hasBaseTarget ? this.baseTarget.value.trim() : ''
  }

  showDestination() {
    if (!this.hasDestinationTarget) return
    const base = this.baseValue()
    if (!base) return (this.destinationTarget.textContent = 'Noch kein Ordner gewählt')
    const parts = this.targetValue === 'folder' ? [base, this.missionFolderValue, this.assignmentFolderValue] : [base, this.assignmentFolderValue]
    this.destinationTarget.textContent = parts.join('/').replace(/\/{2,}/g, '/')
  }

  typeBase(event) {
    this.baseTarget.value = event.target.value
    this.update()
  }

  // Zielordner für den Export (z. B. USB-Stick); der Nextcloud-Ordner hat ein eigenes Feld
  async changeBase() {
    const folder = await platform.pickFolder({ title: 'Zielordner wählen (z. B. USB-Stick)', defaultPath: this.baseValue() || undefined })
    if (!folder) return
    this.baseTarget.value = folder
    const label = this.baseTarget.parentElement.querySelector('.mono')
    if (label) label.textContent = folder
    this.update()
  }
}

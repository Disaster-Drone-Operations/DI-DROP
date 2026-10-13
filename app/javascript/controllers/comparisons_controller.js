import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { render } from '/lib/views.js'
import Comparison from '/app/models/comparison.js'
import { exportComparison, releaseBitmaps } from '/app/services/comparison_renderer.js'

// Vergleichsbild-Seite: Wegpunkte auswählen (Editoren ein-/ausblenden) und alle erzeugen
export default class extends Controller {
  static targets = ['checkbox', 'editors', 'hint', 'exportButton', 'exportLabel']
  static values = { missionId: Number }

  connect() {
    // Auswahl merken, damit sie z. B. nach dem Umbenennen eines Wegpunkts erhalten bleibt.
    // Noch keine Auswahl → wie beim letzten Mal: Wegpunkte der zuletzt erstellten Vergleichsbilder
    const saved = this.loadSelection()
    this.checkboxTargets.forEach((c) => (c.checked = saved ? saved.includes(c.value) : c.dataset.last === '1'))
    if (!saved && this.checkboxTargets.some((c) => c.checked)) this.saveSelection()
    this.sync()
  }

  disconnect() {
    releaseBitmaps()
  }

  toggle() {
    this.saveSelection()
    this.sync()
  }

  // Editoren passend zur Auswahl anlegen/entfernen (bestehende behalten ihren Zustand)
  sync() {
    const checked = this.checkboxTargets.filter((c) => c.checked)
    const ids = checked.map((c) => c.value)

    for (const editor of this.editorsTarget.querySelectorAll('[data-viewpoint-id]')) {
      if (!ids.includes(editor.dataset.viewpointId)) editor.remove()
    }
    for (const box of checked) {
      if (this.editorsTarget.querySelector(`[data-viewpoint-id="${box.value}"]`)) continue
      this.editorsTarget.insertAdjacentHTML('beforeend', render('comparisons/_editor', {
        id: box.value,
        name: box.dataset.name,
        shots: JSON.parse(box.dataset.shots),
        variants: JSON.parse(box.dataset.variants),
      }))
    }

    if (this.hasHintTarget) this.hintTarget.hidden = checked.length > 0
    if (this.hasExportButtonTarget) {
      this.exportButtonTarget.disabled = checked.length === 0
      this.exportLabelTarget.textContent = checked.length > 1 ? `${checked.length} Vergleichsbilder erstellen` : 'Vergleichsbild erstellen'
    }
  }

  get editors() {
    return [...this.editorsTarget.querySelectorAll('[data-controller~="comparison-editor"]')]
      .map((el) => this.application.getControllerForElementAndIdentifier(el, 'comparison-editor'))
      .filter(Boolean)
  }

  async export() {
    const specs = this.editors.map((e) => e.exportSpec())
    const incomplete = specs.filter((s) => s.shots.length < 2)
    if (incomplete.length) {
      await platform.confirm(`Bitte für ${incomplete.map((s) => `„${s.viewpointName}“`).join(', ')} mindestens zwei Aufnahmen auswählen.`, { okLabel: 'OK' })
      return
    }

    const button = this.exportButtonTarget
    button.disabled = true
    const created = []
    const failed = []
    for (const [i, spec] of specs.entries()) {
      this.exportLabelTarget.textContent = `Erstelle ${i + 1} von ${specs.length} …`
      try {
        const path = await exportComparison({ ...spec, joinPath: platform.joinPath })
        const comparison = await Comparison.create({
          mission_id: this.missionIdValue,
          viewpoint_id: spec.viewpointId,
          variant: spec.variant,
          path,
          media_file_ids: JSON.stringify(spec.shots.map((s) => s.files[spec.variant].id)),
        })
        await comparison.ensureThumbnail()
        created.push(path)
      } catch (error) {
        console.error(error)
        failed.push(`${spec.viewpointName}: ${error?.message ?? error}`)
      }
    }

    const flash = failed.length
      ? { alert: `${created.length} erstellt, ${failed.length} fehlgeschlagen – ${failed.join('; ')}` }
      : { notice: created.length === 1 ? 'Vergleichsbild erstellt.' : `${created.length} Vergleichsbilder erstellt.` }
    document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: `/missions/${this.missionIdValue}/comparisons`, flash } }))
  }

  // ── Auswahl merken ─────────────────────────────────────────────────────────

  get storageKey() {
    return `di-drop:comparisons:${this.missionIdValue}`
  }

  loadSelection() {
    try {
      const raw = sessionStorage.getItem(this.storageKey)
      return raw ? JSON.parse(raw) : null // null = noch nie ausgewählt
    } catch {
      return null
    }
  }

  saveSelection() {
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(this.checkboxTargets.filter((c) => c.checked).map((c) => c.value)))
    } catch {
      // nicht schlimm – Auswahl wird dann nur nicht gemerkt
    }
  }
}

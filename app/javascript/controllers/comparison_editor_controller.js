import { Controller } from '@hotwired/stimulus'
import { draw, loadBitmap, captionFor, fileNameFor } from '/app/services/comparison_renderer.js'

const MAX_SHOTS = 4
const DEFAULT_SHOTS = 3

// Ein Wegpunkt im Vergleichsbild-Editor: Bildtyp + Aufnahmen wählen, Live-Vorschau
export default class extends Controller {
  static targets = ['variant', 'chip', 'canvas', 'message', 'fileName']
  static values = { viewpointId: Number, name: String, shots: Array, variants: Array }

  connect() {
    this.variantTarget.value = this.variantsValue.includes('T') ? 'T' : this.variantsValue[0]
    this.selectDefaults()
  }

  get variant() {
    return this.variantTarget.value
  }

  // Standard: je Flug die letzte Aufnahme, davon die letzten drei Flüge
  selectDefaults() {
    const latestPerFlight = new Map()
    this.shotsValue.forEach((shot, i) => {
      if (shot.files[this.variant]) latestPerFlight.set(shot.flight_id, i)
    })
    this.selected = new Set([...latestPerFlight.values()].sort((a, b) => a - b).slice(-DEFAULT_SHOTS))
    this.update()
  }

  changeVariant() {
    this.selectDefaults()
  }

  toggleShot(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (this.selected.has(index)) this.selected.delete(index)
    else if (this.selected.size < MAX_SHOTS) this.selected.add(index)
    this.update()
  }

  get selectedShots() {
    return [...this.selected].sort((a, b) => a - b).map((i) => this.shotsValue[i])
  }

  update() {
    this.chipTargets.forEach((chip) => {
      const index = Number(chip.dataset.index)
      const available = !!this.shotsValue[index].files[this.variant]
      const on = this.selected.has(index)
      chip.classList.toggle('is-active', on)
      chip.setAttribute('aria-pressed', on)
      chip.disabled = !available || (!on && this.selected.size >= MAX_SHOTS)
    })
    this.redraw()
  }

  async redraw() {
    const token = (this.drawToken = (this.drawToken ?? 0) + 1)
    const shots = this.selectedShots
    this.fileNameTarget.textContent = shots.length >= 2 ? fileNameFor(this.nameValue, shots) : ''

    if (shots.length < 2) {
      this.showMessage('Mindestens zwei Aufnahmen auswählen.')
      return
    }
    try {
      const items = []
      for (const shot of shots) {
        const file = shot.files[this.variant]
        items.push({ bitmap: await loadBitmap(file.thumb ?? file.path), caption: captionFor(shot.taken_at) })
      }
      if (token !== this.drawToken) return // inzwischen neue Auswahl
      draw(this.canvasTarget, items, { maxHeight: 480 })
      this.showMessage(null)
    } catch (error) {
      console.error(error)
      this.showMessage(`Vorschau nicht möglich: ${error?.message ?? error}`)
    }
  }

  showMessage(text) {
    this.messageTarget.hidden = !text
    this.messageTarget.textContent = text ?? ''
    this.canvasTarget.hidden = !!text
  }

  exportSpec() {
    return { viewpointId: this.viewpointIdValue, viewpointName: this.nameValue, variant: this.variant, shots: this.selectedShots }
  }
}

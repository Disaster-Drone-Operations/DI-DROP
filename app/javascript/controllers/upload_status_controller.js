import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import { summary } from '/app/services/upload_queue.js'

// Seitenleiste unten links: Gesamtfortschritt, Geschwindigkeit, Restzeit (Klick → Übersicht)
export default class extends Controller {
  connect() {
    this.onChange = () => this.paint()
    window.addEventListener('uploads:changed', this.onChange)
    this.timer = setInterval(this.onChange, 1000) // Geschwindigkeit/Restzeit auch ohne Ereignis aktualisieren
    this.paint()
  }

  disconnect() {
    window.removeEventListener('uploads:changed', this.onChange)
    clearInterval(this.timer)
  }

  paint() {
    const s = summary()
    this.element.hidden = !s.visible
    if (!s.visible) return
    morph(this.element, render('uploads/_status', { s }))
    this.element.title = this.element.textContent.replace(/\s+/g, ' ').trim() // Tooltip für die schmale Seitenleiste
  }
}

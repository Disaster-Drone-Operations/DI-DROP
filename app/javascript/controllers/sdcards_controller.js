import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import { insertedCards, ejectCard } from '/app/services/sdcard_watcher.js'

// Sidebar: one entry per inserted memory card with „Auswerfen“ (like the Finder)
//   <nav class="nav sdcards" data-controller="sdcards"></nav>
export default class extends Controller {
  connect() {
    this.onChange = () => this.update()
    document.addEventListener('sdcard:changed', this.onChange)
    this.update()
  }

  disconnect() {
    document.removeEventListener('sdcard:changed', this.onChange)
  }

  update() {
    morph(this.element, render('layouts/_sdcards', { cards: insertedCards(), ejecting: this.ejecting ?? null }))
  }

  async eject({ params: { root } }) {
    if (this.ejecting) return
    this.ejecting = root
    this.update()
    await ejectCard(root)
    this.ejecting = null
    this.update()
  }
}

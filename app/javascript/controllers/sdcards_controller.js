import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'
import { insertedCards, ejectCard } from '/app/services/sdcard_watcher.js'
import { showNotice } from '/app/services/notice.js'

// Sidebar: one entry per inserted memory card – click opens it in Finder/Explorer, ⏏ ejects it (like the Finder)
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

  open({ params: { root } }) {
    platform.openPath(root).catch((error) => showNotice(`Karte lässt sich nicht öffnen: ${error?.message ?? error}`, { alert: true }))
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

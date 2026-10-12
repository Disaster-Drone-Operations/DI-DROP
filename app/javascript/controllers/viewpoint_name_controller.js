import { Controller } from '@hotwired/stimulus'
import Viewpoint from '/app/models/viewpoint.js'
import { syncFileNames } from '/app/services/file_namer.js'
import { recordViewpointRename } from '/app/services/viewpoint_renamer.js'

// Name eines Wegpunkts ("Ost 1") – Doppelklick zum Umbenennen.
// Enter speichert, Esc bricht ab, leerer Name = wieder automatisch (Himmelsrichtung).
// Nach dem Speichern wird der Name überall auf der Seite (auch in der Galerie) ersetzt.
export default class extends Controller {
  static values = { id: Number }

  connect() {
    this.edit = this.edit.bind(this)
    this.element.addEventListener('dblclick', this.edit)
  }

  disconnect() {
    this.element.removeEventListener('dblclick', this.edit)
  }

  edit(event) {
    event.preventDefault()
    event.stopPropagation()
    if (this.input) return
    const current = this.element.textContent
    this.input = document.createElement('input')
    this.input.type = 'text'
    this.input.className = 'renamable__input'
    this.input.value = current
    this.input.size = Math.max(8, current.length + 2)
    this.element.textContent = ''
    this.element.append(this.input)
    this.input.focus()
    this.input.select()

    const finish = async (save) => {
      if (!this.input) return
      const value = this.input.value.trim()
      this.input.remove()
      this.input = null
      this.element.textContent = current
      if (save && value !== current) await this.save(value)
    }
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation() // Pfeiltasten nicht an die Galerie weitergeben
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    })
    this.input.addEventListener('blur', () => finish(true))
  }

  async save(value) {
    try {
      const viewpoint = await Viewpoint.find(this.idValue)
      const before = viewpoint.custom_name
      await viewpoint.update({ custom_name: value })
      // Anzeigename neu bestimmen (ohne eigenen Namen ggf. mit Nummer, z. B. "Ost 2")
      const name = (await Viewpoint.forMission(viewpoint.mission_id)).find((v) => v.id === viewpoint.id)?.name ?? value
      window.dispatchEvent(new CustomEvent('viewpoint:renamed', { detail: { id: viewpoint.id, name } }))
      // Dateien mit umbenennen und offene Ansichten (Vorschau, Galerie) über neue Pfade informieren
      const changes = await syncFileNames(viewpoint.mission_id)
      if (changes.length) window.dispatchEvent(new CustomEvent('media:renamed', { detail: { changes } }))
      recordViewpointRename(viewpoint, before)
    } catch (error) {
      console.error(error)
    }
  }
}

window.addEventListener('viewpoint:renamed', (e) => {
  document.querySelectorAll(`[data-controller~="viewpoint-name"][data-viewpoint-name-id-value="${e.detail.id}"]`)
    .forEach((el) => {
      if (!el.querySelector('input')) el.textContent = e.detail.name
    })
})

import { Controller } from '@hotwired/stimulus'
import DeviceName from '/app/models/device_name.js'
import { escapeHtml } from '/app/helpers/index.js'

// Custom name for a serial number (drone, battery) – double-click to name it.
// Enter saves, Esc cancels, empty name = back to the serial number.
// Afterwards the name changes everywhere on the page where this serial number appears.
//   <span data-controller="device-name" data-device-name-kind-value="battery" data-device-name-serial-value="87UP…">Akku A</span>
export default class extends Controller {
  static values = { kind: String, serial: String }

  connect() {
    this.edit = this.edit.bind(this)
    this.element.addEventListener('dblclick', this.edit)
    this.element.title = `Seriennummer ${this.serialValue} – Doppelklick zum Benennen`
  }

  disconnect() {
    this.element.removeEventListener('dblclick', this.edit)
  }

  edit(event) {
    event.preventDefault()
    event.stopPropagation()
    if (this.input) return
    const current = this.element.textContent.trim()
    this.input = document.createElement('input')
    this.input.type = 'text'
    this.input.className = 'renamable__input'
    this.input.value = current
    this.input.placeholder = this.serialValue
    this.input.size = Math.max(10, current.length + 2)
    this.element.textContent = ''
    this.element.append(this.input)
    this.input.focus()
    this.input.select()
    // Don't treat clicks in the input as row selection
    this.input.addEventListener('click', (e) => e.stopPropagation())

    const finish = async (save) => {
      if (!this.input) return
      const value = this.input.value.trim()
      this.input.remove()
      this.input = null
      let shown = current
      if (save) {
        try {
          shown = (await DeviceName.set(this.kindValue, this.serialValue, value)) ?? this.serialValue
        } catch (error) {
          console.error(error)
        }
      }
      const selector = `[data-device-name-kind-value="${this.kindValue}"][data-device-name-serial-value="${CSS.escape(this.serialValue)}"]`
      for (const el of document.querySelectorAll(selector)) {
        el.innerHTML = escapeHtml(shown)
        el.classList.toggle('is-named', shown !== this.serialValue)
      }
    }
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true)
      if (e.key === 'Escape') finish(false)
      e.stopPropagation()
    })
    this.input.addEventListener('blur', () => finish(true))
  }
}

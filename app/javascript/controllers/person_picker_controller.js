import { Controller } from '@hotwired/stimulus'
import Person from '/app/models/person.js'

// Person selection (people/_picker.ejs): „＋ Neue Person …“ asks for the name, creates the person
// right away and selects it – also offered in the other pickers on the page.
export default class extends Controller {
  static targets = ['select', 'dialog', 'name', 'error']

  connect() {
    this.previous = this.selectTarget.value
    this.onClose = () => {
      if (this.selectTarget.value === 'new') this.selectTarget.value = this.previous // cancelled
    }
    this.dialogTarget.addEventListener('close', this.onClose)
  }

  disconnect() {
    this.dialogTarget.removeEventListener('close', this.onClose)
  }

  changed() {
    if (this.selectTarget.value !== 'new') {
      this.previous = this.selectTarget.value
      return
    }
    this.nameTarget.value = ''
    this.errorTarget.hidden = true
    this.dialogTarget.showModal()
    this.nameTarget.focus()
  }

  cancel() {
    this.dialogTarget.close()
  }

  async create() {
    const person = new Person({ name: this.nameTarget.value })
    if (!(await person.save())) {
      this.errorTarget.textContent = `Name ${(person.errors.name ?? ['ungültig']).join(', ')}`
      this.errorTarget.hidden = false
      return
    }
    const short = (await Person.roster()).find((p) => p.id === person.id)?.short ?? ''
    for (const select of document.querySelectorAll('[data-controller~="person-picker"] select')) {
      if (!select.querySelector(`option[value="${person.id}"]`)) {
        select.querySelector('option[value="new"]').before(new Option(`${person.name} (${short})`, person.id))
      }
    }
    this.selectTarget.value = String(person.id)
    this.previous = this.selectTarget.value
    this.dialogTarget.close()
    this.selectTarget.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

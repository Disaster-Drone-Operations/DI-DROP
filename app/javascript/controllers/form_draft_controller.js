import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { loadDraft, saveDraft, clearDraft } from '/lib/drafts.js'

// Merkt sich ein angefangenes Formular als Entwurf (z. B. "Neuer Einsatz"), solange man
// zwischendurch woanders hinschaut. Gespeichert wird erst, wenn wirklich etwas eingegeben wurde.
// Verworfen beim Absenden und bei "Abbrechen" (data-action="form-draft#discard").
//   <div data-controller="form-draft" data-form-draft-key-value="mission-new"
//        data-action="input->form-draft#save change->form-draft#save submit->form-draft#submitted"> … <form> … </div>
export default class extends Controller {
  static values = { key: String }

  connect() {
    const draft = loadDraft(this.keyValue)
    if (draft) this.restore(draft)
  }

  get form() {
    return this.element.tagName === 'FORM' ? this.element : this.element.querySelector('form')
  }

  get fields() {
    return [...this.form.elements].filter((el) => el.name && el.name !== '_method' && el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button')
  }

  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const entries = this.fields
        .filter((el) => !['radio', 'checkbox'].includes(el.type) || el.checked)
        .map((el) => [el.name, el.value])
      saveDraft(this.keyValue, entries)
    }, 200)
  }

  restore(entries) {
    const values = new Map(entries)
    for (const el of this.fields) {
      if (!values.has(el.name)) continue
      if (el.type === 'radio' || el.type === 'checkbox') el.checked = values.get(el.name) === el.value
      else el.value = values.get(el.name)
    }
    // Aufklappbereich öffnen, wenn darin etwas eingetragen ist
    for (const details of this.element.querySelectorAll('details')) {
      if ([...details.querySelectorAll('input[type=text], textarea')].some((el) => el.value.trim())) details.open = true
    }
  }

  submitted() {
    clearTimeout(this.timer)
    clearDraft(this.keyValue)
  }

  // "Abbrechen" / Zurück: Eingaben wirklich verwerfen?
  async discard(event) {
    if (!loadDraft(this.keyValue)) return
    event.preventDefault()
    const href = event.currentTarget.getAttribute('href')
    if (!(await platform.confirm('Die Eingaben für den neuen Einsatz verwerfen?', { okLabel: 'Verwerfen', cancelLabel: 'Weiter bearbeiten' }))) return
    clearTimeout(this.timer)
    clearDraft(this.keyValue)
    location.hash = href
  }
}

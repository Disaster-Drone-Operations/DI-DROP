import { Controller } from '@hotwired/stimulus'

// Fills fields of the page's form with given values (e.g. the training scenario's mission suggestion).
//   <div data-controller="fill" data-fill-values-value='{"mission[title]": "…"}'> … data-action="fill#apply"
export default class extends Controller {
  static values = { values: Object }

  apply() {
    const form = this.element.parentElement.querySelector('form')
    for (const [name, value] of Object.entries(this.valuesValue)) {
      if (!value) continue
      for (const input of form.querySelectorAll(`[name="${CSS.escape(name)}"]`)) {
        if (input.type === 'radio') input.checked = input.value === value
        else input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    form.querySelector('[name="mission[location]"]')?.focus()
  }
}

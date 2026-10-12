import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'

// "Über di-drop": Lizenzliste nachladen (public/data/licenses.json, script/build_licenses.mjs) und filtern
export default class extends Controller {
  static targets = ['licenses']

  async connect() {
    try {
      this.licenseData = await fetch('/data/licenses.json').then((r) => r.json())
      this.paint()
    } catch {
      this.licensesTarget.innerHTML = '<p class="hint">Lizenzliste nicht verfügbar.</p>'
    }
  }

  paint() {
    morph(this.licensesTarget, render('about/_licenses', { data: this.licenseData, query: this.query }))
  }

  filter(event) {
    this.query = event.target.value
    this.paint()
  }

  open(event) {
    event.preventDefault()
    platform.openUrl(event.params.url)
  }
}

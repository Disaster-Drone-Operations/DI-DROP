import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { render } from '/lib/views.js'
import { startTraining, RESET_FLAG } from '/app/services/training.js'

// Settings → Schulung: installed scenarios, start/continue/restart, add a scenario (folder or .zip)
export default class extends Controller {
  static targets = ['body']

  async connect() {
    this.error = null
    await this.load()
  }

  async load() {
    this.scenarios = platform.training ? await platform.training.list().catch((e) => ((this.error = String(e)), [])) : []
    this.bodyTarget.innerHTML = render('settings/_training_body', { scenarios: this.scenarios, available: !!platform.training, error: this.error })
  }

  start({ params: { id } }) {
    startTraining(id)
  }

  // Start again from the beginning: the training window deletes its data itself (the database
  // has to be closed first) – see startTrainingMode()
  async restart({ params: { id, title } }) {
    const ok = await platform.confirm(`„${title}“ von vorne beginnen? Alle Eingaben und importierten Bilder dieser Übung werden gelöscht.`,
      { title: 'Schulung', okLabel: 'Neu starten' })
    if (!ok) return
    try {
      sessionStorage.setItem(RESET_FLAG, id)
    } catch {
      // without session storage: continues instead
    }
    startTraining(id)
  }

  async importFolder() {
    const path = await platform.pickFolder({ title: 'Szenario-Ordner wählen (enthält szenario.json)' })
    if (path) await this.install(path)
  }

  async importZip() {
    const [path] = await platform.pickFiles({ title: 'Szenario als ZIP-Datei wählen', filter: { name: 'Szenario (ZIP)', extensions: ['zip'] }, multiple: false })
    if (path) await this.install(path)
  }

  async install(path) {
    this.error = null
    this.bodyTarget.innerHTML = '<p class="location-status"><span class="spinner"></span><span>Szenario wird eingelesen …</span></p>'
    try {
      await platform.training.import(path)
    } catch (error) {
      this.error = String(error?.message ?? error)
    }
    await this.load()
  }
}

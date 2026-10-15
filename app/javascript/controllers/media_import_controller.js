import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { render } from '/lib/views.js'
import Mission from '/app/models/mission.js'
import MediaImporter from '/app/services/media_importer.js'

// Import a flight's images: drag & drop onto the window or choose folder/files,
// then assign the image blocks to assignments in the dialog.
//   data-media-import-mission-id-value     mission
//   data-media-import-assignment-id-value  (optional) assignment to suggest
//   data-media-import-return-path-value    page to reload afterwards
export default class extends Controller {
  static targets = ['zone', 'dialog']
  static values = { missionId: Number, assignmentId: Number, returnPath: String }

  async connect() {
    if (!platform.media) return
    const unlisten = await platform.media.onDragDrop((event) => this.handleDrag(event))
    if (this.element.isConnected) this.unlisten = unlisten
    else unlisten()

    this.dialogTarget.addEventListener('cancel', (e) => this.state === 'importing' && e.preventDefault())
    this.dialogTarget.addEventListener('close', () => (this.state = null))
  }

  disconnect() {
    this.unlisten?.()
    this.unlisten = null
  }

  // ── Inputs ───────────────────────────────────────────────────────────────

  // Target = element under the mouse pointer: an assignment card (→ assign images directly to
  // that assignment) or otherwise the general import zone
  handleDrag({ type, paths, x, y }) {
    if (this.state || !this.hasZoneTarget) return
    const under = x != null ? document.elementFromPoint(x, y)?.closest('[data-media-import-target~="zone"]') : null
    const zone = under ?? this.zoneTargets.find((z) => !z.dataset.assignmentId) ?? this.zoneTargets[0]
    const hovering = type === 'enter' || type === 'over'
    this.zoneTargets.forEach((z) => z.classList.toggle('is-dragover', hovering && z === zone))
    if (type === 'drop' && paths.length) this.start(paths, { assignmentId: zone?.dataset.assignmentId })
  }

  async pickFiles() {
    const paths = await platform.pickFiles({ title: 'Bilder auswählen' })
    if (paths.length) this.start(paths)
  }

  async pickFolder() {
    const path = await platform.pickFolder({ title: 'Ordner mit Bildern auswählen (z. B. DCIM der SD-Karte)' })
    if (path) this.start([path])
  }

  // ── Flow ─────────────────────────────────────────────────────────────────

  async start(paths, { assignmentId } = {}) {
    this.show('scanning')
    try {
      this.importer = new MediaImporter({ mission: await Mission.find(this.missionIdValue) })
      const review = await this.importer.scan(paths, { preferredAssignmentId: assignmentId || this.assignmentIdValue || null })
      this.show('review', { review })
    } catch (error) {
      console.error(error)
      this.show('error', { error: error?.message ?? String(error) })
    }
  }

  async import(event) {
    event.preventDefault()
    const form = event.target
    const blocks = []
    for (const el of form.querySelectorAll('[data-controller~="import-block"]')) {
      const choice = this.application.getControllerForElementAndIdentifier(el, 'import-block')?.choice()
      if (!choice) return // missing name – message is shown at the field
      blocks.push(choice)
    }
    const data = new FormData(form)
    const selection = { blocks, shotKeys: new Set(data.getAll('shot')), variants: new Set(data.getAll('variant')) }

    this.show('importing', { progress: { done: 0, total: 0, name: '' } })
    try {
      const { imported, failed, flight, assignments } = await this.importer.import(selection, (progress) => this.show('importing', { progress }))
      this.close()
      const names = (assignments ?? []).map((a) => `„${a.title}“`).join(', ')
      const flash = failed.length
        ? { alert: `${imported} importiert, ${failed.length} fehlgeschlagen: ${failed.slice(0, 3).map((f) => `${f.name} (${f.error})`).join('; ')}` }
        : imported
          ? { notice: `${imported} ${imported === 1 ? 'Datei' : 'Dateien'} importiert – Flug ${flight.number}${names ? `, ${names}` : ''}.` }
          : { notice: 'Nichts ausgewählt – nichts importiert.' }
      document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: this.returnPathValue, flash } }))
    } catch (error) {
      console.error(error)
      this.show('error', { error: error?.message ?? String(error) })
    }
  }

  close() {
    this.state = null
    if (this.dialogTarget.open) this.dialogTarget.close()
  }

  show(state, locals = {}) {
    this.state = state
    this.dialogTarget.innerHTML = render('media/_import_dialog', { state, review: null, progress: null, error: null, ...locals })
    if (!this.dialogTarget.open) this.dialogTarget.showModal()
  }
}

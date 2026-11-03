import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { render } from '/lib/views.js'
import Mission from '/app/models/mission.js'
import MediaImporter from '/app/services/media_importer.js'
import { takePendingCard, showCardIn, ejectCard } from '/app/services/sdcard_watcher.js'

// Import a flight's images: drag & drop onto the window or choose folder/files,
// then assign the image blocks to assignments in the dialog.
// Memory cards (app/services/sdcard_watcher.js) open the same dialog with previews and the
// option to delete the imported images from the card afterwards.
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

    this.dialogTarget.addEventListener('cancel', (e) => ['importing', 'deleting', 'ejecting', 'kept'].includes(this.state) && e.preventDefault())
    this.dialogTarget.addEventListener('close', () => (this.state = null))

    this.checkCard = () => this.startPendingCard()
    this.cardRemoved = ({ detail }) => {
      if (this.card?.root === detail.root && ['scanning', 'review'].includes(this.state)) {
        this.show('error', { error: `Die Speicherkarte „${detail.name}“ wurde entfernt.` })
      }
    }
    document.addEventListener('sdcard:pending', this.checkCard)
    document.addEventListener('sdcard:removed', this.cardRemoved)
    this.startPendingCard()
  }

  disconnect() {
    this.unlisten?.()
    this.unlisten = null
    document.removeEventListener('sdcard:pending', this.checkCard)
    document.removeEventListener('sdcard:removed', this.cardRemoved)
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
    this.card = null
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

  // Memory card waiting for this mission (inserted card, see sdcard_watcher.js)
  // The message "Speicherkarte wurde entfernt" (or another error) doesn't block it – the card is back
  async startPendingCard() {
    if ((this.state && this.state !== 'error') || !this.hasDialogTarget) return
    const pending = takePendingCard(this.missionIdValue)
    if (!pending) return
    this.card = pending.card
    this.scanned = pending.scanned
    this.show('scanning')
    try {
      this.importer = new MediaImporter({ mission: await Mission.find(this.missionIdValue) })
      const review = await this.importer.scan([this.card.dcim], { card: true, scanned: this.scanned })
      review.card = this.card
      review.missionId = this.missionIdValue
      review.missions = (await Mission.active()).map((m) => ({ id: m.id, title: m.title }))
      this.show('review', { review })
    } catch (error) {
      console.error(error)
      this.show('error', { error: error?.message ?? String(error) })
    }
  }

  // Memory card: the second checkbox (RTK/PPK files) only counts together with the first
  toggleCardDelete(event) {
    const { delete_companions: companions, clear_card: clear } = event.target.form.elements
    for (const box of [companions, clear]) if (box) box.disabled = !event.target.checked
  }

  // Memory card: import into another active mission instead
  switchMission(event) {
    const card = this.card
    this.close()
    showCardIn(Number(event.target.value), card, this.scanned)
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
      const { imported, failed, assignments, copies } = await this.importer.import(selection, (progress) => this.show('importing', { progress }))
      const cleanup = this.card && data.get('delete_from_card') ? await this.deleteFromCard(copies, { companions: !!data.get('delete_companions'), clear: !!data.get('clear_card') }) : null
      // Eject only once everything to be deleted is really gone – otherwise the dialog stays and says what is left
      const incomplete = cleanup?.kept.length > 0
      const ejectError = this.card && data.get('eject_card') && !incomplete ? await this.ejectCard() : undefined
      const names = (assignments ?? []).map((a) => `„${a.title}“`).join(', ')
      let flash = failed.length
        ? { alert: `${imported} importiert, ${failed.length} fehlgeschlagen: ${failed.slice(0, 3).map((f) => `${f.name} (${f.error})`).join('; ')}` }
        : imported
          ? { notice: `${imported} ${imported === 1 ? 'Bild' : 'Bilder'} importiert${names ? ` – ${names}` : ''}. Wie es weitergeht, steht oben unter „Nächster Schritt“.` }
          : { notice: 'Nichts ausgewählt – nichts importiert.' }
      if (cleanup) flash = this.withCleanup(flash, cleanup)
      if (ejectError !== undefined) flash = this.withEject(flash, ejectError)
      if (incomplete) {
        this.afterKept = { flash, root: this.card.root, eject: !!data.get('eject_card') }
        return this.show('kept', { cleanup, eject: !!data.get('eject_card') })
      }
      this.close()
      document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: this.returnPathValue, flash } }))
    } catch (error) {
      console.error(error)
      this.show('error', { error: error?.message ?? String(error) })
    }
  }

  // Delete the imported originals from the card – everything imported just now, also "older" recordings if they
  // were chosen (not imported = stays on the card); Rust checks every copy again before deleting
  // clear: also everything on the card that was imported earlier (any mission) – i.e. everything safely imported
  async deleteFromCard(copies, { companions, clear }) {
    const items = copies.map(({ src, copy }) => ({ src, copy }))
    if (clear) {
      for (const e of this.importer.entries) if (e.duplicate?.copy) items.push({ src: e.path, copy: e.duplicate.copy })
    }
    if (!items.length) return null
    this.show('deleting')
    try {
      return await platform.sdcard.delete(this.card.root, items, companions)
    } catch (error) {
      return { deleted: [], kept: items.map((i) => ({ src: i.src, reason: String(error) })) }
    }
  }

  // Not everything deleted (dialog "kept"): close – or eject anyway, knowing what is still on the card
  async keptDone({ params: { eject } }) {
    const { flash, root } = this.afterKept ?? {}
    this.afterKept = null
    let result = flash
    if (eject && root) {
      this.show('ejecting')
      const error = await ejectCard(root, { quiet: true })
      result = { alert: `${flash.alert ?? flash.notice}${error ? ` Die Karte wurde nicht ausgeworfen: ${error}` : ' Karte trotzdem ausgeworfen.'}` }
    }
    this.close()
    document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: this.returnPathValue, flash: result } }))
  }

  // „Anschließend auswerfen“ → null or why it didn't work (the result goes into the import message)
  async ejectCard() {
    this.show('ejecting')
    return ejectCard(this.card.root, { quiet: true })
  }

  withEject(flash, error) {
    const text = flash.alert ?? flash.notice
    if (error) return { alert: `${text} Die Karte wurde nicht ausgeworfen: ${error}` }
    return flash.alert ? { alert: `${text} Karte ausgeworfen.` } : { notice: `${text} Die SD-Karte ist ausgeworfen und kann entnommen werden.` }
  }

  withCleanup(flash, { deleted, kept }) {
    const text = flash.alert ?? flash.notice
    const removed = deleted.length ? ` ${deleted.length} von der Karte gelöscht.` : ''
    if (!kept.length) return { ...flash, ...(flash.alert ? { alert: text + removed } : { notice: text + removed }) }
    const reasons = [...new Set(kept.map((k) => k.reason))].slice(0, 2).join('; ')
    return { alert: `${text}${removed} ${kept.length} ${kept.length === 1 ? 'Datei blieb' : 'Dateien blieben'} auf der Karte (${reasons}).` }
  }

  close() {
    this.state = null
    if (this.dialogTarget.open) this.dialogTarget.close()
  }

  show(state, locals = {}) {
    this.state = state
    this.dialogTarget.dataset.state = state // an error message doesn't block a newly inserted card (sdcard_watcher.js)
    this.dialogTarget.innerHTML = render('media/_import_dialog', { state, review: null, progress: null, error: null, cleanup: null, eject: false, ...locals })
    if (!this.dialogTarget.open) this.dialogTarget.showModal()
  }
}

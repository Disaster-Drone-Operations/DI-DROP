import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'

// Choose a Nextcloud folder (partial nextcloud/_folder_field): browse folders, create a new one
// („Neuer Ordner“ → small name dialog, like on the Mac), confirm. Writes the path into the input and
// dispatches "nextcloud-folder:chosen".
export default class extends Controller {
  static targets = ['input', 'dialog', 'body', 'nameDialog', 'newFolder', 'parent', 'nameError', 'createButton']
  static values = { suggestion: String }

  ignore() {}

  async open() {
    this.dialogTarget.showModal()
    this.path = '/'
    const account = await platform.nextcloud?.account().catch(() => null)
    if (!account) {
      return this.paint({ error: platform.nextcloud
        ? 'Noch keine Nextcloud verbunden – erst unter Einstellungen → Nextcloud anmelden.'
        : 'Die Nextcloud lässt sich nur in der Desktop-App durchsuchen. Den Ordner kannst du aber von Hand eintragen.' })
    }
    const current = this.inputTarget.value.trim()
    await this.browse({ params: { path: current || '/' } })
  }

  async browse({ params: { path } }) {
    this.path = path
    this.paint({ loading: true })
    try {
      this.folders = await platform.nextcloud.list(path)
      this.paint({ folders: this.folders })
    } catch (error) {
      // Folder doesn't exist (yet) → one level up
      if (path !== '/' && /nicht gefunden/.test(String(error))) return this.browse({ params: { path: path.split('/').slice(0, -1).join('/') || '/' } })
      this.paint({ error: String(error) })
    }
  }

  paint({ folders = [], loading = false, error = null } = {}) {
    morph(this.bodyTarget, render('nextcloud/_browser', { path: this.path, folders, loading, error }))
  }

  // ── New folder ───────────────────────────────────────────────────────────

  // Suggestion: the mission's folder name – unless it already exists here
  newFolder() {
    const taken = new Set((this.folders ?? []).map((f) => f.name.toLowerCase()))
    const suggestion = this.suggestionValue && !taken.has(this.suggestionValue.toLowerCase()) ? this.suggestionValue : 'Neuer Ordner'
    this.parentTarget.textContent = this.path === '/' ? 'Nextcloud' : this.path.split('/').pop()
    this.newFolderTarget.value = suggestion
    this.nameChanged()
    this.nameDialogTarget.showModal()
    this.newFolderTarget.select()
  }

  get newName() {
    return this.newFolderTarget.value.trim().replace(/[\\/]/g, '-')
  }

  nameChanged() {
    const name = this.newName
    const exists = (this.folders ?? []).some((f) => f.name.toLowerCase() === name.toLowerCase())
    this.showNameError(exists ? `„${name}“ gibt es hier schon.` : null)
    this.createButtonTarget.disabled = !name || exists
  }

  showNameError(text) {
    this.nameErrorTarget.hidden = !text
    this.nameErrorTarget.textContent = text ?? ''
  }

  cancelNewFolder() {
    this.nameDialogTarget.close()
  }

  async createFolder() {
    const name = this.newName
    if (!name || this.createButtonTarget.disabled) return
    const path = `${this.path === '/' ? '' : this.path}/${name}`
    this.createButtonTarget.disabled = true
    try {
      await platform.nextcloud.mkdir(path)
      this.nameDialogTarget.close()
      await this.browse({ params: { path } }) // straight into the new folder
    } catch (error) {
      this.showNameError(String(error))
      this.createButtonTarget.disabled = false
    }
  }

  useFolder() {
    this.inputTarget.value = this.path
    this.inputTarget.dispatchEvent(new Event('input', { bubbles: true }))
    this.dispatch('chosen', { detail: { path: this.path } })
    this.close()
  }

  closeBrowser() {
    this.close()
  }

  close() {
    this.dialogTarget.close()
  }
}

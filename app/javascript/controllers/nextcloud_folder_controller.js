import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'

// Choose a Nextcloud folder (partial nextcloud/_folder_field): browse folders, create a new one,
// confirm. Writes the path into the input and dispatches "nextcloud-folder:chosen".
export default class extends Controller {
  static targets = ['input', 'dialog', 'body', 'newFolder']
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
      this.paint({ folders: await platform.nextcloud.list(path) })
    } catch (error) {
      // Folder doesn't exist (yet) → one level up
      if (path !== '/' && /nicht gefunden/.test(String(error))) return this.browse({ params: { path: path.split('/').slice(0, -1).join('/') || '/' } })
      this.paint({ error: String(error) })
    }
  }

  paint({ folders = [], loading = false, error = null } = {}) {
    morph(this.bodyTarget, render('nextcloud/_browser', { path: this.path, folders, loading, error, suggestion: this.suggestionValue }))
  }

  async createFolder() {
    const name = this.newFolderTarget.value.trim().replace(/[\\/]/g, '-')
    if (!name) return
    const path = `${this.path === '/' ? '' : this.path}/${name}`
    try {
      await platform.nextcloud.mkdir(path)
      await this.browse({ params: { path } })
    } catch (error) {
      this.paint({ error: String(error) })
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

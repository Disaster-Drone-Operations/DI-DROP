import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { importFromDevice } from '/app/services/flightlog_importer.js'

// Dialog "Fernsteuerung erkannt" (flight_logs/_device_dialog in the layout): new flight logs on
// the connected remote controller → take them over, with progress in the dialog.
export default class extends Controller {
  static targets = ['dialog']

  connect() {
    this.onOffer = ({ detail }) => this.offer(detail)
    this.onProgress = ({ detail }) => this.state === 'importing' && detail.state === 'running' && this.show('importing', { progress: detail })
    window.addEventListener('flightlogs:offer', this.onOffer)
    window.addEventListener('flightlogs:progress', this.onProgress)
    this.dialogTarget.addEventListener('cancel', (e) => this.state === 'importing' && e.preventDefault())
    this.dialogTarget.addEventListener('close', () => (this.state = null))
  }

  disconnect() {
    window.removeEventListener('flightlogs:offer', this.onOffer)
    window.removeEventListener('flightlogs:progress', this.onProgress)
  }

  offer({ device, status }) {
    if (this.state === 'importing') return
    this.device = device
    this.status = status
    this.show('offer')
  }

  async import() {
    this.show('importing', { progress: null })
    try {
      const result = await importFromDevice(this.device)
      this.show('done', { result })
    } catch (error) {
      this.show('error', { error: error?.message ?? String(error) })
    }
  }

  showLogs() {
    this.close()
    document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: '/flightlogs' } }))
  }

  close() {
    this.state = null
    if (this.dialogTarget.open) this.dialogTarget.close()
  }

  show(state, locals = {}) {
    this.state = state
    this.dialogTarget.innerHTML = render('flight_logs/_device', {
      state, device: this.device, status: this.status, progress: null, result: null, error: null, ...locals,
    })
    if (!this.dialogTarget.open) this.dialogTarget.showModal()
  }
}

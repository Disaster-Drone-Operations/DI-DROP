import { Controller } from '@hotwired/stimulus'
import { icon, escapeHtml } from '/app/helpers/index.js'

// Seitenleiste unten: Fortschritt beim Übernehmen von Flugprotokollen (Ereignis "flightlogs:progress")
export default class extends Controller {
  connect() {
    this.onProgress = (event) => this.show(event.detail)
    window.addEventListener('flightlogs:progress', this.onProgress)
  }

  disconnect() {
    window.removeEventListener('flightlogs:progress', this.onProgress)
    clearTimeout(this.timer)
  }

  show({ state, text, done, total, added, failed }) {
    clearTimeout(this.timer)
    this.element.hidden = false
    this.element.className = `flightlog-progress flightlog-progress--${state}`
    if (state === 'running') {
      const percent = total ? Math.round((done / total) * 100) : null
      this.element.innerHTML = `<div class="upload-status__line">${icon('protocol', { size: 14 })}<span class="upload-status__title">${escapeHtml(text)}</span></div>
        <div class="progress-bar"><span style="width: ${percent ?? 15}%"></span></div>`
    } else if (state === 'done') {
      const msg = added ? `${added} ${added === 1 ? 'Flugprotokoll' : 'Flugprotokolle'} übernommen` : 'Flugprotokolle aktuell'
      this.element.innerHTML = `<div class="upload-status__line">${icon('check', { size: 14 })}<span class="upload-status__title">${msg}${failed?.length ? ` · ${failed.length} nicht lesbar` : ''}</span></div>`
      this.timer = setTimeout(() => (this.element.hidden = true), 8000)
    } else {
      this.element.innerHTML = `<div class="upload-status__line">${icon('alert', { size: 14 })}<span class="upload-status__title">${escapeHtml(text)}</span></div>`
      this.timer = setTimeout(() => (this.element.hidden = true), 15000)
    }
  }
}

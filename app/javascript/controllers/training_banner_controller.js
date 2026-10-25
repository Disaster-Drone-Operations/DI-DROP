import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { isTraining, openControl, endTraining } from '/app/services/training.js'
import { nowMs } from '/lib/clock.js'
import { icon, escapeHtml } from '/app/helpers/index.js'

const pad = (n) => String(n).padStart(2, '0')

// Strip at the top of the sidebar in training mode: scenario, simulated time, control, end.
// In the browser bridge the control is docked at the bottom of the window (no second window).
export default class extends Controller {
  connect() {
    if (!isTraining()) return
    this.element.hidden = false
    this.onState = ({ detail }) => this.paint(detail)
    window.addEventListener('training:state', this.onState)
    this.timer = setInterval(() => this.tickClock(), 500)
    this.paint(null)
    platform.training.emit('training:hello', {}) // asks for the current state
  }

  disconnect() {
    window.removeEventListener('training:state', this.onState)
    clearInterval(this.timer)
  }

  paint(state) {
    if (state) this.title = state.title
    this.element.innerHTML = `
      <div class="training-banner__line"><span class="training-badge">Schulung</span><span class="training-banner__clock" data-clock></span></div>
      <div class="training-banner__title truncate">${escapeHtml(this.title ?? '')}</div>
      <div class="training-banner__actions">
        <button type="button" class="button button--small" data-action="training-banner#control">${icon('sliders', { size: 13 })}<span>Steuerung</span></button>
        <button type="button" class="button button--small button--quiet" data-action="training-banner#end">Beenden</button>
      </div>`
    this.tickClock()
  }

  tickClock() {
    const el = this.element.querySelector('[data-clock]')
    const d = new Date(nowMs())
    if (el) el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  control() {
    openControl()
  }

  async end() {
    if (await platform.confirm('Schulung beenden und zu den echten Einsätzen zurückkehren? Die Schulung kann später fortgesetzt werden.', { title: 'Schulung', okLabel: 'Beenden' })) endTraining()
  }
}

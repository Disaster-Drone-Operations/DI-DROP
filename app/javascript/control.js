// Trainer's control for the training mode: in its own window (index.html?control=<scenario>) or docked
// into the main window (browser bridge). Only shows the state and sends commands – the logic is in
// app/services/training.js in the main window. Later the phone uses the same commands.

import platform from '/lib/platform/index.js'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import QRCode from 'qrcode'

const pad = (n) => String(n).padStart(2, '0')

export function mountControl(element, { docked = false } = {}) {
  let state = null
  let qr = { url: null, dataUrl: null }
  const paint = () => morph(element, render('training/_control', { state, docked, qrDataUrl: qr.dataUrl }))

  // Clock runs locally between two state messages
  const tick = () => {
    if (!state) return
    const { at, speed, running, sentAt } = state.clock
    const d = new Date(at + (running ? (Date.now() - sentAt) * speed : 0))
    const clock = element.querySelector('[data-clock]')
    if (clock) clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    const date = element.querySelector('[data-clock-date]')
    if (date) date.textContent = `${d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}${running && speed > 1 ? ` · Zeitraffer ${speed}×` : running ? '' : ' · angehalten'}`
  }

  element.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-command]')
    if (!button) return
    const { command, confirm: question, ...args } = button.dataset
    if (command === 'ui.undock') return element.dispatchEvent(new CustomEvent('training:undock', { bubbles: true }))
    if (question && !(await platform.confirm(question, { title: 'Schulung', okLabel: 'Neu starten' }))) return
    platform.training.emit('training:command', { action: command, ...args })
  })

  const stop = platform.training.listen('training:state', async (next) => {
    state = next
    const url = state?.phone?.qrUrl ?? null
    if (url !== qr.url) qr = { url, dataUrl: url ? await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 360 }) : null }
    paint()
    tick()
  })
  const timer = setInterval(tick, 250)
  paint()
  platform.training.emit('training:hello', {})
  return async () => {
    clearInterval(timer)
    ;(await stop)()
  }
}

// Own window
export async function start(element, id) {
  document.documentElement.classList.add('control-window')
  document.title = 'di-drop – Schulungssteuerung'
  element.innerHTML = '<div class="training-control"></div>'
  mountControl(element.firstElementChild)
}

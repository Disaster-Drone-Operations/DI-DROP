// Training mode: stands in for LocationRelayClient (lib/location/relay_client.js) – no relay, no real phone.
// di-drop shows a QR code as usual; the trainer "scans" it in the training control (app/services/training.js)
// and the position of the scenario arrives like from a real phone.
//
//   const client = new SimulatedLocationClient({ position: () => ({ lat, lon, alt, accuracy }), onPosition, onStatus })
//   const { qrUrl } = await client.start('single' | 'stream')
//   client.scan() · client.deny() · client.phoneStop()   ← training control
//   client.stop()                                         ← di-drop

const STATUS_TEXT = {
  connecting: 'Verbinde …',
  waiting: 'QR-Code mit dem Telefon scannen',
  pairing: 'Telefon verbindet sich …',
  paired: 'Telefon verbunden – warte auf Freigabe am Telefon',
  streaming: 'Live-Standort wird empfangen',
  done: 'Standort empfangen',
  stopped: 'Übertragung beendet',
}
const LIVE_INTERVAL_MS = 5000
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class SimulatedLocationClient {
  constructor({ position, onPosition = () => {}, onStatus = () => {} }) {
    this.position = position
    this.onPosition = onPosition
    this.onStatus = onStatus
    this.status = 'idle'
    this.seq = 0
  }

  setStatus(status, text = null) {
    this.status = status
    this.onStatus({ status, text: text ?? STATUS_TEXT[status] ?? status, mode: this.mode })
  }

  async start(mode = 'single') {
    this.mode = mode
    this.active = true
    this.setStatus('connecting')
    await wait(300)
    // Looks like a pairing link – but leads nowhere (.invalid)
    const id = crypto.getRandomValues(new Uint8Array(12)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
    this.qrUrl = `https://schulung.di-drop.invalid/telefon#v1:${id}`
    if (this.active) this.setStatus('waiting')
    return { qrUrl: this.qrUrl }
  }

  // Trainer: the phone scans the QR code and allows the location access
  async scan() {
    if (!this.active || this.status !== 'waiting') return
    this.setStatus('pairing')
    await wait(700)
    if (!this.active) return
    this.setStatus('paired')
    await wait(1200)
    if (!this.active) return
    this.send()
    if (this.mode === 'single') return this.finish('done')
    this.setStatus('streaming')
    this.timer = setInterval(() => this.send(), LIVE_INTERVAL_MS)
  }

  // Trainer: location access refused on the phone
  deny() {
    if (!this.active) return
    this.finish('error', 'Am Telefon wurde der Standortzugriff verweigert.')
  }

  // Trainer: live transfer ended on the phone
  phoneStop() {
    if (this.active && this.mode === 'stream') this.finish('stopped')
  }

  send() {
    const p = this.position()
    if (!p) return this.finish('error', 'Das Telefon konnte seinen Standort nicht bestimmen.')
    // A few metres of GPS noise, like a real phone
    const jitter = () => (Math.random() - 0.5) * 0.00008
    this.onPosition({
      lat: p.lat + jitter(), lon: p.lon + jitter(), alt: p.alt ?? null, accuracy: p.accuracy ?? 8,
      timestamp: Date.now(), seq: ++this.seq, receivedAt: Date.now(), source: 'smartphone',
    })
  }

  async stop() {
    if (this.active) this.finish('stopped')
  }

  finish(status, text = null) {
    clearInterval(this.timer)
    this.active = false
    this.setStatus(status, text)
  }
}

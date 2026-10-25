// Phone as remote control for the training mode (relay protocol, docs/location-relay-protocol.md §7).
//
//   const client = new ControlRelayClient({ relayBaseUrl, onCommand, onStatus })
//   const { qrUrl } = await client.start()
//   client.sendState(state)   // whenever something changes (throttled)
//
// The phone sends { type: 'command', action, … } and gets { type: 'state', state }. If its connection
// drops (screen off, dead zone) it comes back with the same QR secret and pairs again.

import { RelayClient } from '/lib/relay/relay_client.js'

const MIN_INTERVAL = 1000 // relay rate limit: 20 messages per 10 s

export class ControlRelayClient extends RelayClient {
  static pairingMode = 'control'
  static keepTrying = true

  constructor({ relayBaseUrl, onCommand = () => {}, onStatus = () => {} }) {
    super({ relayBaseUrl, onStatus })
    this.onCommand = onCommand
    this.lastSent = 0
    Object.assign(this.statusTexts, {
      waiting: 'QR-Code mit dem Telefon scannen',
      paired: 'Telefon verbunden',
      disconnected: 'Telefon getrennt – es verbindet sich von selbst neu (oder QR-Code erneut scannen)',
    })
  }

  paired() {
    this.lastSent = 0
    return this.flush()
  }

  async receive(payload) {
    if (payload.type === 'command' && typeof payload.action === 'string') await this.onCommand(payload)
  }

  // Remembers the newest state and sends it at most once per second
  sendState(state) {
    this.pending = state
    if (this.status !== 'paired' || this.timer) return
    const wait = Math.max(0, this.lastSent + MIN_INTERVAL - Date.now())
    this.timer = setTimeout(() => this.flush(), wait)
  }

  async flush() {
    clearTimeout(this.timer)
    this.timer = null
    if (!this.pending || this.status !== 'paired' || !this.active) return
    this.lastSent = Date.now()
    await this.sendSealed({ type: 'state', state: this.pending }).catch(() => {})
  }

  finish(status) {
    clearTimeout(this.timer)
    super.finish(status)
  }
}

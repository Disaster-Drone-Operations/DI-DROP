// Location from the smartphone (relay protocol, docs/location-relay-protocol.md).
// Knows only the relay address – no Cloudflare details.
//
//   const client = new LocationRelayClient({ relayBaseUrl, onPosition, onStatus })
//   const { qrUrl } = await client.start('single' | 'stream')
//   client.stop()
//
// Status (onStatus): connecting → waiting (QR visible) → pairing → paired → receiving/streaming
//                    → done | stopped | error

import { isPlausiblePosition } from '/relay/protocol.js'
import { RelayClient } from '/lib/relay/relay_client.js'

export class LocationRelayClient extends RelayClient {
  constructor({ relayBaseUrl, onPosition = () => {}, onStatus = () => {} }) {
    super({ relayBaseUrl, onStatus })
    this.onPosition = onPosition
    Object.assign(this.statusTexts, {
      paired: 'Smartphone verbunden – warte auf Freigabe am Smartphone',
      streaming: 'Live-Standort wird empfangen',
      done: 'Standort empfangen',
    })
    Object.assign(this.errors, {
      PERMISSION_DENIED: 'Am Smartphone wurde der Standortzugriff verweigert.',
      POSITION_UNAVAILABLE: 'Das Smartphone konnte seinen Standort nicht bestimmen.',
      TIMEOUT: 'Das Smartphone hat zu lange für die Standortbestimmung gebraucht.',
    })
  }

  start(mode = 'single') {
    return super.start(mode)
  }

  paired() {
    return this.sendSealed({ type: 'request', mode: this.mode })
  }

  async receive(payload) {
    if (payload.type === 'position') {
      if (!isPlausiblePosition(payload)) return
      await this.sendSealed({ type: 'ack', ackSeq: payload.seq })
      this.onPosition({ ...payload, receivedAt: Date.now(), source: 'smartphone' })
      if (this.mode === 'single') return this.finish('done')
      return this.setStatus('streaming')
    }
    if (payload.type === 'status' && payload.state === 'stopped' && this.mode === 'stream') {
      return this.finish('stopped')
    }
    if (payload.type === 'error') return this.fail(payload.code, this.errors[payload.code] ?? payload.code)
  }

  // End the live transfer or close the session
  async stop() {
    if (!this.active) return
    try {
      if (this.mode === 'stream' && this.status === 'streaming') await this.sendSealed({ type: 'stop' })
    } catch {
      // doesn't matter – we're closing anyway
    }
    this.finish('stopped')
  }
}

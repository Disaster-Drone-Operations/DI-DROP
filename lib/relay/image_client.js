// Image to the smartphone (relay protocol, docs/location-relay-protocol.md §6).
//
//   const client = new ImageRelayClient({ relayBaseUrl, image: { blob, name }, onStatus })
//   const { qrUrl } = await client.start()
//
// After pairing: sealed image-offer, then one encrypted binary frame per block, then the phone
// confirms with image-received. Status: connecting → waiting → pairing → sending → delivering
//                                       → done | stopped | error

import { CHUNK_BYTES, MAX_IMAGE_BYTES, randomB64url, sha256B64url } from '/relay/protocol.js'
import { RelayClient } from '/lib/relay/relay_client.js'

// Don't let the WebSocket buffer grow beyond this (memory, progress display)
const MAX_BUFFERED = 1024 * 1024

export class ImageRelayClient extends RelayClient {
  static pairingMode = 'image'

  constructor({ relayBaseUrl, image, onStatus = () => {} }) {
    super({ relayBaseUrl, onStatus })
    if (image.blob.size > MAX_IMAGE_BYTES) throw new Error('Das Bild ist zu groß für die Übertragung.')
    this.image = image
    Object.assign(this.statusTexts, {
      paired: 'Smartphone verbunden',
      delivering: 'Warte auf Bestätigung vom Smartphone …',
      done: 'Bild ist auf dem Smartphone angekommen',
    })
    Object.assign(this.errors, {
      IMAGE_INVALID: 'Das Bild kam auf dem Smartphone unvollständig an. Bitte erneut senden.',
    })
  }

  async paired() {
    const { blob, name } = this.image
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const chunks = Math.ceil(bytes.length / CHUNK_BYTES)
    this.transferId = randomB64url(16)
    await this.sendSealed({
      type: 'image-offer', transferId: this.transferId, name, mime: blob.type || 'image/jpeg',
      size: bytes.length, sha256: await sha256B64url(bytes), chunks,
    })
    this.setStatus('sending', 'Sende Bild … 0 %')
    const ws = this.ws
    for (let i = 0; i < chunks; i++) {
      while (ws.bufferedAmount > MAX_BUFFERED) {
        await new Promise((r) => setTimeout(r, 50))
        if (this.ws !== ws || !this.active) return // connection lost or cancelled
      }
      ws.send(await this.channel.sealChunk(this.transferId, i, bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)))
      this.setStatus('sending', `Sende Bild … ${Math.floor(((i + 1) / chunks) * 100)} %`)
    }
    this.setStatus('delivering')
  }

  async receive(payload) {
    if (payload.transferId !== this.transferId) return
    if (payload.type === 'image-received') return this.finish('done')
    if (payload.type === 'image-error') return this.fail(payload.code, this.errors[payload.code] ?? payload.code)
  }

  // A lost connection while sending can't be resumed (blocks would be missing) → send again
  reconnect() {
    if (['sending', 'delivering'].includes(this.status)) return this.fail('NETWORK', 'Verbindung unterbrochen – bitte erneut senden.')
    return super.reconnect()
  }
}

// Desktop side of the relay protocol v1 (docs/location-relay-protocol.md): session, pairing,
// reconnect. What happens after pairing is up to the subclasses:
//   LocationRelayClient (lib/location/relay_client.js) – position from the phone
//   ImageRelayClient    (lib/relay/image_client.js)    – image to the phone
//
// Subclasses implement paired() and receive(payload) and may extend statusTexts/errors.

import { createSecrets, createChannel, pairingUrl, sessionSocketUrl, send, VERSION } from '/relay/protocol.js'

const RECONNECT_DELAYS = [1000, 2000, 5000, 10_000, 20_000]

const STATUS_TEXT = {
  connecting: 'Verbinde mit dem Relay …',
  waiting: 'QR-Code mit dem Smartphone scannen',
  pairing: 'Smartphone verbindet sich …',
  stopped: 'Übertragung beendet',
  reconnecting: 'Verbindung unterbrochen – verbinde neu …',
  error: 'Fehler',
}

const ERRORS = {
  UNAUTHORIZED: 'Der Relay hat die Verbindung abgelehnt.',
  SESSION_EXPIRED: 'Die Sitzung ist abgelaufen. Bitte neu starten.',
  RATE_LIMITED: 'Zu viele Nachrichten – der Relay bremst.',
  DECRYPT_FAILED: 'Eine Nachricht konnte nicht entschlüsselt werden – Übertragung abgebrochen.',
}

export class RelayClient {
  // QR fragment mode for the phone page (null = location)
  static pairingMode = null

  constructor({ relayBaseUrl, onStatus = () => {} }) {
    this.relayBaseUrl = relayBaseUrl
    this.onStatus = onStatus
    this.status = 'idle'
    this.attempt = 0
    this.statusTexts = { ...STATUS_TEXT }
    this.errors = { ...ERRORS }
  }

  setStatus(status, detail = null) {
    this.status = status
    this.onStatus({ status, text: detail ?? this.statusTexts[status] ?? status, mode: this.mode })
  }

  // Starts a session; returns the QR URL as soon as the relay has confirmed the desktop role
  async start(mode = null) {
    this.mode = mode
    this.secrets = createSecrets()
    this.channel = await createChannel({ ...this.secrets, role: 'desktop' })
    this.qrUrl = pairingUrl(this.relayBaseUrl, this.secrets, this.constructor.pairingMode)
    this.active = true
    this.setStatus('connecting')
    await this.connect()
    this.setStatus('waiting')
    return { qrUrl: this.qrUrl }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(sessionSocketUrl(this.relayBaseUrl, this.secrets.sessionId))
      this.ws = ws
      let ready = false
      ws.onopen = () => send(ws, { type: 'hello', role: 'desktop', token: this.secrets.desktopToken })
      ws.onerror = () => {
        if (!ready) reject(new Error('Relay nicht erreichbar'))
      }
      ws.onmessage = (event) => {
        let msg
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        if (msg.v !== VERSION) return
        if (msg.type === 'desktop-ready') {
          ready = true
          this.attempt = 0
          return resolve()
        }
        if (!ready && msg.type === 'error') return reject(new Error(this.errors[msg.code] ?? msg.message ?? msg.code))
        this.handle(msg).catch((error) => this.fail(error.code, error.message))
      }
      ws.onclose = () => {
        if (!ready) return reject(new Error('Relay hat die Verbindung geschlossen'))
        if (this.active && this.ws === ws) this.reconnect()
      }
    })
  }

  // Connection to the relay lost → reconnect with the same token (smartphone stays paired)
  async reconnect() {
    const delay = RECONNECT_DELAYS[this.attempt++]
    if (delay == null) return this.fail('NETWORK', 'Keine Verbindung zum Relay.')
    const previous = this.status
    this.setStatus('reconnecting')
    await new Promise((r) => setTimeout(r, delay))
    if (!this.active) return
    try {
      await this.connect()
      this.setStatus(previous === 'reconnecting' ? 'waiting' : previous)
    } catch {
      this.reconnect()
    }
  }

  async handle(msg) {
    if (msg.type === 'phone-connected') {
      this.phoneId = msg.phoneId
      if (msg.paired) return // after reconnect: still paired
      return this.setStatus('pairing')
    }
    if (msg.type === 'phone-disconnected') {
      if (this.status !== 'done') this.setStatus('waiting', 'Smartphone getrennt – QR-Code erneut scannen')
      return
    }
    if (msg.type === 'error') {
      if (msg.code === 'NO_RECEIVER') return // e.g. "no paired smartphone" when sending
      return this.fail(msg.code, this.errors[msg.code] ?? msg.message)
    }
    if (msg.type === 'close') return this.finish('stopped')
    if (msg.type !== 'data') return

    let payload
    try {
      payload = await this.channel.open(msg)
    } catch (error) {
      // Pairing probe with a wrong key → reject; otherwise abort (fail closed)
      if (this.status === 'pairing' || this.status === 'waiting') {
        send(this.ws, { type: 'reject', phoneId: msg.phoneId })
        return
      }
      throw error
    }

    if (payload.type === 'pair') {
      send(this.ws, { type: 'accept', phoneId: msg.phoneId })
      this.setStatus('paired')
      return this.paired()
    }
    return this.receive(payload)
  }

  // Override: smartphone is paired (desktop may send now)
  async paired() {}

  // Override: decrypted message from the smartphone
  async receive() {}

  async sendSealed(payload) {
    this.ws.send(JSON.stringify(await this.channel.seal(payload)))
  }

  async stop() {
    if (this.active) this.finish('stopped')
  }

  finish(status) {
    this.active = false
    try {
      send(this.ws, { type: 'close' })
      this.ws.close()
    } catch {
      // already closed
    }
    this.secrets = null // don't keep secrets around
    this.setStatus(status)
  }

  fail(code, message) {
    this.finish('error')
    this.setStatus('error', message ?? this.errors[code] ?? code)
  }
}

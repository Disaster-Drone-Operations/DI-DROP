// Desktop side of the Location Relay Protocol v1 (docs/location-relay-protocol.md).
// Knows only the relay address – no Cloudflare details.
//
//   const client = new LocationRelayClient({ relayBaseUrl, onPosition, onStatus })
//   const { qrUrl } = await client.start('single' | 'stream')
//   client.stop()
//
// Status (onStatus): connecting → waiting (QR visible) → pairing → paired → receiving/streaming
//                    → done | stopped | error

import {
  createSecrets, createChannel, pairingUrl, sessionSocketUrl, isPlausiblePosition, send, VERSION,
} from '/relay/protocol.js'

const RECONNECT_DELAYS = [1000, 2000, 5000, 10_000, 20_000]

export const STATUS_TEXT = {
  connecting: 'Verbinde mit dem Relay …',
  waiting: 'QR-Code mit dem Smartphone scannen',
  pairing: 'Smartphone verbindet sich …',
  paired: 'Smartphone verbunden – warte auf Freigabe am Smartphone',
  streaming: 'Live-Standort wird empfangen',
  done: 'Standort empfangen',
  stopped: 'Übertragung beendet',
  reconnecting: 'Verbindung unterbrochen – verbinde neu …',
  error: 'Fehler',
}

const ERRORS = {
  UNAUTHORIZED: 'Der Relay hat die Verbindung abgelehnt.',
  SESSION_EXPIRED: 'Die Sitzung ist abgelaufen. Bitte neu starten.',
  RATE_LIMITED: 'Zu viele Nachrichten – der Relay bremst.',
  PERMISSION_DENIED: 'Am Smartphone wurde der Standortzugriff verweigert.',
  POSITION_UNAVAILABLE: 'Das Smartphone konnte seinen Standort nicht bestimmen.',
  TIMEOUT: 'Das Smartphone hat zu lange für die Standortbestimmung gebraucht.',
  DECRYPT_FAILED: 'Eine Nachricht konnte nicht entschlüsselt werden – Übertragung abgebrochen.',
}

export class LocationRelayClient {
  constructor({ relayBaseUrl, onPosition = () => {}, onStatus = () => {} }) {
    this.relayBaseUrl = relayBaseUrl
    this.onPosition = onPosition
    this.onStatus = onStatus
    this.status = 'idle'
    this.attempt = 0
  }

  setStatus(status, detail = null) {
    this.status = status
    this.onStatus({ status, text: detail ?? STATUS_TEXT[status] ?? status, mode: this.mode })
  }

  // Starts a session; returns the QR URL as soon as the relay has confirmed the desktop role
  async start(mode = 'single') {
    this.mode = mode
    this.secrets = createSecrets()
    this.channel = await createChannel({ ...this.secrets, role: 'desktop' })
    this.qrUrl = pairingUrl(this.relayBaseUrl, this.secrets)
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
        if (!ready && msg.type === 'error') return reject(new Error(ERRORS[msg.code] ?? msg.message ?? msg.code))
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
      return this.fail(msg.code, ERRORS[msg.code] ?? msg.message)
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
      return this.sendSealed({ type: 'request', mode: this.mode })
    }
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
    if (payload.type === 'error') return this.fail(payload.code, ERRORS[payload.code] ?? payload.code)
  }

  async sendSealed(payload) {
    this.ws.send(JSON.stringify(await this.channel.seal(payload)))
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
    this.setStatus('error', message ?? ERRORS[code] ?? code)
  }
}

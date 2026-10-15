// di-drop Location Relay – Cloudflare Worker + Durable Object
// Protocol: docs/location-relay-protocol.md
//
// Per session the relay connects exactly one desktop and at most one phone and passes
// encrypted messages through. It knows no keys, sees no positions and
// stores nothing persistently (only an alarm for the session end).
//
// relay/bundle.js bundles this file together with the phone web page into a
// single worker module (replacing the ASSETS and BUNDLE placeholders).
// Error texts sent to clients may be shown on the phone page, so they stay German.

const ASSETS = /*@@ASSETS@@*/ {} // { "/": {type, body}, "/app.js": …, "/protocol.js": … }
const BUNDLE = /*@@BUNDLE@@*/ {} // { version, protocol }

const SESSION_MAX_MS = 8 * 60 * 60 * 1000
const MAX_MESSAGE_BYTES = 4096
const RATE_WINDOW_MS = 10_000
const RATE_MAX = 20

// Desktop origins (Tauri on macOS/Windows, dev server). Phone = same origin.
const DESKTOP_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420']

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      // May be queried from anywhere (connection test in the desktop app), contains nothing sensitive
      const response = json({ ok: true, protocol: BUNDLE.protocol, relay: 'cloudflare', bundle: BUNDLE.version })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    const session = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{22})$/)
    if (session) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket erwartet', { status: 426 })
      const origin = request.headers.get('Origin')
      if (origin && origin !== url.origin && !DESKTOP_ORIGINS.includes(origin)) {
        return new Response('Herkunft nicht erlaubt', { status: 403 })
      }
      const stub = env.SESSIONS.get(env.SESSIONS.idFromName(session[1]))
      return stub.fetch(request)
    }

    const asset = ASSETS[url.pathname === '/index.html' ? '/' : url.pathname]
    if (asset && request.method === 'GET') {
      return new Response(asset.body, {
        headers: {
          'Content-Type': asset.type,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ` +
            `connect-src 'self' wss://${url.host}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          'Permissions-Policy': 'geolocation=(self)',
        },
      })
    }
    return new Response('Nicht gefunden', { status: 404 })
  },
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const randomId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replace(/[+/=]/g, 'x')

// One session = one Durable Object. State lives exclusively in the WebSocket attachments –
// that way it survives hibernation.
//   Desktop: { role: 'desktop', tokenHash, expiresAt }
//   Phone:   { role: 'phone', id, paired, pairUsed, tokenHash, expiresAt }
export class RelaySession {
  constructor(ctx) {
    this.ctx = ctx
    this.rates = new Map() // WebSocket → timestamps (volatile only, for rate limiting)
  }

  async fetch() {
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ role: null })
    return new Response(null, { status: 101, webSocket: client })
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  sockets(role) {
    return this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment()?.role === role)
  }

  desktop() {
    return this.sockets('desktop')[0] ?? null
  }

  pairedPhone() {
    return this.sockets('phone').find((ws) => ws.deserializeAttachment().paired) ?? null
  }

  // Session claim (hash of the desktop token), stored in all attachments
  claim() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment()
      if (a?.tokenHash) return { tokenHash: a.tokenHash, expiresAt: a.expiresAt }
    }
    return null
  }

  send(ws, message) {
    try {
      ws.send(JSON.stringify({ v: 1, ...message }))
    } catch {
      // connection already gone
    }
  }

  fail(ws, code, message = code) {
    this.send(ws, { type: 'error', code, message })
    this.close(ws, 4000, code)
  }

  close(ws, code = 1000, reason = '') {
    try {
      ws.close(code, reason)
    } catch {
      // already closed
    }
  }

  limited(ws) {
    const now = Date.now()
    const times = (this.rates.get(ws) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
    times.push(now)
    this.rates.set(ws, times)
    return times.length > RATE_MAX
  }

  // ── WebSocket events ───────────────────────────────────────────────────────

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return this.fail(ws, 'INVALID_MESSAGE', 'Nachricht zu groß oder kein Text')
    if (this.limited(ws)) return this.fail(ws, 'RATE_LIMITED', 'Zu viele Nachrichten')

    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return this.fail(ws, 'INVALID_MESSAGE', 'Kein gültiges JSON')
    }
    if (msg?.v !== 1 || typeof msg.type !== 'string') return this.fail(ws, 'INVALID_MESSAGE', 'Protokollversion fehlt')

    const claim = this.claim()
    if (claim && claim.expiresAt < Date.now()) return this.expire()

    const att = ws.deserializeAttachment() ?? {}
    if (!att.role) return this.hello(ws, msg, claim)
    if (att.role === 'desktop') return this.fromDesktop(ws, msg)
    return this.fromPhone(ws, att, msg)
  }

  async hello(ws, msg, claim) {
    if (msg.type !== 'hello') return this.fail(ws, 'INVALID_MESSAGE', 'Zuerst hello senden')

    if (msg.role === 'desktop') {
      if (typeof msg.token !== 'string' || msg.token.length < 40) return this.fail(ws, 'UNAUTHORIZED', 'Token fehlt')
      const tokenHash = await sha256(msg.token)
      if (claim && claim.tokenHash !== tokenHash) return this.fail(ws, 'UNAUTHORIZED', 'Session gehört einem anderen Desktop')

      const expiresAt = claim?.expiresAt ?? Date.now() + SESSION_MAX_MS
      if (!claim) await this.ctx.storage.setAlarm(expiresAt)
      // Reconnect: replace older desktop connection
      for (const old of this.sockets('desktop')) this.close(old, 4001, 'REPLACED')
      ws.serializeAttachment({ role: 'desktop', tokenHash, expiresAt })
      this.send(ws, { type: 'desktop-ready', expiresAt })
      const phone = this.pairedPhone()
      if (phone) this.send(ws, { type: 'phone-connected', phoneId: phone.deserializeAttachment().id, paired: true })
      return
    }

    if (msg.role === 'phone') {
      const desktop = this.desktop()
      if (!claim || !desktop) return this.fail(ws, 'NO_RECEIVER', 'Kein Empfänger verbunden')
      if (this.pairedPhone()) return this.fail(ws, 'ALREADY_PAIRED', 'Es ist bereits ein Smartphone verbunden')
      // A new, not yet confirmed phone replaces an older unconfirmed one
      for (const old of this.sockets('phone')) this.close(old, 4001, 'REPLACED')
      const id = randomId()
      ws.serializeAttachment({ role: 'phone', id, paired: false, pairUsed: false, ...claim })
      this.send(desktop, { type: 'phone-connected', phoneId: id, paired: false })
      return
    }

    return this.fail(ws, 'INVALID_MESSAGE', 'Unbekannte Rolle')
  }

  fromDesktop(ws, msg) {
    const findPhone = (id) => this.sockets('phone').find((p) => p.deserializeAttachment().id === id)

    if (msg.type === 'accept') {
      const phone = findPhone(msg.phoneId)
      if (!phone) return this.send(ws, { type: 'error', code: 'NO_RECEIVER', message: 'Smartphone nicht mehr verbunden' })
      phone.serializeAttachment({ ...phone.deserializeAttachment(), paired: true })
      return this.send(phone, { type: 'paired' })
    }
    if (msg.type === 'reject') {
      const phone = findPhone(msg.phoneId)
      if (phone) this.fail(phone, 'UNAUTHORIZED', 'Kopplung abgelehnt')
      return
    }
    if (msg.type === 'data') {
      const phone = this.pairedPhone()
      if (!phone) return this.send(ws, { type: 'error', code: 'NO_RECEIVER', message: 'Kein gekoppeltes Smartphone' })
      return this.send(phone, { type: 'data', iv: msg.iv, ct: msg.ct })
    }
    if (msg.type === 'close') return this.closeAll('Session beendet')
    return this.fail(ws, 'INVALID_MESSAGE', 'Unbekannter Nachrichtentyp')
  }

  fromPhone(ws, att, msg) {
    const desktop = this.desktop()
    if (msg.type === 'data') {
      if (!desktop) return this.send(ws, { type: 'error', code: 'DESKTOP_GONE', message: 'Empfänger nicht verbunden' })
      if (!att.paired) {
        // Exactly one message before confirmation: the pairing proof
        if (att.pairUsed) return this.fail(ws, 'INVALID_MESSAGE', 'Warte auf Bestätigung')
        ws.serializeAttachment({ ...att, pairUsed: true })
      }
      return this.send(desktop, { type: 'data', phoneId: att.id, iv: msg.iv, ct: msg.ct })
    }
    if (msg.type === 'close') {
      if (desktop) this.send(desktop, { type: 'phone-disconnected', phoneId: att.id })
      return this.close(ws, 1000, 'closed')
    }
    return this.fail(ws, 'INVALID_MESSAGE', 'Unbekannter Nachrichtentyp')
  }

  async webSocketClose(ws, code) {
    this.rates.delete(ws)
    this.close(ws, code === 1005 ? 1000 : code)
    const att = ws.deserializeAttachment() ?? {}
    if (att.role === 'desktop' && !this.sockets('desktop').some((other) => other !== ws)) {
      // Inform the phone; the desktop may reconnect within the session
      for (const phone of this.sockets('phone')) this.send(phone, { type: 'error', code: 'DESKTOP_GONE', message: 'Empfänger getrennt' })
    }
    if (att.role === 'phone') {
      const desktop = this.desktop()
      if (desktop) this.send(desktop, { type: 'phone-disconnected', phoneId: att.id })
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws, 1011)
  }

  closeAll(reason) {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: 'close', reason })
      this.close(ws, 1000, 'closed')
    }
  }

  expire() {
    for (const ws of this.ctx.getWebSockets()) this.fail(ws, 'SESSION_EXPIRED', 'Session abgelaufen')
  }

  async alarm() {
    this.expire()
  }
}

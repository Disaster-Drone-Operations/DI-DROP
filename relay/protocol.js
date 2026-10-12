// Location Relay Protocol v1 – gemeinsamer Code für Desktop (di-drop) und Smartphone-Webseite.
// Spezifikation: docs/location-relay-protocol.md
//
// Reines Browser-JavaScript (WebCrypto), keine Abhängigkeiten. Der Relay selbst benutzt
// diese Datei nicht – er sieht nur verschlüsselte Daten.

export const VERSION = 1
export const MAX_MESSAGE_BYTES = 4096

const enc = new TextEncoder()
const dec = new TextDecoder()

// ── Base64url ─────────────────────────────────────────────────────────────────

export function toB64url(bytes) {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(text) {
  const s = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export const randomB64url = (bytes) => toB64url(crypto.getRandomValues(new Uint8Array(bytes)))

// ── Pairing-URL ───────────────────────────────────────────────────────────────

export function createSecrets() {
  return {
    sessionId: randomB64url(16),
    phoneSecret: randomB64url(32),
    desktopToken: randomB64url(32),
  }
}

export const isSessionId = (id) => /^[A-Za-z0-9_-]{22}$/.test(id)

export function pairingUrl(relayBaseUrl, { sessionId, phoneSecret }) {
  return `${relayBaseUrl.replace(/\/+$/, '')}/#v${VERSION}:${sessionId}:${phoneSecret}`
}

// "#v1:<sessionId>:<phoneSecret>" → { sessionId, phoneSecret } | null
export function parsePairingFragment(hash) {
  const m = /^#?v1:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{43})$/.exec(hash)
  return m ? { sessionId: m[1], phoneSecret: m[2] } : null
}

export function sessionSocketUrl(relayBaseUrl, sessionId) {
  const url = new URL(`/v${VERSION}/sessions/${sessionId}`, relayBaseUrl)
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  return url.toString()
}

// ── Schlüssel ─────────────────────────────────────────────────────────────────

export const DIRECTIONS = { toDesktop: 'phone->desktop', toPhone: 'desktop->phone' }

async function deriveKey(phoneSecret, sessionId, direction) {
  const ikm = await crypto.subtle.importKey('raw', fromB64url(phoneSecret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('di-drop location relay v1'), info: enc.encode(`v1 ${direction} ${sessionId}`) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function sha256B64url(text) {
  return toB64url(await crypto.subtle.digest('SHA-256', enc.encode(text)))
}

// Ein Kanal = Schlüssel für Senden und Empfangen + Sequenzzähler (Replay-Schutz)
//   role: 'desktop' | 'phone'
export async function createChannel({ sessionId, phoneSecret, role }) {
  const sendDir = role === 'desktop' ? DIRECTIONS.toPhone : DIRECTIONS.toDesktop
  const recvDir = role === 'desktop' ? DIRECTIONS.toDesktop : DIRECTIONS.toPhone
  const [sendKey, recvKey] = await Promise.all([
    deriveKey(phoneSecret, sessionId, sendDir),
    deriveKey(phoneSecret, sessionId, recvDir),
  ])
  let sendSeq = 0
  let recvSeq = 0
  const aad = (dir) => enc.encode(`v1|${sessionId}|${dir}`)

  return {
    // Klartext-Objekt → {"v":1,"type":"data","iv","ct"} (seq wird automatisch gesetzt)
    async seal(payload) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const body = enc.encode(JSON.stringify({ ...payload, seq: ++sendSeq }))
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(sendDir) }, sendKey, body)
      return { v: VERSION, type: 'data', iv: toB64url(iv), ct: toB64url(ct) }
    },

    // {"type":"data",…} → Klartext-Objekt; wirft bei Manipulation, falschem Schlüssel oder Replay
    async open(message) {
      if (message?.type !== 'data' || typeof message.iv !== 'string' || typeof message.ct !== 'string') {
        throw new ProtocolError('INVALID_MESSAGE', 'Keine verschlüsselte Nachricht')
      }
      let plain
      try {
        plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromB64url(message.iv), additionalData: aad(recvDir) }, recvKey, fromB64url(message.ct))
      } catch {
        throw new ProtocolError('DECRYPT_FAILED', 'Nachricht konnte nicht entschlüsselt werden')
      }
      const payload = JSON.parse(dec.decode(plain))
      if (!Number.isInteger(payload.seq) || payload.seq <= recvSeq) {
        throw new ProtocolError('REPLAY', `Veraltete oder doppelte Nachricht (seq ${payload.seq})`)
      }
      recvSeq = payload.seq
      return payload
    },
  }
}

export class ProtocolError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// ── Positionen ────────────────────────────────────────────────────────────────

// Browser-Geolocation → Protokoll-Position
export function positionFromGeolocation(pos) {
  const c = pos.coords
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    type: 'position',
    timestamp: pos.timestamp,
    lat: c.latitude,
    lon: c.longitude,
    alt: n(c.altitude),
    accuracy: n(c.accuracy),
    altAccuracy: n(c.altitudeAccuracy),
    heading: n(c.heading),
    speed: n(c.speed),
  }
}

// Plausibel? (Bereich, Zeitstempel nicht in der Zukunft)
export function isPlausiblePosition(p) {
  return p && p.type === 'position' &&
    Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
    Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 &&
    Number.isFinite(p.timestamp) && p.timestamp < Date.now() + 5 * 60_000
}

export const send = (ws, message) => ws.send(JSON.stringify({ v: VERSION, ...message }))

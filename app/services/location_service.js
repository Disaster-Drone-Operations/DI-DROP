// "Mein Standort": aktuelle Position und laufende Übertragung vom Smartphone.
//
// Liegt nur im Arbeitsspeicher (keine Positionshistorie, nichts in der Datenbank) und
// überlebt Seitenwechsel innerhalb der App – eine Live-Übertragung läuft also weiter,
// während man woanders arbeitet. Seiten hören auf das Ereignis "location:changed".

import { LocationRelayClient } from '/lib/location/relay_client.js'
import Setting from '/app/models/setting.js'

const state = {
  position: null, // { lat, lon, alt, accuracy, timestamp, receivedAt, source }
  session: null, // { mode, status, text, qrUrl }
}
let client = null

const emit = () => window.dispatchEvent(new CustomEvent('location:changed', { detail: { ...state } }))

export const currentLocation = () => ({ ...state })

export function relayBaseUrl() {
  const url = (Setting.get('relay.url') ?? '').trim()
  return url ? url.replace(/\/+$/, '') : null
}

export async function startTransfer(mode) {
  await stopTransfer()
  const base = relayBaseUrl()
  if (!base) throw new Error('Es ist noch kein Relay eingerichtet.')
  client = new LocationRelayClient({
    relayBaseUrl: base,
    onPosition: (position) => {
      state.position = position
      emit()
    },
    onStatus: ({ status, text }) => {
      state.session = state.session ? { ...state.session, status, text } : { mode, status, text }
      emit()
    },
  })
  const id = Date.now() // Dialoge öffnen sich einmal pro neuer Übertragung
  state.session = { id, mode, status: 'connecting', text: 'Verbinde mit dem Relay …' }
  emit()
  try {
    const { qrUrl } = await client.start(mode)
    state.session = { ...state.session, qrUrl }
    emit()
  } catch (error) {
    state.session = { id, mode, status: 'error', text: error.message }
    emit()
  }
}

export async function stopTransfer() {
  if (client) await client.stop()
  client = null
}

export function closeTransfer() {
  stopTransfer()
  state.session = null
  emit()
}

// Position, die nicht älter als maxAgeMs ist (z. B. für „Hier“ im Einsatzformular)
export function freshPosition(maxAgeMs = 5 * 60_000) {
  const p = state.position
  return p && Date.now() - p.timestamp <= maxAgeMs ? p : null
}

export const isLive = () => state.session?.mode === 'stream' && ['streaming', 'paired', 'reconnecting'].includes(state.session.status)

// "Mein Standort": current position and running transfer from the smartphone.
//
// Kept in memory only (no position history, nothing in the database) and
// survives page changes within the app – so a live transfer keeps running
// while working elsewhere. Pages listen to the "location:changed" event.

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
  const id = Date.now() // dialogs open once per new transfer
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

// Position no older than maxAgeMs (e.g. for „Hier“ in the mission form)
export function freshPosition(maxAgeMs = 5 * 60_000) {
  const p = state.position
  return p && Date.now() - p.timestamp <= maxAgeMs ? p : null
}

export const isLive = () => state.session?.mode === 'stream' && ['streaming', 'paired', 'reconnecting'].includes(state.session.status)

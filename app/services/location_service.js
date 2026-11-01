// "Mein Standort": current position and running transfer from the smartphone.
//
// Kept in memory only (no position history, nothing in the database) and
// survives page changes within the app – so a live transfer keeps running
// while working elsewhere. Pages listen to the "location:changed" event.

import { LocationRelayClient } from '/lib/location/relay_client.js'
import { SimulatedLocationClient } from '/lib/location/simulated_client.js'
import Setting from '/app/models/setting.js'
import { nowMs } from '/lib/clock.js'

const state = {
  position: null, // { lat, lon, alt, accuracy, timestamp, receivedAt, source }
  session: null, // { mode, status, text, qrUrl }
}
let client = null
let simulation = null // training mode: () => position of the simulated phone (simulateLocation)

const emit = () => window.dispatchEvent(new CustomEvent('location:changed', { detail: { ...state } }))

export const currentLocation = () => ({ ...state })

export function relayBaseUrl() {
  const url = (Setting.get('relay.url') ?? '').trim()
  return url ? url.replace(/\/+$/, '') : null
}

// Training mode (app/services/training.js): transfers come from a simulated phone, no relay needed
export function simulateLocation(position) {
  simulation = position
}

// Can di-drop ask a phone for its location? (relay set up, or the training mode simulates the phone)
export const canTransfer = () => !!simulation || !!relayBaseUrl()

// The simulated phone of a running transfer (training control: scan, deny …)
export const simulatedPhone = () => (client instanceof SimulatedLocationClient ? client : null)

export async function startTransfer(mode) {
  await stopTransfer()
  const base = relayBaseUrl()
  if (!base && !simulation) throw new Error('Es ist noch kein Relay eingerichtet.')
  const Client = simulation ? SimulatedLocationClient : LocationRelayClient
  client = new Client({
    relayBaseUrl: base,
    position: simulation,
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
  state.session = { id, mode, status: 'connecting', text: 'Verbinde mit dem Relay …', simulated: !!simulation }
  emit()
  try {
    const { qrUrl } = await client.start(mode)
    state.session = { ...state.session, qrUrl }
    emit()
  } catch (error) {
    state.session = { id, mode, status: 'error', text: error.message, simulated: !!simulation }
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
  return p && nowMs() - p.timestamp <= maxAgeMs ? p : null // training: simulated clock
}

export const isLive = () => state.session?.mode === 'stream' && ['streaming', 'paired', 'reconnecting'].includes(state.session.status)

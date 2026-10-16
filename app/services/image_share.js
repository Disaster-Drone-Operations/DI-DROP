// "An Telefon senden": one image via the relay to any smartphone (QR code, no app needed).
//
// Kept in memory only; the dialog (images/_send_dialog in the layout) listens to the
// "image-share:changed" event and opens by itself when a transfer starts.
//   sendImageToPhone('/…/2026_10_15__11_08_Draufsicht_4_Wärmebild.JPG')

import platform from '/lib/platform/index.js'
import { ImageRelayClient } from '/lib/relay/image_client.js'
import { relayBaseUrl } from '/app/services/location_service.js'
import { health } from '/app/services/cloudflare_deployer.js'

let session = null // { id, name, status, text, qrUrl }
let client = null

const emit = () => window.dispatchEvent(new CustomEvent('image-share:changed', { detail: session && { ...session } }))
const update = (changes) => {
  session = { ...session, ...changes }
  emit()
}

export const currentImageShare = () => session && { ...session }

const baseName = (path) => path.split(/[\\/]/).pop()

export async function sendImageToPhone(path) {
  await closeImageShare()
  const id = Date.now()
  session = { id, name: baseName(path), status: 'connecting', text: 'Verbinde mit dem Relay …' }
  emit()
  try {
    const base = relayBaseUrl()
    if (!base) throw new Error('Es ist noch kein Relay eingerichtet (Einstellungen → Standort-Übertragung).')
    const info = await health(base)
    if (!info) throw new Error('Der Relay ist nicht erreichbar. Besteht eine Internetverbindung?')
    if (!info.features?.includes('image')) {
      throw new Error('Der Relay ist veraltet und kann noch keine Bilder übertragen. Bitte unter Einstellungen → Standort-Übertragung „Relay aktualisieren“ wählen.')
    }
    const blob = await platform.readImage(path)
    client = new ImageRelayClient({
      relayBaseUrl: base,
      image: { blob, name: session.name },
      onStatus: ({ status, text }) => session?.id === id && update({ status, text }),
    })
    const { qrUrl } = await client.start()
    if (session?.id === id) update({ qrUrl })
  } catch (error) {
    if (session?.id === id) update({ status: 'error', text: error.message })
  }
}

export async function closeImageShare() {
  const running = client
  client = null
  if (running) await running.stop()
  session = null
  emit()
}

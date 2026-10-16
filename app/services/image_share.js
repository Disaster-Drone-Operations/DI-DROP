// "An Telefon senden": one image via the relay to any smartphone (QR code, no app needed).
//
// Kept in memory only; the dialog (images/_send_dialog in the layout) listens to the
// "image-share:changed" event and opens by itself when a transfer starts.
//   sendImageToPhone('/…/2026_10_15__11_08_Draufsicht_4_Wärmebild.JPG')

import platform from '/lib/platform/index.js'
import { ImageRelayClient } from '/lib/relay/image_client.js'
import { relayBaseUrl } from '/app/services/location_service.js'
import { health, updateRelay, isAvailable as canManageRelay, parseRelayUrl, NeedsTokenError } from '/app/services/cloudflare_deployer.js'

// status: connecting → waiting → … → done | error, or before that:
//   no-relay (not set up), outdated (relay without image transfer, can be updated right here), updating
let session = null // { id, path, name, status, text, qrUrl, canUpdate }
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
  session = { id, path, name: baseName(path), status: 'connecting', text: 'Verbinde mit dem Relay …' }
  emit()
  try {
    const base = relayBaseUrl()
    if (!base) return update({ status: 'no-relay', text: 'Die Telefon-Verbindung ist noch nicht eingerichtet.' })
    const info = await health(base)
    if (!info) throw new Error('Der Relay ist nicht erreichbar. Besteht eine Internetverbindung?')
    if (!info.features?.includes('image')) {
      return update({
        status: 'outdated',
        text: 'Der Relay ist veraltet und kann noch keine Bilder übertragen.',
        canUpdate: canManageRelay() && !!parseRelayUrl(base),
      })
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

// "Jetzt aktualisieren": install the current relay version, then send the image right away
export async function updateRelayAndSend() {
  if (session?.status !== 'outdated') return
  const { id, path } = session
  update({ status: 'updating', text: 'Relay wird aktualisiert …' })
  try {
    await updateRelay(relayBaseUrl(), { onStep: (_key, text) => session?.id === id && update({ text }) })
  } catch (error) {
    if (session?.id !== id) return
    if (error instanceof NeedsTokenError) {
      return update({ status: 'needs-token', text: 'Zum Aktualisieren wird der Cloudflare-Schlüssel gebraucht. Er wurde aus dem Schlüsselbund entfernt.' })
    }
    return update({ status: 'error', text: error.message })
  }
  if (session?.id === id) return sendImageToPhone(path)
}

export async function closeImageShare() {
  const running = client
  client = null
  if (running) await running.stop()
  session = null
  emit()
}

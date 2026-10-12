// Aus Koordinaten eine lesbare Ortsangabe machen.
//
//   nearPlace(lat, lon)     → "Musterdorf, 1,2 km nordöstlich"  (ohne Internet, Ortsliste von GeoNames)
//   lookupAddress(lat, lon) → "Hauptstraße 1, 98765 Musterdorf" (OpenStreetMap Nominatim, braucht Internet)
//
// Die Ortsliste (public/data/places_de.tsv, script/build_places.mjs) wird erst beim ersten Bedarf geladen.

import platform from '/lib/platform/index.js'
import { distance, bearing } from '/lib/geo.js'

const DIRECTIONS = ['nördlich', 'nordöstlich', 'östlich', 'südöstlich', 'südlich', 'südwestlich', 'westlich', 'nordwestlich']

let places = null
// Heruntergeladene Liste (Einstellungen → Aktualisierungen) hat Vorrang vor der mitgelieferten
async function placesText() {
  const downloaded = await platform.places?.read().catch(() => null)
  if (downloaded) return { text: downloaded, source: 'download' }
  const response = await fetch('/data/places_de.tsv')
  if (!response.ok) throw new Error('Ortsliste fehlt')
  return { text: await response.text(), source: 'bundled' }
}

function loadPlaces() {
  places ??= placesText()
    .then(({ text, source }) => {
      const lines = text.split('\n').filter((l) => l && !l.startsWith('#'))
      const names = new Array(lines.length)
      const lat = new Float64Array(lines.length)
      const lon = new Float64Array(lines.length)
      lines.forEach((line, i) => {
        const [name, la, lo] = line.split('\t')
        names[i] = name
        lat[i] = Number(la)
        lon[i] = Number(lo)
      })
      return { names, lat, lon, source }
    })
    .catch((error) => {
      places = null // beim nächsten Mal erneut versuchen
      throw error
    })
  return places
}

// Nach einer Aktualisierung neu laden
export function reloadPlaces() {
  places = null
}

// { count, source: 'bundled' | 'download' }
export async function placesInfo() {
  const { names, source } = await loadPlaces()
  return { count: names.length, source }
}

const formatKm = (m) => (m < 1000 ? `${Math.round(m / 100) * 100} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)

// Nächster Ort aus der mitgelieferten Liste; null außerhalb Deutschlands
export async function nearPlace(lat, lon) {
  const { names, lat: lats, lon: lons } = await loadPlaces()
  const k = Math.cos((lat * Math.PI) / 180) ** 2
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < names.length; i++) {
    const dy = lats[i] - lat
    const dx = lons[i] - lon
    const d = dy * dy + dx * dx * k
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  if (best < 0) return null
  const meters = distance(lats[best], lons[best], lat, lon)
  if (meters > 20_000) return null
  if (meters < 400) return { name: names[best], meters, text: names[best] }
  const direction = DIRECTIONS[Math.round(bearing(lats[best], lons[best], lat, lon) / 45) % 8]
  return { name: names[best], meters, text: `${names[best]}, ${formatKm(meters)} ${direction}` }
}

// ── Online-Adresse ──────────────────────────────────────────────────────

const cache = new Map()

export function formatAddress(result) {
  const a = result?.address
  if (!a) return null
  const place = a.city || a.town || a.village || a.hamlet || a.municipality
  const street = [a.road || a.pedestrian || a.footway || a.path || a.track, a.house_number].filter(Boolean).join(' ')
  const locality = [a.postcode, place].filter(Boolean).join(' ')
  // Benannte Objekte (Parkplatz, Hütte, Gipfel …) voranstellen – nicht bei Hausadressen
  const name = result.name && !a.house_number && result.name !== street ? result.name : null
  return [name, street, locality].filter(Boolean).join(', ') || result.display_name || null
}

// Liefert { text, meters } oder null (kein Internet, nichts gefunden)
export async function lookupAddress(lat, lon) {
  if (!platform.reverseGeocode) return null
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}` // ≈ 10 m – Live-Positionen fragen nicht jedes Mal neu
  if (!cache.has(key)) {
    cache.set(key, platform.reverseGeocode(lat, lon)
      .then((result) => {
        const text = formatAddress(result)
        if (!text) return null
        const meters = result.lat ? distance(lat, lon, Number(result.lat), Number(result.lon)) : 0
        return { text, meters }
      })
      .catch(() => {
        cache.delete(key)
        return null
      }))
  }
  return cache.get(key)
}

// Beste verfügbare Ortsangabe; onUpdate wird zuerst mit dem Offline-Ergebnis aufgerufen,
// dann ggf. mit der genaueren Online-Adresse.
//   { text, near, address, source: 'offline' | 'online' }
export async function describeLocation(lat, lon, onUpdate = () => {}) {
  const near = await nearPlace(lat, lon).catch(() => null)
  let result = { text: near?.text ?? null, near: near?.text ?? null, address: null, source: 'offline' }
  if (result.text) onUpdate(result)
  const address = await lookupAddress(lat, lon)
  if (address) {
    // Im Gelände ist die nächste Straße oft weit weg → dann der Ort mit Richtung, die Straße als Zusatz
    const text = address.meters > 250 && near ? `${near.text} (nahe ${address.text})` : address.text
    result = { text, near: near?.text ?? null, address: address.text, source: 'online' }
    onUpdate(result)
  }
  return result
}

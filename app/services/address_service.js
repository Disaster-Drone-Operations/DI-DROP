// Turn coordinates into a readable location description.
//
//   nearPlace(lat, lon)     → "Musterdorf, 1,2 km nordöstlich"  (offline, place list from GeoNames)
//   lookupAddress(lat, lon) → "Hauptstraße 1, 98765 Musterdorf" (OpenStreetMap Nominatim, needs internet)
//
// The place list (public/data/places_de.tsv, script/build_places.mjs) is only loaded when first needed.

import platform from '/lib/platform/index.js'
import { distance, bearing } from '/lib/geo.js'

const DIRECTIONS = ['nördlich', 'nordöstlich', 'östlich', 'südöstlich', 'südlich', 'südwestlich', 'westlich', 'nordwestlich']

let places = null
// A downloaded list (Settings → Updates) takes precedence over the bundled one
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
      places = null // try again next time
      throw error
    })
  return places
}

// Reload after an update
export function reloadPlaces() {
  places = null
}

// { count, source: 'bundled' | 'download' }
export async function placesInfo() {
  const { names, source } = await loadPlaces()
  return { count: names.length, source }
}

const formatKm = (m) => (m < 1000 ? `${Math.round(m / 100) * 100} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)

// Nearest place from the bundled list; null outside Germany
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

// ── Online address ──────────────────────────────────────────────────────

const cache = new Map()

export function formatAddress(result) {
  const a = result?.address
  if (!a) return null
  const place = a.city || a.town || a.village || a.hamlet || a.municipality
  const street = [a.road || a.pedestrian || a.footway || a.path || a.track, a.house_number].filter(Boolean).join(' ')
  const locality = [a.postcode, place].filter(Boolean).join(' ')
  // Put named objects (car park, hut, summit …) first – not for house addresses
  const name = result.name && !a.house_number && result.name !== street ? result.name : null
  return [name, street, locality].filter(Boolean).join(', ') || result.display_name || null
}

// Returns { text, meters } or null (no internet, nothing found)
export async function lookupAddress(lat, lon) {
  if (!platform.reverseGeocode) return null
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}` // ≈ 10 m – live positions don't query again every time
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

// Best available location description; onUpdate is called first with the offline result,
// then possibly with the more precise online address.
//   { text, near, address, source: 'offline' | 'online' }
export async function describeLocation(lat, lon, onUpdate = () => {}) {
  const near = await nearPlace(lat, lon).catch(() => null)
  let result = { text: near?.text ?? null, near: near?.text ?? null, address: null, source: 'offline' }
  if (result.text) onUpdate(result)
  const address = await lookupAddress(lat, lon)
  if (address) {
    // Out in the terrain the nearest road is often far away → then the place with direction, the road as an addition
    const text = address.meters > 250 && near ? `${near.text} (nahe ${address.text})` : address.text
    result = { text, near: near?.text ?? null, address: address.text, source: 'online' }
    onUpdate(result)
  }
  return result
}

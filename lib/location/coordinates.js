// Koordinaten-Darstellung und Kartenlinks
//   WGS84 Dezimalgrad, Grad/Minuten/Sekunden und UTM 32N (ETRS89 / EPSG:25832, wie der
//   Thüringen-Viewer und viele Lagekarten). Für Thüringen wird immer Zone 32 verwendet.

export const formatDecimal = (lat, lon, digits = 6) => `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`

function dms(value, positive, negative) {
  const abs = Math.abs(value)
  const deg = Math.floor(abs)
  const minFloat = (abs - deg) * 60
  const min = Math.floor(minFloat)
  const sec = (minFloat - min) * 60
  return `${deg}° ${String(min).padStart(2, '0')}′ ${sec.toFixed(1).padStart(4, '0')}″ ${value >= 0 ? positive : negative}`
}

export const formatDms = (lat, lon) => `${dms(lat, 'N', 'S')}  ${dms(lon, 'O', 'W')}`

// WGS84/ETRS89 → UTM (Transversale Mercator, Krüger-Reihe; Genauigkeit im mm-Bereich)
export function toUtm(lat, lon, zone = 32) {
  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const n = f / (2 - f)
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64)
  const alpha = [
    n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3,
    (13 / 48) * n ** 2 - (3 / 5) * n ** 3,
    (61 / 240) * n ** 3,
  ]
  const rad = Math.PI / 180
  const phi = lat * rad
  const lambda = (lon - (zone * 6 - 183)) * rad
  const e = (2 * Math.sqrt(n)) / (1 + n)
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)))
  const xi = Math.atan(t / Math.cos(lambda))
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t))
  let x = eta
  let y = xi
  alpha.forEach((al, i) => {
    const j = 2 * (i + 1)
    x += al * Math.cos(j * xi) * Math.sinh(j * eta)
    y += al * Math.sin(j * xi) * Math.cosh(j * eta)
  })
  return { zone, easting: 500000 + k0 * A * x, northing: k0 * A * y + (lat < 0 ? 10_000_000 : 0) }
}

export function formatUtm(lat, lon) {
  const { zone, easting, northing } = toUtm(lat, lon)
  return `${zone}U ${Math.round(easting)} ${Math.round(northing)}`
}

// Kartendienste – alle öffnen die Position mit Markierung
export function mapLinks(lat, lon) {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`
  const lonLat = `[${lon.toFixed(6)},${lat.toFixed(6)}]`
  return [
    {
      key: 'thueringen',
      label: 'Thüringen-Viewer',
      url: `https://thueringenviewer.thueringen.de/thviewer3/index.html?MAP/PROJECTION=EPSG:4326&MAP/CENTER=${lonLat}&MAP/ZOOMLEVEL=9&MARKER=${lonLat}`,
    },
    { key: 'google', label: 'Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${ll}` },
    { key: 'osm', label: 'OpenStreetMap', url: `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=17/${lat.toFixed(6)}/${lon.toFixed(6)}` },
  ]
}

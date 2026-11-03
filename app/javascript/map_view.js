// A MapLibre map with the open map data (app/services/map_sources.js): map ↔ aerial, image footprints on top.
//
//   const view = createMapView(container, { kind: 'map' })
//   view.setKind('aerial')
//   view.showFootprints([{ id, footprint, highlight }])   // footprint.js results
//   view.destroy()

import { Map as MapLibreMap, LngLatBounds, setWorkerUrl, prewarm } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre's worker is self-contained – loaded unchanged as a blob (Vite's processing of worker files breaks it;
// the CSP allows workers from blob:)
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw'

setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })))
// Start the worker now – the first map created while it was still starting up never finished loading its style
prewarm()
import { mapStyle, ATTRIBUTION } from '/app/services/map_sources.js'

const EMPTY = { type: 'FeatureCollection', features: [] }

// Footprints as GeoJSON: area, drone → centre line, drone point, centre point. Without an area (no focal
// length …): position: { lat, lon, heading } → drone point and a short line in the viewing direction
function features(items) {
  const out = []
  for (const { id, footprint: fp, position, highlight = false } of items) {
    if (!fp && position) {
      const props = { id, highlight }
      out.push({ type: 'Feature', properties: { ...props, kind: 'drone' }, geometry: { type: 'Point', coordinates: [position.lon, position.lat] } })
      if (position.heading != null) {
        const a = (position.heading * Math.PI) / 180
        const end = [position.lon + (40 * Math.sin(a)) / (111_320 * Math.cos((position.lat * Math.PI) / 180)), position.lat + (40 * Math.cos(a)) / 111_320]
        out.push({ type: 'Feature', properties: { ...props, kind: 'ray' }, geometry: { type: 'LineString', coordinates: [[position.lon, position.lat], end] } })
      }
      continue
    }
    if (!fp) continue
    const ring = fp.polygon.map((p) => [p.lon, p.lat])
    ring.push(ring[0])
    const props = { id, highlight, measured: fp.measured, clipped: fp.clipped }
    out.push({ type: 'Feature', properties: { ...props, kind: 'area' }, geometry: { type: 'Polygon', coordinates: [ring] } })
    out.push({ type: 'Feature', properties: { ...props, kind: 'ray' }, geometry: { type: 'LineString', coordinates: [[fp.drone.lon, fp.drone.lat], [fp.center.lon, fp.center.lat]] } })
    out.push({ type: 'Feature', properties: { ...props, kind: 'drone', heading: fp.heading }, geometry: { type: 'Point', coordinates: [fp.drone.lon, fp.drone.lat] } })
    out.push({ type: 'Feature', properties: { ...props, kind: 'center' }, geometry: { type: 'Point', coordinates: [fp.center.lon, fp.center.lat] } })
  }
  return { type: 'FeatureCollection', features: out }
}

function addLayers(map, data) {
  if (map.getSource('footprints')) return
  map.addSource('footprints', { type: 'geojson', data })
  const is = (kind) => ['==', ['get', 'kind'], kind]
  const accent = ['case', ['get', 'highlight'], '#ff3b30', '#ff9f0a']
  map.addLayer({ id: 'fp-area', type: 'fill', source: 'footprints', filter: is('area'), paint: { 'fill-color': accent, 'fill-opacity': ['case', ['get', 'highlight'], 0.28, 0.12] } })
  map.addLayer({ id: 'fp-outline', type: 'line', source: 'footprints', filter: is('area'), paint: { 'line-color': accent, 'line-width': ['case', ['get', 'highlight'], 2, 1] } })
  map.addLayer({ id: 'fp-ray', type: 'line', source: 'footprints', filter: ['all', is('ray'), ['get', 'highlight']], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 2] } })
  map.addLayer({ id: 'fp-center', type: 'circle', source: 'footprints', filter: ['all', is('center'), ['get', 'highlight']], paint: { 'circle-radius': 4, 'circle-color': '#ff3b30', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
  map.addLayer({ id: 'fp-drone', type: 'circle', source: 'footprints', filter: is('drone'), paint: { 'circle-radius': ['case', ['get', 'highlight'], 6, 3], 'circle-color': '#0a84ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
}

export function createMapView(container, { kind = 'map', interactive = true } = {}) {
  let data = EMPTY
  const map = new MapLibreMap({
    container,
    style: mapStyle(kind),
    center: [11.1, 50.6],
    zoom: 15,
    interactive,
    attributionControl: { compact: true, customAttribution: ATTRIBUTION.heights },
    fadeDuration: 0,
  })
  map.on('style.load', () => addLayers(map, data))
  // Attribution collapsed to its "i" on small maps (it would cover a third of them) – one click shows it
  map.once('load', () => container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'))

  return {
    map,
    setKind(next) {
      kind = next
      map.setStyle(mapStyle(kind))
    },
    // items: [{ id, footprint, highlight }]; fit: zoom to them
    showFootprints(items, { fit = true } = {}) {
      data = features(items)
      if (map.getSource('footprints')) map.getSource('footprints').setData(data)
      else if (map.isStyleLoaded()) addLayers(map, data)
      if (!fit || !data.features.length) return
      const bounds = new LngLatBounds()
      for (const f of data.features) {
        const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.type === 'LineString' ? f.geometry.coordinates : [f.geometry.coordinates]
        for (const c of coords) bounds.extend(c)
      }
      map.fitBounds(bounds, { padding: { top: 40, right: 24, bottom: 28, left: 24 }, maxZoom: 19, duration: 0 }) // top: room for the map/aerial switch
    },
    resize: () => map.resize(),
    destroy: () => map.remove(),
  }
}

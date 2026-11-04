// A MapLibre map with the open map data (app/services/map_sources.js): map ↔ aerial, image footprints on top.
//
//   const view = createMapView(container, { kind: 'map' })
//   view.setKind('aerial')
//   view.showFootprints([{ id, footprint, highlight }])   // footprint.js results
//   view.onClick((id) => …); view.hoverLinks()               // hover: area, drone and line of one shot light up together
//   view.trackUser()                                          // own position from „Mein Standort“ (phone), kept up to date
//   view.showSite({ lat, lon })                               // Einsatzort (mission coordinates)
//   view.showPlaces([{ lat, lon }])                           // nothing photographed yet: centre on these points
//   view.destroy()

import { Map as MapLibreMap, LngLatBounds, Popup, setWorkerUrl, prewarm } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre's worker is self-contained – loaded unchanged as a blob (Vite's processing of worker files breaks it;
// the CSP allows workers from blob:)
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw'

setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })))
// Start the worker now – the first map created while it was still starting up never finished loading its style
prewarm()
import { mapStyle, ATTRIBUTION } from '/app/services/map_sources.js'
import { currentLocation } from '/app/services/location_service.js'
import { nowMs } from '/lib/clock.js'

const EMPTY = { type: 'FeatureCollection', features: [] }

// Footprints as GeoJSON: area, drone → centre line, drone point, centre point. Without an area (no focal
// length …): position: { lat, lon, heading } → drone point and a short line in the viewing direction.
// key: the same for all parts of one shot (feature state "hover" lights them up together)
function features(items) {
  const out = []
  for (const { id, footprint: fp, position, highlight = false } of items) {
    const key = `shot-${id}`
    if (!fp && position) {
      const props = { id, key, highlight }
      out.push({ type: 'Feature', properties: { ...props, kind: 'drone', heading: position.heading ?? 0 }, geometry: { type: 'Point', coordinates: [position.lon, position.lat] } })
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
    const props = { id, key, highlight, measured: fp.measured, clipped: fp.clipped }
    out.push({ type: 'Feature', properties: { ...props, kind: 'area' }, geometry: { type: 'Polygon', coordinates: [ring] } })
    out.push({ type: 'Feature', properties: { ...props, kind: 'ray' }, geometry: { type: 'LineString', coordinates: [[fp.drone.lon, fp.drone.lat], [fp.center.lon, fp.center.lat]] } })
    out.push({ type: 'Feature', properties: { ...props, kind: 'drone', heading: fp.heading ?? 0 }, geometry: { type: 'Point', coordinates: [fp.drone.lon, fp.drone.lat] } })
    out.push({ type: 'Feature', properties: { ...props, kind: 'center' }, geometry: { type: 'Point', coordinates: [fp.center.lon, fp.center.lat] } })
  }
  return { type: 'FeatureCollection', features: out }
}

// Drone marker: blue dot with a light cone in the viewing direction (rotated per shot: heading = camera yaw)
function droneIcon() {
  const size = 64 // canvas px, pixelRatio 2 → 32 CSS px
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2
  const spread = (28 * Math.PI) / 180
  const cone = ctx.createRadialGradient(c, c, 0, c, c, c - 1)
  cone.addColorStop(0, 'rgba(10, 132, 255, 1)')
  cone.addColorStop(1, 'rgba(10, 132, 255, 0.45)')
  ctx.beginPath() // cone pointing up (north) – the map rotates it
  ctx.moveTo(c, c)
  ctx.arc(c, c, c - 1, -Math.PI / 2 - spread, -Math.PI / 2 + spread)
  ctx.closePath()
  ctx.fillStyle = cone
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(c, c, 8, 0, Math.PI * 2)
  ctx.fillStyle = '#0a84ff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.fill()
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

// Own position: dot + accuracy circle (polygon in metres); stale (older than 5 min) → grey
const STALE_MS = 5 * 60_000
function userFeatures(position) {
  if (!position) return EMPTY
  const stale = nowMs() - position.timestamp > STALE_MS // training: simulated clock
  const props = { stale }
  const out = [{ type: 'Feature', properties: { ...props, kind: 'dot' }, geometry: { type: 'Point', coordinates: [position.lon, position.lat] } }]
  const r = Number(position.accuracy)
  if (r > 0) {
    const ring = []
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * 2 * Math.PI
      ring.push([position.lon + (r * Math.sin(a)) / (111_320 * Math.cos((position.lat * Math.PI) / 180)), position.lat + (r * Math.cos(a)) / 111_320])
    }
    out.unshift({ type: 'Feature', properties: { ...props, kind: 'accuracy' }, geometry: { type: 'Polygon', coordinates: [ring] } })
  }
  return { type: 'FeatureCollection', features: out }
}

// "gerade eben", "vor 3 Min.", "vor 1 Std. 5 Min." (training: simulated clock)
function ageText(timestamp) {
  const minutes = Math.floor((nowMs() - timestamp) / 60_000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  return `vor ${Math.floor(minutes / 60)} Std.${minutes % 60 ? ` ${minutes % 60} Min.` : ''}`
}

// Text for the hover hint on the Einsatzort / own position
function placeTip(layer) {
  if (layer === 'site') return 'Einsatzort (Koordinaten des Einsatzes)'
  const p = currentLocation().position
  if (!p) return null
  return ['Euer Standort', ageText(p.timestamp), p.accuracy ? `± ${Math.round(p.accuracy)} m` : null].filter(Boolean).join(' · ')
}

const point = (p, props = {}) => (p ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }] } : EMPTY)

function addUserLayers(map, data, siteData) {
  if (!map.getSource('site')) {
    map.addSource('site', { type: 'geojson', data: siteData })
    map.addLayer({ id: 'site', type: 'circle', source: 'site', paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-opacity': 0.9, 'circle-stroke-color': '#ff3b30', 'circle-stroke-width': 3 } })
  }
  if (map.getSource('user')) return
  map.addSource('user', { type: 'geojson', data })
  const color = ['case', ['get', 'stale'], '#8e8e93', '#30d158']
  map.addLayer({ id: 'user-accuracy', type: 'fill', source: 'user', filter: ['==', ['get', 'kind'], 'accuracy'], paint: { 'fill-color': color, 'fill-opacity': 0.15, 'fill-outline-color': color } })
  map.addLayer({ id: 'user-dot', type: 'circle', source: 'user', filter: ['==', ['get', 'kind'], 'dot'], paint: { 'circle-radius': 6, 'circle-color': color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
}

// cones: drone points with the viewing cone (mission map) – otherwise plain dots (mini map of one shot, which
// shows the line to the image centre anyway)
function addLayers(map, data, { cones }) {
  if (map.getSource('footprints')) return
  if (cones && !map.hasImage('drone')) map.addImage('drone', droneIcon(), { pixelRatio: 2 })
  map.addSource('footprints', { type: 'geojson', data, promoteId: 'key' })
  const is = (kind) => ['==', ['get', 'kind'], kind]
  const hover = ['boolean', ['feature-state', 'hover'], false]
  const lit = ['any', ['get', 'highlight'], hover]
  const accent = ['case', lit, '#ff3b30', '#ff9f0a']
  map.addLayer({ id: 'fp-area', type: 'fill', source: 'footprints', filter: is('area'), paint: { 'fill-color': accent, 'fill-opacity': ['case', lit, 0.28, 0.12] } })
  map.addLayer({ id: 'fp-outline', type: 'line', source: 'footprints', filter: is('area'), paint: { 'line-color': accent, 'line-width': ['case', lit, 2.5, 1] } })
  map.addLayer({ id: 'fp-ray', type: 'line', source: 'footprints', filter: is('ray'), paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': ['case', lit, 1, 0] } })
  map.addLayer({ id: 'fp-center', type: 'circle', source: 'footprints', filter: is('center'), paint: {
    'circle-radius': 4, 'circle-color': '#ff3b30', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
    'circle-opacity': ['case', lit, 1, 0], 'circle-stroke-opacity': ['case', lit, 1, 0],
  } })
  // Ring behind the hovered drone point
  map.addLayer({ id: 'fp-drone-ring', type: 'circle', source: 'footprints', filter: is('drone'), paint: {
    'circle-radius': 13, 'circle-color': '#ff3b30', 'circle-opacity': ['case', hover, 0.35, 0],
    'circle-stroke-color': '#ff3b30', 'circle-stroke-width': 2, 'circle-stroke-opacity': ['case', hover, 1, 0],
  } })
  if (cones) {
    map.addLayer({ id: 'fp-drone', type: 'symbol', source: 'footprints', filter: is('drone'), layout: {
      'icon-image': 'drone', 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map',
      'icon-size': ['case', ['get', 'highlight'], 1.3, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    } })
  } else {
    map.addLayer({ id: 'fp-drone', type: 'circle', source: 'footprints', filter: is('drone'), paint: { 'circle-radius': ['case', ['get', 'highlight'], 6, 3], 'circle-color': '#0a84ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
  }
}

export function createMapView(container, { kind = 'map', interactive = true, cones = true } = {}) {
  let data = EMPTY
  let userData = EMPTY
  let siteData = EMPTY
  let untrack = null
  const map = new MapLibreMap({
    container,
    style: mapStyle(kind),
    center: [11.1, 50.6],
    zoom: 15,
    interactive,
    attributionControl: { compact: true, customAttribution: ATTRIBUTION.heights },
    fadeDuration: 0,
  })
  // Hover hint on Einsatzort and own position (what the red and green dot mean)
  const tip = new Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'map-tip' })
  for (const layer of ['site', 'user-dot']) {
    map.on('mousemove', layer, (e) => {
      const text = placeTip(layer)
      if (!text || !e.features?.[0]) return
      tip.setLngLat(e.features[0].geometry.coordinates).setText(text).addTo(map)
    })
    map.on('mouseleave', layer, () => tip.remove())
  }
  map.on('style.load', () => {
    addLayers(map, data, { cones })
    addUserLayers(map, userData, siteData) // after the footprints: on top
  })
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
      else if (map.isStyleLoaded()) {
        addLayers(map, data, { cones })
        for (const id of ['site', 'user-accuracy', 'user-dot']) if (map.getLayer(id)) map.moveLayer(id) // Einsatzort, own position stay on top
      }
      if (!fit || !data.features.length) return
      const bounds = new LngLatBounds()
      for (const f of data.features) {
        const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.type === 'LineString' ? f.geometry.coordinates : [f.geometry.coordinates]
        for (const c of coords) bounds.extend(c)
      }
      map.fitBounds(bounds, { padding: { top: 40, right: 24, bottom: 28, left: 24 }, maxZoom: 19, duration: 0 }) // top: room for the map/aerial switch
    },
    // Click on a footprint (area or drone) → its id
    onClick(handler) {
      for (const layer of ['fp-area', 'fp-drone']) {
        map.on('click', layer, (e) => e.features?.[0] && handler(e.features[0].properties.id))
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }
    },
    // Hover over an area or drone point → that shot's area, drone, line and centre light up together
    hoverLinks() {
      let current = null
      const set = (key) => {
        if (key === current) return
        if (current != null && map.getSource('footprints')) map.setFeatureState({ source: 'footprints', id: current }, { hover: false })
        current = key
        if (key != null) map.setFeatureState({ source: 'footprints', id: key }, { hover: true })
      }
      map.on('mousemove', (e) => {
        const layers = ['fp-drone', 'fp-area'].filter((l) => map.getLayer(l))
        const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : null // drone first: it is on top
        set(hit?.properties.key ?? null)
      })
      map.on('mouseout', () => set(null))
      map.on('styledata', () => (current = null)) // new style (map ↔ aerial): states are gone
    },
    showSite(site) {
      siteData = point(site)
      map.getSource('site')?.setData(siteData)
    },
    // No footprints: one point → centred (zoom 16), several → all in view
    showPlaces(places) {
      if (!places.length) return
      if (places.length === 1) return map.jumpTo({ center: [places[0].lon, places[0].lat], zoom: 16 })
      const bounds = new LngLatBounds()
      for (const p of places) bounds.extend([p.lon, p.lat])
      map.fitBounds(bounds, { padding: { top: 60, right: 60, bottom: 60, left: 60 }, maxZoom: 16, duration: 0 })
    },
    // Own position (from „Mein Standort“, memory only) – follows live transfers, greys out when old
    trackUser() {
      const update = () => {
        userData = userFeatures(currentLocation().position)
        if (map.getSource('user')) map.getSource('user').setData(userData)
      }
      update()
      window.addEventListener('location:changed', update)
      const ticker = setInterval(update, 30_000)
      untrack = () => {
        window.removeEventListener('location:changed', update)
        clearInterval(ticker)
      }
    },
    resize: () => map.resize(),
    destroy: () => {
      untrack?.()
      map.remove()
    },
  }
}

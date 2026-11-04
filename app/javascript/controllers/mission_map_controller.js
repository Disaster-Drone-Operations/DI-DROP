import { Controller } from '@hotwired/stimulus'
import { footprint, hasView } from '/app/services/footprint.js'
import { groundAround } from '/app/services/terrain.js'
import { insideAerial } from '/app/services/map_sources.js'

// Mission map (mission_maps/show.ejs): all shots as footprints; click → the shot in the large view (gallery)
//   data-mission-map-shots-value='[{ data: <shotData>, params: <imageParams>, variant }]'
export default class extends Controller {
  static targets = ['map', 'kinds']
  static values = { shots: Array }

  async connect() {
    const { createMapView } = await import('/app/javascript/map_view.js') // MapLibre only when needed
    if (!this.element.isConnected) return
    // Index in the full list (= gallery position); shotsValue parses anew on every access – no indexOf on it
    const located = this.shotsValue.map((shot, index) => ({ ...shot, index })).filter((s) => s.params)
    const first = located[0].params
    let kind = null
    try {
      kind = localStorage.getItem('didrop.missionmap.kind')
    } catch { /* default */ }
    kind ??= insideAerial(first.lon, first.lat) ? 'aerial' : 'map'
    this.view = createMapView(this.mapTarget, { kind })
    this.markKind(kind)
    this.view.onClick((id) => this.open(Number(id)))
    this.view.hoverLinks()
    this.view.showFootprints(located.map((s) => this.item(s, null)))

    // Terrain per area (shots of one mission lie close together – a few tiles)
    const grounds = new Map()
    const items = []
    for (const shot of located) {
      const key = `${shot.params.lat.toFixed(2)},${shot.params.lon.toFixed(2)}`
      if (!grounds.has(key)) grounds.set(key, await groundAround(shot.params.lat, shot.params.lon, 1500).catch(() => null))
      items.push(this.item(shot, grounds.get(key)))
    }
    if (this.element.isConnected) this.view.showFootprints(items, { fit: false })
  }

  disconnect() {
    this.view?.destroy()
  }

  item(shot, ground) {
    const p = shot.params
    return {
      id: shot.index,
      footprint: hasView(p) ? footprint({ ...p, ground, samples: 3 }) : null,
      position: { lat: p.lat, lon: p.lon, heading: p.yaw },
      highlight: false,
    }
  }

  kind({ params: { kind } }) {
    try {
      localStorage.setItem('didrop.missionmap.kind', kind)
    } catch { /* only this time */ }
    this.view?.setKind(kind)
    this.markKind(kind)
  }

  markKind(kind) {
    for (const b of this.kindsTarget.querySelectorAll('button')) b.classList.toggle('is-active', b.dataset.missionMapKindParam === kind)
  }

  // The large view with all shots of the map (paging works as usual)
  open(index) {
    const items = this.shotsValue.map((s) => s.data)
    window.dispatchEvent(new CustomEvent('gallery:open', { detail: { items, index, variant: this.shotsValue[index]?.variant } }))
  }
}

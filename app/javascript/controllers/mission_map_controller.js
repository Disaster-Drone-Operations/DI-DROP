import { Controller } from '@hotwired/stimulus'
import { footprint, hasView } from '/app/services/footprint.js'
import { groundAround } from '/app/services/terrain.js'
import { insideAerial } from '/app/services/map_sources.js'
import { currentLocation } from '/app/services/location_service.js'
import { distance } from '/lib/geo.js'

// Mission map (mission_maps/show.ejs): all shots as footprints, the Einsatzort and the own position; click → the shot in
// the large view (gallery)
//   data-mission-map-shots-value='[{ data: <shotData>, params: <imageParams>, variant }]'
//   data-mission-map-site-value='{ lat, lon }' (Einsatzort, or null)
export default class extends Controller {
  static targets = ['map', 'kinds', 'waiting']
  static values = { shots: Array, site: Object }

  // Shows the map as soon as there is something to show: shots with position, the Einsatzort or the own position
  connect() {
    // Index in the full list (= gallery position); shotsValue parses anew on every access – no indexOf on it
    this.located = this.shotsValue.map((shot, index) => ({ ...shot, index })).filter((s) => s.params)
    this.site = this.hasSiteValue ? this.siteValue : null
    const position = currentLocation().position
    if (this.located.length || this.site || position) return this.show()
    this.waitingTarget.hidden = false
    this.onLocation = () => {
      if (!currentLocation().position) return
      window.removeEventListener('location:changed', this.onLocation)
      this.waitingTarget.hidden = true
      this.show()
    }
    window.addEventListener('location:changed', this.onLocation)
  }

  async show() {
    const { createMapView } = await import('/app/javascript/map_view.js') // MapLibre only when needed
    if (!this.element.isConnected) return
    const located = this.located
    const position = currentLocation().position
    const first = located[0]?.params ?? this.site ?? position
    let kind = null
    try {
      kind = localStorage.getItem('didrop.missionmap.kind')
    } catch { /* default */ }
    kind ??= insideAerial(first.lon, first.lat) ? 'aerial' : 'map'
    this.view = createMapView(this.mapTarget, { kind })
    this.markKind(kind)
    this.view.onClick((id) => this.open(Number(id)))
    this.view.hoverLinks()
    this.view.trackUser()
    this.view.showSite(this.site)
    if (!located.length) {
      // Nothing photographed yet: Einsatzort and own position in view (own position far away, e.g. at home: only the Einsatzort)
      const near = position && (!this.site || distance(this.site.lat, this.site.lon, position.lat, position.lon) < 20_000)
      this.view.showPlaces([this.site, near ? position : null].filter(Boolean))
      return
    }
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
    if (this.onLocation) window.removeEventListener('location:changed', this.onLocation)
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

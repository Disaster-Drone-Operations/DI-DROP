import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import MediaFile from '/app/models/media_file.js'
import Assignment from '/app/models/assignment.js'
import { formatDate, formatTime } from '/app/helpers/application_helper.js'
import { variantLabel, PREFERRED_VARIANTS } from '/app/helpers/media_helper.js'
import { viewpointNameTag } from '/app/helpers/mission_helper.js'
import { escapeHtml } from '/app/helpers/application_helper.js'

// Galerie (fast Vollbild):
//   ← / →  vorherige / nächste Aufnahme der Seite (chronologisch)
//   ↑ / ↓  dieselbe Stelle (Wegpunkt) früher / später – über alle Aufträge des Einsatzes;
//          Zoom und Ausschnitt bleiben dabei erhalten (zum Vergleichen)
//   + / − / 0, Trackpad-Geste, Strg+Mausrad, Doppelklick: zoomen; Ziehen: verschieben
//   Esc    schließen
// Zuerst erscheint sofort das Vorschaubild, das Original wird nachgeladen.
export default class extends Controller {
  static targets = ['stage', 'image', 'notice', 'prev', 'next', 'vertical', 'verticalLabel', 'earlier', 'later', 'caption', 'position', 'variants', 'zoomLevel']

  static MAX_ZOOM = 8
  static DOUBLE_CLICK_ZOOM = 2.5

  connect() {
    this.full = new Map() // Pfad → Object-URL (zuletzt genutzte Originale)
    this.viewpoints = new Map() // Wegpunkt → Aufnahmen
    // Wegpunkt umbenannt (z. B. per Doppelklick hier in der Galerie) → Daten nachziehen
    this.renamed = ({ detail }) => {
      for (const item of [...(this.items ?? []), ...(this.vertical?.items ?? [])]) {
        if (item.viewpointId === detail.id) item.viewpointName = detail.name
      }
      this.viewpoints.delete(detail.id)
    }
    window.addEventListener('viewpoint:renamed', this.renamed)
    // Datei umbenannt → Pfade in den angezeigten Aufnahmen aktualisieren
    this.moved = ({ detail }) => {
      const map = new Map(detail.changes.map((c) => [c.from, c.to]))
      for (const item of [...(this.items ?? []), ...(this.vertical?.items ?? [])]) {
        for (const file of Object.values(item.files)) if (map.has(file.path)) file.path = map.get(file.path)
      }
    }
    window.addEventListener('media:renamed', this.moved)

    // Trackpad/Mausrad: Zwei-Finger-Geste bzw. Strg+Rad zoomt, Wischen verschiebt (wenn gezoomt)
    this.wheel = (event) => this.onWheel(event)
    this.stageTarget.addEventListener('wheel', this.wheel, { passive: false })
    // macOS (WebKit): Zoomgeste am Trackpad kommt als "gesture"-Ereignis statt als Strg+Rad
    this.gestureStart = (event) => {
      event.preventDefault()
      this.gestureBase = this.view.scale
    }
    this.gestureChange = (event) => {
      event.preventDefault()
      this.zoomAt(this.gestureBase * event.scale, this.pointFromEvent(event), { animate: false })
    }
    this.stageTarget.addEventListener('gesturestart', this.gestureStart)
    this.stageTarget.addEventListener('gesturechange', this.gestureChange)
    this.view = { scale: 1, x: 0, y: 0 }
  }

  disconnect() {
    this.stageTarget.removeEventListener('wheel', this.wheel)
    this.stageTarget.removeEventListener('gesturestart', this.gestureStart)
    this.stageTarget.removeEventListener('gesturechange', this.gestureChange)
    window.removeEventListener('viewpoint:renamed', this.renamed)
    window.removeEventListener('media:renamed', this.moved)
    this.releaseAll()
  }

  // ── Öffnen & Navigation ───────────────────────────────────────────────────

  open({ detail }) {
    this.items = detail.items
    this.index = Math.max(0, detail.index)
    this.variant = detail.variant
    this.vertical = null
    this.resetZoom()
    if (!this.element.open) this.element.showModal()
    // Fokus auf die Galerie selbst – nicht auf einen Knopf, der gleich deaktiviert sein könnte
    this.element.focus()
    this.render()
  }

  close() {
    this.element.close()
  }

  closed() {
    this.releaseAll()
  }

  // Tasten im ganzen Fenster, solange die Galerie offen ist – unabhängig davon, wo der Fokus
  // gerade liegt (ein deaktivierter Knopf am Listenende verliert ihn sonst). Eingabefelder
  // (z. B. Umbenennen) behalten ihre Pfeiltasten.
  key(event) {
    if (!this.element.open || event.target.closest?.('input, textarea, select')) return
    const actions = { ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'earlier', ArrowDown: 'later', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', 0: 'resetZoom' }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    this[action]()
  }

  prev() {
    this.move(-1)
  }

  next() {
    this.move(1)
  }

  // Links/Rechts geht immer durch die Aufnahmen der Seite – von dort aus, wo man war
  move(step) {
    this.vertical = null
    const index = this.index + step
    if (index < 0 || index >= this.items.length) return
    this.index = index
    this.resetZoom()
    this.render()
  }

  async earlier() {
    await this.moveVertical(-1)
  }

  async later() {
    await this.moveVertical(1)
  }

  async moveVertical(step) {
    if (!this.vertical) {
      const base = this.items[this.index]
      if (!base.viewpointId) return
      const list = await this.loadViewpoint(base.viewpointId, base.viewpointName)
      this.vertical = { items: list, index: Math.max(0, list.findIndex((i) => i.key === base.key)) }
    }
    const index = this.vertical.index + step
    if (index < 0 || index >= this.vertical.items.length) return
    this.vertical.index = index
    this.render()
  }

  showVariant({ params }) {
    this.variant = params.variant
    this.resetZoom() // Wärme- und Sichtkamera haben andere Bildausschnitte
    this.render()
  }

  // ── Zoom & Verschieben ────────────────────────────────────────────────────
  // Zustand: scale + Verschiebung (x/y in Bildschirmpixeln, bezogen auf die Bildmitte).
  // Bleibt bei ↑/↓ erhalten – gleiche Kamera, gleiche Auflösung, gleicher Ausschnitt.

  zoomIn() {
    this.zoomAt(this.view.scale * 1.5)
  }

  zoomOut() {
    this.zoomAt(this.view.scale / 1.5)
  }

  resetZoom() {
    this.view = { scale: 1, x: 0, y: 0 }
    this.applyView({ animate: true })
  }

  toggleZoom(event) {
    if (this.view.scale > 1.01) return this.resetZoom()
    this.zoomAt(this.constructor.DOUBLE_CLICK_ZOOM, this.pointFromEvent(event))
  }

  // Punkt relativ zur (unverschobenen) Bildmitte
  pointFromEvent(event) {
    const img = this.imageTarget
    const cx = img.offsetLeft + img.offsetWidth / 2
    const cy = img.offsetTop + img.offsetHeight / 2
    const stage = this.stageTarget.getBoundingClientRect()
    return { x: event.clientX - stage.left - cx, y: event.clientY - stage.top - cy }
  }

  // Zoomen so, dass der Punkt unter dem Mauszeiger an seiner Stelle bleibt
  zoomAt(scale, point = { x: 0, y: 0 }, { animate = true } = {}) {
    const s1 = this.view.scale
    const s2 = Math.min(this.constructor.MAX_ZOOM, Math.max(1, scale))
    const localX = (point.x - this.view.x) / s1
    const localY = (point.y - this.view.y) / s1
    this.view = { scale: s2, x: point.x - localX * s2, y: point.y - localY * s2 }
    this.applyView({ animate })
  }

  onWheel(event) {
    if (!this.element.open) return
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      // Trackpad-Zoomgeste (kommt als Strg+Rad) bzw. Strg+Mausrad
      this.zoomAt(this.view.scale * Math.exp(-event.deltaY * 0.01), this.pointFromEvent(event), { animate: false })
    } else if (this.view.scale > 1) {
      this.view.x -= event.deltaX
      this.view.y -= event.deltaY
      this.applyView({ animate: false })
    }
  }

  panStart(event) {
    if (this.view.scale <= 1 || event.button !== 0) return
    event.preventDefault()
    const img = this.imageTarget
    const start = { px: event.clientX, py: event.clientY, x: this.view.x, y: this.view.y }
    img.setPointerCapture(event.pointerId)
    img.classList.add('is-panning')
    const move = (e) => {
      this.view.x = start.x + e.clientX - start.px
      this.view.y = start.y + e.clientY - start.py
      this.applyView({ animate: false })
    }
    const end = () => {
      img.classList.remove('is-panning')
      img.removeEventListener('pointermove', move)
      img.removeEventListener('pointerup', end)
      img.removeEventListener('pointercancel', end)
    }
    img.addEventListener('pointermove', move)
    img.addEventListener('pointerup', end)
    img.addEventListener('pointercancel', end)
  }

  // Verschiebung begrenzen (Bild bleibt im Bild) und anwenden
  applyView({ animate }) {
    if (!this.hasImageTarget) return
    const img = this.imageTarget
    const { scale } = this.view
    const maxX = ((scale - 1) * img.offsetWidth) / 2
    const maxY = ((scale - 1) * img.offsetHeight) / 2
    this.view.x = Math.max(-maxX, Math.min(maxX, this.view.x))
    this.view.y = Math.max(-maxY, Math.min(maxY, this.view.y))
    img.style.transition = animate ? 'transform .15s ease-out' : 'none'
    img.style.transform = scale === 1 ? '' : `translate(${this.view.x}px, ${this.view.y}px) scale(${scale})`
    img.classList.toggle('is-zoomed', scale > 1)
    this.zoomLevelTarget.textContent = `${Math.round(scale * 100)} %`
  }

  get current() {
    return this.vertical ? this.vertical.items[this.vertical.index] : this.items[this.index]
  }

  // ── Darstellung ───────────────────────────────────────────────────────────

  async render() {
    const item = this.current
    const variants = Object.keys(item.files)
    if (!item.files[this.variant]) this.variant = PREFERRED_VARIANTS.find((v) => variants.includes(v)) ?? variants[0]
    const file = item.files[this.variant]

    // Beschriftung
    const date = item.takenAt ? `${formatDate(item.takenAt, { weekday: false })} ${formatTime(item.takenAt)} Uhr` : file.name
    this.captionTarget.innerHTML = [
      escapeHtml(date),
      item.viewpointName ? viewpointNameTag(item.viewpointId, item.viewpointName) : null,
      item.assignmentTitle ? escapeHtml(item.assignmentTitle) : null,
    ].filter(Boolean).join(' · ')
    this.positionTarget.textContent = `${this.index + 1} von ${this.items.length}`
    this.prevTarget.disabled = !!this.vertical ? false : this.index === 0
    this.nextTarget.disabled = !!this.vertical ? false : this.index === this.items.length - 1

    // Gleiche Stelle (↑/↓)
    const base = this.vertical ? null : this.items[this.index]
    const list = this.vertical?.items ?? (base?.viewpointId ? await this.loadViewpoint(base.viewpointId, base.viewpointName) : [])
    const vIndex = this.vertical?.index ?? list.findIndex((i) => i.key === base?.key)
    this.verticalTarget.hidden = list.length < 2
    this.verticalLabelTarget.textContent = list.length > 1 ? `Gleiche Stelle ${vIndex + 1}/${list.length}` : ''
    this.earlierTarget.disabled = vIndex <= 0
    this.laterTarget.disabled = vIndex >= list.length - 1

    // Bildtyp-Umschalter
    this.variantsTarget.innerHTML = variants
      .sort((a, b) => PREFERRED_VARIANTS.indexOf(a) - PREFERRED_VARIANTS.indexOf(b))
      .map((v) => `<button type="button" class="${v === this.variant ? 'is-active' : ''}" data-action="gallery#showVariant" data-gallery-variant-param="${v}">${variantLabel(v)}</button>`)
      .join('')

    // Bild: erst Vorschau, dann Original
    this.noticeTarget.hidden = !file.video
    this.noticeTarget.textContent = file.video ? 'Video – mit „Öffnen“ abspielen' : ''
    if (file.thumb) this.imageTarget.src = file.thumb
    if (file.video) return
    const token = (this.token = (this.token ?? 0) + 1)
    try {
      const url = await this.fullImage(file.path)
      if (token === this.token) this.imageTarget.src = url
    } catch (error) {
      console.error(error)
    }
    this.preload()
  }

  async fullImage(path) {
    if (!this.full.has(path)) {
      this.full.set(path, platform.readImage(path).then((blob) => URL.createObjectURL(blob)))
      // nur die letzten Originale behalten
      while (this.full.size > 8) {
        const [oldest, url] = this.full.entries().next().value
        this.full.delete(oldest)
        url.then((u) => URL.revokeObjectURL(u)).catch(() => {})
      }
    }
    return this.full.get(path)
  }

  // Nachbarn vorladen, damit das Blättern flüssig ist
  preload() {
    const neighbours = this.vertical
      ? [this.vertical.items[this.vertical.index - 1], this.vertical.items[this.vertical.index + 1]]
      : [this.items[this.index - 1], this.items[this.index + 1]]
    for (const item of neighbours) {
      const file = item?.files[this.variant]
      if (file && !file.video) this.fullImage(file.path).catch(() => {})
    }
  }

  releaseAll() {
    for (const url of this.full?.values() ?? []) url.then((u) => URL.revokeObjectURL(u)).catch(() => {})
    this.full?.clear()
    this.viewpoints?.clear()
  }

  // Alle Aufnahmen eines Wegpunkts im Einsatz, chronologisch
  async loadViewpoint(viewpointId, viewpointName = null) {
    if (!this.viewpoints.has(viewpointId)) {
      this.viewpoints.set(viewpointId, (async () => {
        const files = await MediaFile.where('viewpoint_id = ?', [viewpointId], { order: 'taken_at ASC' })
        const ids = [...new Set(files.map((f) => f.assignment_id))]
        const titles = new Map((await Assignment.where(`id IN (${ids.map(() => '?').join(', ') || 'NULL'})`, ids)).map((a) => [a.id, a.title]))
        const shots = new Map()
        for (const f of files) {
          const key = `${f.flight_id}/${f.shot_key}`
          if (!shots.has(key)) shots.set(key, { key, files: {}, takenAt: f.taken_at, viewpointId, viewpointName, assignmentTitle: titles.get(f.assignment_id) ?? '' })
          shots.get(key).files[f.variant ?? 'other'] = {
            path: f.path, thumb: platform.media?.thumbUrl(f.thumb_path) ?? null, name: f.original_name, video: f.kind === 'video',
          }
        }
        return [...shots.values()]
      })())
    }
    return this.viewpoints.get(viewpointId)
  }

  // ── Aktionen ──────────────────────────────────────────────────────────────

  openExternal() {
    platform.openPath(this.current.files[this.variant].path).catch((e) => console.error(e))
  }

  reveal() {
    platform.revealPath(this.current.files[this.variant].path).catch((e) => console.error(e))
  }
}

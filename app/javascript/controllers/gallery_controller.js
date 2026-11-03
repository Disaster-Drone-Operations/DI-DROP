import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import MediaFile from '/app/models/media_file.js'
import Assignment from '/app/models/assignment.js'
import { formatDate, formatTime } from '/app/helpers/application_helper.js'
import { variantLabel, PREFERRED_VARIANTS, toggledVariant, compassData } from '/app/helpers/media_helper.js'
import { isVariantSpace } from '/lib/keys.js'
import { viewpointNameTag } from '/app/helpers/mission_helper.js'
import { escapeHtml } from '/app/helpers/application_helper.js'
import { sendImageToPhone } from '/app/services/image_share.js'
import { relayBaseUrl } from '/app/services/location_service.js'
import AnnotationEditor from '/app/javascript/annotation_editor.js'
import Annotation from '/app/models/annotation.js'
import { saveAnnotations, markedPath } from '/app/services/annotations.js'
import { compassOf, setShotCompass, providedPath } from '/app/services/compass.js'
import { compassCenter, drawCompass } from '/app/services/annotation_renderer.js'

// Gallery (almost full screen):
//   ← / →  previous / next shot on the page (chronological)
//   ↑ / ↓  same spot (viewpoint) earlier / later – across all assignments of the mission;
//          zoom and crop are kept (for comparing)
//   + / − / 0, trackpad gesture, Ctrl+mouse wheel (Windows/Linux: mouse wheel), double-click: zoom; drag: pan
//   Space  visible ↔ thermal image
//   M      show/hide markings; "Markieren" opens the editor (annotation_editor.js) – Esc/Fertig saves
//   K      compass on/off for this shot (drag it to move it) – app/services/compass.js
//   Esc    close
// The preview image appears immediately, the original is loaded afterwards.
export default class extends Controller {
  static targets = ['stage', 'frame', 'image', 'marks', 'tools', 'notice', 'prev', 'next', 'vertical', 'verticalLabel', 'earlier', 'later', 'caption', 'position', 'variants', 'zoomLevel', 'phone', 'markButton', 'marksToggle', 'compass', 'compassHandle', 'compassButton']

  static MAX_ZOOM = 8
  static DOUBLE_CLICK_ZOOM = 2.5

  connect() {
    this.full = new Map() // path → object URL (recently used originals)
    this.viewpoints = new Map() // viewpoint → shots
    // Viewpoint renamed (e.g. by double-click here in the gallery) → update data
    this.renamed = ({ detail }) => {
      for (const item of [...(this.items ?? []), ...(this.vertical?.items ?? [])]) {
        if (item.viewpointId === detail.id) item.viewpointName = detail.name
      }
      this.viewpoints.delete(detail.id)
    }
    window.addEventListener('viewpoint:renamed', this.renamed)
    // File renamed → update paths in the displayed shots
    this.moved = ({ detail }) => {
      const map = new Map(detail.changes.map((c) => [c.from, c.to]))
      for (const item of [...(this.items ?? []), ...(this.vertical?.items ?? [])]) {
        for (const file of Object.values(item.files)) if (map.has(file.path)) file.path = map.get(file.path)
      }
    }
    window.addEventListener('media:renamed', this.moved)

    // Trackpad/mouse wheel: two-finger gesture or Ctrl+wheel zooms, swiping pans (when zoomed)
    this.wheel = (event) => this.onWheel(event)
    this.stageTarget.addEventListener('wheel', this.wheel, { passive: false })
    // macOS (WebKit): trackpad zoom gesture arrives as a "gesture" event instead of Ctrl+wheel
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

    // Markings: shown over the image, edited in place
    this.annotations = new Map() // "m<id>" / "c<id>" → shapes
    this.editor = new AnnotationEditor({
      canvas: this.marksTarget, image: this.imageTarget, toolbar: this.toolsTarget, overlay: this.stageTarget,
      onDone: (shapes, changed) => this.marksDone(shapes, changed),
    })
    this.compassResize = new ResizeObserver(() => this.drawCompassLayer())
    this.compassResize.observe(this.imageTarget)
    this.imageTarget.addEventListener('load', () => this.drawCompassLayer())
    this.marksUndo = ({ detail }) => (detail.redo ? this.editor.redo() : this.editor.undo())
    window.addEventListener('annotations:undo', this.marksUndo)
  }

  disconnect() {
    this.stageTarget.removeEventListener('wheel', this.wheel)
    this.stageTarget.removeEventListener('gesturestart', this.gestureStart)
    this.stageTarget.removeEventListener('gesturechange', this.gestureChange)
    window.removeEventListener('viewpoint:renamed', this.renamed)
    window.removeEventListener('media:renamed', this.moved)
    window.removeEventListener('annotations:undo', this.marksUndo)
    this.compassResize.disconnect()
    this.editor.destroy()
    this.releaseAll()
  }

  // ── Opening & navigation ──────────────────────────────────────────────────

  open({ detail }) {
    this.items = detail.items
    this.index = Math.max(0, detail.index)
    this.variant = detail.variant
    this.vertical = null
    this.resetZoom()
    if (!this.element.open) this.element.showModal()
    // Focus the gallery itself – not a button that might be disabled right away
    this.element.focus()
    this.render()
  }

  close() {
    this.element.close()
  }

  closed() {
    this.editor.finish()
    this.releaseAll()
  }

  // Esc while marking: finish marking instead of closing the gallery
  cancel(event) {
    if (!this.editor.editing) return
    event.preventDefault()
    this.editor.finish()
  }

  // Keys in the whole window while the gallery is open – regardless of where focus
  // currently is (a disabled button at the end of the list would lose it otherwise). Input fields
  // (e.g. renaming) keep their arrow keys.
  key(event) {
    if (!this.element.open || event.target.closest?.('input, textarea, select')) return
    if (document.querySelector('.location-dialog[open]')) return // e.g. "An Telefon senden" on top
    if (this.editor.key(event)) return
    if (this.editor.editing) return
    if (event.key === 'm' || event.key === 'M') {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      return this.toggleMarks()
    }
    if ((event.key === 'k' || event.key === 'K') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      return this.toggleCompass()
    }
    if (isVariantSpace(event, { inDialog: true })) {
      event.preventDefault() // no click on a focused button, no scrolling
      return this.toggleVariant()
    }
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

  // Left/right always steps through the page's shots – from where you were
  move(step) {
    this.editor.finish()
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
    this.editor.finish()
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
    this.setVariant(params.variant)
  }

  // Space: thermal ↔ visible image of the same shot
  toggleVariant() {
    const variant = toggledVariant(this.variant, Object.keys(this.current.files), this.lastVisible)
    if (variant) this.setVariant(variant)
  }

  setVariant(variant) {
    if (variant === this.variant) return
    this.editor.finish()
    if (this.variant !== 'T') this.lastVisible = this.variant
    this.variant = variant
    this.resetZoom() // thermal and visual cameras have different fields of view
    this.render()
  }

  // ── Zoom & pan ────────────────────────────────────────────────────────────
  // State: scale + offset (x/y in screen pixels, relative to the image center).
  // Kept on ↑/↓ – same camera, same resolution, same crop.

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
    if (this.editor.editing) return
    if (this.view.scale > 1.01) return this.resetZoom()
    this.zoomAt(this.constructor.DOUBLE_CLICK_ZOOM, this.pointFromEvent(event))
  }

  // Point relative to the (unpanned) image center
  pointFromEvent(event) {
    const img = this.frameTarget
    const cx = img.offsetLeft + img.offsetWidth / 2
    const cy = img.offsetTop + img.offsetHeight / 2
    const stage = this.stageTarget.getBoundingClientRect()
    return { x: event.clientX - stage.left - cx, y: event.clientY - stage.top - cy }
  }

  // Zoom so that the point under the mouse pointer stays in place
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
      // Trackpad zoom gesture (arrives as Ctrl+wheel) or Ctrl+mouse wheel
      this.zoomAt(this.view.scale * Math.exp(-event.deltaY * 0.01), this.pointFromEvent(event), { animate: false })
    } else if (platform.os !== 'macos') {
      // Windows/Linux: the wheel zooms like in the Windows photo viewer – 20 % per notch (100 px)
      this.zoomAt(this.view.scale * 1.2 ** (-wheelPixels(event) / 100), this.pointFromEvent(event), { animate: false })
    } else if (this.view.scale > 1) {
      this.view.x -= event.deltaX
      this.view.y -= event.deltaY
      this.applyView({ animate: false })
    }
  }

  panStart(event) {
    if (this.view.scale <= 1 || event.button !== 0 || this.editor.editing) return
    event.preventDefault()
    const img = this.frameTarget
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

  // Clamp the offset (image stays in view) and apply it
  applyView({ animate }) {
    if (!this.hasFrameTarget) return
    const img = this.frameTarget
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

  // ── Rendering ─────────────────────────────────────────────────────────────

  async render() {
    const item = this.current
    const variants = Object.keys(item.files)
    if (!item.files[this.variant]) this.variant = PREFERRED_VARIANTS.find((v) => variants.includes(v)) ?? variants[0]
    const file = item.files[this.variant]

    // Caption
    const date = item.takenAt ? `${formatDate(item.takenAt, { weekday: false })} ${formatTime(item.takenAt)} Uhr` : file.name
    this.captionTarget.innerHTML = [
      escapeHtml(date),
      item.viewpointName ? viewpointNameTag(item.viewpointId, item.viewpointName) : null,
      item.assignmentTitle ? escapeHtml(item.assignmentTitle) : null,
    ].filter(Boolean).join(' · ')
    this.positionTarget.textContent = `${this.index + 1} von ${this.items.length}`
    this.prevTarget.disabled = !!this.vertical ? false : this.index === 0
    this.nextTarget.disabled = !!this.vertical ? false : this.index === this.items.length - 1

    // Same spot (↑/↓)
    const base = this.vertical ? null : this.items[this.index]
    const list = this.vertical?.items ?? (base?.viewpointId ? await this.loadViewpoint(base.viewpointId, base.viewpointName) : [])
    const vIndex = this.vertical?.index ?? list.findIndex((i) => i.key === base?.key)
    this.verticalTarget.hidden = list.length < 2
    this.verticalLabelTarget.textContent = list.length > 1 ? `Gleiche Stelle ${vIndex + 1}/${list.length}` : ''
    this.earlierTarget.disabled = vIndex <= 0
    this.laterTarget.disabled = vIndex >= list.length - 1

    // Image type switcher
    this.variantsTarget.innerHTML = variants
      .sort((a, b) => PREFERRED_VARIANTS.indexOf(a) - PREFERRED_VARIANTS.indexOf(b))
      .map((v) => `<button type="button" class="${v === this.variant ? 'is-active' : ''}" data-action="gallery#showVariant" data-gallery-variant-param="${v}">${variantLabel(v)}</button>`)
      .join('')

    // Markings of this image (loaded once per gallery opening) and the compass
    this.showMarks(file)
    this.drawCompassLayer()

    // Image: preview first, then original
    this.noticeTarget.hidden = !file.video
    if (this.hasPhoneTarget) this.phoneTarget.hidden = file.video || !relayBaseUrl()
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
      // keep only the most recent originals
      while (this.full.size > 8) {
        const [oldest, url] = this.full.entries().next().value
        this.full.delete(oldest)
        url.then((u) => URL.revokeObjectURL(u)).catch(() => {})
      }
    }
    return this.full.get(path)
  }

  // Preload neighbours so paging is smooth
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
    this.annotations?.clear()
  }

  // All shots of a viewpoint in the mission, chronological
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
            path: f.path, thumb: platform.media?.thumbUrl(f.thumb_path) ?? null, name: f.original_name, video: f.kind === 'video', mediaFileId: f.id, ...compassData(f),
          }
        }
        return [...shots.values()]
      })())
    }
    return this.viewpoints.get(viewpointId)
  }

  // ── Markings ──────────────────────────────────────────────────────────────

  // Image or comparison image the markings belong to → { key, target } or null (videos, unknown files)
  markTarget(file) {
    if (file?.video) return null
    if (file?.mediaFileId) return { key: `m${file.mediaFileId}`, target: { mediaFileId: file.mediaFileId } }
    if (file?.comparisonId) return { key: `c${file.comparisonId}`, target: { comparisonId: file.comparisonId } }
    return null
  }

  async shapesFor(mark) {
    if (!this.annotations.has(mark.key)) {
      const a = mark.target.mediaFileId ? await Annotation.forMediaFile(mark.target.mediaFileId) : await Annotation.forComparison(mark.target.comparisonId)
      this.annotations.set(mark.key, a?.list ?? [])
    }
    return this.annotations.get(mark.key)
  }

  async showMarks(file) {
    const mark = this.markTarget(file)
    this.markButtonTarget.hidden = !mark
    this.marksToggleTarget.hidden = true
    this.editor.show([])
    if (!mark) return
    const shapes = await this.shapesFor(mark)
    if (this.markTarget(this.current.files[this.variant])?.key !== mark.key) return // paged on meanwhile
    this.editor.show(shapes)
    this.updateMarkButtons(shapes)
    // Markings belong to one image: point to the other image type if only that one is marked
    const others = []
    for (const [variant, other] of Object.entries(this.current.files)) {
      const m = variant !== this.variant && this.markTarget(other)
      if (m && (await this.shapesFor(m)).length) others.push(variantLabel(variant))
    }
    if (this.markTarget(this.current.files[this.variant])?.key !== mark.key) return
    this.positionTarget.textContent = [`${this.index + 1} von ${this.items.length}`, !shapes.length && others.length ? `Markiert: ${others.join(', ')}` : null].filter(Boolean).join(' · ')
  }

  updateMarkButtons(shapes) {
    this.marksToggleTarget.hidden = !shapes.length
    this.marksToggleTarget.classList.toggle('is-active', this.editor.visible)
    this.marksToggleTarget.title = this.editor.visible ? 'Markierungen ausblenden (M)' : 'Markierungen einblenden (M)'
    this.markButtonTarget.querySelector('span').textContent = shapes.length ? 'Bearbeiten' : 'Markieren'
  }

  toggleMarks() {
    this.editor.visible = !this.editor.visible
    this.updateMarkButtons(this.annotations.get(this.markTarget(this.current.files[this.variant])?.key) ?? [])
  }

  async editMarks() {
    const mark = this.markTarget(this.current.files[this.variant])
    if (!mark) return
    this.markKey = mark
    this.editor.edit(await this.shapesFor(mark))
    this.markButtonTarget.hidden = true
    this.drawCompassLayer() // not movable while marking
  }

  // Fertig: save (writes the marked copy "…_markiert.JPG" next to the original)
  async marksDone(shapes, changed) {
    const mark = this.markKey
    this.markKey = null
    this.markButtonTarget.hidden = false
    this.drawCompassLayer()
    this.updateMarkButtons(shapes)
    if (!mark || !changed) return
    this.annotations.set(mark.key, shapes)
    try {
      await saveAnnotations(mark.target, shapes)
      this.flashNotice(shapes.length ? 'Markierung gespeichert' : 'Markierungen entfernt')
      window.dispatchEvent(new CustomEvent('annotations:changed', { detail: { ...mark.target, marked: shapes.length > 0, shapes } }))
    } catch (error) {
      console.error(error)
      this.flashNotice(`Markierung nicht gespeichert: ${error?.message ?? error}`)
    }
  }

  flashNotice(text) {
    clearTimeout(this.noticeTimer)
    this.noticeTarget.textContent = text
    this.noticeTarget.hidden = false
    this.noticeTimer = setTimeout(() => { this.noticeTarget.hidden = true }, 2500)
  }

  // ── Compass ───────────────────────────────────────────────────────────────

  // compassOf() wants the database fields – the gallery data names them shorter
  compassFile(file = this.current?.files[this.variant]) {
    if (!file) return null
    return { gimbal_yaw: file.yaw, gimbal_pitch: file.pitch, compass: file.compass, compass_x: file.compassX, compass_y: file.compassY }
  }

  drawCompassLayer() {
    if (!this.hasCompassTarget || !this.items?.length || !this.current) return
    const file = this.current.files[this.variant]
    const data = this.compassFile(file)
    const canDo = data?.gimbal_yaw != null && data?.gimbal_pitch != null && !file.video
    const compass = canDo ? compassOf(data) : null
    this.compassButtonTarget.hidden = !canDo
    this.compassButtonTarget.classList.toggle('is-active', !!compass)
    const canvas = this.compassTarget
    const img = this.imageTarget
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(img.clientWidth * dpr)
    canvas.height = Math.round(img.clientHeight * dpr)
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    this.compassHandleTarget.hidden = !compass || this.editor.editing
    if (!compass || !canvas.width) return
    const { cx, cy, r } = compassCenter(canvas.width, canvas.height, compass.x, compass.y)
    drawCompass(ctx, compass, cx, cy, r)
    // Grab area over the disc (CSS pixels, relative to the image)
    Object.assign(this.compassHandleTarget.style, {
      left: `${((cx - r * 1.3) / canvas.width) * 100}%`, top: `${((cy - r * 1.3) / canvas.height) * 100}%`,
      width: `${((r * 2.6) / canvas.width) * 100}%`, height: `${((r * 2.6) / canvas.height) * 100}%`,
    })
  }

  // Changes of the shot's compass – all its images (visible and thermal share the gimbal position)
  async updateCompass(changes) {
    const files = Object.values(this.current.files).filter((f) => f.mediaFileId)
    const map = { compass: 'compass', compass_x: 'compassX', compass_y: 'compassY' }
    for (const f of files) for (const [k, v] of Object.entries(changes)) f[map[k]] = v
    this.drawCompassLayer()
    const ids = files.map((f) => f.mediaFileId)
    await setShotCompass(ids, changes)
    window.dispatchEvent(new CustomEvent('compass:changed', { detail: { ids, changes } })) // the page's shot cards keep their data
    // Marked copies show the compass too – draw them anew
    for (const f of files) {
      const shapes = this.annotations.get(`m${f.mediaFileId}`) ?? (await this.shapesFor({ key: `m${f.mediaFileId}`, target: { mediaFileId: f.mediaFileId } }))
      if (shapes.length) await saveAnnotations({ mediaFileId: f.mediaFileId }, shapes).catch((e) => console.error(e))
    }
  }

  toggleCompass() {
    const data = this.compassFile()
    if (data?.gimbal_yaw == null) return
    this.updateCompass({ compass: compassOf(data) ? 0 : 1 })
    this.flashNotice(compassOf(this.compassFile()) ? 'Kompass an – wird in die bereitgestellten Bilder eingezeichnet' : 'Kompass aus')
  }

  // Drag the compass – position relative to the image, stored when let go
  compassDrag(event) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = this.compassHandleTarget
    const rect = this.imageTarget.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    const compass = compassOf(this.compassFile())
    const canvas = this.compassTarget
    const { cx, cy } = compassCenter(canvas.width, canvas.height, compass.x, compass.y)
    const origin = { x: cx / canvas.width, y: cy / canvas.height }
    const file = this.current.files[this.variant]
    let pos = origin
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    const move = (e) => {
      const clamp = (v) => Math.min(0.97, Math.max(0.03, v))
      pos = { x: clamp(origin.x + (e.clientX - start.x) / rect.width), y: clamp(origin.y + (e.clientY - start.y) / rect.height) }
      file.compassX = pos.x
      file.compassY = pos.y
      this.drawCompassLayer()
    }
    const up = () => {
      handle.classList.remove('is-dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      if (pos !== origin) this.updateCompass({ compass_x: pos.x, compass_y: pos.y, ...(file.compass == null ? { compass: 1 } : {}) })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  // The file as it is shown: the marked copy ("…_markiert.JPG", with compass) while markings are shown, otherwise
  // the image with compass (rendered into the cache) or the original. reveal: never a cache copy – show the original's folder
  async shownPath({ reveal = false } = {}) {
    const file = this.current.files[this.variant]
    const shapes = this.annotations.get(this.markTarget(file)?.key)
    if (shapes?.length && this.editor.visible) return markedPath(file.path)
    if (reveal || !file.mediaFileId || !compassOf(this.compassFile(file))) return file.path
    return (await providedPath(await MediaFile.find(file.mediaFileId)).catch((e) => console.error(e))) ?? file.path
  }

  async openExternal() {
    platform.openPath(await this.shownPath()).catch((e) => console.error(e))
  }

  async reveal() {
    platform.revealPath(await this.shownPath({ reveal: true })).catch((e) => console.error(e))
  }

  // The variant shown (thermal/visible …) – with markings and compass as they are shown
  async sendToPhone() {
    const file = this.current.files[this.variant]
    if (file && !file.video) sendImageToPhone(await this.shownPath())
  }
}

// Wheel distance in pixels (some devices report lines or pages)
function wheelPixels(event) {
  return event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1)
}

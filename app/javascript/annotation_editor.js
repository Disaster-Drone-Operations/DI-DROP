// Markings on the large view (gallery): a canvas exactly over the image shows them; in edit mode it takes the
// mouse and draws circles, rectangles, arrows and text – kept deliberately simple (like a small Preview.app).
//
//   const editor = new AnnotationEditor({ canvas, image, toolbar, overlay, onDone })   overlay: untransformed
//                                                                                       parent for the text field
//   editor.show(shapes)        display (or [] for none)
//   editor.edit(shapes)        edit mode with toolbar; Fertig/Esc → onDone(shapes, changed)
//   editor.visible = false     hide the markings (key M in the gallery)
//
// Drawing: drag on empty space draws with the chosen tool (text: click, then type). A click on a shape
// selects it – drag moves it, the corner handles resize it; color/style/size apply to the selected shape
// and to the next ones. Delete/Backspace removes it, ⌘Z/⇧⌘Z undo/redo within the editor (via the app's
// undo command – app/javascript/shortcuts.js sends "annotations:undo" while marking).

import { COLORS, TEXT_SIZES, DEFAULT_COLOR, drawShapes, bounds, strokeWidth, cleanShapes } from '/app/services/annotation_renderer.js'
import { icon, escapeHtml } from '/app/helpers/application_helper.js'

const TOOLS = [
  ['ellipse', 'Kreis', 'shape-ellipse'],
  ['rect', 'Rechteck', 'shape-rect'],
  ['arrow', 'Pfeil', 'shape-arrow'],
  ['text', 'Text', 'shape-text'],
]
const MIN_SIZE = 0.01 // smaller drags are clicks
const HANDLE = 6 // handle radius in CSS pixels

const clone = (shapes) => JSON.parse(JSON.stringify(shapes))

export default class AnnotationEditor {
  constructor({ canvas, image, toolbar, overlay, onDone }) {
    this.canvas = canvas
    this.image = image
    this.toolbar = toolbar
    this.overlay = overlay
    this.onDone = onDone
    this.shapes = []
    this.visible = true
    this.editing = false
    this.style = { tool: 'ellipse', color: DEFAULT_COLOR, fill: false, size: 'm' }
    this.selected = -1

    this.resize = new ResizeObserver(() => this.redraw())
    this.resize.observe(image)
    image.addEventListener('load', () => this.redraw())
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e))
    canvas.addEventListener('dblclick', (e) => this.doubleClick(e))
    toolbar.addEventListener('click', (e) => this.toolbarClick(e))
  }

  destroy() {
    this.resize.disconnect()
  }

  // ── Public ────────────────────────────────────────────────────────────

  show(shapes) {
    this.stopEditing()
    this.shapes = clone(shapes ?? [])
    this.redraw()
  }

  set visible(value) {
    this._visible = value
    this.redraw()
  }

  get visible() {
    return this._visible
  }

  edit(shapes) {
    this.shapes = clone(shapes ?? [])
    this.original = JSON.stringify(cleanShapes(this.shapes))
    this.history = [clone(this.shapes)]
    this.future = []
    this.selected = -1
    this.editing = true
    this._visible = true
    this.canvas.classList.add('is-editing')
    this.toolbar.hidden = false
    this.renderToolbar()
    this.redraw()
  }

  // Fertig: hand the shapes over (changed = differs from when editing started)
  finish() {
    if (!this.editing) return
    this.commitText()
    const shapes = cleanShapes(this.shapes)
    const changed = JSON.stringify(shapes) !== this.original
    this.stopEditing()
    this.shapes = shapes
    this.redraw()
    this.onDone?.(shapes, changed)
  }

  stopEditing() {
    this.removeTextInput()
    this.editing = false
    this.selected = -1
    this.canvas.classList.remove('is-editing')
    this.toolbar.hidden = true
  }

  // Keys while editing → true if handled
  key(event) {
    if (!this.editing) return false
    if (event.target.closest?.('.annot-text')) return false // typing
    if (event.key === 'Escape' || (event.key === 'Enter' && this.selected < 0)) {
      this.finish()
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && this.selected >= 0) {
      this.deleteSelected()
    } else if (event.key === 'Enter' && this.shapes[this.selected]?.type === 'text') {
      this.editText(this.selected)
    } else {
      return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key) // no paging while editing
    }
    event.preventDefault()
    return true
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  get size() {
    return { w: this.canvas.width, h: this.canvas.height }
  }

  redraw() {
    const img = this.image
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(img.clientWidth * dpr)
    const h = Math.round(img.clientHeight * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const ctx = this.canvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    if (!w || !h || (!this._visible && !this.editing)) return
    drawShapes(ctx, this.shapes, w, h)
    if (this.editing && this.selected >= 0 && this.shapes[this.selected]) this.drawSelection(ctx, this.shapes[this.selected])
  }

  drawSelection(ctx, shape) {
    const dpr = window.devicePixelRatio || 1
    const { w, h } = this.size
    const pad = strokeWidth(w, h) + 4 * dpr
    ctx.save()
    ctx.setLineDash([5 * dpr, 4 * dpr])
    ctx.lineWidth = 1.5 * dpr
    ctx.strokeStyle = 'rgba(255,255,255,.9)'
    if (shape.type !== 'arrow') {
      const b = bounds(ctx, shape, w, h)
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2)
    }
    ctx.setLineDash([])
    for (const p of this.handles(ctx, shape)) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, HANDLE * dpr, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,.6)'
      ctx.stroke()
    }
    ctx.restore()
  }

  // Resize handles in canvas pixels: corners (rect/ellipse) or both ends (arrow); text: none (size S/M/L)
  handles(ctx, shape) {
    const { w, h } = this.size
    if (shape.type === 'arrow') return [{ x: shape.x * w, y: shape.y * h, key: 'start' }, { x: shape.x2 * w, y: shape.y2 * h, key: 'end' }]
    if (shape.type === 'text') return []
    const b = bounds(ctx, shape, w, h)
    return [
      { x: b.x, y: b.y, key: 'nw' }, { x: b.x + b.w, y: b.y, key: 'ne' },
      { x: b.x, y: b.y + b.h, key: 'sw' }, { x: b.x + b.w, y: b.y + b.h, key: 'se' },
    ]
  }

  // ── Mouse ─────────────────────────────────────────────────────────────

  // Pointer position relative to the image (0…1) – also when zoomed (the canvas is transformed with the image)
  point(event) {
    const r = this.canvas.getBoundingClientRect()
    return { x: (event.clientX - r.left) / r.width, y: (event.clientY - r.top) / r.height, px: (event.clientX - r.left) * (this.canvas.width / r.width), py: (event.clientY - r.top) * (this.canvas.height / r.height) }
  }

  hit(p) {
    const ctx = this.canvas.getContext('2d')
    const { w, h } = this.size
    const tolerance = strokeWidth(w, h) + 6 * (window.devicePixelRatio || 1)
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i]
      if (s.type === 'arrow') {
        if (distanceToSegment(p.px, p.py, s.x * w, s.y * h, s.x2 * w, s.y2 * h) <= tolerance) return i
        continue
      }
      const b = bounds(ctx, s, w, h)
      if (p.px >= b.x - tolerance && p.px <= b.x + b.w + tolerance && p.py >= b.y - tolerance && p.py <= b.y + b.h + tolerance) return i
    }
    return -1
  }

  handleAt(p) {
    if (this.selected < 0) return null
    const ctx = this.canvas.getContext('2d')
    const r = (HANDLE + 4) * (window.devicePixelRatio || 1)
    return this.handles(ctx, this.shapes[this.selected]).find((hd) => Math.hypot(hd.x - p.px, hd.y - p.py) <= r)?.key ?? null
  }

  pointerDown(event) {
    if (!this.editing || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    this.commitText()
    const start = this.point(event)
    const handle = this.handleAt(start)
    const index = handle ? this.selected : this.hit(start)
    let mode
    let shape
    const before = JSON.stringify(this.shapes)

    if (handle) {
      mode = 'resize'
      shape = this.shapes[index]
    } else if (index >= 0) {
      mode = 'move'
      this.select(index)
      shape = this.shapes[index]
    } else if (this.style.tool === 'text') {
      this.addText(start)
      return
    } else {
      mode = 'draw'
      shape = this.newShape(start)
      this.shapes.push(shape)
      this.selected = this.shapes.length - 1
    }
    const origin = clone(shape)

    this.canvas.setPointerCapture(event.pointerId)
    const move = (e) => {
      const p = this.point(e)
      const dx = p.x - start.x
      const dy = p.y - start.y
      if (mode === 'move') {
        Object.assign(shape, { x: origin.x + dx, y: origin.y + dy })
        if (shape.type === 'arrow') Object.assign(shape, { x2: origin.x2 + dx, y2: origin.y2 + dy })
      } else if (mode === 'draw') {
        if (shape.type === 'arrow') Object.assign(shape, { x2: p.x, y2: p.y })
        else Object.assign(shape, { w: p.x - start.x, h: p.y - start.y })
      } else if (shape.type === 'arrow') {
        if (handle === 'start') Object.assign(shape, { x: origin.x + dx, y: origin.y + dy })
        else Object.assign(shape, { x2: origin.x2 + dx, y2: origin.y2 + dy })
      } else {
        // corner handle: move that corner, the opposite one stays
        const left = Math.min(origin.x, origin.x + origin.w)
        const top = Math.min(origin.y, origin.y + origin.h)
        const right = Math.max(origin.x, origin.x + origin.w)
        const bottom = Math.max(origin.y, origin.y + origin.h)
        const x1 = handle.includes('w') ? left + dx : left
        const x2 = handle.includes('e') ? right + dx : right
        const y1 = handle.includes('n') ? top + dy : top
        const y2 = handle.includes('s') ? bottom + dy : bottom
        Object.assign(shape, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
      }
      this.redraw()
    }
    const up = () => {
      this.canvas.removeEventListener('pointermove', move)
      this.canvas.removeEventListener('pointerup', up)
      this.canvas.removeEventListener('pointercancel', up)
      if (mode === 'draw' && tooSmall(shape)) {
        this.shapes.pop()
        this.selected = -1
      }
      this.normalize(shape)
      if (JSON.stringify(this.shapes) !== before) this.remember()
      this.renderToolbar()
      this.redraw()
    }
    this.canvas.addEventListener('pointermove', move)
    this.canvas.addEventListener('pointerup', up)
    this.canvas.addEventListener('pointercancel', up)
    this.redraw()
  }

  doubleClick(event) {
    if (!this.editing) return
    const index = this.hit(this.point(event))
    if (index >= 0 && this.shapes[index].type === 'text') this.editText(index)
  }

  newShape(p) {
    const { tool, color, fill } = this.style
    if (tool === 'arrow') return { type: 'arrow', x: p.x, y: p.y, x2: p.x, y2: p.y, color }
    return { type: tool, x: p.x, y: p.y, w: 0, h: 0, color, fill }
  }

  // Rectangles/ellipses with positive width/height
  normalize(shape) {
    if (!shape || !('w' in shape)) return
    if (shape.w < 0) Object.assign(shape, { x: shape.x + shape.w, w: -shape.w })
    if (shape.h < 0) Object.assign(shape, { y: shape.y + shape.h, h: -shape.h })
  }

  select(index) {
    this.selected = index
    const s = this.shapes[index]
    if (s) {
      // the toolbar shows the selected shape's style
      this.style.color = s.color
      if ('fill' in s) this.style.fill = s.fill
      if (s.size) this.style.size = s.size
    }
    this.renderToolbar()
    this.redraw()
  }

  deleteSelected() {
    if (this.selected < 0) return
    this.shapes.splice(this.selected, 1)
    this.selected = -1
    this.remember()
    this.renderToolbar()
    this.redraw()
  }

  // ── Text ──────────────────────────────────────────────────────────────

  addText(p) {
    const { color, fill, size } = this.style
    this.shapes.push({ type: 'text', x: p.x, y: p.y, text: '', color, fill, size })
    this.editText(this.shapes.length - 1, { isNew: true })
  }

  // A text field exactly where the text is; Enter = done, ⇧Enter = new line, Esc = cancel
  editText(index, { isNew = false } = {}) {
    this.removeTextInput()
    const shape = this.shapes[index]
    this.selected = index
    const r = this.canvas.getBoundingClientRect()
    const host = this.overlay.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const px = Math.max(10, Math.round(Math.min(this.canvas.width, this.canvas.height) * TEXT_SIZES[shape.size].ratio)) / dpr * (r.width / this.canvas.clientWidth)
    const input = document.createElement('textarea')
    input.className = 'annot-text'
    input.value = shape.text
    input.rows = Math.max(1, shape.text.split('\n').length)
    Object.assign(input.style, {
      left: `${r.left - host.left + shape.x * r.width}px`,
      top: `${r.top - host.top + shape.y * r.height}px`,
      fontSize: `${px}px`,
      color: COLORS[shape.color]?.value,
    })
    const hidden = { ...shape }
    shape.text = '' // shown by the field while typing
    this.redraw()
    this.overlay.append(input)
    this.textInput = { input, index, isNew, previous: hidden.text }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        this.cancelText()
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.commitText()
      }
    })
    input.addEventListener('input', () => { input.rows = Math.max(1, input.value.split('\n').length) })
    input.addEventListener('blur', () => this.commitText())
    input.focus()
  }

  commitText() {
    const t = this.textInput
    if (!t) return
    this.textInput = null
    const shape = this.shapes[t.index]
    shape.text = t.input.value.replace(/\s+$/, '')
    t.input.remove()
    if (!shape.text.trim()) {
      this.shapes.splice(t.index, 1)
      this.selected = -1
    }
    if (shape.text !== t.previous) this.remember()
    this.renderToolbar()
    this.redraw()
  }

  cancelText() {
    const t = this.textInput
    if (!t) return
    t.input.value = t.previous
    this.commitText()
  }

  removeTextInput() {
    this.textInput?.input.remove()
    this.textInput = null
  }

  // ── Undo ──────────────────────────────────────────────────────────────

  remember() {
    this.history.push(clone(this.shapes))
    if (this.history.length > 100) this.history.shift()
    this.future = []
  }

  undo() {
    if (this.history.length < 2) return
    this.future.push(this.history.pop())
    this.shapes = clone(this.history.at(-1))
    this.selected = -1
    this.renderToolbar()
    this.redraw()
  }

  redo() {
    const next = this.future.pop()
    if (!next) return
    this.history.push(next)
    this.shapes = clone(next)
    this.selected = -1
    this.renderToolbar()
    this.redraw()
  }

  // ── Toolbar ───────────────────────────────────────────────────────────

  renderToolbar() {
    if (!this.editing) return
    const s = this.style
    const shape = this.shapes[this.selected]
    const isText = (shape?.type ?? s.tool) === 'text'
    const canFill = (shape?.type ?? s.tool) !== 'arrow'
    // All groups always present (the toolbar keeps its width) – what doesn't fit the tool is dimmed, not removed
    const button = (attrs, content, active = false, title = '', disabled = false) =>
      `<button type="button" class="${active ? 'is-active' : ''}" ${attrs} title="${escapeHtml(title)}" ${disabled ? 'disabled' : ''}>${content}</button>`
    this.toolbar.innerHTML = `
      <div class="segmented segmented--dark" aria-label="Werkzeug">
        ${TOOLS.map(([key, label, ic]) => button(`data-tool="${key}"`, icon(ic, { size: 16 }), s.tool === key, label)).join('')}
      </div>
      <div class="segmented segmented--dark ${canFill ? '' : 'is-disabled'}" aria-label="Stil">
        ${button('data-fill="0"', 'Rand', !s.fill && canFill, isText ? 'Text ohne Hintergrund' : 'Nur der Rand', !canFill)}
        ${button('data-fill="1"', 'Gefüllt', s.fill && canFill, isText ? 'Text auf farbigem Schild' : 'Deckend gefüllt – verdeckt, was darunter ist', !canFill)}
      </div>
      <div class="annot-colors" aria-label="Farbe">
        ${Object.entries(COLORS).map(([key, c]) => `<button type="button" class="annot-color ${s.color === key ? 'is-active' : ''}" data-color="${key}" title="${c.label}" style="--swatch: ${c.value}"></button>`).join('')}
      </div>
      <div class="segmented segmented--dark ${isText ? '' : 'is-disabled'}" aria-label="Textgröße">
        ${Object.entries(TEXT_SIZES).map(([key, t]) => button(`data-size="${key}"`, t.label, s.size === key && isText, `Textgröße ${t.label}`, !isText)).join('')}
      </div>
      <span class="annot-tools__spacer"></span>
      <button type="button" class="button button--dark" data-action-key="delete" title="Ausgewählte Markierung löschen (⌫)" ${shape ? '' : 'disabled'}>${icon('trash', { size: 16 })}</button>
      <button type="button" class="button button--dark" data-action-key="undo" title="Widerrufen (⌘Z)" ${this.history.length > 1 ? '' : 'disabled'}>${icon('undo', { size: 16 })}</button>
      <button type="button" class="button button--primary" data-action-key="done" title="Fertig (Esc)">Fertig</button>`
  }

  toolbarClick(event) {
    const b = event.target.closest('button')
    if (!b || b.disabled) return
    const shape = this.shapes[this.selected]
    const apply = (changes) => {
      if (!shape) return
      Object.assign(shape, changes)
      this.remember()
    }
    if (b.dataset.tool) {
      this.style.tool = b.dataset.tool
      this.selected = -1
    } else if (b.dataset.fill) {
      this.style.fill = b.dataset.fill === '1'
      if (shape && 'fill' in shape) apply({ fill: this.style.fill })
    } else if (b.dataset.color) {
      this.style.color = b.dataset.color
      apply({ color: b.dataset.color })
    } else if (b.dataset.size) {
      this.style.size = b.dataset.size
      if (shape?.type === 'text') apply({ size: b.dataset.size })
    } else if (b.dataset.actionKey === 'delete') {
      return this.deleteSelected()
    } else if (b.dataset.actionKey === 'undo') {
      return this.undo()
    } else if (b.dataset.actionKey === 'done') {
      return this.finish()
    }
    this.renderToolbar()
    this.redraw()
  }
}

function tooSmall(shape) {
  if (shape.type === 'arrow') return Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y) < MIN_SIZE * 2
  return Math.abs(shape.w) < MIN_SIZE && Math.abs(shape.h) < MIN_SIZE
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2)) : 0
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)))
}

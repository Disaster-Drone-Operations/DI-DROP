// Draws markings (circle, rectangle, arrow, text) onto a canvas – the same function for the editor, the
// large view and the marked copy, so all look identical. Shapes use coordinates relative to the image (0…1):
//
//   { type: 'rect' | 'ellipse', x, y, w, h, color, fill }     fill = opaque (covers what's underneath)
//   { type: 'arrow', x, y, x2, y2, color }                     from (x, y) to the tip (x2, y2)
//   { type: 'text', x, y, text, size: 's' | 'm' | 'l', color, fill }   fill = on a colored label
//
// Every shape gets a fine contrasting outline – on thermal images yellow or red would otherwise get lost.

export const COLORS = {
  red: { label: 'Rot', value: '#ff3b30' },
  yellow: { label: 'Gelb', value: '#ffd60a' },
  green: { label: 'Grün', value: '#30d158' },
  blue: { label: 'Blau', value: '#0a84ff' },
  white: { label: 'Weiß', value: '#ffffff' },
  black: { label: 'Schwarz', value: '#1c1c1e' },
}
export const DEFAULT_COLOR = 'red'
export const TEXT_SIZES = { s: { label: 'Klein', ratio: 0.035 }, m: { label: 'Mittel', ratio: 0.055 }, l: { label: 'Groß', ratio: 0.085 } }
export const TYPES = ['ellipse', 'rect', 'arrow', 'text']

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
const LIGHT = new Set(['yellow', 'white', 'green'])

const colorOf = (shape) => COLORS[shape.color]?.value ?? COLORS[DEFAULT_COLOR].value
const haloOf = (shape) => (shape.color === 'black' ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.55)')
const textOn = (shape) => (LIGHT.has(shape.color) ? '#1c1c1e' : '#ffffff')

// Line width in pixels for an image of this size (about 0.8 % of the shorter side)
export const strokeWidth = (width, height, min = 2) => Math.max(min, Math.round(Math.min(width, height) * 0.008))

// Only known shapes with sensible values (data from the editor or the database)
export function cleanShapes(shapes) {
  const num = (v) => (Number.isFinite(Number(v)) ? Math.min(1.5, Math.max(-0.5, Number(v))) : 0)
  return (Array.isArray(shapes) ? shapes : []).filter((s) => TYPES.includes(s?.type)).map((s) => {
    const base = { type: s.type, color: COLORS[s.color] ? s.color : DEFAULT_COLOR, x: num(s.x), y: num(s.y) }
    if (s.type === 'arrow') return { ...base, x2: num(s.x2), y2: num(s.y2) }
    if (s.type === 'text') return { ...base, text: String(s.text ?? '').slice(0, 500), size: TEXT_SIZES[s.size] ? s.size : 'm', fill: !!s.fill }
    return { ...base, w: num(s.w), h: num(s.h), fill: !!s.fill }
  }).filter((s) => s.type !== 'text' || s.text.trim())
}

function textLayout(ctx, shape, width, height) {
  const px = Math.max(10, Math.round(Math.min(width, height) * TEXT_SIZES[shape.size ?? 'm'].ratio))
  ctx.font = `600 ${px}px ${FONT}`
  const lines = shape.text.split('\n')
  const lineHeight = Math.round(px * 1.2)
  const pad = shape.fill ? Math.round(px * 0.3) : 0
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width))
  return { px, lines, lineHeight, pad, w: textWidth + pad * 2, h: lines.length * lineHeight + pad * 2 }
}

// Bounding box in pixels (for selecting and moving in the editor)
export function bounds(ctx, shape, width, height) {
  if (shape.type === 'text') {
    const t = textLayout(ctx, shape, width, height)
    return { x: shape.x * width, y: shape.y * height, w: t.w, h: t.h }
  }
  if (shape.type === 'arrow') {
    const [x1, y1, x2, y2] = [shape.x * width, shape.y * height, shape.x2 * width, shape.y2 * height]
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
  }
  const x = shape.x * width
  const y = shape.y * height
  const w = shape.w * width
  const h = shape.h * height
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) }
}

function outline(ctx, shape, path, line) {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = haloOf(shape)
  ctx.lineWidth = line + Math.max(2, line * 0.7)
  path()
  ctx.stroke()
  ctx.strokeStyle = colorOf(shape)
  ctx.lineWidth = line
  path()
  ctx.stroke()
}

function drawShape(ctx, shape, width, height, line) {
  const color = colorOf(shape)
  if (shape.type === 'rect' || shape.type === 'ellipse') {
    const { x, y, w, h } = bounds(ctx, shape, width, height)
    const path = () => {
      ctx.beginPath()
      if (shape.type === 'rect') ctx.rect(x, y, w, h)
      else ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2)
    }
    if (shape.fill) {
      ctx.fillStyle = color
      path()
      ctx.fill()
      outline(ctx, shape, path, Math.max(1, line / 3))
    } else {
      outline(ctx, shape, path, line)
    }
  } else if (shape.type === 'arrow') {
    const [x1, y1, x2, y2] = [shape.x * width, shape.y * height, shape.x2 * width, shape.y2 * height]
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = Math.max(line * 6, 12)
    const spread = Math.PI / 7
    const tip = (a) => [x2 - head * Math.cos(angle - a), y2 - head * Math.sin(angle - a)]
    const shaftEnd = [x2 - head * 0.8 * Math.cos(angle), y2 - head * 0.8 * Math.sin(angle)]
    const headPath = () => {
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(...tip(spread))
      ctx.lineTo(...tip(-spread))
      ctx.closePath()
    }
    outline(ctx, shape, () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(...shaftEnd) }, line)
    ctx.fillStyle = color
    headPath()
    ctx.lineWidth = Math.max(2, line * 0.7)
    ctx.strokeStyle = haloOf(shape)
    ctx.stroke()
    ctx.fill()
  } else if (shape.type === 'text') {
    const t = textLayout(ctx, shape, width, height)
    const x = shape.x * width
    const y = shape.y * height
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.lineJoin = 'round'
    if (shape.fill) {
      ctx.fillStyle = color
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y, t.w, t.h, t.pad)
      else ctx.rect(x, y, t.w, t.h)
      ctx.fill()
    }
    t.lines.forEach((l, i) => {
      const ty = y + t.pad + i * t.lineHeight + (t.lineHeight - t.px) / 2
      if (!shape.fill) {
        ctx.strokeStyle = haloOf(shape)
        ctx.lineWidth = Math.max(2, t.px * 0.14)
        ctx.strokeText(l, x + t.pad, ty)
      }
      ctx.fillStyle = shape.fill ? textOn(shape) : color
      ctx.fillText(l, x + t.pad, ty)
    })
  }
}

// Draws all shapes onto ctx for an image of width × height pixels (the image itself is already drawn);
// minLine: thinnest line in pixels (thumbnails: a bit more, so markings stay visible)
export function drawShapes(ctx, shapes, width, height, { minLine = 2 } = {}) {
  const line = strokeWidth(width, height, minLine)
  ctx.save()
  for (const shape of shapes) drawShape(ctx, shape, width, height, line)
  ctx.restore()
}

// Thumbnails: markings over an <img> shown with "object-fit: cover" (cropped to its box)
//   drawOnThumbnail(canvas, img, shapes)  – canvas lies exactly over the image box
export function drawOnThumbnail(canvas, img, shapes) {
  const dpr = window.devicePixelRatio || 1
  const boxW = img.clientWidth
  const boxH = img.clientHeight
  canvas.width = Math.round(boxW * dpr)
  canvas.height = Math.round(boxH * dpr)
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!shapes?.length || !img.naturalWidth || !boxW) return
  const scale = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight) * dpr
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  ctx.save()
  ctx.translate((canvas.width - w) / 2, (canvas.height - h) / 2)
  drawShapes(ctx, shapes, w, h, { minLine: 2 * dpr })
  ctx.restore()
}

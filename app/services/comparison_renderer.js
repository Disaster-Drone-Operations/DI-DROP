// Draws a comparison image: shots side by side, above them a white strip
// with date and time (template from practice: 3840×1064 from 3 thermal images).
//
// The same function serves the live preview (with thumbnails) and the
// export (with original images) – so the result looks identical.

import platform from '/lib/platform/index.js'
import { sanitizeFolderName } from '/lib/folders.js'
import { parseLocal } from '/lib/time.js'

const MAX_HEIGHT = 1080 // visible images (3024 px tall) are scaled down to this height
const HEADER_RATIO = 0.039 // 40 px header at 1024 px image height
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'

const bitmaps = new Map()

// Load a thumbnail (cached – they are small)
export function loadBitmap(path) {
  if (!bitmaps.has(path)) {
    bitmaps.set(path, platform.readImage(path).then((blob) => createImageBitmap(blob)).catch((error) => {
      bitmaps.delete(path)
      throw error
    }))
  }
  return bitmaps.get(path)
}

export function releaseBitmaps() {
  for (const promise of bitmaps.values()) promise.then((b) => b.close?.()).catch(() => {})
  bitmaps.clear()
}

// "11.09.2026 13:08"
export function captionFor(takenAt) {
  const d = parseLocal(takenAt)
  if (!d) return ''
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

// items: [{ bitmap, caption }]
export function draw(canvas, items, { maxHeight = MAX_HEIGHT } = {}) {
  const height = Math.min(maxHeight, ...items.map((i) => i.bitmap.height))
  const widths = items.map((i) => Math.round((i.bitmap.width * height) / i.bitmap.height))
  const header = Math.max(16, Math.round(height * HEADER_RATIO))

  canvas.width = widths.reduce((a, b) => a + b, 0)
  canvas.height = height + header
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'

  let x = 0
  items.forEach((item, i) => {
    ctx.drawImage(item.bitmap, x, header, widths[i], height)
    ctx.fillStyle = '#222'
    ctx.font = `500 ${Math.round(header * 0.45)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(item.caption, x + widths[i] / 2, header / 2 + 1)
    x += widths[i]
  })
  return canvas
}

// "Vergleich_Ost-1_1308_1331_1440.jpg"
export function fileNameFor(viewpointName, shots) {
  const name = sanitizeFolderName(viewpointName).replace(/\s+/g, '-')
  const times = shots.map((s) => (s.taken_at ?? '').slice(11, 16).replace(':', ''))
  return `Vergleich_${name}_${times.join('_')}.jpg`
}

// Creates the comparison image in full resolution and saves it.
// shots: [{ taken_at, files: { T: { path } … } }], variant: 'T' | 'V' …
export async function exportComparison({ viewpointName, shots, variant, joinPath }) {
  // Don't cache originals: a 12 MP visible image takes ~50 MB as a bitmap
  const items = []
  for (const shot of shots) {
    const blob = await platform.readImage(shot.files[variant].path)
    items.push({ bitmap: await createImageBitmap(blob), caption: captionFor(shot.taken_at) })
  }
  const canvas = draw(document.createElement('canvas'), items)
  items.forEach((i) => i.bitmap.close?.())
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error('Bild konnte nicht erzeugt werden')

  // Saved next to the most recent shot (folder of the last control flight)
  const dir = shots.at(-1).files[variant].path.replace(/[\\/][^\\/]*$/, '')
  return platform.writeImage(await joinPath(dir, fileNameFor(viewpointName, shots)), blob)
}

// Saving markings and keeping the marked copy "…_markiert.JPG" next to the original up to date.
//
//   await saveAnnotations({ mediaFileId } | { comparisonId }, shapes)   empty shapes → markings and copy removed
//   markedPath(path)                                                    path of the marked copy
//
// The copy is rendered in full resolution (annotation_renderer.js), Rust adds the original's EXIF/XMP
// (src-tauri/src/media/marked.rs). The original is never changed.

import platform from '/lib/platform/index.js'
import Annotation from '/app/models/annotation.js'
import MediaFile from '/app/models/media_file.js'
import Comparison from '/app/models/comparison.js'
import { cleanShapes, drawShapes } from '/app/services/annotation_renderer.js'
import { drawCompassOf } from '/app/services/compass.js'

export const MARKED_SUFFIX = '_markiert'

// ".../DJI_0001_T.JPG" → ".../DJI_0001_T_markiert.JPG"
export const markedPath = (path) => path.replace(/(\.[^.\\/]+)?$/, (ext) => `${MARKED_SUFFIX}${ext || '.jpg'}`)

async function sourceOf({ mediaFileId, comparisonId }) {
  return mediaFileId ? MediaFile.find(mediaFileId) : Comparison.find(comparisonId)
}

// Image with markings (and the compass, if the image has one on – compassFile: its media_files row) → JPEG blob
export async function renderMarked(path, shapes, compassFile = null) {
  const bitmap = await createImageBitmap(await platform.readImage(path))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  if (compassFile) drawCompassOf(ctx, compassFile, canvas.width, canvas.height)
  drawShapes(ctx, shapes, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error('Markiertes Bild konnte nicht erzeugt werden')
  return blob
}

// → the annotation (null when the markings were removed)
export async function saveAnnotations(target, shapes) {
  const source = await sourceOf(target)
  const clean = cleanShapes(shapes)
  const existing = target.mediaFileId ? await Annotation.forMediaFile(target.mediaFileId) : await Annotation.forComparison(target.comparisonId)
  if (!clean.length) {
    await platform.removeMarked(source.path)
    await existing?.destroy()
    return null
  }
  const blob = await renderMarked(source.path, clean, target.mediaFileId ? source : null)
  await platform.writeMarked(source.path, blob)
  const annotation = existing ?? new Annotation({ media_file_id: target.mediaFileId ?? null, comparison_id: target.comparisonId ?? null })
  annotation.shapes = JSON.stringify(clean)
  annotation.marked_size = blob.size
  annotation.version = (annotation.version ?? 0) + 1
  await annotation.save()
  return annotation
}

// Compass on images: shows north and how the camera is tilted (gimbal data from the DJI XMP). Per shot on/off and
// position (media_files.compass, compass_x/y; NULL = as in the settings, images "storage.compass_default").
// Drawn in the large view and into what is provided (Nextcloud, folder, phone) and the "_markiert" copy –
// the original in the image storage is never changed. Drawing: drawCompass in annotation_renderer.js.

import { db } from '/lib/db.js'
import platform from '/lib/platform/index.js'
import Setting from '/app/models/setting.js'
import { compassCenter, drawCompass } from '/app/services/annotation_renderer.js'

export const compassByDefault = () => Setting.get('storage.compass_default') === 'yes'

// Only images with gimbal data (DJI drones) can have one
export const hasCompassData = (file) => file?.gimbal_yaw != null && file?.gimbal_pitch != null

// → { yaw, pitch, x, y } if the compass is shown on this image, otherwise null
export function compassOf(file) {
  if (!hasCompassData(file)) return null
  const on = file.compass == null ? compassByDefault() : !!file.compass
  return on ? { yaw: file.gimbal_yaw, pitch: file.gimbal_pitch, x: file.compass_x ?? null, y: file.compass_y ?? null } : null
}

// Draw onto an image of width × height pixels (the image is already drawn)
export function drawCompassOf(ctx, file, width, height) {
  const compass = compassOf(file)
  if (!compass) return false
  const { cx, cy, r } = compassCenter(width, height, compass.x, compass.y)
  drawCompass(ctx, compass, cx, cy, r)
  return true
}

// The image as it is provided: with compass drawn in (full resolution, metadata of the original kept) → path of a
// copy in the app cache – or null if the image has no compass (then the original itself goes)
export async function providedPath(file) {
  if (!compassOf(file) || !/\.jpe?g$/i.test(file.path ?? '')) return null
  const bitmap = await createImageBitmap(await platform.readImage(file.path))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  drawCompassOf(ctx, file, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error('Bild mit Kompass konnte nicht erzeugt werden')
  return platform.writeRendered(file.path, `${file.id}_${file.path.split(/[\\/]/).pop()}`, blob)
}

// For all images of a shot at once (visible and thermal image share the gimbal position)
//   changes: { compass: 1 | 0 | null, compass_x, compass_y }
export async function setShotCompass(fileIds, changes) {
  if (!fileIds.length) return
  const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ')
  await db.execute(`UPDATE media_files SET ${sets} WHERE id IN (${fileIds.map(() => '?').join(',')})`, [...Object.values(changes), ...fileIds])
}

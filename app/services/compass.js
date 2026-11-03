// Compass on images: shows north and how the camera is tilted (gimbal data from the DJI XMP). Per shot on/off and
// position (media_files.compass, compass_x/y; NULL = as in the settings, images "storage.compass_default").
// Drawn in the large view and into what is provided (Nextcloud, folder, phone) and the "_markiert" copy –
// the original in the image storage is never changed. Drawing: drawCompass in annotation_renderer.js.

import { db } from '/lib/db.js'
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

// For all images of a shot at once (visible and thermal image share the gimbal position)
//   changes: { compass: 1 | 0 | null, compass_x, compass_y }
export async function setShotCompass(fileIds, changes) {
  if (!fileIds.length) return
  const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ')
  await db.execute(`UPDATE media_files SET ${sets} WHERE id IN (${fileIds.map(() => '?').join(',')})`, [...Object.values(changes), ...fileIds])
}

import platform from '/lib/platform/index.js'
import MediaFile from '/app/models/media_file.js'

export const platformName = () => platform.os

export function thumbUrl(path) {
  return platform.media?.thumbUrl(path) ?? ''
}

export function variantLabel(variant) {
  if (variant === 'video') return 'Videos'
  if (variant === 'other') return 'Sonstige'
  return MediaFile.VARIANTS[variant] ?? variant
}

// Short form for small buttons: "Sicht", "Wärme" …
export function variantShort(variant) {
  return { V: 'Sicht', W: 'Weitw.', Z: 'Zoom', T: 'Wärme' }[variant] ?? variant ?? 'Datei'
}

const DIRECTIONS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

// DJI delivers -180…180 → 0…360° + compass direction
export function formatHeading(yaw) {
  if (yaw == null) return null
  const deg = ((Number(yaw) % 360) + 360) % 360
  return `${Math.round(deg)}° ${DIRECTIONS[Math.round(deg / 22.5) % 16]}`
}

export function shotTooltip(file) {
  return [
    file.original_name,
    file.cameraLabel,
    file.rel_alt != null ? `Höhe ${Math.round(file.rel_alt)} m` : null,
    file.gimbal_yaw != null ? `Blickrichtung ${formatHeading(file.gimbal_yaw)}` : null,
    file.gimbal_pitch != null ? `Neigung ${Math.round(file.gimbal_pitch)}°` : null,
    file.lat != null ? `${file.lat.toFixed(5)}, ${file.lon.toFixed(5)}` : null,
  ].filter(Boolean).join(' · ')
}

// Preview shows the thermal image by default – usually the more important one in operations
export const PREFERRED_VARIANTS = ['T', 'V', 'W', 'Z']

export const defaultVariantOf = (variants) => PREFERRED_VARIANTS.find((v) => variants.includes(v)) ?? variants[0]

export function defaultVariant(files) {
  const variants = files.map((f) => f.variant ?? 'other')
  return PREFERRED_VARIANTS.find((v) => variants.includes(v)) ?? variants[0]
}

// Data of a shot for preview card and gallery (as JSON in a data attribute)
export function shotData(shot, { assignmentTitle = '' } = {}) {
  const files = {}
  for (const f of shot.files) {
    files[f.variant ?? 'other'] = { path: f.path, thumb: thumbUrl(f.thumb_path), name: f.original_name, video: f.kind === 'video' }
  }
  return JSON.stringify({
    key: `${shot.files[0].flight_id}/${shot.key}`,
    files,
    takenAt: shot.taken_at,
    viewpointId: shot.files.find((f) => f.viewpoint_id)?.viewpoint_id ?? null,
    viewpointName: shot.viewpointName ?? null,
    assignmentTitle,
  })
}

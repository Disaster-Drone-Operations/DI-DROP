// Where an image was taken and which part of the ground it shows (for the map). Pure functions – no database,
// no platform; heights come in as a function (terrain model) if available.
//
//   const fp = footprint({ lat, lon, relAlt, yaw, pitch, focal35, zoom, aspect, target, ground, takeoffGround })
//   → { drone, center, polygon: [{ lat, lon }], clipped, measured }
//
// Heights are taken relative to the take-off point – they fit together in the DJI data (RelativeAltitude,
// LRFTargetAlt), the absolute ones don't (different references). The laser rangefinder's point on the ground
// (LRFTarget*) calibrates the terrain model: ground(lat, lon) + offset = height above take-off.
// Without a terrain model the ground is a plane at the laser point's height (otherwise: take-off height).

const M_PER_DEG = 111_320
const HALF_DIAGONAL_35MM = 21.633 // mm, half the diagonal of a 36 × 24 mm frame
export const MAX_DISTANCE = 600 // m – edges near the horizon end here
const STEP = 4 // m, ray marching over the terrain

const rad = (d) => (d * Math.PI) / 180

// Half field of view (tangents) from the 35 mm equivalent focal length, digital zoom and image aspect (w / h)
export function fieldOfView(focal35, zoom = 1, aspect = 4 / 3) {
  const tanDiagonal = HALF_DIAGONAL_35MM / (focal35 * Math.max(1, zoom || 1))
  const norm = Math.sqrt(1 + aspect * aspect)
  return { tanH: (tanDiagonal * aspect) / norm, tanV: tanDiagonal / norm }
}

// Local metres (east, north) ↔ degrees around a point
export const toLocal = (origin, p) => ({ x: (p.lon - origin.lon) * M_PER_DEG * Math.cos(rad(origin.lat)), y: (p.lat - origin.lat) * M_PER_DEG })
export const toLatLon = (origin, x, y) => ({ lat: origin.lat + y / M_PER_DEG, lon: origin.lon + x / (M_PER_DEG * Math.cos(rad(origin.lat))) })

// Camera axes in east/north/up: forward, right, up (yaw from north clockwise, pitch negative = down, roll right-down)
export function cameraAxes(yaw, pitch, roll = 0) {
  const [y, p, r] = [rad(yaw), rad(pitch), rad(roll)]
  const forward = [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p)]
  let right = [Math.cos(y), -Math.sin(y), 0]
  let up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]]
  if (r) {
    const [c, s] = [Math.cos(r), Math.sin(r)]
    ;[right, up] = [right.map((v, i) => v * c - up[i] * s), up.map((v, i) => v * c + right[i] * s)]
  }
  return { forward, right, up }
}

// Where a ray from the drone (height z above take-off) meets the terrain (groundAt: local x, y → height above
// take-off) → { x, y, distance } or null (misses within MAX_DISTANCE)
function hitTerrain(ray, z, groundAt) {
  const len = Math.hypot(...ray)
  const d = ray.map((v) => v / len)
  let prev = 0
  for (let t = STEP; Math.hypot(d[0] * t, d[1] * t) <= MAX_DISTANCE; t += STEP) {
    if (z + d[2] * t > groundAt(d[0] * t, d[1] * t)) {
      prev = t
      continue
    }
    let [a, b] = [prev, t] // refine between the last point above and the first below the ground
    for (let i = 0; i < 12; i++) {
      const m = (a + b) / 2
      if (z + d[2] * m <= groundAt(d[0] * m, d[1] * m)) b = m
      else a = m
    }
    return { x: d[0] * b, y: d[1] * b, distance: b }
  }
  return null
}

// Ray onto a horizontal plane at height planeZ (relative to the drone's take-off) → point or null
function hitPlane(ray, z, planeZ) {
  const len = Math.hypot(...ray)
  const d = ray.map((v) => v / len)
  if (d[2] >= -1e-6 || planeZ >= z) return null
  const t = (planeZ - z) / d[2]
  const p = { x: d[0] * t, y: d[1] * t, distance: t }
  return Math.hypot(p.x, p.y) <= MAX_DISTANCE ? p : null
}

// Ray that misses (horizon) → point at MAX_DISTANCE in its horizontal direction
function clipPoint(ray) {
  const h = Math.hypot(ray[0], ray[1]) || 1
  return { x: (ray[0] / h) * MAX_DISTANCE, y: (ray[1] / h) * MAX_DISTANCE, distance: MAX_DISTANCE, clipped: true }
}

// Height offset so that ground(lat, lon) + offset = height above take-off
function calibration({ target, ground, takeoffGround }) {
  if (!ground) return null
  if (target?.lat != null && target.relAlt != null) {
    const h = ground(target.lat, target.lon)
    if (h != null) return target.relAlt - h
  }
  if (takeoffGround != null) return -takeoffGround
  return null
}

// params: lat, lon (drone), relAlt (m above take-off), yaw, pitch, roll (gimbal, degrees), focal35, zoom, aspect,
//         target: { lat, lon, relAlt, distance } (laser, optional), ground: (lat, lon) → height (terrain model, optional),
//         takeoffGround: terrain height at the take-off point (optional, without laser), samples: points per edge
export function footprint(params) {
  const { lat, lon, relAlt, yaw, pitch, roll = 0, focal35, zoom = 1, aspect = 4 / 3, target = null, ground = null, samples = 4 } = params
  if ([lat, lon, relAlt, yaw, pitch, focal35].some((v) => v == null || Number.isNaN(Number(v)))) return null
  const origin = { lat, lon }
  const { tanH, tanV } = fieldOfView(focal35, zoom, aspect)
  const { forward, right, up } = cameraAxes(yaw, pitch, roll)
  const ray = (sx, sy) => forward.map((f, i) => f + sx * tanH * right[i] + sy * tanV * up[i])

  const offset = calibration(params)
  const groundAt = offset != null ? (x, y) => {
    const p = toLatLon(origin, x, y)
    const h = ground(p.lat, p.lon)
    return h == null ? (target?.relAlt ?? 0) : h + offset
  } : null
  const planeZ = target?.relAlt ?? 0
  const cast = (sx, sy) => (groundAt ? hitTerrain(ray(sx, sy), relAlt, groundAt) : hitPlane(ray(sx, sy), relAlt, planeZ)) ?? clipPoint(ray(sx, sy))

  // Border of the image: corners and points in between, clockwise from top left
  const border = []
  const n = Math.max(1, samples)
  for (let i = 0; i < n; i++) border.push([-1 + (2 * i) / n, 1]) // top, left → right
  for (let i = 0; i < n; i++) border.push([1, 1 - (2 * i) / n]) // right, top → bottom
  for (let i = 0; i < n; i++) border.push([1 - (2 * i) / n, -1]) // bottom, right → left
  for (let i = 0; i < n; i++) border.push([-1, -1 + (2 * i) / n]) // left, bottom → top
  const points = border.map(([sx, sy]) => cast(sx, sy))

  const measured = target?.lat != null && target?.lon != null
  const centerPoint = measured ? toLocal(origin, target) : cast(0, 0)
  return {
    drone: origin,
    heading: yaw,
    center: measured ? { lat: target.lat, lon: target.lon } : toLatLon(origin, centerPoint.x, centerPoint.y),
    measured,
    polygon: points.map((p) => toLatLon(origin, p.x, p.y)),
    clipped: points.some((p) => p.clipped),
  }
}

// footprint() parameters from a media_files row (DJI EXIF/XMP) – null without position (hasView: enough for an area)
export function imageParams(file) {
  let dji = {}
  try {
    dji = JSON.parse(file.metadata || '{}')
  } catch {
    dji = {}
  }
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
  const laser = num(file.target_distance) && file.target_lat != null && file.target_lon != null
  const params = {
    lat: num(file.lat),
    lon: num(file.lon),
    relAlt: num(file.rel_alt),
    yaw: num(file.gimbal_yaw),
    pitch: num(file.gimbal_pitch),
    roll: num(dji.GimbalRollDegree) ?? 0,
    focal35: num(file.focal_length_35mm),
    zoom: num(file.digital_zoom) ?? 1,
    aspect: file.width && file.height ? file.width / file.height : 4 / 3,
    target: laser ? { lat: num(file.target_lat), lon: num(file.target_lon), relAlt: num(dji.LRFTargetAlt), distance: num(file.target_distance) } : null,
  }
  return [params.lat, params.lon].some((v) => v == null) ? null : params
}

// Can footprint() compute an area from these parameters? (otherwise only position + direction)
export const hasView = (params) => params != null && [params.relAlt, params.yaw, params.pitch, params.focal35].every((v) => v != null)

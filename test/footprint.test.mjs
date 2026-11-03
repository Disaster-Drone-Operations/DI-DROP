// Image footprint on the map: field of view, camera axes, ground intersection (app/services/footprint.js)
//   node --import ./test/support/app_paths.mjs --test test/footprint.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fieldOfView, footprint, toLocal, MAX_DISTANCE, imageParams } from '../app/services/footprint.js'

const deg = (t) => (2 * Math.atan(t) * 180) / Math.PI
const near = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} ≉ ${b}`)

test('field of view from the 35 mm equivalent focal length', () => {
  const wide = fieldOfView(24, 1, 4 / 3)
  near(deg(wide.tanH), 71.6, 0.3, 'horizontal 24 mm')
  near(deg(wide.tanV), 56.8, 0.3, 'vertical 24 mm')
  const thermal = fieldOfView(52, 1, 1280 / 1024)
  assert.ok(deg(thermal.tanH) < 40) // the thermal camera sees much less
  near(fieldOfView(24, 2).tanH, wide.tanH / 2, 1e-9, '2× digital zoom halves it')
})

test('straight down: a rectangle around the drone, top of the image to the north', () => {
  const fp = footprint({ lat: 50.6, lon: 11.1, relAlt: 100, yaw: 0, pitch: -90, focal35: 24, aspect: 4 / 3, samples: 1 })
  const [topLeft, topRight, bottomRight] = fp.polygon.map((p) => toLocal(fp.drone, p))
  near(topRight.x - topLeft.x, 144.2, 1, 'width east–west')
  near(topRight.y - bottomRight.y, 108.2, 1, 'height north–south')
  assert.ok(topLeft.y > 0 && bottomRight.y < 0)
  near(toLocal(fp.drone, fp.center).x, 0, 0.01, 'centre below the drone')
  assert.equal(fp.clipped, false)
})

test('real M4TD image: the computed centre meets the laser measurement', () => {
  // 36.2 m above take-off, looking north 49° down; laser: ground 6.44 m above take-off, 39.4 m away
  const image = { lat: 50.635218, lon: 11.128606, relAlt: 36.225, yaw: 0, pitch: -49, focal35: 52, aspect: 1.25 }
  const computed = footprint({ ...image, target: { relAlt: 6.44 } })
  const laser = { lat: 50.6354522, lon: 11.1285854 }
  const a = toLocal(image, computed.center)
  const b = toLocal(image, laser)
  near(Math.hypot(a.x - b.x, a.y - b.y), 0, 2, 'distance computed ↔ measured centre (m)')
  const measured = footprint({ ...image, target: { ...laser, relAlt: 6.44, distance: 39.438 } })
  assert.equal(measured.measured, true)
  assert.deepEqual(measured.center, laser)
})

test('oblique view towards the horizon: the far edge is cut off', () => {
  const fp = footprint({ lat: 50.6, lon: 11.1, relAlt: 50, yaw: 90, pitch: -10, focal35: 24, aspect: 4 / 3, samples: 2 })
  assert.equal(fp.clipped, true)
  const far = Math.max(...fp.polygon.map((p) => Math.hypot(...Object.values(toLocal(fp.drone, p)))))
  near(far, MAX_DISTANCE, 1, 'clipped at the maximum distance')
})

test('terrain: rising ground ahead shortens the view, calibrated by the laser point', () => {
  const image = { lat: 50.6, lon: 11.1, relAlt: 60, yaw: 0, pitch: -30, focal35: 24, aspect: 4 / 3, samples: 2 }
  const flat = footprint(image)
  // Ground in "metres above sea level": 400 m at the drone, rising 0.3 m per metre to the north
  const ground = (lat) => 400 + (lat - 50.6) * 111_320 * 0.3
  const hill = footprint({ ...image, ground, takeoffGround: 400 })
  const reach = (fp) => Math.max(...fp.polygon.map((p) => toLocal(fp.drone, p).y))
  assert.ok(reach(hill) < reach(flat) * 0.8, `${reach(hill)} vs ${reach(flat)}`)
  // Laser point: calibrates the same way (ground 15 m above take-off where it hit)
  const targetLat = 50.6 + 50 / 111_320
  const calibrated = footprint({ ...image, ground, target: { lat: targetLat, lon: 11.1, relAlt: 15 } })
  near(reach(calibrated), reach(hill), 1, 'laser calibration = take-off calibration')
})

test('missing data → no footprint', () => {
  assert.equal(footprint({ lat: 50, lon: 11, relAlt: 30, yaw: 0, pitch: null, focal35: 24 }), null)
})

test('parameters from an imported image (media_files row)', () => {
  const row = {
    lat: 50.635218, lon: 11.128606, rel_alt: 36.225, gimbal_yaw: 0, gimbal_pitch: -49, focal_length_35mm: 52, digital_zoom: 1,
    width: 1280, height: 1024, target_lat: 50.6354522, target_lon: 11.1285854, target_distance: 39.438,
    metadata: JSON.stringify({ GimbalRollDegree: '+0.00', LRFTargetAlt: '6.440' }),
  }
  const params = imageParams(row)
  assert.equal(params.aspect, 1.25)
  assert.deepEqual(params.target, { lat: 50.6354522, lon: 11.1285854, relAlt: 6.44, distance: 39.438 })
  assert.equal(footprint(params).measured, true)
  // no laser distance (LRF out of range): LRFTargetAlt "0.000" must not count
  assert.equal(imageParams({ ...row, target_distance: null }).target, null)
  assert.equal(imageParams({ ...row, gimbal_yaw: null }), null)
})

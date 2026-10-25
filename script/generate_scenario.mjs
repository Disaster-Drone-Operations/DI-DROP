#!/usr/bin/env node
// Generates a public training scenario with drawn (artificial) aerial images:
//
//   node script/generate_scenario.mjs scenarios/src/basis.mjs scenarios/basis
//
// The scenario description (scenarios/src/*.mjs) defines mission, cards, flights and script; this
// script draws the "world" (village with a burning barn, seen from above) once per flight – the fire
// develops from flight to flight – and cuts the shots from it: visible (V) + thermal (T) pairs with
// real DJI metadata (EXIF time/GPS, XMP gimbal/altitude, FlightLineInfo for waypoints, LRF target point).
// Requires ImageMagick (magick) and exiftool. Later the drawings can be replaced by AI images
// (same file names) without touching the scenario.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const [specPath, target] = process.argv.slice(2)
if (!specPath || !target) {
  console.error('Usage: node script/generate_scenario.mjs <scenarios/src/x.mjs> <target folder>')
  process.exit(2)
}
const spec = (await import(pathToFileURL(path.resolve(specPath)).href)).default
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'didrop-scenario-'))
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
const pad = (n, w = 2) => String(n).padStart(w, '0')

// ── World: 2400×1800 px = 240×180 m (0.1 m/px), barn in the middle ─────────────

const W = 2400
const H = 1800
const M_PER_PX = 0.1
const BARN = { x: 1200, y: 900, w: 180, h: 100 }
// M4TD: wide camera 24 mm, thermal 52 mm (35 mm equivalent) → thermal width as share of the visible width
const THERMAL_SHARE = (5 * 24 / 52 * 5 / Math.sqrt(41)) / 4

// Deterministic randomness (same images on every run)
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function houses(seed) {
  const rand = rng(seed)
  const list = []
  while (list.length < 26) {
    const w = 70 + rand() * 60
    const h = 50 + rand() * 40
    const x = 120 + rand() * (W - 240)
    const y = 120 + rand() * (H - 240)
    const clear = (o) => Math.abs(o.x - x) > (o.w + w) / 2 + 40 || Math.abs(o.y - y) > (o.h + h) / 2 + 40
    const offRoad = Math.abs(y - 1250) > h / 2 + 40 && Math.abs(x - 700) > w / 2 + 40
    if (clear(BARN) && offRoad && list.every(clear)) list.push({ x, y, w, h, roof: rand() < 0.65 ? '#9c4a3a' : '#707276' })
  }
  return list
}

function trees(seed) {
  const rand = rng(seed + 7)
  return Array.from({ length: 70 }, () => ({ x: rand() * W, y: rand() * H, r: 18 + rand() * 22 }))
}

const rect = (r) => `rectangle ${r.x - r.w / 2},${r.y - r.h / 2} ${r.x + r.w / 2},${r.y + r.h / 2}`

// fire 0…1: burned share of the barn roof, smoke, hot spots; trucks once the fire brigade is there
function drawWorld(name, { fire, trucks }, seed) {
  const base = path.join(work, `${name}_base.png`)
  const visible = path.join(work, `${name}_v.png`)
  const thermal = path.join(work, `${name}_t.png`)
  const draws = []
  draws.push('-fill', '#8a8170', '-draw', `rectangle 0,1225 ${W},1275`, '-draw', `rectangle 675,0 725,${H}`) // roads
  draws.push('-fill', '#7d8a5a', '-draw', 'rectangle 1450,300 2250,700') // field
  for (const t of trees(seed)) draws.push('-fill', '#3f6b2f', '-draw', `circle ${t.x},${t.y} ${t.x + t.r},${t.y}`)
  for (const h of houses(seed)) {
    draws.push('-fill', h.roof, '-draw', rect(h), '-stroke', '#00000055', '-draw', `line ${h.x - h.w / 2},${h.y} ${h.x + h.w / 2},${h.y}`, '-stroke', 'none')
  }
  draws.push('-fill', '#a8653f', '-draw', rect(BARN)) // barn roof
  if (fire > 0) {
    const burned = BARN.w * Math.min(1, 0.25 + fire * 0.75)
    draws.push('-fill', '#2a2420', '-draw', `rectangle ${BARN.x - BARN.w / 2},${BARN.y - BARN.h / 2} ${BARN.x - BARN.w / 2 + burned},${BARN.y + BARN.h / 2}`)
  }
  if (trucks) {
    draws.push('-fill', '#c8102e', '-draw', 'rectangle 1010,1236 1080,1264', '-draw', 'rectangle 1100,1236 1170,1264', '-draw', 'rectangle 690,980 710,1050')
  }
  const layers = []
  // Smoke drifting east (blurred layer)
  if (fire > 0.15) {
    const smoke = path.join(work, `${name}_smoke.png`)
    const puffs = []
    for (let i = 0; i < 6; i++) {
      const x = BARN.x + 60 + i * 110
      const y = BARN.y - 20 - i * 25
      const r = (40 + i * 25) * fire
      puffs.push('-draw', `circle ${x},${y} ${x + r},${y}`)
    }
    run('magick', ['-size', `${W}x${H}`, 'xc:none', '-fill', `rgba(200,200,205,${0.35 + fire * 0.4})`, ...puffs, '-blur', '0x25', smoke])
    layers.push(smoke)
  }
  run('magick', ['-size', `${W}x${H}`, 'xc:#6b8f4e', '-seed', String(seed), '-attenuate', '0.25', '+noise', 'Gaussian', ...draws, base])
  run('magick', [base, ...layers.flatMap((l) => [l, '-composite']), visible])

  // Thermal: grey (white = warm) + red hot spots (isotherm) on the barn; one ember nest wanders
  const spots = []
  const ember = { x: BARN.x - 40 + fire * 70, y: BARN.y + 10 - fire * 20 }
  spots.push('-draw', `circle ${ember.x},${ember.y} ${ember.x + 22 + fire * 10},${ember.y}`)
  if (fire > 0.3) for (let i = 0; i < 4; i++) spots.push('-draw', `circle ${BARN.x - 60 + i * 40},${BARN.y - 20 + (i % 2) * 35} ${BARN.x - 60 + i * 40 + 18 * fire},${BARN.y - 20 + (i % 2) * 35}`)
  const hot = path.join(work, `${name}_hot.png`)
  run('magick', ['-size', `${W}x${H}`, 'xc:none', '-fill', `rgba(255,60,40,${0.55 + fire * 0.4})`, ...spots, '-blur', '0x8', hot])
  // (smoke is not warm – thermal from the image without smoke)
  run('magick', [base, '-colorspace', 'Gray', '-level', '15%,85%', '-brightness-contrast', '-15x10', '-colorspace', 'sRGB',
    '(', hot, '-alpha', 'extract', '-blur', '0x30', '-level', '0,60%', ')', '-compose', 'screen', '-composite',
    hot, '-compose', 'over', '-composite', thermal])
  return { visible, thermal }
}

// ── Shots ─────────────────────────────────────────────────────────────────────

// px offset from the barn → lat/lon (north = up)
function geo(dxPx, dyPx) {
  const { lat, lon } = spec.center
  const north = -dyPx * M_PER_PX
  const east = dxPx * M_PER_PX
  return { lat: lat + north / 111_320, lon: lon + east / (111_320 * Math.cos((lat * Math.PI) / 180)) }
}

const WAYPOINTS = [
  { name: 'nord', yaw: 180, from: [0, -1] },
  { name: 'ost', yaw: -90, from: [1, 0] },
  { name: 'sued', yaw: 0, from: [0, 1] },
  { name: 'west', yaw: 90, from: [-1, 0] },
  { name: 'draufsicht', yaw: 0, from: [0, 0], top: true },
]

// Shots of a folder: { center px, crop width px, yaw, pitch, rel alt, flight line, distance m }
function shotsFor(kind, rand) {
  const jitter = (n) => (rand() - 0.5) * n
  if (kind === 'waypoints') {
    return WAYPOINTS.map((wp) => ({
      cx: BARN.x + wp.from[0] * 60 + jitter(20), cy: BARN.y + wp.from[1] * 60 + jitter(20), crop: wp.top ? 700 : 900,
      yaw: wp.yaw + jitter(2), pitch: wp.top ? -90 : -45, alt: 60, line: `${spec.id}-wp-${wp.name}`,
      drone: wp.top ? [0, 0] : [wp.from[0] * 600, wp.from[1] * 600],
    }))
  }
  if (kind === 'overview') {
    return [[-500, -300, 135], [500, -300, -135], [500, 350, -45], [-500, 350, 45]].map(([dx, dy, yaw]) => ({
      cx: BARN.x + dx * 0.4, cy: BARN.y + dy * 0.4, crop: 1500, yaw, pitch: -60, alt: 100, drone: [dx * 2, dy * 2],
    }))
  }
  if (kind === 'manual') {
    // Access road west of the barn (special assignment)
    return [[700, 1100, 0], [700, 950, 10], [820, 1250, -80]].map(([cx, cy, yaw]) => ({
      cx: cx + jitter(30), cy: cy + jitter(30), crop: 600, yaw, pitch: -30, alt: 35, drone: [cx - BARN.x, cy - BARN.y + 300],
    }))
  }
  if (kind === 'older') {
    // Test flight the day before (field in the north east)
    return [[1700, 450, 0], [1950, 450, 0], [2100, 550, 90]].map(([cx, cy, yaw]) => ({
      cx, cy, crop: 800, yaw, pitch: -50, alt: 50, drone: [cx - BARN.x, cy - BARN.y + 400],
    }))
  }
  if (kind === 'mapping') {
    // Nadir grid 4×3 with overlap (orthophoto)
    const list = []
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      const x = 700 + col * 330
      list.push({ cx: row % 2 ? 1890 - (x - 700) : x, cy: 600 + row * 300, crop: 500, yaw: 0, pitch: -90, alt: 80, nadir: true,
        drone: [(row % 2 ? 1890 - (x - 700) : x) - BARN.x, 600 + row * 300 - BARN.y] })
    }
    return list
  }
  throw new Error(`Unknown shot kind: ${kind}`)
}

function cut(src, out, shot, width, height, quality) {
  const ratio = height / width
  const cropW = shot.crop
  const cropH = Math.round(shot.crop * ratio)
  // rotate so that "up" is the viewing direction
  run('magick', [src, '-virtual-pixel', 'edge', '-distort', 'SRT', `${shot.cx},${shot.cy} 1 ${-shot.yaw} ${cropW / 2},${cropH / 2}`,
    '+repage', '-crop', `${cropW}x${cropH}+0+0`, '+repage', '-resize', `${width}x${height}!`, '-quality', String(quality), out])
}

function xmpFor(shot, at) {
  const drone = geo(shot.drone[0], shot.drone[1])
  const ground = geo(shot.cx - BARN.x, shot.cy - BARN.y)
  const f = (n, d = 6) => (n >= 0 ? `+${n.toFixed(d)}` : n.toFixed(d))
  const attrs = {
    GpsLatitude: drone.lat.toFixed(8), GpsLongitude: drone.lon.toFixed(8),
    AbsoluteAltitude: f(spec.groundAltitude + shot.alt, 3), RelativeAltitude: f(shot.alt, 3),
    GimbalRollDegree: '+0.00', GimbalYawDegree: f(shot.yaw, 2), GimbalPitchDegree: f(shot.pitch, 2),
    FlightRollDegree: '+0.00', FlightYawDegree: f(shot.yaw, 2), FlightPitchDegree: '+0.00',
    ImageSource: 'WideCamera', DroneModel: 'M4TD', ProductName: 'M4TD',
    LRFStatus: 'Normal', LRFTargetLat: ground.lat.toFixed(7), LRFTargetLon: ground.lon.toFixed(7),
    LRFTargetDistance: (Math.hypot(shot.drone[0] - (shot.cx - BARN.x), shot.drone[1] - (shot.cy - BARN.y)) * M_PER_PX + shot.alt).toFixed(3),
    UTCAtExposure: at.toISOString().replace('T', ' ').replace('Z', ''),
  }
  if (shot.line) attrs.FlightLineInfo = shot.line
  if (shot.nadir) delete attrs.LRFStatus
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" ` +
    Object.entries(attrs).map(([k, v]) => `drone-dji:${k}="${v}"`).join(' ') +
    `/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
}

function tag(file, shot, at) {
  const xmp = `${file}.xmp`
  fs.writeFileSync(xmp, xmpFor(shot, at))
  const drone = geo(shot.drone[0], shot.drone[1])
  const stamp = `${at.getFullYear()}:${pad(at.getMonth() + 1)}:${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  run('exiftool', ['-q', '-overwrite_original', `-XMP<=${xmp}`, '-Make=DJI', '-Model=M4TD', `-DateTimeOriginal=${stamp}`, `-CreateDate=${stamp}`,
    `-GPSLatitude=${drone.lat}`, '-GPSLatitudeRef=N', `-GPSLongitude=${drone.lon}`, '-GPSLongitudeRef=E',
    `-GPSAltitude=${spec.groundAltitude + shot.alt}`, file])
  fs.rmSync(xmp)
}

const djiStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
const localTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const day = spec.start.slice(0, 10)
const timeOf = (t) => new Date(/^\d{2}:\d{2}$/.test(t) ? `${day}T${t}` : t)

// ── Build ─────────────────────────────────────────────────────────────────────

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })
const worlds = new Map()
const flights = [] // for flight logs: { start, end, battery }

for (const card of spec.cards) {
  card.folders.forEach((folder, fi) => {
    const begin = timeOf(folder.time)
    const key = `${folder.fire}|${folder.trucks}`
    if (!worlds.has(key)) worlds.set(key, drawWorld(`w${worlds.size}`, folder, spec.seed))
    const world = worlds.get(key)
    const rand = rng(spec.seed + begin.getMinutes() * 31 + fi)
    const shots = shotsFor(folder.shots, rand)
    const dir = path.join(target, 'karten', card.id, 'DCIM', `DJI_${djiStamp(begin).slice(0, 12)}_${pad(fi + 1, 3)}${folder.name ? `_${folder.name}` : ''}`)
    fs.mkdirSync(dir, { recursive: true })
    shots.forEach((shot, i) => {
      const at = new Date(begin.getTime() + (i + 1) * (folder.shots === 'mapping' ? 6 : 22) * 1000)
      const base = path.join(dir, `DJI_${djiStamp(at)}_${pad(i + 1, 4)}`)
      cut(world.visible, `${base}_V.JPG`, shot, 1600, 1200, 62)
      tag(`${base}_V.JPG`, shot, at)
      if (folder.shots !== 'mapping') {
        // Thermal camera: narrower field of view → only the middle of the visible image (52 vs 24 mm)
        cut(world.thermal, `${base}_T.JPG`, { ...shot, crop: shot.crop * THERMAL_SHARE }, 640, 512, 80)
        tag(`${base}_T.JPG`, shot, at)
      }
    })
    if (folder.rtk) {
      // RTK/PPK companions as written by RTK drones (content is only a placeholder)
      const stem = `DJI_${djiStamp(begin)}_${pad(fi + 1, 4)}_D`
      for (const ext of ['MRK', 'NAV', 'OBS', 'RTK']) fs.writeFileSync(path.join(dir, `${stem}.${ext}`), `Simulierte RTK-Rohdaten (${ext}) – Schulungsszenario ${spec.id}\n`)
      fs.writeFileSync(path.join(dir, 'ppk_file_name.pbk'), `${stem}.RTK`)
    }
    const end = new Date(begin.getTime() + shots.length * 22_000)
    if (folder.shots !== 'older') flights.push({ start: begin, end, card: card.id })
    else flights.push({ start: begin, end, card: card.id, older: true })
    console.log(`${card.id}/${path.basename(dir)}: ${shots.length} shots`)
  })
}

// Flight logs (key data): one log per card flight; several folders of one card = one flight
const byCard = new Map()
for (const f of flights) {
  const key = `${f.card}|${f.older ? 'older' : 'main'}`
  const prev = byCard.get(key)
  byCard.set(key, prev ? { ...prev, start: prev.start < f.start ? prev.start : f.start, end: prev.end > f.end ? prev.end : f.end } : f)
}
const batteries = spec.remote?.batteries ?? ['SIM-AKKU-A', 'SIM-AKKU-B']
const logs = [...byCard.values()].sort((a, b) => a.start - b.start).map((f, i) => {
  const start = new Date(f.start.getTime() - 4 * 60_000)
  const duration = Math.round((f.end - f.start) / 1000 + 9 * 60)
  return {
    start: `${localTime(start)}:00`, duration_s: duration, distance_m: Math.round(duration * 1.9), max_height_m: 100, max_speed_ms: 10,
    aircraft_name: 'Matrice 4TD', aircraft_sn: 'SIM-M4TD-0001', battery_sn: batteries[i % batteries.length], rc_sn: 'SIM-RC-0001',
    latitude: spec.center.lat, longitude: spec.center.lon, photos: 0,
  }
})
for (const extra of spec.remote?.extraLogs ?? []) logs.unshift(extra)

const scenario = {
  id: spec.id,
  title: spec.title,
  description: spec.description,
  start: spec.start,
  settings: spec.settings ?? {},
  mission: spec.mission,
  assignments: spec.assignments ?? [],
  cards: spec.cards.map(({ id, label }) => ({ id, label })),
  remote: { name: spec.remote?.name ?? 'DJI RC Plus 2 (Simulation)', logs },
  script: spec.script,
}
fs.writeFileSync(path.join(target, 'szenario.json'), `${JSON.stringify(scenario, null, 2)}\n`)
fs.rmSync(work, { recursive: true, force: true })
const size = execFileSync('du', ['-sh', target]).toString().split('\t')[0]
console.log(`Scenario "${spec.title}" → ${target} (${size})`)

#!/usr/bin/env node
// Turns the drawn images of a generated training scenario into photorealistic ones (OpenAI image edit).
//
//   node script/ai_scenario_images.mjs <scenarios/src/x.mjs> <scenarios/x> [--only flug2:1,flug3:1] [--apply] [--model=gpt-image-2]
//
// - Every drawn visible image (…_V.JPG) is sent as template with the instruction to keep the exact layout →
//   viewpoints stay identical across flights (comparison images keep working).
// - The thermal image (…_T.JPG) is derived from the new visible image by script (grey, soft, low
//   resolution) plus the red hot spots of the drawn thermal image – so both always match.
// - Metadata (time, GPS, gimbal, waypoint id …) is copied from the drawn version.
// Without --apply the results go to tmp/ai-preview/<scenario>/ (scenario untouched); with --apply they
// replace the scenario files (originals in tmp/ai-backup/).
// API key: macOS keychain, service "di-drop-openai", account "api" (never in the repository).

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const [specPath, scenarioDir] = args.filter((a) => !a.startsWith('--'))
const apply = args.includes('--apply')
const model = args.find((a) => a.startsWith('--model='))?.slice(8) ?? 'gpt-image-2'
// Only recompute the thermal images from the visible images already in the scenario (no API calls)
const thermalOnly = args.includes('--thermal-only')

// Thermal camera = narrower field of view (M4TD: wide 24 mm, thermal 52 mm equivalent) → the thermal
// image shows only the middle of the visible image: 46 % of its diagonal, 5:4 → 721×577 of 1600×1200
const THERMAL_W = Math.round(1600 * (5 * 24 / 52 * 5 / Math.sqrt(41)) / 4)
const THERMAL_H = Math.round(THERMAL_W * 0.8)
// The visible image shows the middle 8/9 of the drawing (see below); the drawn thermal image covers
// the same width as the drawing → hot-spot mask = this share of the drawn thermal image
const MASK_SHARE = `${((THERMAL_W / 1600) * (1365 / 1536) * 100).toFixed(2)}%`
const onlyArg = args.find((a) => a.startsWith('--only='))?.slice(7) ?? (args.includes('--only') ? args[args.indexOf('--only') + 1] : null)
if (!specPath || !scenarioDir) {
  console.error('Usage: node script/ai_scenario_images.mjs <scenarios/src/x.mjs> <scenarios/x> [--only flug2:1,flug3:1] [--apply]')
  process.exit(2)
}
const only = onlyArg ? onlyArg.split(',').map((s) => { const [card, nr] = s.split(':'); return { card, nr: nr && Number(nr) } }) : null

const spec = (await import(pathToFileURL(path.resolve(specPath)).href)).default
const key = thermalOnly ? null : execFileSync('security', ['find-generic-password', '-s', 'di-drop-openai', '-a', 'api', '-w']).toString().trim()
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const work = path.join(root, 'tmp', 'ai-work')
const preview = path.join(root, 'tmp', 'ai-preview', spec.id)
const backup = path.join(root, 'tmp', 'ai-backup', spec.id)
fs.mkdirSync(work, { recursive: true })
const run = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'ignore', 'inherit'] })
const pad = (n, w = 2) => String(n).padStart(w, '0')

// Same folder names as script/generate_scenario.mjs
const day = spec.start.slice(0, 10)
const timeOf = (t) => new Date(/^\d{2}:\d{2}$/.test(t) ? `${day}T${t}` : t)
const djiStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

function fireText(folder) {
  if (folder.shots === 'older' || folder.fire === 0) return 'There is no fire anywhere; a calm normal day, no smoke, no fire engines.'
  if (folder.fire >= 0.9) return 'The barn in the middle is fully on fire: flames break out of the roof, about half of the roof tiles are gone, a thick grey-brown smoke plume drifts away exactly where the drawing shows the smoke.'
  if (folder.fire >= 0.6) return 'The barn roof is mostly burned through: charred black rafters, a few small flames, moderate smoke where the drawing shows it, firefighters spraying water.'
  if (folder.fire >= 0.3) return 'The barn roof has collapsed: black charred interior, light smoke rising, puddles of water around it, the fire is under control.'
  return 'The barn is a burned-out ruin, only a thin wisp of smoke, wet ground, the fire is out.'
}

// What is in the picture besides the village (only waypoint/overview shots show the barn in the middle)
function subjectText(folder) {
  if (folder.shots === 'manual') {
    return ['This picture does NOT show the barn. It shows the gravel farm road used as access route for a turntable ladder truck: its width, the verges, hedges and fences next to it, overhanging trees, and the small red fire vehicle standing on it. Keep the road exactly where the beige band is in the drawing. Light smoke may drift in from the edge.']
  }
  if (folder.shots === 'older') return [fireText(folder)]
  if (folder.shots === 'mapping') return ['Where the drawing shows the large dark rectangle, there is the burned barn.', fireText(folder)]
  return ['The large rectangle in the centre is an old timber-and-brick barn.', fireText(folder)]
}

function promptFor(folder) {
  const view = folder.shots === 'mapping'
    ? 'This is a nadir mapping photo, camera pointing straight down.'
    : 'This is an aerial photo taken from a drone, keep the camera angle exactly as in the drawing.'
  return [
    'Turn this schematic drawing into a photorealistic aerial photograph taken by a DJI Matrice 4TD drone (wide camera).',
    'KEEP THE EXACT COMPOSITION AND GEOMETRY: every building, roof, tree, road, vehicle and the smoke stay at exactly the same position, size and orientation as in the drawing. Do not add, remove or move objects.',
    view,
    'Setting: a small village in the Thuringian hills, Germany, mid-May, bright overcast daylight. Rectangles with red or grey colour are village houses seen from above (red clay tile or grey slate roofs, small gardens); dark green circles are trees and bushes; beige bands are an asphalt road and a gravel farm road; the light olive area is a meadow; small bright red rectangles are generic German fire engines (no text).',
    ...subjectText(folder),
    'Realistic textures, natural colours, slight wide-angle drone look. No text, no logos, no watermarks, no readable licence plates, no recognisable faces.',
  ].join(' ')
}

// OpenAI image edit → PNG buffer
async function edit(imagePath, prompt) {
  const form = new FormData()
  form.append('model', model)
  form.append('image', new Blob([fs.readFileSync(imagePath)], { type: 'image/png' }), 'drawing.png')
  form.append('prompt', prompt)
  form.append('size', '1536x1024')
  form.append('quality', 'high')
  if (model === 'gpt-image-1') form.append('input_fidelity', 'high') // newer models keep the template by themselves
  for (let attempt = 1; ; attempt++) {
    const response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form })
    const json = await response.json().catch(() => ({}))
    if (response.ok && json.data?.[0]?.b64_json) return Buffer.from(json.data[0].b64_json, 'base64')
    const message = json.error?.message ?? `HTTP ${response.status}`
    if (attempt >= 3 || ![429, 500, 502, 503].includes(response.status)) throw new Error(`OpenAI: ${message}`)
    console.log(`  retry (${message})`)
    await new Promise((r) => setTimeout(r, attempt * 15_000))
  }
}

async function processShot(cardId, folder, dir, visibleName) {
  const base = visibleName.replace(/_V\.JPG$/i, '')
  const drawnV = path.join(dir, `${base}_V.JPG`)
  const drawnT = path.join(dir, `${base}_T.JPG`)
  const tag = `${cardId}/${path.basename(dir)}/${base}`
  const outDir = apply ? dir : path.join(preview, cardId, path.basename(dir))
  fs.mkdirSync(outDir, { recursive: true })
  if (apply) {
    fs.mkdirSync(path.join(backup, cardId, path.basename(dir)), { recursive: true })
    // Keep the drawn original from the first run – later runs start from it again
    for (const f of [drawnV, drawnT]) {
      const saved = path.join(backup, cardId, path.basename(dir), path.basename(f))
      if (fs.existsSync(f) && !fs.existsSync(saved)) fs.copyFileSync(f, saved)
    }
  }
  const metaV = apply ? path.join(backup, cardId, path.basename(dir), `${base}_V.JPG`) : drawnV
  const metaT = apply ? path.join(backup, cardId, path.basename(dir), `${base}_T.JPG`) : drawnT

  const outV = path.join(outDir, `${base}_V.JPG`)
  if (thermalOnly) {
    console.log(`${tag}: Wärmebild …`)
  } else {
    // 1. Drawing 4:3 → 3:2 template (centre crop), edit, back to 4:3 1600×1200
    const template = path.join(work, 'template.png')
    run('magick', [metaV, '-resize', '1536x1152', '-gravity', 'center', '-crop', '1536x1024+0+0', '+repage', template])
    console.log(`${tag}: KI …`)
    const raw = path.join(work, 'raw.png')
    fs.writeFileSync(raw, await edit(template, promptFor(folder)))
    // Back to 4:3 by a centre crop → shows the middle 8/9 of the drawing (same for every shot, so
    // viewpoints stay comparable)
    run('magick', [raw, '-gravity', 'center', '-crop', '1365x1024+0+0', '+repage', '-resize', '1600x1200!', '-quality', '85', outV])
    run('exiftool', ['-q', '-overwrite_original', '-TagsFromFile', metaV, '-exif:all', '-xmp', outV])
  }

  // 2. Thermal from the middle of the new photo (narrower thermal camera) + hot spots (red) of the
  //    drawn thermal image (old drawings cover the full width → MASK_SHARE of it)
  if (fs.existsSync(metaT)) {
    const mask = path.join(work, 'hot.png')
    run('magick', [metaT, '-gravity', 'center', '-crop', `${MASK_SHARE}x${MASK_SHARE}+0+0`, '+repage', '-resize', '640x512!',
      '-fx', 'r-g>0.25 ? 1 : 0', '-blur', '0x2', mask])
    const outT = path.join(outDir, `${base}_T.JPG`)
    run('magick', [outV, '-gravity', 'center', '-crop', `${THERMAL_W}x${THERMAL_H}+0+0`, '+repage', '-resize', '640x512!',
      '-colorspace', 'Gray', '-blur', '0x1.4', '-level', '12%,88%', '-brightness-contrast', '-12x18', '-colorspace', 'sRGB',
      '(', mask, '-blur', '0x14', '-level', '0,55%', ')', '-compose', 'screen', '-composite',
      '(', '-size', '640x512', 'xc:#ff3c28', mask, '-alpha', 'off', '-compose', 'copy-opacity', '-composite', ')', '-compose', 'over', '-composite',
      '-quality', '88', outT])
    run('exiftool', ['-q', '-overwrite_original', '-TagsFromFile', metaT, '-exif:all', '-xmp', outT])
  }
}

let count = 0
for (const card of spec.cards) {
  let shotNr = 0 // numbering across all folders of a card (for --only)
  for (const [fi, folder] of card.folders.entries()) {
    const begin = timeOf(folder.time)
    const dir = path.join(scenarioDir, 'karten', card.id, 'DCIM', `DJI_${djiStamp(begin).slice(0, 12)}_${pad(fi + 1, 3)}${folder.name ? `_${folder.name}` : ''}`)
    if (!fs.existsSync(dir)) throw new Error(`Folder missing (generate the scenario first): ${dir}`)
    const visibles = fs.readdirSync(dir).filter((f) => /_V\.JPG$/i.test(f)).sort()
    for (const name of visibles) {
      shotNr++
      if (only && !only.some((o) => o.card === card.id && (!o.nr || o.nr === shotNr))) continue
      await processShot(card.id, folder, dir, name)
      count++
    }
  }
}

fs.rmSync(work, { recursive: true, force: true })
console.log(`${count} Aufnahmen ${apply ? `ersetzt (Originale in ${path.relative(root, backup)})` : `als Vorschau in ${path.relative(root, preview)}`}`)

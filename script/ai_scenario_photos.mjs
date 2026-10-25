#!/usr/bin/env node
// Photorealistic oblique drone photos for a training scenario, derived from ONE reference photo
// (OpenAI image edit). Unlike ai_scenario_images.mjs (which keeps the layout of the drawings, i.e.
// top views), every view is generated as a real oblique shot of the reference scene.
//
//   node script/ai_scenario_photos.mjs scenarios/src/basis.mjs scenarios/src/basis-photos.mjs scenarios/basis \
//     [--only flug2:3,flug3:3] [--apply] [--force] [--model=gpt-image-2]
//
// - Plan (scenarios/src/<x>-photos.mjs): per shot "card:number" the source (reference, the reference
//   itself, or an earlier shot → only the fire state changes) and the camera description.
// - Thermal image: the middle of the finished photo (thermal camera 52 mm vs. 24 mm wide camera) is edited
//   into a DJI thermal image → hot spots sit exactly where the burning building is.
// - Metadata (time, GPS, gimbal, waypoint id …) from the drawn original (tmp/ai-backup/ or the scenario).
// - Results are cached in tmp/ai-photos-cache/<id>/ (no second payment); --force makes them anew.
// Without --apply: preview in tmp/ai-preview/<id>-fotos/. API key: keychain "di-drop-openai".

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const [specPath, planPath, scenarioDir] = args.filter((a) => !a.startsWith('--') && !/^flug\d/.test(a))
const apply = args.includes('--apply')
const force = args.includes('--force')
const model = args.find((a) => a.startsWith('--model='))?.slice(8) ?? 'gpt-image-2'
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1].split(',')) : null
if (!specPath || !planPath || !scenarioDir) {
  console.error('Usage: node script/ai_scenario_photos.mjs <spec.mjs> <plan.mjs> <scenario folder> [--only flug2:3] [--apply] [--force]')
  process.exit(2)
}

const load = async (p) => (await import(pathToFileURL(path.resolve(p)).href)).default
const spec = await load(specPath)
const plan = await load(planPath)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const cache = path.join(root, 'tmp', 'ai-photos-cache', spec.id)
const preview = path.join(root, 'tmp', 'ai-preview', `${spec.id}-fotos`)
const backup = path.join(root, 'tmp', 'ai-backup', spec.id)
const work = path.join(root, 'tmp', 'ai-work')
for (const d of [cache, work]) fs.mkdirSync(d, { recursive: true })
const run = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'ignore', 'inherit'] })
let key = null
const apiKey = () => (key ??= execFileSync('security', ['find-generic-password', '-s', 'di-drop-openai', '-a', 'api', '-w']).toString().trim())

// Thermal camera field of view within the 1600×1200 photo (see ai_scenario_images.mjs)
const THERMAL_W = Math.round(1600 * (5 * 24 / 52 * 5 / Math.sqrt(41)) / 4) // 721
const THERMAL_H = Math.round(THERMAL_W * 0.8) // 577
const THERMAL_REGION_W = Math.round(THERMAL_H * 1.5) // 3:2 region sent to the API (contains the 5:4 part)

const STYLE = 'Photorealistic drone photograph like the reference: same village, same old half-timbered barn with red clay tile roof, same houses, gardens, fruit trees, roads, red German fire engines (no readable text), firefighters in dark blue gear (small, faces not recognisable). Bright overcast May daylight, natural colours, sharp details, slight wide-angle look. No text, no logos, no watermarks.'

const THERMAL_PROMPT = 'Convert this photo into the image of a DJI drone thermal camera (white-hot palette) – EXACTLY the same view, framing and geometry, nothing moved. Grayscale only, slightly soft and low-resolution like a 640×512 thermal sensor: cold surfaces dark (wet ground, puddles, shade), meadow and trees dark grey, roofs and roads mid grey, people and vehicle engines light grey, the burning and glowing parts of the barn bright white with a RED isotherm overlay on the hottest areas only. Smoke is almost invisible in thermal. No text, no colour scale, no colours except grey and the red isotherm.'

async function edit(imagePath, prompt) {
  const form = new FormData()
  form.append('model', model)
  form.append('image', new Blob([fs.readFileSync(imagePath)], { type: 'image/png' }), 'input.png')
  form.append('prompt', prompt)
  form.append('size', '1536x1024')
  form.append('quality', 'high')
  for (let attempt = 1; ; attempt++) {
    const response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey()}` }, body: form })
    const json = await response.json().catch(() => ({}))
    if (response.ok && json.data?.[0]?.b64_json) return Buffer.from(json.data[0].b64_json, 'base64')
    const message = json.error?.message ?? `HTTP ${response.status}`
    if (attempt >= 3 || ![429, 500, 502, 503].includes(response.status)) throw new Error(`OpenAI: ${message}`)
    console.log(`  retry (${message})`)
    await new Promise((r) => setTimeout(r, attempt * 15_000))
  }
}

// Cached API result (3:2 PNG); "make" only runs if there is none yet (or --force)
async function cached(name, make) {
  const file = path.join(cache, `${name}.png`)
  if (force || !fs.existsSync(file)) fs.writeFileSync(file, await make())
  return file
}

const toPng = (src, name) => {
  const out = path.join(work, `${name}.png`)
  run('magick', [src, out])
  return out
}

// Visible photo of a shot (3:2 PNG in the cache)
async function photo(id) {
  const shot = plan.shots[id]
  if (!shot) throw new Error(`No plan for ${id}`)
  if (shot.from === 'reference-as-is') return toPng(plan.reference, 'reference')
  return cached(`${id.replace(':', '_')}_V`, async () => {
    console.log(`${id}: Foto …`)
    if (shot.from === 'reference') {
      return edit(toPng(plan.reference, 'reference'), [shot.view, plan.fire[shot.fire], STYLE].join(' '))
    }
    const base = await photo(shot.from) // earlier flight of the same waypoint
    return edit(base, `Exactly the same photo: same camera position, framing, buildings, trees, roads and vehicles – nothing moves. Change ONLY the state of the fire. ${plan.fire[shot.fire]} ${STYLE}`)
  })
}

// Files of the scenario: "card:n" → { dir, base } (numbering across all folders of a card)
function scenarioShots() {
  const map = new Map()
  for (const card of spec.cards) {
    const dirs = fs.readdirSync(path.join(scenarioDir, 'karten', card.id, 'DCIM')).sort()
    let n = 0
    for (const d of dirs) {
      const dir = path.join(scenarioDir, 'karten', card.id, 'DCIM', d)
      for (const f of fs.readdirSync(dir).filter((x) => /_V\.JPG$/i.test(x)).sort()) map.set(`${card.id}:${++n}`, { dir, base: f.replace(/_V\.JPG$/i, '') })
    }
  }
  return map
}

const shots = scenarioShots()
let done = 0
for (const id of Object.keys(plan.shots)) {
  if (only && !only.has(id)) continue
  const target = shots.get(id)
  if (!target) throw new Error(`Shot ${id} is not in the scenario`)
  const rel = path.relative(path.join(scenarioDir, 'karten'), target.dir)
  const outDir = apply ? target.dir : path.join(preview, rel)
  fs.mkdirSync(outDir, { recursive: true })
  // Metadata source: drawn original (backup) – make the backup on the first --apply
  const saved = path.join(backup, rel)
  if (apply) {
    fs.mkdirSync(saved, { recursive: true })
    for (const v of ['V', 'T']) {
      const src = path.join(target.dir, `${target.base}_${v}.JPG`)
      const dst = path.join(saved, `${target.base}_${v}.JPG`)
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst)
    }
  }
  const meta = (v) => [path.join(saved, `${target.base}_${v}.JPG`), path.join(target.dir, `${target.base}_${v}.JPG`)].find((f) => fs.existsSync(f))

  // Visible: 3:2 → 4:3 centre crop → 1600×1200
  const raw = await photo(id)
  const outV = path.join(outDir, `${target.base}_V.JPG`)
  run('magick', [raw, '-gravity', 'center', '-crop', '1365x1024+0+0', '+repage', '-resize', '1600x1200!', '-quality', '86', outV])
  run('exiftool', ['-q', '-overwrite_original', '-TagsFromFile', meta('V'), '-exif:all', '-xmp', outV])

  // Thermal: middle of the photo (3:2 region around the 5:4 thermal field) → thermal edit → 5:4 part
  if (meta('T')) {
    const region = path.join(work, 'thermal_region.png')
    run('magick', [outV, '-gravity', 'center', '-crop', `${THERMAL_REGION_W}x${THERMAL_H}+0+0`, '+repage', '-resize', '1536x1024!', region])
    const thermalRaw = await cached(`${id.replace(':', '_')}_T`, async () => {
      console.log(`${id}: Wärmebild …`)
      return edit(region, THERMAL_PROMPT)
    })
    const outT = path.join(outDir, `${target.base}_T.JPG`)
    run('magick', [thermalRaw, '-gravity', 'center', '-crop', `${Math.round(1536 * THERMAL_W / THERMAL_REGION_W)}x1024+0+0`, '+repage',
      '-resize', '640x512!', '-blur', '0x0.7', '-colorspace', 'sRGB', '-quality', '88', outT]) // a little soft like the real sensor
    run('exiftool', ['-q', '-overwrite_original', '-TagsFromFile', meta('T'), '-exif:all', '-xmp', outT])
  }
  done++
}
fs.rmSync(work, { recursive: true, force: true })
console.log(`${done} Aufnahmen ${apply ? 'ins Szenario übernommen' : `als Vorschau in ${path.relative(root, preview)}`}`)

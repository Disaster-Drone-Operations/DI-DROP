#!/usr/bin/env node
// Builds a training scenario (docs/scenario-format.md) from existing image folders:
//
//   node script/build_scenario.mjs <config.json> <target folder>
//
// config.json (keep scenarios with real mission images OUTSIDE the repository):
//   { "id", "title", "description", "start": "2026-09-11T11:30",
//     "settings": {…},
//     "missionSuggestion": { "kind", "title", "location", "coordinates" }   (participants create the mission;
//                                              "mission" + "assignments" instead: already created at the start)
//     "phone": { "lat", "lon", "accuracy" }   (optional – simulated phone, default: the suggested coordinates)
//     "nextcloud": { "folders": ["/a/b", …], "target": "/a/b/Fotos" }   (optional – folders in the simulated
//                                              Nextcloud; target = where the images belong, named in the script)
//     "cards": [{ "id": "flug1", "label": "Flug 1 · Lageerkundung", "sources": ["/path/to/folder", …] }],
//     "flightlogs": "/path/to/FlightRecord"   (optional: real DJIFlightRecord_*.txt of that day)
//     "remote": { "name": "DJI RC Plus 2 (Simulation)" },
//     "script": […]                            (optional – otherwise generated from the image times) }
//
// Each source folder becomes a DCIM subfolder of the card (as on the drone's SD card). Without real
// flight logs, the remote controller gets key data derived from the image times.

import fs from 'node:fs'
import path from 'node:path'

const [configPath, target] = process.argv.slice(2)
if (!configPath || !target) {
  console.error('Usage: node script/build_scenario.mjs <config.json> <target folder>')
  process.exit(2)
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const home = (p) => p.replace(/^~(?=\/|$)/, process.env.HOME)
const pad = (n) => String(n).padStart(2, '0')
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const CAMERA_FILE = /^DJI_\d{14}_\d{4}_[A-Z]+\.(JPG|JPEG|DNG|MP4|MOV)$/i
const COMPANION = /\.(MRK|OBS|NAV|RTK|pbk)$/i

// "DJI_20260911114817_0001_T.JPG" → Date (local time, like the camera)
function timeOf(name) {
  const m = /^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/.exec(name)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(target, { recursive: true })

const flights = []
for (const card of config.cards) {
  let first = null
  let last = null
  card.sources.forEach((source, i) => {
    const dir = home(source)
    const files = fs.readdirSync(dir).filter((f) => CAMERA_FILE.test(f) || COMPANION.test(f))
    const times = files.map(timeOf).filter(Boolean).sort((a, b) => a - b)
    if (!times.length) throw new Error(`No DJI images in ${dir}`)
    first = !first || times[0] < first ? times[0] : first
    last = !last || times.at(-1) > last ? times.at(-1) : last
    const t = times[0]
    const folder = `DJI_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}${pad(t.getHours())}${pad(t.getMinutes())}_${String(i + 1).padStart(3, '0')}`
    const dest = path.join(target, 'karten', card.id, 'DCIM', folder)
    fs.mkdirSync(dest, { recursive: true })
    for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(dest, f))
    console.log(`${card.id}: ${files.length} files → ${path.relative(target, dest)}`)
  })
  flights.push({ card, first, last })
}

// Flight logs: real files of that day, otherwise key data from the image times
const remote = { name: config.remote?.name ?? 'DJI RC Plus 2 (Simulation)', logs: [] }
if (config.flightlogs) {
  const dir = home(config.flightlogs)
  const day = config.start.slice(0, 10)
  fs.mkdirSync(path.join(target, 'flugprotokolle'), { recursive: true })
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`DJIFlightRecord_${day}_`))) {
    const m = /_\[(\d{2})-(\d{2})-(\d{2})\]/.exec(f)
    fs.copyFileSync(path.join(dir, f), path.join(target, 'flugprotokolle', f))
    remote.logs.push({ file: f, start: `${day}T${m[1]}:${m[2]}:${m[3]}` })
  }
  console.log(`${remote.logs.length} flight logs`)
} else {
  flights.forEach(({ first, last }, i) => {
    const start = new Date(first.getTime() - 4 * 60_000)
    const duration = (last - first) / 1000 + 8 * 60
    remote.logs.push({
      start: local(start), duration_s: Math.round(duration), distance_m: Math.round(duration * 2.2),
      max_height_m: 80, max_speed_ms: 9, aircraft_name: 'Matrice 4TD', aircraft_sn: 'SIM-0001',
      battery_sn: i % 2 ? 'SIM-AKKU-B' : 'SIM-AKKU-A', rc_sn: 'SIM-RC-1', photos: 0,
    })
  })
}

// Script: after each flight insert the card (landing + 3 min) and take it out again;
// connect the remote controller after the second and after the last flight
let script = config.script
if (!script) {
  script = []
  flights.forEach(({ card, last }, i) => {
    const landed = new Date(last.getTime() + 3 * 60_000)
    script.push({ at: hhmm(landed), action: 'card.insert', card: card.id, text: `${card.label} gelandet – SD-Karte einstecken` })
    script.push({ at: hhmm(new Date(landed.getTime() + 12 * 60_000)), action: 'card.remove', card: card.id })
    if (i === 1 || i === flights.length - 1) {
      script.push({ at: hhmm(new Date(landed.getTime() + 14 * 60_000)), action: 'remote.connect' })
      script.push({ at: hhmm(new Date(landed.getTime() + 18 * 60_000)), action: 'remote.disconnect' })
    }
  })
  // Begins with creating the mission and ends with closing it (unless it is created at the start)
  const suggestion = config.missionSuggestion
  if (suggestion) {
    const begin = new Date(new Date(config.start).getTime() + 60_000)
    script.push({ at: hhmm(begin), action: 'note', text: `Alarmierung. Neuen Einsatz anlegen (Vorschlag: „${suggestion.title}“) – Einsatzort mit „Hier“ vom Telefon übernehmen (in der Steuerung „QR-Code scannen“).` })
    const target = config.nextcloud?.target
    if (target && flights.length) {
      const firstLanding = new Date(flights[0].last.getTime() + 8 * 60_000)
      script.push({ at: hhmm(firstLanding), action: 'note', text: `Bilder bereitstellen – als Nextcloud-Ordner des Einsatzes wählen: ${target.split('/').filter(Boolean).join(' › ')} (Klickpfad üben).` })
    }
    const end = new Date(Math.max(...flights.map((f) => f.last.getTime())) + 25 * 60_000)
    script.push({ at: hhmm(end), action: 'note', text: 'Alle Aufträge bereitstellen, erledigen („Keine weiteren Kontrollflüge“) und den Einsatz abschließen.' })
  }
  script.sort((a, b) => a.at.localeCompare(b.at))
}

const scenario = {
  id: config.id,
  title: config.title,
  description: config.description ?? '',
  start: config.start,
  settings: config.settings ?? {},
  ...(config.missionSuggestion ? { missionSuggestion: config.missionSuggestion } : {}),
  ...(config.mission ? { mission: config.mission, assignments: config.assignments ?? [] } : {}),
  ...(config.phone ? { phone: config.phone } : {}),
  ...(config.nextcloud ? { nextcloud: config.nextcloud } : {}),
  ...(config.people ? { people: config.people } : {}),
  cards: config.cards.map(({ id, label }) => ({ id, label })),
  remote,
  script,
}
fs.writeFileSync(path.join(target, 'szenario.json'), `${JSON.stringify(scenario, null, 2)}\n`)
console.log(`Scenario "${scenario.title}" → ${target} (${script.length} script steps)`)

// Import der Bilder eines Flugs in einen Einsatz.
//
// Ablauf: Nach der Landung kommen alle neuen Bilder auf einmal rein. Die App teilt
// sie in Blöcke (Wegpunkt-Flug vs. Handaufnahmen, Ordner, Zeitlücken) und schlägt
// je Block einen Auftrag vor. Neue Aufträge lassen sich dabei direkt anlegen –
// falls ein Auftrag erst während des Flugs kam.
//
//   const importer = new MediaImporter({ mission })
//   const review = await importer.scan(paths, { preferredAssignmentId })
//   await importer.import({ blocks: [{ id, target, newKind, newTitle }], shotKeys, variants }, onProgress)
//
// Ablage: <Basis>/<2026_09_11__Einsatz>/<2026_09_11__1355_Kontrollflug 3>/DJI_….JPG

import platform from '/lib/platform/index.js'
import { sanitizeFolderName, dateTimeFolder } from '/lib/folders.js'
import { parseLocal, toLocalDateTime, addMinutes } from '/lib/time.js'
import Setting from '/app/models/setting.js'
import Assignment from '/app/models/assignment.js'
import AssignmentSeries from '/app/models/assignment_series.js'
import Flight from '/app/models/flight.js'
import MediaFile, { groupShots } from '/app/models/media_file.js'
import Viewpoint from '/app/models/viewpoint.js'
import { syncFileNames } from '/app/services/file_namer.js'

const BLOCK_GAP_MINUTES = 5

export async function mediaBaseDir() {
  return Setting.isSet('storage.base_path') ? Setting.get('storage.base_path') : platform.defaultMediaDir()
}

// W, V, Z, T zuerst, dann alles andere
function sortVariants(variants) {
  const order = [...MediaFile.VARIANT_ORDER, 'other', 'video']
  const rank = (v) => (order.includes(v) ? order.indexOf(v) : order.length - 2)
  return [...variants].sort((a, b) => rank(a) - rank(b))
}

const dirOf = (path) => path.replace(/[\\/][^\\/]*$/, '')
const variantKey = (e) => (e.kind === 'video' ? 'video' : e.variant ?? 'other')

export default class MediaImporter {
  constructor({ mission }) {
    this.mission = mission
    this.entries = []
  }

  // ── 1. Scannen, Duplikate erkennen, Blöcke bilden, Aufträge vorschlagen ─────

  async scan(paths, { preferredAssignmentId = null } = {}) {
    const { files, skipped } = await platform.media.scan(paths)
    const known = await MediaFile.findByFingerprints(files.map((f) => f.fingerprint), this.mission.id)
    const seen = new Set()

    this.entries = files.map((file) => {
      const existing = known.get(file.fingerprint)
      const duplicate = existing
        ? { label: `Flug ${existing.flight_number}` }
        : seen.has(file.fingerprint) ? { label: 'mehrfach in dieser Auswahl' } : null
      seen.add(file.fingerprint)
      return { ...file, taken_at: file.meta.taken_at, duplicate }
    })

    const shots = groupShots(this.entries).map((shot) => ({
      ...shot,
      isDuplicate: shot.files.every((f) => f.duplicate),
      hasWaypoint: shot.files.some((f) => f.meta.flight_line),
      dir: dirOf(shot.files[0].path),
    }))

    this.blocks = this.buildBlocks(shots.filter((s) => !s.isDuplicate))
    const openAssignments = await Assignment.open(this.mission.id)
    const recentlyDone = (await Assignment.done(this.mission.id)).slice(0, 5)
    const several = this.blocks.length > 1
    for (const block of this.blocks) Object.assign(block, this.suggest(block, openAssignments, preferredAssignmentId, several))

    const newEntries = this.entries.filter((e) => !e.duplicate)
    return {
      shots,
      blocks: this.blocks,
      openAssignments,
      recentlyDone,
      skipped,
      variants: sortVariants(new Set(newEntries.map(variantKey))),
      newCount: newEntries.length,
      duplicateCount: this.entries.length - newEntries.length,
    }
  }

  // Neue Blöcke bei: anderem Ordner, Wechsel Wegpunkt-Flug ↔ Handaufnahmen, Zeitlücke
  buildBlocks(shots) {
    const blocks = []
    for (const shot of shots) {
      const last = blocks.at(-1)
      const prev = last?.shots.at(-1)
      const gap = prev && shot.taken_at && prev.taken_at
        ? (parseLocal(shot.taken_at) - parseLocal(prev.taken_at)) / 60_000 : 0
      if (!last || prev.dir !== shot.dir || prev.hasWaypoint !== shot.hasWaypoint || gap > BLOCK_GAP_MINUTES) {
        blocks.push({ id: String(blocks.length), shots: [], hasWaypoint: shot.hasWaypoint })
      }
      blocks.at(-1).shots.push(shot)
    }
    for (const b of blocks) {
      b.start = b.shots[0].taken_at
      b.end = b.shots.at(-1).taken_at
    }
    return blocks
  }

  // Vorschlag: Wegpunkt-Bilder → fälliger Kontrollflug; sonst → ältester offener Auftrag
  // → { target: '<id>' | 'new', newKind }
  // Ein Block: der fälligste passende Auftrag (Kontrollflüge werden auch mal von Hand geflogen).
  // Mehrere Blöcke: Wegpunkt-Bilder → Kontrollflug, Handaufnahmen → anderer Auftrag oder neuer.
  suggest(block, open, preferredId, several) {
    const newKind = block.hasWaypoint ? 'kontrolle' : 'spezial'
    if (preferredId) return { target: String(preferredId), newKind } // gezielt auf einen Auftrag gezogen
    const controls = open.filter((a) => a.isControl)
    const others = open.filter((a) => !a.isControl)
    const match = block.hasWaypoint
      ? controls[0] ?? (several ? null : others[0])
      : others[0] ?? (several ? null : controls[0])
    return { target: match ? String(match.id) : 'new', newKind }
  }

  // ── 2. Importieren ─────────────────────────────────────────────────────────
  // blocks: [{ id, target: '<assignmentId>' | 'new', newKind, newTitle }]   ('skip' = nicht importieren)

  async import({ blocks, shotKeys, variants }, onProgress = () => {}) {
    const chosenBlocks = blocks.filter((b) => b.target !== 'skip')
    const blockById = new Map(this.blocks.map((b) => [b.id, b]))

    // Dateien je Block (nur ausgewählte Aufnahmen und Bildtypen, keine Duplikate)
    const plan = []
    for (const choice of chosenBlocks) {
      const block = blockById.get(choice.id)
      const entries = block.shots
        .filter((s) => shotKeys.has(s.key))
        .flatMap((s) => s.files)
        .filter((e) => !e.duplicate && variants.has(variantKey(e)))
      if (entries.length) plan.push({ choice, block, entries })
    }
    if (!plan.length) return { imported: 0, failed: [], flight: null }

    await this.ensureMissionFolder()
    const flight = await this.findOrCreateFlight(plan.flatMap((p) => p.entries))

    // Aufträge auflösen bzw. anlegen; Zielordner je Block
    const items = []
    const targets = new Map()
    const created = new Map() // gleicher neuer Auftrag für mehrere Blöcke → nur einmal anlegen
    for (const p of plan) {
      const key = p.choice.target === 'new' ? `${p.choice.newKind}|${(p.choice.newTitle ?? '').trim().toLowerCase()}` : null
      p.assignment = (key && created.get(key)) ?? await this.resolveAssignment(p.choice)
      if (key) created.set(key, p.assignment)
      const start = p.entries.map((e) => e.taken_at).filter(Boolean).sort()[0] ?? toLocalDateTime()
      p.dir = await platform.joinPath(this.mission.media_dir, `${dateTimeFolder(start.slice(0, 16))}_${sanitizeFolderName(p.assignment.title)}`)
      if (!p.assignment.media_dir) await p.assignment.update({ media_dir: p.dir })
      for (const e of p.entries) {
        items.push({ src: e.path, dest_dir: p.dir, fingerprint: e.fingerprint, kind: e.kind })
        targets.set(e.fingerprint, { entry: e, assignment: p.assignment })
      }
    }

    const results = await platform.media.import(items, onProgress)

    const failed = []
    let imported = 0
    for (const result of results) {
      const { entry, assignment } = targets.get(result.fingerprint)
      if (result.error || !result.dest_path) {
        failed.push({ name: entry.name, error: result.error })
        continue
      }
      const m = entry.meta
      const file = new MediaFile({
        mission_id: this.mission.id,
        flight_id: flight.id,
        assignment_id: assignment.id,
        kind: entry.kind,
        shot_key: entry.shot_key,
        variant: entry.variant,
        original_name: entry.name,
        original_path: entry.path,
        path: result.dest_path,
        thumb_path: result.thumb_path,
        size: entry.size,
        fingerprint: entry.fingerprint,
        taken_at: m.taken_at,
        camera: [m.make, m.model].filter(Boolean).join(' ') || null,
        width: m.width, height: m.height,
        lat: m.lat, lon: m.lon, abs_alt: m.abs_alt, rel_alt: m.rel_alt,
        gimbal_yaw: m.gimbal_yaw, gimbal_pitch: m.gimbal_pitch, flight_yaw: m.flight_yaw,
        focal_length: m.focal_length, focal_length_35mm: m.focal_length_35mm, digital_zoom: m.digital_zoom,
        image_source: m.image_source, flight_line: m.flight_line,
        target_lat: m.target_lat, target_lon: m.target_lon, target_distance: m.target_distance,
        metadata: Object.keys(m.dji ?? {}).length ? JSON.stringify(m.dji) : null,
      })
      if (await file.save()) imported++
      else failed.push({ name: entry.name, error: Object.values(file.errors).flat().join(', ') })
    }

    if (imported) {
      await Viewpoint.sync(this.mission.id)
      await syncFileNames(this.mission.id) // sprechende Dateinamen (Datum, Zeit, Wegpunkt, Bildtyp)
    }
    return { imported, failed, flight, assignments: [...new Map(plan.map((p) => [p.assignment.id, p.assignment])).values()] }
  }

  async resolveAssignment(choice) {
    if (choice.target !== 'new') return Assignment.find(choice.target)
    if (choice.newKind === 'kontrolle') {
      return AssignmentSeries.start(this.mission.id, { intervalMinutes: this.mission.control_interval_minutes })
    }
    const assignment = new Assignment({
      mission_id: this.mission.id,
      kind: choice.newKind,
      title: choice.newTitle || (Assignment.NAMED_KINDS.includes(choice.newKind) ? '' : Assignment.KINDS[choice.newKind]),
    })
    if (!(await assignment.save())) throw new Error(`Neuer Auftrag: Name ${Object.values(assignment.errors).flat().join(', ')}`)
    return assignment
  }

  // Bilder, die zeitlich an einen vorhandenen Flug anschließen, gehören zu ihm
  async findOrCreateFlight(entries) {
    const times = entries.map((e) => e.taken_at).filter(Boolean).sort()
    const start = (times[0] ?? toLocalDateTime()).slice(0, 16)
    const end = (times.at(-1) ?? start).slice(0, 16)

    const margin = Flight.MERGE_MINUTES
    const flights = await Flight.where('mission_id = ?', [this.mission.id])
    const overlapping = flights.find((f) => {
      const from = addMinutes(f.flownAt, -margin)
      const to = addMinutes(f.landedAt ?? f.flownAt, margin)
      return parseLocal(start) <= to && parseLocal(end) >= from
    })
    if (overlapping) {
      await overlapping.update({
        flown_at: [overlapping.flown_at, start].sort()[0],
        landed_at: [overlapping.landed_at ?? overlapping.flown_at, end].sort().at(-1),
      })
      return overlapping
    }
    return Flight.create({ mission_id: this.mission.id, flown_at: start, landed_at: end })
  }

  async ensureMissionFolder() {
    if (!this.mission.media_dir) {
      this.mission.media_dir = await platform.joinPath(await mediaBaseDir(), this.mission.folderName)
      await this.mission.save()
    }
  }
}

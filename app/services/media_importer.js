// Import of a flight's images into a mission.
//
// Flow: after landing all new images come in at once. The app splits them
// into blocks (waypoint flight vs. manual shots, folders, time gaps) and suggests
// an assignment per block. New assignments can be created right there –
// in case an assignment only came in during the flight.
//
//   const importer = new MediaImporter({ mission })
//   const review = await importer.scan(paths, { preferredAssignmentId })
//   await importer.import({ blocks: [{ id, target, newKind, newTitle }], shotKeys, variants }, onProgress)
//
// Memory cards (scan(…, { card: true })): duplicates across all missions, blocks from before the
// mission start count as "older" (not imported by default and never deleted from the card).
//
// Storage: <base>/<2026_09_11__Einsatz>/<2026_09_11__1355_Kontrollflug 3>/DJI_….JPG

import platform from '/lib/platform/index.js'
import { sanitizeFolderName, dateTimeFolder } from '/lib/folders.js'
import { parseLocal, toLocalDateTime, addMinutes } from '/lib/time.js'
import Setting from '/app/models/setting.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import AssignmentSeries from '/app/models/assignment_series.js'
import Flight from '/app/models/flight.js'
import MediaFile, { groupShots } from '/app/models/media_file.js'
import Viewpoint from '/app/models/viewpoint.js'
import { syncFileNames } from '/app/services/file_namer.js'

const BLOCK_GAP_MINUTES = 5
// Mapping flight: most images straight down, enough of them
const NADIR_PITCH = -80
const MAPPING_MIN_SHOTS = 8
const MAPPING_NADIR_SHARE = 0.8

export async function mediaBaseDir() {
  return Setting.isSet('storage.base_path') ? Setting.get('storage.base_path') : platform.defaultMediaDir()
}

// W, V, Z, T first, then everything else
function sortVariants(variants) {
  const order = [...MediaFile.VARIANT_ORDER, 'other', 'video']
  const rank = (v) => (order.includes(v) ? order.indexOf(v) : order.length - 2)
  return [...variants].sort((a, b) => rank(a) - rank(b))
}

const dirOf = (path) => path.replace(/[\\/][^\\/]*$/, '')
const baseName = (path) => path.split(/[\\/]/).pop()
const variantKey = (e) => (e.kind === 'video' ? 'video' : e.variant ?? 'other')

export default class MediaImporter {
  constructor({ mission }) {
    this.mission = mission
    this.entries = []
  }

  // ── 1. Scan, detect duplicates, build blocks, suggest assignments ─────

  // scanned: result of platform.media.scan(paths) if already available (memory card check)
  async scan(paths, { preferredAssignmentId = null, card = false, scanned = null } = {}) {
    const { files, skipped } = scanned ?? await platform.media.scan(paths)
    const known = await MediaFile.findByFingerprints(files.map((f) => f.fingerprint), card ? null : this.mission.id)
    const seen = new Set()

    this.entries = files.map((file) => {
      const existing = known.get(file.fingerprint)
      const duplicate = existing
        ? { label: existing.mission_id === this.mission.id ? `Flug ${existing.flight_number}` : `Einsatz „${existing.mission_title}“` }
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
    if (card) await this.markOlder(this.blocks)
    const current = this.blocks.filter((b) => !b.older)
    const several = current.length > 1
    for (const block of this.blocks) {
      Object.assign(block, block.older ? { target: 'skip', newKind: 'special' } : this.suggest(block, openAssignments, preferredAssignmentId, several))
    }

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

  // Memory card: blocks that ended before the mission started stay on the card unless chosen.
  // Hint: another mission on the same day
  async markOlder(blocks) {
    const startsAt = this.mission.startsAt
    const others = (await Mission.all()).filter((m) => m.id !== this.mission.id)
    for (const block of blocks) {
      if (!block.end || parseLocal(block.end) >= startsAt) continue
      block.older = true
      const day = block.start.slice(0, 10)
      block.otherMission = others.find((m) => m.date === day) ?? null
    }
  }

  // New blocks on: different folder, switch waypoint flight ↔ manual shots, time gap
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
      b.folder = baseName(b.shots[0].dir)
      const nadir = b.shots.filter((s) => s.files.some((f) => f.meta.gimbal_pitch != null && f.meta.gimbal_pitch <= NADIR_PITCH))
      b.isMapping = b.shots.length >= MAPPING_MIN_SHOTS && nadir.length >= b.shots.length * MAPPING_NADIR_SHARE
    }
    return blocks
  }

  // Suggestion: waypoint images → due control flight; otherwise → oldest open assignment
  // → { target: '<id>' | 'new', newKind }
  // One block: the most due matching assignment (control flights are sometimes flown manually).
  // Several blocks: waypoint images → control flight, manual shots → other assignment or a new one.
  // Mapping flights (images straight down) → open mapping assignment or a new one.
  suggest(block, open, preferredId, several) {
    if (block.isMapping && !preferredId) {
      const mapping = open.find((a) => a.kind === 'mapping')
      return { target: mapping ? String(mapping.id) : 'new', newKind: 'mapping', newTitle: 'Kartierung' }
    }
    const newKind = block.hasWaypoint ? 'control' : 'special'
    if (preferredId) return { target: String(preferredId), newKind } // dragged onto a specific assignment
    const controls = open.filter((a) => a.isControl)
    const others = open.filter((a) => !a.isControl)
    const match = block.hasWaypoint
      ? controls[0] ?? (several ? null : others[0])
      : others[0] ?? (several ? null : controls[0])
    return { target: match ? String(match.id) : 'new', newKind }
  }

  // ── 2. Import ─────────────────────────────────────────────────────────
  // blocks: [{ id, target: '<assignmentId>' | 'new', newKind, newTitle }]   ('skip' = don't import)

  async import({ blocks, shotKeys, variants }, onProgress = () => {}) {
    const chosenBlocks = blocks.filter((b) => b.target !== 'skip')
    const blockById = new Map(this.blocks.map((b) => [b.id, b]))

    // Files per block (only selected shots and image types, no duplicates)
    const plan = []
    for (const choice of chosenBlocks) {
      const block = blockById.get(choice.id)
      const entries = block.shots
        .filter((s) => shotKeys.has(s.key))
        .flatMap((s) => s.files)
        .filter((e) => !e.duplicate && variants.has(variantKey(e)))
      if (entries.length) plan.push({ choice, block, entries })
    }
    if (!plan.length) return { imported: 0, failed: [], flight: null, copies: [] }

    await this.ensureMissionFolder()
    const flight = await this.findOrCreateFlight(plan.flatMap((p) => p.entries))

    // Resolve or create assignments; target folder per block
    const items = []
    const targets = new Map()
    const created = new Map() // same new assignment for several blocks → create only once
    for (const p of plan) {
      const key = p.choice.target === 'new' ? `${p.choice.newKind}|${(p.choice.newTitle ?? '').trim().toLowerCase()}` : null
      p.assignment = (key && created.get(key)) ?? await this.resolveAssignment(p.choice)
      if (key) created.set(key, p.assignment)
      const start = p.entries.map((e) => e.taken_at).filter(Boolean).sort()[0] ?? toLocalDateTime()
      p.dir = await platform.joinPath(this.mission.media_dir, `${dateTimeFolder(start.slice(0, 16))}_${sanitizeFolderName(p.assignment.title)}`)
      if (!p.assignment.media_dir) await p.assignment.update({ media_dir: p.dir })
      for (const e of p.entries) {
        items.push({ src: e.path, dest_dir: p.dir, fingerprint: e.fingerprint, kind: e.kind })
        targets.set(e.fingerprint, { entry: e, assignment: p.assignment, older: p.block.older })
      }
    }

    const results = await platform.media.import(items, onProgress)

    const failed = []
    const copies = [] // { src, copy, older } – for deleting from the memory card
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
      if (await file.save()) {
        imported++
        copies.push({ src: entry.path, copy: result.dest_path, fingerprint: entry.fingerprint, older: !!targets.get(result.fingerprint).older })
      } else failed.push({ name: entry.name, error: Object.values(file.errors).flat().join(', ') })
    }

    if (imported) {
      await Viewpoint.sync(this.mission.id)
      await syncFileNames(this.mission.id) // descriptive file names (date, time, viewpoint, image type)
      // The copies were renamed → current paths (the card cleanup verifies these files)
      const current = new Map((await MediaFile.where('mission_id = ?', [this.mission.id])).map((f) => [f.fingerprint, f.path]))
      for (const c of copies) c.copy = current.get(c.fingerprint) ?? c.copy
    }
    return { imported, failed, flight, copies, assignments: [...new Map(plan.map((p) => [p.assignment.id, p.assignment])).values()] }
  }

  async resolveAssignment(choice) {
    if (choice.target !== 'new') return Assignment.find(choice.target)
    if (choice.newKind === 'control') {
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

  // Images that follow an existing flight in time belong to it
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

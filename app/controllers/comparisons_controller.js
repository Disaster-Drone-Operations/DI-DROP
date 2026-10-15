import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import MediaFile from '/app/models/media_file.js'
import Viewpoint from '/app/models/viewpoint.js'
import Comparison from '/app/models/comparison.js'
import platform from '/lib/platform/index.js'
import { syncFileNames } from '/app/services/file_namer.js'

// Comparison images of a mission: select viewpoints, choose shots, generate
export default class ComparisonsController extends ApplicationController {
  async index() {
    const mission = await Mission.find(this.params.mission_id)
    await Viewpoint.sync(mission.id)
    await syncFileNames(mission.id)

    const [viewpoints, files, assignments, comparisons] = await Promise.all([
      Viewpoint.forMission(mission.id),
      MediaFile.where('mission_id = ? AND viewpoint_id IS NOT NULL', [mission.id], { order: 'taken_at ASC' }),
      Assignment.forMission(mission.id),
      Comparison.forMission(mission.id),
    ])
    const assignmentById = new Map(assignments.map((a) => [a.id, a]))
    const names = new Map(viewpoints.map((v) => [v.id, v.name]))

    // Per viewpoint: shots (across all flights) with their files per image type
    const entries = viewpoints.map((viewpoint) => {
      const shots = new Map()
      for (const f of files.filter((f) => f.viewpoint_id === viewpoint.id)) {
        const key = `${f.flight_id}/${f.shot_key}`
        if (!shots.has(key)) {
          shots.set(key, { key, taken_at: f.taken_at, flight_id: f.flight_id, label: assignmentById.get(f.assignment_id)?.title ?? '', files: {} })
        }
        shots.get(key).files[f.variant ?? 'other'] = { id: f.id, path: f.path, thumb: f.thumb_path }
      }
      const list = [...shots.values()].sort((a, b) => (a.taken_at ?? '').localeCompare(b.taken_at ?? ''))
      return {
        viewpoint,
        shots: list,
        flightCount: new Set(list.map((s) => s.flight_id)).size,
        variants: MediaFile.VARIANT_ORDER.filter((v) => list.some((s) => s.files[v])),
        latest: list.at(-1),
      }
    })

    // Already created comparison images per viewpoint (newest) and the last "round":
    // everything created up to 15 minutes before the newest comparison image → preselected
    const lastCreated = new Map()
    for (const c of comparisons) {
      if (c.viewpoint_id && (!lastCreated.has(c.viewpoint_id) || c.created_at > lastCreated.get(c.viewpoint_id))) lastCreated.set(c.viewpoint_id, c.created_at)
    }
    const newest = comparisons.map((c) => Date.parse(c.created_at)).filter(Number.isFinite).sort((a, b) => b - a)[0]
    const lastRound = new Set(comparisons
      .filter((c) => c.viewpoint_id && newest - Date.parse(c.created_at) <= 15 * 60_000)
      .map((c) => c.viewpoint_id))
    for (const e of entries) {
      e.lastCreated = lastCreated.get(e.viewpoint.id) ?? null
      e.inLastRound = lastRound.has(e.viewpoint.id)
    }

    await this.render('comparisons/index', {
      mission,
      repeated: entries.filter((e) => e.flightCount > 1),
      single: entries.filter((e) => e.flightCount <= 1),
      comparisons: comparisons.map((c) => ({ comparison: c, viewpointName: names.get(c.viewpoint_id) })),
      canExport: platform.capabilities.media,
    }, { title: `Vergleichsbilder – ${mission.title}` })
  }
}

import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import MediaFile, { groupShots } from '/app/models/media_file.js'
import Viewpoint from '/app/models/viewpoint.js'
import { imageParams } from '/app/services/footprint.js'
import { shotData } from '/app/helpers/media_helper.js'

// Mission map: every shot as the part of the ground it shows (app/services/footprint.js), per assignment or all;
// a click opens the shot in the large view. ?assignment=<id>, ?variant=T|V|W
export default class MissionMapsController extends ApplicationController {
  async show() {
    const mission = await Mission.find(this.params.mission_id)
    const assignments = (await Assignment.forMission(mission.id))
    const assignmentId = /^\d+$/.test(this.params.assignment ?? '') ? Number(this.params.assignment) : null
    const files = await MediaFile.where(
      `mission_id = ? AND kind = 'image'${assignmentId ? ' AND assignment_id = ?' : ''}`,
      assignmentId ? [mission.id, assignmentId] : [mission.id], { order: 'taken_at ASC, id ASC' })
    const titles = new Map(assignments.map((a) => [a.id, a.title]))
    const names = new Map((await Viewpoint.forMission(mission.id)).map((v) => [v.id, v.name]))
    const variants = [...new Set(files.map((f) => f.variant).filter(Boolean))]
    const variant = this.params.variant && variants.includes(this.params.variant) ? this.params.variant : variants.includes('T') ? 'T' : variants[0] ?? null

    // One entry per shot: gallery data + the footprint parameters of the chosen image type
    const shots = groupShots(files).map((shot) => {
      const file = shot.byVariant[variant] ?? shot.primary
      const viewpointId = shot.files.find((f) => f.viewpoint_id)?.viewpoint_id
      return {
        data: JSON.parse(shotData({ ...shot, viewpointName: names.get(viewpointId) ?? null }, { assignmentTitle: titles.get(file.assignment_id) ?? '' })),
        params: imageParams(file),
        variant: file.variant,
      }
    })
    // Einsatzort ("Breite, Länge") – marker, and where the map starts without shots
    const [siteLat, siteLon] = (mission.coordinates ?? '').split(/[,;]/).map((v) => Number(v.trim()))
    const site = mission.coordinates && Number.isFinite(siteLat) && Number.isFinite(siteLon) ? { lat: siteLat, lon: siteLon } : null
    await this.render('mission_maps/show', {
      mission,
      site,
      assignments: assignments.filter((a) => files.length || a.id === assignmentId),
      assignmentId,
      variants,
      variant,
      shots,
      located: shots.filter((s) => s.params).length,
    }, { title: `Karte – ${mission.title}` })
  }
}

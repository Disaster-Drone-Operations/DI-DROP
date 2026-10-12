import ApplicationController from '/app/controllers/application_controller.js'
import Viewpoint from '/app/models/viewpoint.js'
import { syncFileNames } from '/app/services/file_namer.js'
import { recordViewpointRename } from '/app/services/viewpoint_renamer.js'

export default class ViewpointsController extends ApplicationController {
  // Umbenennen; leerer Name → wieder automatischer Name (Himmelsrichtung)
  async update() {
    const viewpoint = await Viewpoint.findBy('id = ? AND mission_id = ?', [Number(this.params.id), Number(this.params.mission_id)])
    if (!viewpoint) await Viewpoint.find(-1)
    const before = viewpoint.custom_name
    await viewpoint.update({ custom_name: this.params.viewpoint?.custom_name ?? '' })
    await syncFileNames(viewpoint.mission_id) // Dateinamen enthalten den Wegpunkt-Namen
    recordViewpointRename(viewpoint, before)
    this.redirectTo(`/missions/${viewpoint.mission_id}/comparisons`, {
      notice: viewpoint.custom_name ? `Wegpunkt heißt jetzt „${viewpoint.custom_name}“.` : 'Automatischer Name wiederhergestellt.',
      undo: true,
    })
  }
}

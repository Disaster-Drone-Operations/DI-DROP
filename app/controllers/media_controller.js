import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'

// The former module "Bilddaten": images always belong to a mission now – old links (and ⌘2 from
// earlier habits) go to the only active mission or to the mission overview.
export default class MediaController extends ApplicationController {
  async index() {
    const active = await Mission.active()
    this.redirectTo(active.length === 1 ? `/missions/${active[0].id}` : '/')
  }
}

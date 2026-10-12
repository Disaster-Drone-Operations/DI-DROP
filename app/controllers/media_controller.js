import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'

// Modul "Bilddaten": anstehende Aufträge und Verlauf aller aktiven Einsätze
export default class MediaController extends ApplicationController {
  async index() {
    const groups = []
    for (const mission of await Mission.active()) {
      const timeline = await Assignment.timeline(mission.id, { thumbs: 4 })
      const history = (await Assignment.forMission(mission.id))
        .filter((a) => timeline.has(a.id))
        .sort((a, b) => (timeline.get(b.id).last ?? '').localeCompare(timeline.get(a.id).last ?? ''))
        .slice(0, 4)
      groups.push({ mission, history, timeline })
    }
    await this.render('media/index', { groups, upcoming: await Assignment.upcoming() }, { title: 'Bilddaten' })
  }
}

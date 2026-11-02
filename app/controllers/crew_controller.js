import ApplicationController from '/app/controllers/application_controller.js'
import Mission from '/app/models/mission.js'
import MissionCrew from '/app/models/mission_crew.js'
import Person from '/app/models/person.js'
import { roleLabel } from '/app/helpers/mission_helper.js'
import { crewTime, localNow } from '/app/helpers/crew_helper.js'
import undo from '/lib/undo.js'

// Crew of a mission (box „Besetzung“ on the mission page, missions/_crew.ejs)
export default class CrewController extends ApplicationController {
  async create() {
    const mission = await Mission.find(this.params.mission_id)
    const p = this.params.crew ?? {}
    if (!Mission.ROLES[p.role]) return this.redirectTo(`/missions/${mission.id}`, { alert: 'Unbekannte Rolle.' })
    const personId = /^\d+$/.test(p.person_id ?? '') ? Number(p.person_id) : null
    const fromAt = p.from === 'start' ? `${mission.date}T${mission.start_time ?? '00:00'}`
      : p.from === 'at' && p.at ? p.at.slice(0, 16)
        : localNow()

    const { entry, previous, replaced } = await MissionCrew.change(mission.id, p.role, personId, fromAt)
    const person = personId ? await Person.find(personId) : null
    const label = `${roleLabel(p.role)} ab ${crewTime(fromAt, mission)}: ${person?.name ?? 'niemand'}`
    undo.record({
      label,
      undo: () => (replaced ? entry.update({ person_id: previous }) : entry.destroy()),
      redo: () => MissionCrew.change(mission.id, p.role, personId, fromAt),
    })
    this.redirectTo(`/missions/${mission.id}`, { notice: `${label}.`, undo: true })
  }

  // A change entered by mistake
  async destroy() {
    const mission = await Mission.find(this.params.mission_id)
    const entry = await MissionCrew.find(this.params.entry)
    if (entry.mission_id !== mission.id) return this.redirectTo(`/missions/${mission.id}`)
    const { role, person_id: personId, from_at: fromAt } = entry
    await entry.destroy()
    undo.record({
      label: `Wechsel ${roleLabel(role)} (${crewTime(fromAt, mission)}) entfernt`,
      undo: () => MissionCrew.change(mission.id, role, personId, fromAt),
      redo: async () => (await MissionCrew.findBy('mission_id = ? AND role = ? AND from_at = ?', [mission.id, role, fromAt]))?.destroy(),
    })
    this.redirectTo(`/missions/${mission.id}`, { notice: `Wechsel ${roleLabel(role)} (${crewTime(fromAt, mission)}) entfernt.`, undo: true })
  }
}

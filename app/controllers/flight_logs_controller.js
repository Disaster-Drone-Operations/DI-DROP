import ApplicationController from '/app/controllers/application_controller.js'
import FlightLog from '/app/models/flight_log.js'
import DeviceName from '/app/models/device_name.js'
import Mission from '/app/models/mission.js'
import platform from '/lib/platform/index.js'
import { flightLogDir, syncLocal, isAvailable } from '/app/services/flightlog_importer.js'
import { assignFlights, assign, reset } from '/app/services/flight_missions.js'

// Module "Flugprotokolle": all flights from the remote controller's logs
export default class FlightLogsController extends ApplicationController {
  async index() {
    if (isAvailable()) await syncLocal().catch((e) => console.warn('[flight logs]', e))
    await assignFlights()
    const battery = this.params.battery || null // "Flüge" link in the battery module
    const missionFilter = this.params.mission || null // a mission's id or "none" (flights without a mission)
    const all = battery
      ? await FlightLog.where('battery_sn = ?', [battery], { order: 'started_at DESC' })
      : await FlightLog.all({ order: 'started_at DESC' })
    const logs = missionFilter === 'none' ? all.filter((l) => !l.mission_id)
      : missionFilter ? all.filter((l) => l.mission_id === Number(missionFilter)) : all
    const missions = new Map((await Mission.all({ order: 'date DESC, start_time DESC' })).map((m) => [m.id, m]))
    // Grouped by mission (and „Ohne Einsatz“), the group with the most recent flight first
    const groups = []
    for (const log of logs) {
      const mission = (log.mission_id && missions.get(log.mission_id)) || null
      let group = groups.find((g) => g.mission === mission)
      if (!group) groups.push((group = { mission, logs: [] }))
      group.logs.push(log)
    }
    await this.render('flight_logs/index', {
      logs,
      groups,
      names: await DeviceName.all(),
      battery,
      missions,
      missionFilter,
      filterMission: missionFilter && missionFilter !== 'none' ? missions.get(Number(missionFilter)) ?? null : null,
      unassigned: all.filter((l) => !l.mission_id).length,
      available: isAvailable(),
      dir: isAvailable() ? await flightLogDir() : null,
      canPickFolder: platform.capabilities.folders,
    }, { title: 'Flugprotokolle' })
  }

  // „Einsatz zuordnen …“: selected flights → a mission, „none“ (no mission) or „auto“ (automatic again)
  async assign() {
    const ids = String(this.params.ids ?? '').split(',').map(Number).filter(Boolean)
    const choice = this.params.mission
    const back = this.params.return_to?.startsWith('/flightlogs') ? this.params.return_to : '/flightlogs'
    if (!ids.length || !choice) return this.redirectTo(back, { alert: 'Keine Flüge ausgewählt.' })
    const flights = ids.length === 1 ? '1 Flug' : `${ids.length} Flüge`
    if (choice === 'auto') {
      await reset(ids)
      return this.redirectTo(back, { notice: `${flights} wieder automatisch zugeordnet.` })
    }
    if (choice === 'none') {
      await assign(ids, null)
      return this.redirectTo(back, { notice: `${flights} keinem Einsatz zugeordnet.` })
    }
    const mission = await Mission.find(Number(choice))
    await assign(ids, mission.id)
    this.redirectTo(back, { notice: `${flights} „${mission.title}“ zugeordnet.` })
  }
}

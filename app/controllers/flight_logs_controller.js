import ApplicationController from '/app/controllers/application_controller.js'
import FlightLog from '/app/models/flight_log.js'
import DeviceName from '/app/models/device_name.js'
import Mission from '/app/models/mission.js'
import platform from '/lib/platform/index.js'
import { flightLogDir, syncLocal, isAvailable } from '/app/services/flightlog_importer.js'
import { assignFlights, assign, reset } from '/app/services/flight_missions.js'
import { FLIGHT_ROLES, setCrew, resetCrew } from '/app/services/flight_crew.js'
import Person from '/app/models/person.js'
import { roleLabel } from '/app/helpers/mission_helper.js'

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
    // Strictly by time (newest first), a new block whenever the mission changes – flights without a mission in
    // between form blocks of their own; a mission interrupted by other flights appears in parts („Teil 1 von 2“)
    const groups = []
    for (const log of logs) {
      const mission = (log.mission_id && missions.get(log.mission_id)) || null
      const last = groups.at(-1)
      if (last && last.mission === mission) last.logs.push(log)
      else groups.push({ mission, key: mission ? `m${mission.id}` : `n${groups.length}`, logs: [log] })
    }
    const partsOf = new Map()
    for (const g of groups) if (g.mission) partsOf.set(g.key, (partsOf.get(g.key) ?? 0) + 1)
    const counted = new Map()
    for (const g of [...groups].reverse()) { // numbered from the oldest part
      if (!g.mission || partsOf.get(g.key) < 2) continue
      counted.set(g.key, (counted.get(g.key) ?? 0) + 1)
      g.part = { n: counted.get(g.key), of: partsOf.get(g.key) }
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
      people: await Person.roster(),
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

  // „Besetzung ändern …“: pilot and airspace observer of the selected flights –
  // per role "keep" (unchanged), "auto" (from the mission's crew again), "" (nobody) or a person's id
  async crew() {
    const ids = String(this.params.ids ?? '').split(',').map(Number).filter(Boolean)
    const back = this.params.return_to?.startsWith('/flightlogs') ? this.params.return_to : '/flightlogs'
    if (!ids.length) return this.redirectTo(back, { alert: 'Keine Flüge ausgewählt.' })
    const changes = []
    for (const role of FLIGHT_ROLES) {
      const choice = this.params[role] ?? 'keep'
      if (choice === 'keep' || choice === 'new') continue
      if (choice === 'auto') await resetCrew(ids, role)
      else await setCrew(ids, role, /^\d+$/.test(choice) ? Number(choice) : null)
      const person = /^\d+$/.test(choice) ? await Person.find(Number(choice)) : null
      changes.push(`${roleLabel(role)}: ${choice === 'auto' ? 'automatisch' : person?.name ?? 'niemand'}`)
    }
    const flights = ids.length === 1 ? '1 Flug' : `${ids.length} Flüge`
    this.redirectTo(back, { notice: changes.length ? `${flights} – ${changes.join(', ')}.` : 'Nichts geändert.' })
  }
}

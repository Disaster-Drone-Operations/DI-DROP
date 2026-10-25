// Training mode (docs/scenario-format.md). Runs in the main window when it was opened with
// ?training=<scenario> (lib/platform/simulation.js): own database, simulated clock and devices.
//
// The control window (app/javascript/control.js), the docked panel in the browser bridge and – later –
// the phone send commands as event "training:command" { action, … }; the main window answers with
// "training:state". All logic lives here.

import platform, { trainingId } from '/lib/platform/index.js'
import { setClock, snapshot, nowMs } from '/lib/clock.js'
import { parseLocal, toDate, toTime, toLocalDateTime } from '/lib/time.js'
import { destroyDatabase } from '/lib/db.js'
import Setting from '/app/models/setting.js'
import Mission from '/app/models/mission.js'
import Assignment from '/app/models/assignment.js'
import AssignmentSeries from '/app/models/assignment_series.js'
import FlightLog from '/app/models/flight_log.js'

export const isTraining = () => !!trainingId

// Carried over from the normal mode when starting (the training database is separate)
const CARRY_KEYS = ['relay.url', 'general.unit_name', 'general.operator_name']
const CARRY_STORAGE = 'di-drop:training-carry'
// "Neu starten" from the settings: the training window deletes its data at startup
export const RESET_FLAG = 'di-drop:training-reset'

let scenario = null
let steps = [] // [{ index, at (ms), action, card, text, label }]

// ── Entering and leaving ───────────────────────────────────────────────────

// URL of the main window in training mode / normal mode (keeps ?bridge in the dev bridge)
function urlFor(id) {
  const params = new URLSearchParams(location.search)
  params.delete('training')
  if (id) params.set('training', id)
  const query = params.toString()
  return `${location.pathname}${query ? `?${query}` : ''}#/`
}

// Always a real reload: if only the part after "#" differs, the browser would not reload the page
function reloadAs(url) {
  const target = new URL(url, location.href)
  if (target.pathname === location.pathname && target.search === location.search) {
    location.hash = target.hash
    location.reload()
  } else {
    location.href = url
  }
}

export async function startTraining(id) {
  try {
    const carry = Object.fromEntries(CARRY_KEYS.map((k) => [k, Setting.get(k)]).filter(([, v]) => v))
    sessionStorage.setItem(CARRY_STORAGE, JSON.stringify(carry))
  } catch {
    // not important
  }
  reloadAs(urlFor(id))
}

export async function endTraining() {
  await platform.training?.closeControl().catch(() => {})
  reloadAs(urlFor(null))
}

// "Übung neu starten": delete the training data and start again from the beginning
export async function resetTraining() {
  await destroyDatabase()
  await platform.training.reset(trainingId)
  reloadAs(urlFor(trainingId))
}

// ── Scenario ──────────────────────────────────────────────────────────────

// "11:45" → on the day of the exercise; "2026-09-11T11:45" stays as it is
function timeOf(value) {
  if (!value) return null
  const day = scenario.start.slice(0, 10)
  return parseLocal(/^\d{2}:\d{2}$/.test(value) ? `${day}T${value}` : value)?.getTime() ?? null
}

const cardLabel = (id) => scenario.cards?.find((c) => c.id === id)?.label ?? id

function stepLabel(step) {
  if (step.text) return step.text
  return {
    'card.insert': `SD-Karte „${cardLabel(step.card)}“ einstecken`,
    'card.remove': `SD-Karte „${cardLabel(step.card)}“ entnehmen`,
    'remote.connect': 'Fernsteuerung anschließen',
    'remote.disconnect': 'Fernsteuerung trennen',
  }[step.action] ?? step.action
}

// First start: settings, mission and assignments from the scenario, clock on the start time
async function initialize() {
  let carry = {}
  try {
    carry = JSON.parse(sessionStorage.getItem(CARRY_STORAGE) ?? '{}')
  } catch {
    // nothing carried over
  }
  for (const [key, value] of Object.entries({ ...carry, ...(scenario.settings ?? {}) })) await Setting.set(key, value)

  const start = timeOf(scenario.start)
  if (scenario.mission) {
    const m = scenario.mission
    const mission = await Mission.create({
      ...Mission.defaults(),
      date: toDate(new Date(start)),
      start_time: toTime(new Date(start)),
      ...m,
      status: 'active',
    })
    await Assignment.create({ mission_id: mission.id, kind: 'initial', title: Assignment.KINDS.initial })
    for (const a of scenario.assignments ?? []) {
      const dueAt = a.due ? new Date(timeOf(a.due)) : null
      if (a.kind === 'control') {
        await AssignmentSeries.start(mission.id, { intervalMinutes: a.interval ?? mission.control_interval_minutes, dueAt })
      } else {
        await Assignment.create({ mission_id: mission.id, kind: a.kind ?? 'special', title: a.title ?? '', notes: a.notes ?? null,
          due_at: dueAt ? toLocalDateTime(dueAt) : null })
      }
    }
  }
  await Setting.set('training.clock', { at: start, speed: 1, running: false })
  await Setting.set('training.step', 0)
  await Setting.set('training.initialized', true)
}

// ── Simulated remote controller ───────────────────────────────────────────

// Logs of the scenario with their start time; summary logs get a DJI-like file name
function remoteLogs() {
  return (scenario.remote?.logs ?? []).map((log) => {
    const start = timeOf(log.start)
    const d = new Date(start)
    const pad = (n) => String(n).padStart(2, '0')
    const name = log.file ?? `DJIFlightRecord_${toDate(d)}_[${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}]_SIM.txt`
    return { ...log, start, name }
  })
}

const remoteProvider = {
  get device() {
    return { key: `sim:${trainingId}`, name: scenario.remote?.name ?? 'DJI RC Plus 2 (Simulation)' }
  },
  // On the remote controller: everything flown until now (simulated clock)
  async status() {
    const known = new Set(await FlightLog.knownFileNames())
    const flown = remoteLogs().filter((l) => l.start <= nowMs())
    const fresh = flown.filter((l) => !known.has(l.name)).sort((a, b) => b.start - a.start)
    return { device: this.device, folder: 'DJI/com.dji.industry.pilot/FlightRecord', total: flown.length, new: fresh.length, new_files: fresh.map((l) => l.name) }
  },
  async import(dest, known, includeDat, onProgress) {
    const knownSet = new Set(known)
    const fresh = remoteLogs().filter((l) => l.start <= nowMs() && !knownSet.has(l.name))
    const total = fresh.length
    const report = { copied: 0, extras_copied: 0, summaries: [], failed: [] }
    onProgress({ done: 0, total })
    // Real DJI files: through the normal folder import (Rust reads the key data)
    const files = fresh.filter((l) => l.file)
    if (files.length) {
      const staged = await platform.training.stageLogs(trainingId, files.map((l) => l.name))
      const real = await platform.flightlogs.importFolder(staged, dest, known, includeDat)
      Object.assign(report, { copied: real.copied, extras_copied: real.extras_copied, failed: real.failed })
      report.summaries.push(...real.summaries)
    }
    // Key data from the scenario (no file)
    let done = files.length
    for (const log of fresh.filter((l) => !l.file)) {
      await new Promise((r) => setTimeout(r, 250)) // looks like a transfer
      report.summaries.push({
        file_name: log.name, path: '', size: 0, log_version: 0,
        start_time: new Date(log.start).toISOString(),
        duration_s: log.duration_s ?? 600, distance_m: log.distance_m ?? 0, max_height_m: log.max_height_m ?? 0, max_speed_ms: log.max_speed_ms ?? 0,
        battery_sn: log.battery_sn ?? '', aircraft_name: log.aircraft_name ?? '', aircraft_sn: log.aircraft_sn ?? '',
        rc_sn: log.rc_sn ?? '', camera_sn: log.camera_sn ?? '', latitude: log.latitude ?? 0, longitude: log.longitude ?? 0,
        photos: log.photos ?? 0, video_s: log.video_s ?? 0, app_version: 'Simulation',
      })
      report.copied++
      onProgress({ done: ++done, total })
    }
    return report
  },
}

// ── Commands ──────────────────────────────────────────────────────────────

async function perform(step) {
  if (step.action === 'card.insert') return platform.simulation.insertCard(step.card, cardLabel(step.card))
  if (step.action === 'card.remove') return platform.simulation.removeCard(step.card)
  if (step.action === 'remote.connect') return platform.simulation.connectRemote(remoteProvider)
  if (step.action === 'remote.disconnect') return platform.simulation.disconnectRemote()
}

const nextIndex = () => Number(Setting.get('training.step') ?? 0)

async function advance() {
  await Setting.set('training.step', nextIndex() + 1)
}

async function saveClock() {
  await Setting.set('training.clock', snapshot())
}

const COMMANDS = {
  'clock.play': () => setClock({ running: true }),
  'clock.pause': () => setClock({ running: false }),
  'clock.speed': ({ speed }) => setClock({ speed: Number(speed) || 1 }),
  'clock.add': ({ minutes }) => setClock({ at: nowMs() + Number(minutes) * 60_000 }),
  // Next script step: if it lies in the future, the clock jumps there first
  async 'step.run'() {
    const step = steps[nextIndex()]
    if (!step) return
    if (step.at && step.at > nowMs()) setClock({ at: step.at })
    await advance()
    await perform(step)
  },
  async 'step.forward'() {
    const step = steps[nextIndex()]
    if (step?.at && step.at > nowMs()) setClock({ at: step.at })
  },
  'step.skip': () => advance(),
  'card.insert': ({ card }) => platform.simulation.insertCard(card, cardLabel(card)),
  'card.remove': ({ card }) => platform.simulation.removeCard(card),
  'remote.connect': () => platform.simulation.connectRemote(remoteProvider),
  'remote.disconnect': () => platform.simulation.disconnectRemote(),
  async 'cloud.reveal'() {
    await platform.training.cloudMkdir(trainingId, '/')
    platform.revealPath(await platform.joinPath(platform.simulation.paths.data, 'Nextcloud'))
  },
  'training.reset': () => resetTraining(),
  'training.end': () => endTraining(),
}

export async function command({ action, ...args } = {}) {
  const fn = COMMANDS[action]
  if (!fn) return console.warn('[training] unknown command', action)
  try {
    await fn(args)
  } catch (error) {
    console.error('[training]', action, error)
  }
  if (action.startsWith('clock.') || action.startsWith('step.')) await saveClock()
  broadcast()
}

// ── State for the control window ─────────────────────────────────────────

export function trainingState() {
  if (!scenario) return null
  const inserted = new Set(platform.simulation.cards())
  const next = nextIndex()
  return {
    id: trainingId,
    title: scenario.title ?? trainingId,
    clock: { ...snapshot(), sentAt: Date.now() },
    cards: (scenario.cards ?? []).map((c) => ({ id: c.id, label: c.label ?? c.id, inserted: inserted.has(c.id) })),
    remote: scenario.remote ? { name: remoteProvider.device.name, connected: platform.simulation.remoteConnected(),
      flown: remoteLogs().filter((l) => l.start <= nowMs()).length, total: remoteLogs().length } : null,
    steps: steps.map((s) => ({ index: s.index, at: s.at, label: s.label, action: s.action, done: s.index < next })),
    next,
  }
}

function broadcast() {
  const state = trainingState()
  window.dispatchEvent(new CustomEvent('training:state', { detail: state }))
  platform.training.emit('training:state', state).catch(() => {})
}

// At app start (application.js), only in training mode
export async function startTrainingMode() {
  if (!isTraining()) return
  document.documentElement.classList.add('mode-training')
  let resetRequested = null
  try {
    resetRequested = sessionStorage.getItem(RESET_FLAG)
    sessionStorage.removeItem(RESET_FLAG)
  } catch {
    // no session storage
  }
  if (resetRequested === trainingId) {
    await resetTraining() // reloads the window – nothing else should start meanwhile
    return new Promise(() => {})
  }
  if (platform.name !== 'tauri') (await import('/app/javascript/training_dock.js')).installDock()
  scenario = await platform.training.scenario(trainingId)
  steps = (scenario.script ?? []).map((s, index) => ({ ...s, index, at: timeOf(s.at), label: stepLabel(s) }))
  if (!Setting.get('training.initialized')) await initialize()
  setClock(Setting.get('training.clock') ?? { at: timeOf(scenario.start) })

  await platform.training.listen('training:command', (cmd) => command(cmd))
  await platform.training.listen('training:hello', () => broadcast()) // control window (re)opened
  window.addEventListener('clock:changed', () => broadcast())
  // Keep the clock saved while it runs (continue after a restart), state for the control window
  setInterval(() => {
    if (snapshot()?.running) saveClock()
    broadcast()
  }, 5000)
  broadcast()
}

export const openControl = () => platform.training.openControl(trainingId)

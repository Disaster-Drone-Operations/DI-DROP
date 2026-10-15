// Import flight logs: from the connected DJI remote controller or from a folder.
//
// Always all of them: whatever is already there (same name, same size) is skipped – there is no
// selection list. The original files stay unchanged in <media base>/Flugprotokolle.
// Progress goes to the UI as the event "flightlogs:progress" (bottom left).

import platform from '/lib/platform/index.js'
import FlightLog from '/app/models/flight_log.js'
import { mediaBaseDir } from '/app/services/media_importer.js'
import Setting from '/app/models/setting.js'

let busy = false
const asked = new Set() // ask only once per remote controller per app session

export const isAvailable = () => !!platform.flightlogs

// Raw flight controller data (MCDatFlightRecords) only on request (Settings → Flugprotokolle)
const includeDat = () => Setting.get('flightlogs.include_dat') === 'yes'

export async function flightLogDir() {
  return platform.joinPath(await mediaBaseDir(), 'Flugprotokolle')
}

function progress(detail) {
  window.dispatchEvent(new CustomEvent('flightlogs:progress', { detail }))
}

async function store(report) {
  const added = await FlightLog.addSummaries(report.summaries ?? [])
  return { added, copied: report.copied ?? 0, extras: report.extras_copied ?? 0, failed: report.failed ?? [] }
}

// From a folder (USB stick, copied FlightRecord folder, also whole drives)
export async function importFromFolder(src) {
  if (busy) throw new Error('Es werden gerade schon Flugprotokolle übernommen.')
  busy = true
  progress({ state: 'running', text: 'Flugprotokolle werden übernommen …' })
  try {
    const result = await store(await platform.flightlogs.importFolder(src, await flightLogDir(), await FlightLog.knownFileNames(), includeDat()))
    progress({ state: 'done', ...result })
    return result
  } catch (error) {
    progress({ state: 'error', text: String(error) })
    throw error
  } finally {
    busy = false
  }
}

// From the remote controller (MTP)
export async function importFromDevice(device) {
  if (busy) throw new Error('Es werden gerade schon Flugprotokolle übernommen.')
  busy = true
  progress({ state: 'running', text: `Verbinde mit ${device.name} …` })
  try {
    const report = await platform.flightlogs.deviceImport(device.key, await flightLogDir(), await FlightLog.knownFileNames(), includeDat(),
      ({ done, total }) => progress({ state: 'running', text: `Von ${device.name}: ${done} von ${total} Dateien`, done, total }))
    const result = await store(report)
    progress({ state: 'done', ...result })
    return result
  } catch (error) {
    progress({ state: 'error', text: String(error) })
    throw error
  } finally {
    busy = false
  }
}

// Files already in the folder but missing from the database (e.g. after a reinstall)
export async function syncLocal() {
  if (!isAvailable() || busy) return 0
  const report = await platform.flightlogs.scanLocal(await flightLogDir(), await FlightLog.knownFileNames())
  return (await store(report)).added
}

// Remote controller connected → new logs? → ask once → import all
async function deviceArrived(device) {
  if (busy || asked.has(device.key)) return
  let status
  try {
    status = await platform.flightlogs.deviceStatus(device.key, await flightLogDir())
  } catch (error) {
    console.warn('[flight logs]', error)
    return progress({ state: 'error', text: String(error) })
  }
  if (!status.folder || status.new === 0) return
  asked.add(device.key)
  const name = status.device.name || device.name
  const ok = await platform.confirm(
    `${name} ist angeschlossen.\n\n${status.new === 1 ? 'Ein neues Flugprotokoll' : `${status.new} neue Flugprotokolle`} gefunden. Jetzt übernehmen?`,
    { title: 'Flugprotokolle', okLabel: 'Übernehmen', cancelLabel: 'Später' },
  )
  if (!ok) return
  try {
    const { added, failed } = await importFromDevice({ ...device, name })
    const flash = failed.length
      ? { alert: `${added} Flugprotokolle übernommen, ${failed.length} nicht lesbar.` }
      : { notice: `${added} ${added === 1 ? 'Flugprotokoll' : 'Flugprotokolle'} übernommen.` }
    document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: '/flightlogs', flash } }))
  } catch {
    // The progress indicator shows the message
  }
}

// At app start: watch for connected remote controllers (including already present ones)
export function watchDevices() {
  if (!isAvailable()) return
  platform.flightlogs.onDevice((device) => deviceArrived(device)).catch((e) => console.warn('[flight logs]', e))
  // Already connected at startup: this event came before the UI was listening → check ourselves
  setTimeout(async () => {
    for (const device of await connectedDevices()) await deviceArrived(device)
  }, 3000)
}

// Import from the currently connected remote controller manually (button on the page)
export async function connectedDevices() {
  return isAvailable() ? platform.flightlogs.devices().catch(() => []) : []
}

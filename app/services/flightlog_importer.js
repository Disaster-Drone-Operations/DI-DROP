// Flugprotokolle übernehmen: von der angesteckten DJI-Fernsteuerung oder aus einem Ordner.
//
// Immer alle: Was schon da ist (gleicher Name, gleiche Größe), wird übersprungen – es gibt keine
// Auswahlliste. Die Originaldateien bleiben unverändert in <Bildablage>/Flugprotokolle.
// Fortschritt geht als Ereignis "flightlogs:progress" an die Oberfläche (unten links).

import platform from '/lib/platform/index.js'
import FlightLog from '/app/models/flight_log.js'
import { mediaBaseDir } from '/app/services/media_importer.js'
import Setting from '/app/models/setting.js'

let busy = false
const asked = new Set() // pro App-Sitzung nur einmal je Fernsteuerung nachfragen

export const isAvailable = () => !!platform.flightlogs

// Rohdaten des Flugcontrollers (MCDatFlightRecords) nur auf Wunsch (Einstellungen → Flugprotokolle)
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

// Aus einem Ordner (USB-Stick, kopierter FlightRecord-Ordner, auch ganze Datenträger)
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

// Von der Fernsteuerung (MTP)
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

// Dateien, die schon im Ordner liegen, aber in der Datenbank fehlen (z. B. nach Neuinstallation)
export async function syncLocal() {
  if (!isAvailable() || busy) return 0
  const report = await platform.flightlogs.scanLocal(await flightLogDir(), await FlightLog.knownFileNames())
  return (await store(report)).added
}

// Fernsteuerung angesteckt → neue Protokolle? → einmal nachfragen → alle übernehmen
async function deviceArrived(device) {
  if (busy || asked.has(device.key)) return
  let status
  try {
    status = await platform.flightlogs.deviceStatus(device.key, await flightLogDir())
  } catch (error) {
    console.warn('[Flugprotokolle]', error)
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
    // Meldung zeigt die Fortschrittsanzeige
  }
}

// Beim App-Start: auf angesteckte Fernsteuerungen achten (auch schon vorhandene)
export function watchDevices() {
  if (!isAvailable()) return
  platform.flightlogs.onDevice((device) => deviceArrived(device)).catch((e) => console.warn('[Flugprotokolle]', e))
  // Schon beim Start angesteckt: Diese Meldung kam, bevor die Oberfläche zuhörte → selbst nachsehen
  setTimeout(async () => {
    for (const device of await connectedDevices()) await deviceArrived(device)
  }, 3000)
}

// Gerade angesteckte Fernsteuerung von Hand übernehmen (Knopf auf der Seite)
export async function connectedDevices() {
  return isAvailable() ? platform.flightlogs.devices().catch(() => []) : []
}

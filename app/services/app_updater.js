// Auto-Update von di-drop über die GitHub-Releases (Tauri-Updater, signiert).
//
//   checkOnStartup()   beim Start leise nachsehen (höchstens alle 6 Stunden, ohne Internet: nichts)
//   findUpdate()       → { version, notes, date } oder null
//   installUpdate()    laden, installieren, di-drop neu starten
//
// Ein Update startet die App nie ungefragt neu. Laufende Uploads gehen nach dem Neustart weiter
// (die Warteschlange liegt in der Datenbank).

import platform from '/lib/platform/index.js'
import Setting from '/app/models/setting.js'
import { summary as uploadSummary } from '/app/services/upload_queue.js'

const CHECK_EVERY = 6 * 3600_000
let pending = null // gefundenes Update-Objekt des Plugins

export const isAvailable = () => !!platform.updater

export const currentVersion = () => platform.updater?.version() ?? Promise.resolve(null)

export async function findUpdate() {
  if (!isAvailable()) return null
  try {
    pending = await platform.updater.check()
  } catch (error) {
    // Noch kein veröffentlichter Release (latest.json fehlt) → es gibt schlicht nichts Neues
    if (/release JSON|404|not found/i.test(String(error))) pending = null
    else throw new Error('Update-Server nicht erreichbar – Internetverbindung prüfen.')
  }
  await Setting.set('app.update_checked_at', new Date().toISOString())
  if (!pending) return null
  return { version: pending.version, notes: (pending.body ?? '').trim(), date: pending.date ?? null }
}

// Nachfrage mit Versionshinweisen (und Hinweis auf laufende Uploads)
export async function askToInstall(info) {
  const current = await currentVersion()
  const uploads = uploadSummary()
  const busy = uploads.running || uploads.queued
    ? '\n\nEs laufen gerade Uploads – sie werden nach dem Neustart automatisch fortgesetzt.'
    : ''
  const notes = info.notes ? `\n\nNeu in dieser Version:\n${info.notes.slice(0, 900)}` : ''
  return platform.confirm(
    `di-drop ${info.version} ist verfügbar (installiert: ${current}).${notes}${busy}\n\nJetzt installieren? di-drop startet danach neu.`,
    { title: 'Update verfügbar', okLabel: 'Installieren', cancelLabel: 'Später' },
  )
}

// onProgress(text): Fortschritt für die Anzeige
export async function installUpdate(onProgress = () => {}) {
  if (!pending) await findUpdate()
  if (!pending) return false
  let total = 0
  let done = 0
  await pending.downloadAndInstall((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? 0
    if (event.event === 'Progress') {
      done += event.data.chunkLength
      onProgress(total ? `Wird geladen … ${Math.min(100, Math.round((done / total) * 100))} %` : 'Wird geladen …')
    }
    if (event.event === 'Finished') onProgress('Wird installiert …')
  })
  onProgress('di-drop startet neu …')
  await platform.updater.relaunch()
  return true
}

// Beim Start: kurz warten (die App soll erst bedienbar sein), dann leise nachsehen
export function checkOnStartup() {
  if (!isAvailable()) return
  const last = Date.parse(Setting.get('app.update_checked_at') ?? '')
  if (Number.isFinite(last) && Date.now() - last < CHECK_EVERY) return
  setTimeout(async () => {
    try {
      const info = await findUpdate()
      if (info && (await askToInstall(info))) {
        document.dispatchEvent(new CustomEvent('router:visit', { detail: { path: '/settings/updates?install=1' } }))
      }
    } catch (error) {
      console.info('Update-Prüfung nicht möglich (offline?):', error)
    }
  }, 8000)
}

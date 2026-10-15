// Auto-update of di-drop via the GitHub releases (Tauri updater, signed).
//
//   checkOnStartup()   quietly check at startup (at most every 6 hours, offline: nothing)
//   findUpdate()       → { version, notes, date } or null
//   installUpdate()    download, install, restart di-drop
//
// An update never restarts the app without asking. Running uploads continue after the restart
// (the queue lives in the database).

import platform from '/lib/platform/index.js'
import Setting from '/app/models/setting.js'
import { summary as uploadSummary } from '/app/services/upload_queue.js'

const CHECK_EVERY = 6 * 3600_000
let pending = null // update object found by the plugin

export const isAvailable = () => !!platform.updater

export const currentVersion = () => platform.updater?.version() ?? Promise.resolve(null)

export async function findUpdate() {
  if (!isAvailable()) return null
  try {
    pending = await platform.updater.check()
  } catch (error) {
    // No published release yet (latest.json missing) → there is simply nothing new
    if (/release JSON|404|not found/i.test(String(error))) pending = null
    else throw new Error('Update-Server nicht erreichbar – Internetverbindung prüfen.')
  }
  await Setting.set('app.update_checked_at', new Date().toISOString())
  if (!pending) return null
  return { version: pending.version, notes: (pending.body ?? '').trim(), date: pending.date ?? null }
}

// Confirmation with release notes (and a hint about running uploads)
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

// onProgress(text): progress for display
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

// At startup: wait briefly (the app should become usable first), then check quietly
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
      console.info('Update check not possible (offline?):', error)
    }
  }, 8000)
}

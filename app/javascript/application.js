// Einstiegspunkt der App (entspricht config/application.rb + app/javascript/application.js)

import { Application } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'
import { connect } from '/lib/db.js'
import Router from '/lib/router.js'
import routes from '/config/routes.js'
import Setting from '/app/models/setting.js'
import { install as installShortcuts } from '/app/javascript/shortcuts.js'
import { start as startUploads } from '/app/services/upload_queue.js'
import { checkOnStartup as checkForAppUpdate } from '/app/services/app_updater.js'

document.documentElement.classList.add(`platform-${platform.os}`, `runtime-${platform.name}`)

// Stimulus-Controller automatisch registrieren: folder_picker_controller.js → "folder-picker"
const stimulus = Application.start()
window.Stimulus = stimulus // zum Debuggen in der Konsole, wie in Rails
if (import.meta.env.DEV) window.platform = platform
const stimulusControllers = import.meta.glob('./controllers/*_controller.js', { eager: true, import: 'default' })
for (const [file, controller] of Object.entries(stimulusControllers)) {
  stimulus.register(file.split('/').pop().replace('_controller.js', '').replaceAll('_', '-'), controller)
}

// Route-Controller: missions_controller.js → "missions"
const controllers = Object.fromEntries(
  Object.entries(import.meta.glob('/app/controllers/*_controller.js', { eager: true, import: 'default' }))
    .map(([file, controller]) => [file.split('/').pop().replace('_controller.js', ''), controller]),
)

const element = document.getElementById('app')

try {
  await connect()
  await Setting.load()
  await new Router({ routes, controllers, element }).start()
  installShortcuts()
  startUploads().catch((error) => console.error('Upload-Warteschlange:', error))
  checkForAppUpdate()
} catch (error) {
  console.error(error)
  element.innerHTML = `<div class="boot boot--error"><strong>di-drop konnte nicht starten.</strong><pre></pre></div>`
  element.querySelector('pre').textContent = error?.stack ?? String(error)
}

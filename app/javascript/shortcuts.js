// Tastenkürzel und Menübefehle.
//
// macOS: Das native Menü (src-tauri/src/menu.rs) fängt die Kürzel ab und schickt den Befehl
//        hierher. Windows/Browser: Wir hören selbst auf die Tasten (Strg statt ⌘).
//
//   ⌘ ,   Einstellungen          ⌘ N   Neuer Auftrag        ⇧⌘ N  Neuer Einsatz
//   ⌘ O   Bilder importieren     ⌘ S   Sichern               ⌘ 1/2 Einsätze / Bilddaten
//   ⌘ [ ] Zurück / Vorwärts      ⌘ Z   Widerrufen            ⇧⌘ Z  Wiederholen (Strg+Y)
//   ⇧⌘ /  Tastaturkürzel         F11 / ⌃⌘F Vollbild
//   Pfeiltasten + Leertaste in der Bildübersicht: Bild wählen und groß anzeigen

import platform from '/lib/platform/index.js'
import Router from '/lib/router.js'
import undo from '/lib/undo.js'
import Mission from '/app/models/mission.js'

const router = () => Router.current
const currentMissionId = () => router()?.currentPath.match(/^\/missions\/(\d+)/)?.[1] ?? null
const isTextField = (el) => el?.closest?.('input, textarea, select, [contenteditable="true"]') &&
  !['checkbox', 'radio', 'button', 'submit'].includes(el.type)

function controller(identifier, selector = `[data-controller~="${identifier}"]`) {
  const el = [...document.querySelectorAll(selector)].find((e) => e.isConnected)
  return el ? window.Stimulus.getControllerForElementAndIdentifier(el, identifier) : null
}

// Wartet kurz, bis nach einem Seitenwechsel ein Controller da ist
async function waitForController(identifier, selector) {
  for (let i = 0; i < 40; i++) {
    const c = controller(identifier, selector)
    if (c) return c
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

// Einsatz für Befehle wie "Neuer Auftrag": der geöffnete, sonst der einzige aktive
async function targetMissionId() {
  const current = currentMissionId()
  if (current) return current
  const active = await Mission.active()
  if (active.length === 1) return String(active[0].id)
  router().reload({ alert: active.length ? 'Bitte zuerst einen Einsatz öffnen.' : 'Es gibt noch keinen aktiven Einsatz – leg zuerst einen an (⇧⌘N).' })
  return null
}

export async function runUndo() {
  router().reload(await undo.undo())
}

export async function runRedo() {
  router().reload(await undo.redo())
}

export const commands = {
  settings: () => router().redirectTo('/settings'),
  new_mission: () => router().redirectTo('/missions/new'),

  async new_assignment() {
    const id = await targetMissionId()
    if (!id) return
    if (router().currentPath !== `/missions/${id}`) router().redirectTo(`/missions/${id}`)
    const dialog = await waitForController('dialog', '.tasks__header [data-controller~="dialog"]')
    dialog?.open()
  },

  async import() {
    let importer = controller('media-import')
    if (!importer) {
      const id = await targetMissionId()
      if (!id) return
      router().redirectTo(`/missions/${id}`)
      importer = await waitForController('media-import')
    }
    importer?.pickFolder()
  },

  save() {
    document.querySelector('form[data-shortcut="save"]')?.requestSubmit()
  },

  module_missions: () => router().redirectTo('/'),
  module_media: () => router().redirectTo('/media'),
  back: () => history.back(),
  forward: () => history.forward(),

  // In Textfeldern: Text widerrufen; sonst: letzte Aktion der App
  undo() {
    if (isTextField(document.activeElement)) document.execCommand('undo')
    else runUndo()
  },
  redo() {
    if (isTextField(document.activeElement)) document.execCommand('redo')
    else runRedo()
  },

  fullscreen: () => platform.toggleFullscreen().catch((e) => console.error(e)),
  shortcuts: () => document.querySelector('dialog.shortcuts')?.showModal(),
}

export function run(command) {
  if (document.querySelector('dialog.gallery[open]') && !['undo', 'redo', 'fullscreen'].includes(command)) return
  commands[command]?.()
}

// Tasten → Befehl (Windows/Browser; auf dem Mac übernimmt das Menü)
function commandFor(event) {
  const mod = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  if (event.key === 'F11' || (event.ctrlKey && event.metaKey && key === 'f')) return 'fullscreen'
  if (event.key === 'F1') return 'shortcuts'
  if (!mod || event.altKey) return null
  if (event.shiftKey && (key === '?' || key === '/' || key === 'ß')) return 'shortcuts'
  return {
    ',': 'settings', n: event.shiftKey ? 'new_mission' : 'new_assignment', o: 'import', s: 'save',
    1: 'module_missions', 2: 'module_media', '[': 'back', ']': 'forward',
    z: event.shiftKey ? 'redo' : 'undo', y: 'redo',
  }[key] ?? null
}

// Pfeiltasten in der Bildübersicht: Fokus zum Nachbarbild (Leertaste/Enter öffnet es dann)
function moveInGrid(event) {
  const current = document.activeElement
  if (!current?.classList?.contains('shot__image')) return false
  const all = [...document.querySelectorAll('.shot__image')]
  const index = all.indexOf(current)
  const top = current.getBoundingClientRect().top
  const perRow = all.filter((b) => Math.abs(b.getBoundingClientRect().top - top) < 4).length || 1
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow }[event.key]
  if (!step) return false
  const target = all[index + step]
  if (target) {
    target.focus()
    target.scrollIntoView({ block: 'nearest' })
  }
  return true
}

export function install() {
  platform.onMenu?.((command) => run(command))

  document.addEventListener('keydown', (event) => {
    if (!document.querySelector('dialog[open]') && moveInGrid(event)) {
      event.preventDefault()
      return
    }
    if (platform.nativeMenu) return // macOS: Menü hat die Kürzel schon behandelt
    const command = commandFor(event)
    if (!command) return
    // Text-Kürzel (Strg+Z in einem Feld) dem Feld überlassen, außer es sind App-Befehle
    if ((command === 'undo' || command === 'redo') && isTextField(event.target)) return
    event.preventDefault()
    run(command)
  })
}

// Platform adapter: encapsulates everything that differs between desktop (Tauri) and
// browser. App code only talks to `platform`, never directly to Tauri.
//
// Every adapter provides:
//   name                   'tauri' | 'browser'
//   os                     'macos' | 'windows' | 'linux' | 'other'
//   openDatabase()         → { select(sql, params), execute(sql, params) }
//   confirm(message, opts) → Promise<boolean>
//   pickFolder(opts)       → Promise<string|null>   (null = canceled / not available)
//   pickFiles(opts)        → Promise<string[]>
//   joinPath(...parts)     → Promise<string>
//   defaultMediaDir()      → Promise<string>        default storage for images
//   readImage(path)        → Promise<Blob>          read an image file (canvas processing)
//   writeImage(path, blob) → Promise<string>        save, returns the actual path
//   renameFile(from, to)   → Promise<string>        rename within the same folder, returns the new path
//   renameDir(from, to)    → Promise<string>        rename a folder, returns the new path
//   nativeMenu             true if a native menu handles the keyboard shortcuts (macOS)
//   onMenu(handler)        commands from the native menu
//   toggleFullscreen()     window full screen on/off
//   openUrl(url)           open a web page in the browser (https only)
//   cloudflare             Cloudflare API for setting up the relay – null in the browser
//   openPath(path)         → opens with the default application (Preview, Finder …)
//   revealPath(path)       → shows the file in Finder/Explorer
//   media                  image import (scan, import, thumbUrl, onDragDrop) – null in the browser
//   capabilities           { folders: bool, media: bool }
//   training               training mode: scenarios, simulated cards/cloud, control window (null in the browser)
//   simulation             only in training mode: insert cards, connect the remote controller (simulation.js)

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function detectOS() {
  const ua = navigator.userAgent
  if (/Mac/.test(ua)) return 'macos'
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux/.test(ua)) return 'linux'
  return 'other'
}

// ?bridge in the dev server: browser + real Rust code (for testing only)
const useDevBridge = !isTauri && import.meta.env.DEV && new URLSearchParams(location.search).has('bridge')

const adapter = isTauri
  ? (await import('./tauri.js')).default
  : useDevBridge
    ? (await import('./dev_bridge.js')).default
    : (await import('./browser.js')).default

// Training mode: ?training=<scenario> (main window) – own data, simulated devices (simulation.js).
// ?control=<scenario>: the trainer's control window (app/javascript/control.js).
const params = new URLSearchParams(location.search)
export const controlId = params.get('control')
export let trainingError = null

let base = adapter
if (params.get('training') && adapter.training) {
  try {
    base = await (await import('./simulation.js')).withSimulation(adapter, params.get('training'))
  } catch (error) {
    // e.g. scenario no longer installed → normal mode (never fall back to real data silently in
    // training: the caller shows trainingError and offers to leave)
    trainingError = String(error?.message ?? error)
    console.error('[training]', error)
  }
}
export const trainingId = base.trainingId ?? null

export const platform = { os: detectOS(), ...base }
export default platform

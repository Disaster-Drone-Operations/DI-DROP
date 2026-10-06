// Platform-Adapter: kapselt alles, was zwischen Desktop (Tauri) und Browser
// unterschiedlich ist. App-Code spricht nur mit `platform`, nie direkt mit Tauri.
//
// Jeder Adapter liefert:
//   name                   'tauri' | 'browser'
//   os                     'macos' | 'windows' | 'linux' | 'other'
//   openDatabase()         → { select(sql, params), execute(sql, params) }
//   confirm(message, opts) → Promise<boolean>
//   pickFolder(opts)       → Promise<string|null>   (null = abgebrochen / nicht verfügbar)
//   capabilities           { folders: bool, ... }

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function detectOS() {
  const ua = navigator.userAgent
  if (/Mac/.test(ua)) return 'macos'
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux/.test(ua)) return 'linux'
  return 'other'
}

const adapter = isTauri
  ? (await import('./tauri.js')).default
  : (await import('./browser.js')).default

export const platform = { os: detectOS(), ...adapter }
export default platform

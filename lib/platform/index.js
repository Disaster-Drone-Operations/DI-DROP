// Platform-Adapter: kapselt alles, was zwischen Desktop (Tauri) und Browser
// unterschiedlich ist. App-Code spricht nur mit `platform`, nie direkt mit Tauri.
//
// Jeder Adapter liefert:
//   name                   'tauri' | 'browser'
//   os                     'macos' | 'windows' | 'linux' | 'other'
//   openDatabase()         → { select(sql, params), execute(sql, params) }
//   confirm(message, opts) → Promise<boolean>
//   pickFolder(opts)       → Promise<string|null>   (null = abgebrochen / nicht verfügbar)
//   pickFiles(opts)        → Promise<string[]>
//   joinPath(...parts)     → Promise<string>
//   defaultMediaDir()      → Promise<string>        Standard-Ablage für Bilder
//   readImage(path)        → Promise<Blob>          Bilddatei lesen (Canvas-Bearbeitung)
//   writeImage(path, blob) → Promise<string>        speichern, liefert tatsächlichen Pfad
//   renameFile(from, to)   → Promise<string>        im selben Ordner umbenennen, liefert neuen Pfad
//   renameDir(from, to)    → Promise<string>        Ordner umbenennen, liefert neuen Pfad
//   nativeMenu             true, wenn ein natives Menü die Tastenkürzel übernimmt (macOS)
//   onMenu(handler)        Befehle aus dem nativen Menü
//   toggleFullscreen()     Fenster-Vollbild an/aus
//   openUrl(url)           Webseite im Browser öffnen (nur https)
//   cloudflare             Cloudflare-API für die Relay-Einrichtung – null im Browser
//   openPath(path)         → öffnet mit Standardprogramm (Vorschau, Finder …)
//   revealPath(path)       → zeigt Datei im Finder/Explorer
//   media                  Bildimport (scan, import, thumbUrl, onDragDrop) – null im Browser
//   capabilities           { folders: bool, media: bool }

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function detectOS() {
  const ua = navigator.userAgent
  if (/Mac/.test(ua)) return 'macos'
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux/.test(ua)) return 'linux'
  return 'other'
}

// ?bridge im Dev-Server: Browser + echter Rust-Code (nur zum Testen)
const useDevBridge = !isTauri && import.meta.env.DEV && new URLSearchParams(location.search).has('bridge')

const adapter = isTauri
  ? (await import('./tauri.js')).default
  : useDevBridge
    ? (await import('./dev_bridge.js')).default
    : (await import('./browser.js')).default

export const platform = { os: detectOS(), ...adapter }
export default platform

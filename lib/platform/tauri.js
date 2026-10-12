import Database from '@tauri-apps/plugin-sql'
import { ask, open } from '@tauri-apps/plugin-dialog'
import { invoke, Channel, convertFileSrc } from '@tauri-apps/api/core'
import { join, pictureDir } from '@tauri-apps/api/path'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'

const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'JPG', 'JPEG', 'dng', 'DNG', 'mp4', 'MP4', 'mov', 'MOV']

export default {
  name: 'tauri',
  capabilities: { folders: true, media: true },

  // Die Datei liegt im App-Datenverzeichnis, z. B.
  // macOS:   ~/Library/Application Support/app.didrop.desktop/di-drop.db
  // Windows: %APPDATA%\app.didrop.desktop\di-drop.db
  async openDatabase() {
    const db = await Database.load('sqlite:di-drop.db')
    return {
      select: (sql, params = []) => db.select(sql, params),
      execute: (sql, params = []) => db.execute(sql, params),
    }
  },

  confirm(message, { title = 'di-drop', okLabel = 'OK', cancelLabel = 'Abbrechen' } = {}) {
    return ask(message, { title, kind: 'warning', okLabel, cancelLabel })
  },

  async pickFolder({ title = 'Ordner auswählen', defaultPath } = {}) {
    const result = await open({ directory: true, multiple: false, title, defaultPath: defaultPath || undefined })
    return typeof result === 'string' ? result : null
  },

  async pickFiles({ title = 'Dateien auswählen' } = {}) {
    const result = await open({ multiple: true, title, filters: [{ name: 'Bilder & Videos', extensions: MEDIA_EXTENSIONS }] })
    return result ?? []
  },

  joinPath: (...parts) => join(...parts),
  defaultMediaDir: async () => join(await pictureDir(), 'di-drop'),

  // Bilddatei lesen (für Canvas-Bearbeitung) → Blob
  async readImage(path) {
    const bytes = await invoke('read_image', { path })
    return new Blob([bytes], { type: /\.png$/i.test(path) ? 'image/png' : 'image/jpeg' })
  },

  // Bild speichern; gibt den tatsächlichen Pfad zurück (bei Namenskonflikt "_2" …)
  async writeImage(path, blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return invoke('write_image', bytes, { headers: { 'x-path': encodeURIComponent(path) } })
  },

  // Datei im selben Ordner umbenennen; liefert den tatsächlichen Pfad (bei Belegung "_2" …)
  renameFile: (from, to) => invoke('rename_file', { from, to }),

  renameDir: (from, to) => invoke('rename_dir', { from, to }),
  // macOS: App-Menü schickt Befehle ("settings", "new_assignment" …)
  nativeMenu: navigator.userAgent.includes('Mac'),
  onMenu: (handler) => listen('menu', ({ payload }) => handler(payload)),

  async toggleFullscreen() {
    const win = getCurrentWindow()
    await win.setFullscreen(!(await win.isFullscreen()))
  },

  openUrl: (url) => invoke('open_url', { url }),

  // Cloudflare (Einrichtung des Standort-Relays). Der Token bleibt im Schlüsselbund.
  cloudflare: {
    setToken: (token) => invoke('cf_set_token', { token }),
    hasToken: () => invoke('cf_has_token'),
    deleteToken: () => invoke('cf_delete_token'),
    api: (method, path, body = null) => invoke('cf_api', { method, path, body }),
    uploadWorker: (accountId, scriptName, metadata, script) =>
      invoke('cf_upload_worker', { accountId, scriptName, metadata, script }),
  },

  openPath: (path) => invoke('open_path', { path }),
  revealPath: (path) => invoke('reveal_path', { path }),

  media: {
    scan: (paths) => invoke('scan_media', { paths }),

    import(items, onProgress) {
      const channel = new Channel()
      channel.onmessage = onProgress
      return invoke('import_media', { items, onProgress: channel })
    },

    thumbUrl: (path) => (path ? convertFileSrc(path) : null),

    // Dateien/Ordner, die aufs Fenster gezogen werden. handler({ type, paths, x, y })
    // type: 'enter' | 'over' | 'drop' | 'leave'; x/y in CSS-Pixeln
    async onDragDrop(handler) {
      return getCurrentWebview().onDragDropEvent(({ payload }) => {
        const ratio = window.devicePixelRatio || 1
        handler({
          type: payload.type,
          paths: payload.paths ?? [],
          x: payload.position ? payload.position.x / ratio : null,
          y: payload.position ? payload.position.y / ratio : null,
        })
      })
    },
  },
}

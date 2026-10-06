import Database from '@tauri-apps/plugin-sql'
import { ask, open } from '@tauri-apps/plugin-dialog'

export default {
  name: 'tauri',
  capabilities: { folders: true },

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
}

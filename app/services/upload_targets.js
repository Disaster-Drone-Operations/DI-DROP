// Ziele für das Bereitstellen. Ein neues Ziel = ein neuer Eintrag hier (+ Übertragung in
// src-tauri/src/transfer und lib/platform). Die Warteschlange (upload_queue.js) kennt nur:
//
//   available()                       gibt es das Ziel auf dieser Plattform?
//   status()                          { ready, text, setupPath? } – eingerichtet?
//   missionBase(mission)              Vorschlag für den Basisordner des Einsatzes
//   join(...teile)                    Zielpfad zusammensetzen
//   transfer(item, id, onProgress)    Datei übertragen → { bytes, skipped, name }
//                                     (nie überschreiben; name = Ausweichname wie "…_2.JPG")
//   cancel(id)                        laufende Übertragung abbrechen
//   mirrorDepth                       so viele letzte Pfadteile spiegeln den lokalen Pfad
//                                     (für Umbenennungen nach dem Einreihen)

import platform from '/lib/platform/index.js'
import Setting from '/app/models/setting.js'

const joinSlash = (...parts) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/')
const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export const TARGETS = {
  nextcloud: {
    key: 'nextcloud',
    label: 'Nextcloud',
    icon: 'cloud',
    action: 'In die Nextcloud hochladen',
    mirrorDepth: 2, // <Einsatz-Basisordner>/<Auftragsordner>/<Datei>
    available: () => !!platform.nextcloud,
    async status() {
      const account = await platform.nextcloud.account().catch(() => null)
      if (!account) return { ready: false, text: 'Noch keine Nextcloud eingerichtet.', setupPath: '/settings/nextcloud' }
      return { ready: true, text: `${account.login_name} · ${hostOf(account.server)}` }
    },
    // Basisordner wird pro Einsatz festgelegt (Einsatz bearbeiten oder beim ersten Hochladen)
    missionBase(mission) {
      return mission.nextcloud_path || null
    },
    join: (...parts) => joinSlash(...parts),
    // Ordner und Dateiname getrennt: Rust schreibt ausschließlich in diesen Ordner
    transfer(item, id, onProgress) {
      const cut = item.dest_path.lastIndexOf('/')
      return platform.transfer.nextcloud(id, item.source_path, item.dest_path.slice(0, cut), item.dest_path.slice(cut + 1), onProgress)
    },
    cancel: (id) => platform.transfer.cancel(id),
  },

  folder: {
    key: 'folder',
    label: 'Ordner / USB-Stick',
    icon: 'folder',
    action: 'In Ordner exportieren',
    mirrorDepth: 3, // <Zielordner>/<Einsatzordner>/<Auftragsordner>/<Datei>
    available: () => !!platform.transfer,
    async status() {
      return { ready: true, text: '' }
    },
    // Zuletzt gewählter Ordner (z. B. der USB-Stick); darin entsteht der Einsatzordner
    missionBase(mission) {
      const base = Setting.get('uploads.folder_path')
      return base ? joinSlash(base, mission.folderName) : null
    },
    join: (...parts) => joinSlash(...parts),
    transfer: (item, id, onProgress) => platform.transfer.copy(id, item.source_path, item.dest_path, onProgress),
    cancel: (id) => platform.transfer.cancel(id),
  },
}

export const availableTargets = () => Object.values(TARGETS).filter((t) => t.available())

// Ordnername des Auftrags (wie auf der Festplatte): "2026_10_11__13_08_Kontrollflug 3"
export function assignmentFolderName(assignment) {
  return assignment.media_dir?.split(/[\\/]/).filter(Boolean).pop() ?? assignment.title
}

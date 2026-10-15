// Targets for provisioning. A new target = a new entry here (+ transfer in
// src-tauri/src/transfer and lib/platform). The queue (upload_queue.js) only knows:
//
//   available()                       does the target exist on this platform?
//   status()                          { ready, text, setupPath? } – set up?
//   missionBase(mission)              suggestion for the mission's base folder
//   join(...parts)                    build the target path
//   transfer(item, id, onProgress)    transfer a file → { bytes, skipped, name }
//                                     (never overwrite; name = fallback name like "…_2.JPG")
//   cancel(id)                        cancel a running transfer
//   mirrorDepth                       this many trailing path parts mirror the local path
//                                     (for renames after enqueueing)

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
    mirrorDepth: 2, // <mission base folder>/<assignment folder>/<file>
    available: () => !!platform.nextcloud,
    async status() {
      const account = await platform.nextcloud.account().catch(() => null)
      if (!account) return { ready: false, text: 'Noch keine Nextcloud eingerichtet.', setupPath: '/settings/nextcloud' }
      return { ready: true, text: `${account.login_name} · ${hostOf(account.server)}` }
    },
    // The base folder is set per mission (edit mission or on first upload)
    missionBase(mission) {
      return mission.nextcloud_path || null
    },
    join: (...parts) => joinSlash(...parts),
    // Folder and file name separately: Rust writes exclusively into this folder
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
    mirrorDepth: 3, // <target folder>/<mission folder>/<assignment folder>/<file>
    available: () => !!platform.transfer,
    async status() {
      return { ready: true, text: '' }
    },
    // Last chosen folder (e.g. the USB stick); the mission folder is created inside it
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

// Folder name of the assignment (as on disk): "2026_10_11__13_08_Kontrollflug 3"
export function assignmentFolderName(assignment) {
  return assignment.media_dir?.split(/[\\/]/).filter(Boolean).pop() ?? assignment.title
}

// Training mode (index.html?training=<scenario>): wraps the real platform adapter.
//   - own database and image folder (<app data>/Schulung/Daten/<id>/)
//   - simulated SD cards, remote controller and Nextcloud instead of the real ones
//   - no app updates
// What is inserted/connected when is decided by app/services/training.js via `platform.simulation`.

const CLOUD_BYTES_PER_S = 2 * 1024 * 1024 // simulated upload speed (progress and ETA stay visible)

export async function withSimulation(base, id) {
  const paths = await base.training.paths(id) // { scenario, data, database }
  const handlers = { inserted: new Set(), removed: new Set(), device: new Set(), deviceRemoved: new Set() }
  const on = (set) => async (handler) => {
    set.add(handler)
    return () => set.delete(handler)
  }
  const cards = new Map() // card id → { root, name, dcim }
  let remote = null // { device, status(dest, known), import(dest, known, includeDat, onProgress) } – see training.js

  const simulation = {
    id,
    paths,
    cards: () => [...cards.keys()],
    remoteConnected: () => !!remote,

    async insertCard(card, label) {
      if (cards.has(card)) return
      const root = await base.training.card(id, card)
      const entry = { root, name: `Simulierte Karte – ${label}`, dcim: await base.joinPath(root, 'DCIM') }
      cards.set(card, entry)
      handlers.inserted.forEach((h) => h(entry))
    },
    removeCard(card) {
      const entry = cards.get(card)
      if (!entry) return
      cards.delete(card)
      handlers.removed.forEach((h) => h(entry))
    },
    connectRemote(provider) {
      remote = provider
      handlers.device.forEach((h) => h(provider.device))
    },
    disconnectRemote() {
      if (!remote) return
      const { device } = remote
      remote = null
      handlers.deviceRemoved.forEach((h) => h(device))
    },
  }

  const notConnected = () => Promise.reject('Die simulierte Fernsteuerung ist nicht angeschlossen.')

  return {
    ...base,
    trainingId: id,
    simulation,
    updater: null,

    openDatabase: () => base.openDatabase(base.name === 'tauri' ? { file: paths.database } : { key: `training:${id}` }),
    defaultMediaDir: () => base.joinPath(paths.data, 'Bilder'),

    // Simulated SD cards (copies in Daten/<id>/Karten – deleting really happens there, checked by Rust)
    sdcard: {
      list: async () => [...cards.values()],
      delete: (root, items, companions) => base.sdcard.delete(root, items, companions),
      onInserted: on(handlers.inserted),
      onRemoved: on(handlers.removed),
    },

    // Simulated remote controller; folder import (Rust) stays as it is
    flightlogs: base.flightlogs && {
      ...base.flightlogs,
      devices: async () => (remote ? [remote.device] : []),
      deviceStatus: (key, dest) => (remote ? remote.status(dest) : notConnected()),
      deviceImport: (key, dest, known, includeDat, onProgress) =>
        remote ? remote.import(dest, known, includeDat, onProgress) : notConnected(),
      onDevice: on(handlers.device),
      onDeviceRemoved: on(handlers.deviceRemoved),
    },

    // Simulated Nextcloud = folder Daten/<id>/Nextcloud; same rules (never overwrite, "_2")
    nextcloud: {
      account: async () => ({ server: 'https://nextcloud.schulung', login_name: 'Simulierte Nextcloud', user_id: 'schulung' }),
      test: async () => ({ ok: true }),
      forget: async () => {},
      loginStart: () => Promise.reject('Im Schulungsmodus ist die Nextcloud simuliert – keine Anmeldung nötig.'),
      loginPoll: () => Promise.reject('Im Schulungsmodus nicht nötig.'),
      loginManual: () => Promise.reject('Im Schulungsmodus nicht nötig.'),
      list: (path) => base.training.cloudList(id, path),
      mkdir: (path) => base.training.cloudMkdir(id, path),
    },
    transfer: base.transfer && {
      ...base.transfer,
      async nextcloud(transferId, src, dir, fileName, onProgress) {
        const dest = await base.training.cloudPath(id, dir, fileName)
        return base.transfer.copy(transferId, src, dest, onProgress, { throttle: CLOUD_BYTES_PER_S })
      },
    },
  }
}

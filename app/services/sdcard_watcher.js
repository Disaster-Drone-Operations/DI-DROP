// Memory card inserted → new images on it? → open the import dialog on the right mission page.
//
// "New" means: not imported into any mission yet. Which mission:
//   the mission page that is open (if active) → the only active mission → the most recent active
//   one (the dialog offers to switch) → none active: offer to create a new mission first.
// The dialog itself (media_import_controller) picks the card up with takePendingCard().

import platform from '/lib/platform/index.js'
import { Router } from '/lib/router.js'
import { db } from '/lib/db.js'
import Mission from '/app/models/mission.js'
import MediaFile from '/app/models/media_file.js'

// { card, scanned, missionId, newerThan } – waiting for the mission page
let pending = null
// card root → number of new files we already asked about (don't ask again for the same card)
const asked = new Map()
let checking = false

export const isAvailable = () => !!platform.sdcard

// For the media import controller: the card waiting for this mission (taken only once)
export function takePendingCard(missionId) {
  if (!pending) return null
  const fits = pending.missionId === missionId || (pending.newerThan != null && missionId > pending.newerThan)
  if (!fits) return null
  const { card, scanned } = pending
  pending = null
  return { card, scanned }
}

// Open the card on another mission's page (switch in the dialog)
export function showCardIn(missionId, card, scanned) {
  pending = { card, scanned, missionId }
  visit(`/missions/${missionId}`)
}

function visit(path) {
  const router = Router.current
  if (router?.currentPath === path) {
    // Same page: the controller is already there
    document.dispatchEvent(new CustomEvent('sdcard:pending'))
  } else {
    document.dispatchEvent(new CustomEvent('router:visit', { detail: { path } }))
  }
}

async function newFiles(scanned) {
  const known = await MediaFile.findByFingerprints(scanned.files.map((f) => f.fingerprint), null)
  return scanned.files.filter((f) => !known.has(f.fingerprint))
}

// Mission of the page that is currently open: "/missions/12", "/missions/12/assignments/3"
function currentMissionId() {
  const match = Router.current?.currentPath.match(/^\/missions\/(\d+)/)
  return match ? Number(match[1]) : null
}

async function cardInserted(card) {
  if (checking || document.querySelector('.import-dialog[open]')) return
  checking = true
  try {
    const scanned = await platform.media.scan([card.dcim])
    const fresh = await newFiles(scanned)
    if (!fresh.length || asked.get(card.root) === fresh.length) return
    asked.set(card.root, fresh.length)

    const missions = await Mission.active()
    const current = missions.find((m) => m.id === currentMissionId())
    const mission = current ?? missions[0]
    if (mission) {
      pending = { card, scanned, missionId: mission.id }
      return visit(`/missions/${mission.id}`)
    }

    const ok = await platform.confirm(
      `Neue Speicherkarte „${card.name}“ mit ${fresh.length === 1 ? 'einer neuen Datei' : `${fresh.length} neuen Dateien`}.\n\n` +
        'Es läuft gerade kein Einsatz. Jetzt einen neuen Einsatz anlegen und die Bilder danach importieren?',
      { title: 'Neue SD-Karte erkannt', okLabel: 'Neuer Einsatz', cancelLabel: 'Später' },
    )
    if (!ok) return
    const [{ max }] = await db.select('SELECT COALESCE(MAX(id), 0) AS max FROM missions')
    pending = { card, scanned, missionId: null, newerThan: max } // the mission that is created next
    visit('/missions/new')
  } catch (error) {
    console.warn('[sdcard]', error)
  } finally {
    checking = false
  }
}

// At app start: watch for inserted cards (and check cards that are already inserted)
export function watchCards() {
  if (!isAvailable()) return
  platform.sdcard.onInserted((card) => cardInserted(card)).catch((e) => console.warn('[sdcard]', e))
  platform.sdcard.onRemoved((card) => {
    asked.delete(card.root)
    if (pending?.card.root === card.root) pending = null
    document.dispatchEvent(new CustomEvent('sdcard:removed', { detail: card }))
  }).catch((e) => console.warn('[sdcard]', e))
  setTimeout(async () => {
    for (const card of await platform.sdcard.list().catch(() => [])) await cardInserted(card)
  }, 3000)
}

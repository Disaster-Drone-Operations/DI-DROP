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
import { showNotice } from '/app/services/notice.js'

// { card, scanned, missionId, newerThan } – waiting for the mission page
let pending = null
// Cards inserted right now (sidebar, „Auswerfen“) – event "sdcard:changed" on changes
let cards = []
// card root → number of new files we already asked about (don't ask again for the same card)
const asked = new Map()
let checking = false

export const isAvailable = () => !!platform.sdcard

export const insertedCards = () => cards

function setCards(list) {
  cards = list
  document.dispatchEvent(new CustomEvent('sdcard:changed'))
}

// „Auswerfen“ → null, or the reason it didn't work. Says so itself (notice), unless quiet:
// the import („Anschließend auswerfen“) puts the result into its own message.
export async function ejectCard(root, { quiet = false } = {}) {
  const card = cards.find((c) => c.root === root)
  const fail = (text) => (quiet || showNotice(text, { alert: true, delay: 10000 }), text)
  if (!quiet && document.querySelector('.import-dialog[open]')) return fail('Erst den Import abschließen, dann die Karte auswerfen.')
  try {
    await platform.sdcard.eject(root)
  } catch (error) {
    return fail(error?.message ?? String(error))
  }
  setCards(cards.filter((c) => c.root !== root)) // right away – the watcher follows
  if (!quiet) showNotice(`„${card?.name ?? 'SD-Karte'}“ ausgeworfen – die Karte kann jetzt entnommen werden.`)
  return null
}

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

// → { fresh: files not imported into any mission, known: Map(fingerprint → imported copy) }
async function checkFiles(scanned) {
  const known = await MediaFile.findByFingerprints(scanned.files.map((f) => f.fingerprint), null)
  return { fresh: scanned.files.filter((f) => !known.has(f.fingerprint)), known }
}

// Everything on the card is already imported → offer to clear the card. Rust compares every file
// with its imported copy (size + fingerprint) before deleting it; RTK raw data goes along.
async function offerCleanup(card, scanned, known) {
  const files = scanned.files.filter((f) => known.has(f.fingerprint))
  const missions = [...new Set(files.map((f) => known.get(f.fingerprint).mission_title))]
  const ok = await platform.confirm(
    `Alle ${files.length === 1 ? 'Dateien' : `${files.length} Dateien`} auf der Karte „${card.name}“ sind schon importiert` +
      `${missions.length ? ` (${missions.map((t) => `„${t}“`).join(', ')})` : ''}.\n\n` +
      'Von der Karte löschen? Jede Datei wird vorher mit ihrer importierten Kopie verglichen – was nicht übereinstimmt, bleibt auf der Karte.',
    { title: 'SD-Karte aufräumen', okLabel: 'Von der Karte löschen', cancelLabel: 'Behalten' },
  )
  if (!ok) return
  const items = files.map((f) => ({ src: f.path, copy: known.get(f.fingerprint).path }))
  try {
    const { deleted, kept } = await platform.sdcard.delete(card.root, items, true)
    if (!kept.length) return showNotice(`${deleted.length} ${deleted.length === 1 ? 'Datei' : 'Dateien'} von der Karte „${card.name}“ gelöscht.`)
    const reasons = [...new Set(kept.map((k) => k.reason))].slice(0, 2).join('; ')
    showNotice(`${deleted.length} gelöscht, ${kept.length} ${kept.length === 1 ? 'blieb' : 'blieben'} auf der Karte (${reasons}).`, { alert: true, delay: 10000 })
  } catch (error) {
    showNotice(`Karte nicht aufgeräumt: ${error?.message ?? error}`, { alert: true, delay: 10000 })
  }
}

// Mission of the page that is currently open: "/missions/12", "/missions/12/assignments/3"
function currentMissionId() {
  const match = Router.current?.currentPath.match(/^\/missions\/(\d+)/)
  return match ? Number(match[1]) : null
}

// atStartup: card was already there when di-drop started → only speak up if there is something new
// An open import dialog blocks it – unless it only shows an error (e.g. "Speicherkarte wurde entfernt")
async function cardInserted(card, { atStartup = false } = {}) {
  if (checking || document.querySelector('.import-dialog[open]:not([data-state="error"])')) return
  checking = true
  try {
    const scanned = await platform.media.scan([card.dcim])
    const { fresh, known } = await checkFiles(scanned)
    if (asked.get(card.root) === fresh.length) return
    asked.set(card.root, fresh.length)
    // Nothing new: offer to clear the card – otherwise it looks as if the card wasn't detected
    if (!fresh.length) {
      if (atStartup) return
      if (scanned.files.length) return offerCleanup(card, scanned, known)
      return showNotice(`SD-Karte „${card.name}“ erkannt – keine Bilder darauf.`, { delay: 7000 })
    }

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
  platform.sdcard.onInserted((card) => {
    setCards([...cards.filter((c) => c.root !== card.root), card])
    cardInserted(card)
  }).catch((e) => console.warn('[sdcard]', e))
  platform.sdcard.onRemoved((card) => {
    setCards(cards.filter((c) => c.root !== card.root))
    asked.delete(card.root)
    if (pending?.card.root === card.root) pending = null
    document.dispatchEvent(new CustomEvent('sdcard:removed', { detail: card }))
  }).catch((e) => console.warn('[sdcard]', e))
  platform.sdcard.list().then(setCards).catch(() => {})
  setTimeout(async () => {
    for (const card of await platform.sdcard.list().catch(() => [])) await cardInserted(card, { atStartup: true })
  }, 3000)
}

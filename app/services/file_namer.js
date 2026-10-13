// Sprechende Dateinamen für importierte Bilder:
//
//   2026_09_11__13_31_Ost_1_Wärmebild.JPG
//   └ Datum ┘  └Zeit┘ └Wegp.┘ └Bildtyp┘
//
// Keine Leerzeichen in Datei- und Ordnernamen (sanitizeFolderName macht daraus "_").
//
// Mehrere Aufnahmen derselben Stelle in derselben Minute → "_2", "_3" …
//
// Die Namen werden nachgezogen, sobald sich der Wegpunkt-Name ändert (Umbenennen,
// oder "Ost" → "Ost_1", weil ein zweiter Ost-Wegpunkt dazukam). Vergleichsbilder ebenso.
// Den Originalnamen der Drohne behält die Datenbank (original_name).

import platform from '/lib/platform/index.js'
import { db } from '/lib/db.js'
import { sanitizeFolderName, dateTimeFolder } from '/lib/folders.js'
import MediaFile from '/app/models/media_file.js'
import Viewpoint from '/app/models/viewpoint.js'
import Comparison from '/app/models/comparison.js'
import Assignment from '/app/models/assignment.js'
import Mission from '/app/models/mission.js'

const VARIANT_WORDS = { T: 'Wärmebild', V: 'Sichtbild', W: 'Weitwinkel', Z: 'Zoom' }

const splitPath = (path) => {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return { dir: path.slice(0, i), sep: path[i], name: path.slice(i + 1) }
}
const extOf = (name) => name.match(/\.[^.]+$/)?.[0] ?? ''

// "2026-09-11T13:31:52" → "2026_09_11__13_31"
const stampOf = (takenAt) => `${takenAt.slice(0, 10).replaceAll('-', '_')}__${takenAt.slice(11, 13)}_${takenAt.slice(14, 16)}`

// shotTime: Zeit der Aufnahme (früheste Datei) – Wärme- und Sichtbild lösen teils eine
// Sekunde versetzt aus, sollen aber denselben Zeitstempel tragen und nebeneinander stehen
export function desiredName(file, viewpointName, shotTime = file.taken_at) {
  if (!shotTime || shotTime.length < 16) return null
  const kind = file.kind === 'video' ? 'Video' : VARIANT_WORDS[file.variant] ?? null
  const parts = [stampOf(shotTime), viewpointName ? sanitizeFolderName(viewpointName) : null, kind]
  return parts.filter(Boolean).join('_') + extOf(splitPath(file.path).name)
}

// Passt der aktuelle Name schon? (auch mit "_2"-Zusatz bei Namensgleichheit)
function fits(current, wanted) {
  if (current === wanted) return true
  const ext = extOf(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  return current.startsWith(`${stem}_`) && current.endsWith(ext) && /^\d+$/.test(current.slice(stem.length + 1, current.length - ext.length))
}

// Einsatzordner "2026_09_11__B3_Musterdorf" (Datum + Stichwort) und Ordner der Aufträge
// "2026_09_11__13_57_Kontrollflug_3" (Zeit der ersten Aufnahme + Auftrag).
// Umbenannt werden nur Ordner, die die App selbst angelegt hat: direkt im Einsatzordner
// und mit Datum am Anfang. Alle gespeicherten Pfade ziehen mit.
async function syncFolderNames(missionId, changes) {
  const mission = await Mission.find(missionId)
  if (!mission.media_dir) return
  await syncMissionFolder(mission, changes)
  const titles = new Map((await Assignment.forMission(missionId)).map((a) => [a.id, a.title]))
  const files = await MediaFile.where('mission_id = ?', [missionId], { order: 'taken_at ASC' })

  const byDir = new Map()
  for (const f of files) {
    const { dir } = splitPath(f.path)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(f)
  }

  for (const [dir, group] of byDir) {
    const { dir: parent, sep, name: folder } = splitPath(dir)
    if (parent !== mission.media_dir || !/^\d{4}_\d{2}_\d{2}__/.test(folder)) continue
    const start = group.map((f) => f.taken_at).filter(Boolean).sort()[0]
    const title = titles.get(group[0].assignment_id)
    if (!start || !title) continue
    const wanted = `${dateTimeFolder(start.slice(0, 16))}_${sanitizeFolderName(title)}`
    if (folder === wanted || new RegExp(`^${escapeRegExp(wanted)}_\\d+$`).test(folder)) continue

    let target
    try {
      target = await platform.renameDir(dir, `${parent}${sep}${wanted}`)
    } catch (error) {
      console.warn('[Ordnernamen]', dir, '→', wanted, error)
      continue
    }
    const now = new Date().toISOString()
    const move = (path) => target + path.slice(dir.length)
    for (const f of group) {
      await db.execute('UPDATE media_files SET path = ?, updated_at = ? WHERE id = ?', [move(f.path), now, f.id])
      changes.push({ from: f.path, to: move(f.path) })
    }
    for (const c of await Comparison.forMission(missionId)) {
      if (c.path.startsWith(dir + sep)) {
        await c.update({ path: move(c.path) })
        changes.push({ from: c.path, to: move(c.path) })
      }
    }
    await db.execute('UPDATE assignments SET media_dir = ? WHERE mission_id = ? AND media_dir = ?', [target, missionId, dir])
  }
}

// Einsatzordner nachziehen (Stichwort/Datum geändert, alte Namen mit Leerzeichen).
// Nur Ordner, die die App selbst angelegt hat (Datum am Anfang). Alle Pfade ziehen mit.
async function syncMissionFolder(mission, changes) {
  const dir = mission.media_dir
  const { dir: parent, sep, name: folder } = splitPath(dir)
  const wanted = mission.folderName
  if (!/^\d{4}_\d{2}_\d{2}__/.test(folder) || folder === wanted || new RegExp(`^${escapeRegExp(wanted)}_\\d+$`).test(folder)) return

  let target
  try {
    target = await platform.renameDir(dir, `${parent}${sep}${wanted}`)
  } catch (error) {
    console.warn('[Einsatzordner]', dir, '→', wanted, error)
    return
  }
  const now = new Date().toISOString()
  const inside = (path) => path === dir || path?.startsWith(dir + sep)
  const move = (path) => target + path.slice(dir.length)
  for (const f of await MediaFile.where('mission_id = ?', [mission.id])) {
    if (!inside(f.path)) continue
    await db.execute('UPDATE media_files SET path = ?, updated_at = ? WHERE id = ?', [move(f.path), now, f.id])
    changes.push({ from: f.path, to: move(f.path) })
  }
  for (const c of await Comparison.forMission(mission.id)) {
    if (!inside(c.path)) continue
    await c.update({ path: move(c.path) })
    changes.push({ from: c.path, to: move(c.path) })
  }
  for (const table of ['assignments', 'flights']) {
    for (const row of await db.select(`SELECT id, media_dir FROM ${table} WHERE mission_id = ?`, [mission.id])) {
      if (inside(row.media_dir)) await db.execute(`UPDATE ${table} SET media_dir = ? WHERE id = ?`, [move(row.media_dir), row.id])
    }
  }
  await mission.update({ media_dir: target })
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Benennt Ordner und Dateien eines Einsatzes um, deren Name nicht (mehr) passt.
// Gibt die Änderungen zurück: [{ from, to }] – für Seiten, die Pfade schon anzeigen.
export async function syncFileNames(missionId) {
  if (!platform.capabilities.media) return []
  const changes = []
  await syncFolderNames(missionId, changes)

  const names = new Map((await Viewpoint.forMission(missionId)).map((v) => [v.id, v.name]))

  const files = await MediaFile.where('mission_id = ?', [missionId], { order: 'id ASC' })
  const shotTimes = new Map()
  for (const f of files) {
    const key = `${f.flight_id}/${f.shot_key}`
    if (f.taken_at && (!shotTimes.has(key) || f.taken_at < shotTimes.get(key))) shotTimes.set(key, f.taken_at)
  }

  for (const file of files) {
    const wanted = desiredName(file, names.get(file.viewpoint_id), shotTimes.get(`${file.flight_id}/${file.shot_key}`))
    const { dir, sep, name } = splitPath(file.path)
    if (!wanted || fits(name, wanted)) continue
    const to = await rename(file.path, `${dir}${sep}${wanted}`)
    if (!to) continue
    await db.execute('UPDATE media_files SET path = ?, updated_at = ? WHERE id = ?', [to, new Date().toISOString(), file.id])
    changes.push({ from: file.path, to })
  }

  // Vergleichsbilder: "Vergleich_<Wegpunkt>_1308_1331_1440.jpg"
  for (const comparison of await Comparison.forMission(missionId)) {
    const viewpointName = names.get(comparison.viewpoint_id)
    const { dir, sep, name } = splitPath(comparison.path)
    const times = name.match(/_(\d{4}(?:_\d{4})*)(?:_\d+)?(\.\w+)$/)
    if (!viewpointName || !times) continue
    const wanted = `Vergleich_${sanitizeFolderName(viewpointName).replace(/\s+/g, '-')}_${times[1]}${times[2]}`
    if (fits(name, wanted)) continue
    const to = await rename(comparison.path, `${dir}${sep}${wanted}`)
    if (!to) continue
    await comparison.update({ path: to })
    changes.push({ from: comparison.path, to })
  }
  return collapse(changes)
}

// Ordner und danach Datei umbenannt → für offene Ansichten direkt alt → endgültig
// (Kreise wie A → B → A und "Umbenennungen" auf denselben Namen werden ignoriert – nie endlos laufen)
function collapse(changes) {
  const real = changes.filter((c) => c.from !== c.to)
  const next = new Map(real.map((c) => [c.from, c.to]))
  const targets = new Set(real.map((c) => c.to))
  return real
    .filter((c) => !targets.has(c.from))
    .map((c) => {
      let to = c.to
      const seen = new Set([c.from])
      while (next.has(to) && !seen.has(to)) {
        seen.add(to)
        to = next.get(to)
      }
      return { from: c.from, to }
    })
}

async function rename(from, to) {
  try {
    return await platform.renameFile(from, to)
  } catch (error) {
    // z. B. Datei inzwischen im Finder verschoben – nicht abbrechen, nur melden
    console.warn('[Dateinamen]', from, '→', to, error)
    return null
  }
}

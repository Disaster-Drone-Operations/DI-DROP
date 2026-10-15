// Descriptive file names for imported images:
//
//   2026_09_11__13_31_Ost_1_Wärmebild.JPG
//   └  date ┘  └time┘ └viewp┘ └ type ┘
//
// No spaces in file and folder names (sanitizeFolderName turns them into "_").
//
// Several shots of the same spot in the same minute → "_2", "_3" …
//
// Names are updated as soon as the viewpoint name changes (renaming,
// or "Ost" → "Ost_1" because a second east viewpoint was added). Comparison images too.
// The database keeps the drone's original name (original_name).

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

// shotTime: time of the shot (earliest file) – thermal and visible images sometimes trigger
// a second apart, but should carry the same timestamp and sit next to each other
export function desiredName(file, viewpointName, shotTime = file.taken_at) {
  if (!shotTime || shotTime.length < 16) return null
  const kind = file.kind === 'video' ? 'Video' : VARIANT_WORDS[file.variant] ?? null
  const parts = [stampOf(shotTime), viewpointName ? sanitizeFolderName(viewpointName) : null, kind]
  return parts.filter(Boolean).join('_') + extOf(splitPath(file.path).name)
}

// Does the current name already fit? (also with a "_2" suffix for duplicate names)
function fits(current, wanted) {
  if (current === wanted) return true
  const ext = extOf(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  return current.startsWith(`${stem}_`) && current.endsWith(ext) && /^\d+$/.test(current.slice(stem.length + 1, current.length - ext.length))
}

// Mission folder "2026_09_11__B3_Musterdorf" (date + keyword) and assignment folders
// "2026_09_11__13_57_Kontrollflug_3" (time of the first shot + assignment).
// Only folders the app created itself are renamed: directly inside the mission folder
// and starting with a date. All stored paths follow.
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
      console.warn('[folder names]', dir, '→', wanted, error)
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

// Update the mission folder (keyword/date changed, old names with spaces).
// Only folders the app created itself (starting with a date). All paths follow.
async function syncMissionFolder(mission, changes) {
  const dir = mission.media_dir
  const { dir: parent, sep, name: folder } = splitPath(dir)
  const wanted = mission.folderName
  if (!/^\d{4}_\d{2}_\d{2}__/.test(folder) || folder === wanted || new RegExp(`^${escapeRegExp(wanted)}_\\d+$`).test(folder)) return

  let target
  try {
    target = await platform.renameDir(dir, `${parent}${sep}${wanted}`)
  } catch (error) {
    console.warn('[mission folder]', dir, '→', wanted, error)
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

// Renames folders and files of a mission whose name doesn't fit (anymore).
// Returns the changes: [{ from, to }] – for pages that already show paths.
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

  // Comparison images: "Vergleich_<viewpoint>_1308_1331_1440.jpg"
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

// Folder and then file renamed → for open views directly old → final
// (cycles like A → B → A and "renames" to the same name are ignored – never loop forever)
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
    // e.g. file moved in the Finder in the meantime – don't abort, just report
    console.warn('[file names]', from, '→', to, error)
    return null
  }
}

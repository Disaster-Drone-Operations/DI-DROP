// Backfilling older missions: drone detection, folder names, grouping (app/services/history_grouping.js)
//   node --import ./test/support/app_paths.mjs --test test/history_grouping.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { droneOf, deviceList, parseFolderName, isMeaningful, assignmentHint, groupHistory } from '../app/services/history_grouping.js'

const OWN = '1581F8HGX255M00A'
let n = 0
// A scanned file as platform.media.scan returns it
function image(path, takenAt, { serial = `${OWN}24JC`, lat = 50.565, lon = 11.087, dji = true, make = 'DJI' } = {}) {
  n++
  return {
    path, name: path.split('/').pop(), size: 1000, kind: 'image', shot_key: `S${n}`, fingerprint: `f${n}`,
    meta: { taken_at: takenAt, make, lat, lon, rel_alt: dji ? 50 : null, dji: dji ? { DroneModel: 'M4TD', DroneSerialNumber: serial } : {} },
  }
}
const log = (id, start, minutes, extra = {}) => ({
  id, started_at: new Date(start).toISOString(), landed_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
  duration_s: minutes * 60, aircraft_sn: OWN, latitude: 50.565, longitude: 11.087, mission_id: null, mission_source: null, ...extra,
})

test('drones by XMP, other cameras together', () => {
  assert.equal(droneOf(image('/r/a.JPG', '2025-09-05T10:00:00')).serial, `${OWN}24JC`)
  assert.equal(droneOf(image('/r/b.JPG', '2025-09-05T10:00:00', { dji: false, make: 'Apple' })).key, 'other')
  const files = [image('/r/a.JPG', '2025-09-05T10:00:00'), image('/r/b.JPG', '2025-09-05T10:01:00', { serial: 'FOREIGN123' }),
    image('/r/c.JPG', '2025-09-05T10:02:00', { dji: false, make: 'Apple' })]
  const devices = deviceList(files, [OWN])
  assert.deepEqual(devices.map((d) => [d.drone, d.selected]), [[true, true], [true, false], [false, false]])
  // no flight logs at all → every drone preselected
  assert.ok(deviceList(files, []).filter((d) => d.drone).every((d) => d.selected))
})

test('folder names: date in front, generic names are no hint', () => {
  assert.deepEqual(parseFolderName('2025_09_05 Waldbrand_Musterberg'), { date: '2025-09-05', title: 'Waldbrand Musterberg' })
  assert.deepEqual(parseFolderName('2026_09_11_13_55_Ueberblick'), { date: '2026-09-11', title: 'Ueberblick' })
  assert.deepEqual(parseFolderName('05.09.2025 - Übung Wache'), { date: '2025-09-05', title: 'Übung Wache' })
  assert.deepEqual(parseFolderName('2026_09_11_11_45'), { date: '2026-09-11', title: '' })
  for (const generic of ['DCIM', '100MEDIA', 'DJI_001', '2025', 'Bilder', '']) assert.equal(isMeaningful(generic), false, generic)
  assert.equal(assignmentHint({ path: '/r/Waldbrand/Suche Nord/DCIM/100MEDIA/a.JPG' }, '/r', 'Waldbrand'), 'Suche Nord')
  assert.equal(assignmentHint({ path: '/r/Waldbrand/DCIM/a.JPG' }, '/r', 'Waldbrand'), null)
})

test('images join their flight; gaps > 4 h and > 5 km split; titles from the own folder, not containers', () => {
  const root = '/r'
  const files = [
    image('/r/Einsätze/2025_09_05 Waldbrand/Suche Nord/DCIM/a.JPG', '2025-09-05T10:05:00'),
    image('/r/Einsätze/2025_09_05 Waldbrand/Suche Nord/DCIM/b.JPG', '2025-09-05T10:10:00'),
    image('/r/Einsätze/2025_09_05 Waldbrand/c.JPG', '2025-09-05T13:00:00'), // 3 h later – same mission
    image('/r/Einsätze/2025_09_06 Hochwasser/d.JPG', '2025-09-06T09:00:00', { lat: 50.7, lon: 11.3 }), // next day
    image('/r/Übungen/x/e.JPG', '2025-09-06T09:30:00', { lat: 50.565, lon: 11.087 }), // same time, far away → separate
    image('/r/Handy/f.JPG', '2025-09-05T10:06:00', { dji: false, make: 'Apple' }), // not selected
  ]
  const logs = [
    log(1, '2025-09-05T10:00:00', 20), // contains a + b (local time = test machine's zone)
    log(2, '2025-10-09T15:00:00', 15), // flight without images → own proposal
    log(3, '2025-10-10T15:00:00', 15, { mission_id: null, mission_source: 'manual' }), // „kein Einsatz“ → none
  ]
  const selected = new Set(deviceList(files, [OWN]).filter((d) => d.selected).map((d) => d.key))
  const { proposals } = groupHistory({ files, logs, selected, root })
  assert.deepEqual(proposals.map((p) => [p.date, p.files.length, p.flightIds]), [
    ['2025-09-05', 3, [1]],
    ['2025-09-06', 1, []],
    ['2025-09-06', 1, []],
    ['2025-10-09', 0, [2]],
  ])
  assert.equal(proposals[0].titleHint, 'Waldbrand')
  assert.equal(proposals[0].posSource, 'home')
  assert.equal(proposals[1].titleHint, 'Hochwasser')
  assert.equal(proposals[2].kind, 'exercise')
  assert.equal(proposals[2].titleHint, 'x') // "Übungen" is a category, not a name
})

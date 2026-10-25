// Photo plan for "Basis" (script/ai_scenario_photos.mjs): which photo of the scenario is made how.
// All views are derived from basis-referenz.webp (taken from the SOUTH-WEST looking NORTH-EAST):
// same village, barn, roads, vehicles – only the camera position changes. Later flights of a waypoint
// are edits of the earlier photo (only the fire changes) → identical framing for comparison images.
//
// World (north = up): barn in the middle (ridge east–west), asphalt road ~35 m SOUTH (east–west),
// gravel farm road ~50 m WEST (north–south, T-junction south-west), meadow NORTH-EAST, smoke drifts EAST.

const FIRE = {
  1: 'Fire state: full fire – flames break out of the burning roof, thick grey-brown smoke plume drifting east, as in the reference.',
  2: 'Fire state, 30 minutes later: the roof has largely burned through, charred black rafters, only a few small flames left, moderate grey smoke drifting east, firefighters spraying water onto the barn.',
  3: 'Fire state, one hour later: the roof has collapsed, black charred interior with exposed beams, only thin light smoke, puddles of extinguishing water, the fire is under control; vehicles and hoses still in place.',
}

const oblique = (from, lookTo, layout) =>
  `New photo of exactly this scene from a different drone position: the drone is about 60 m ${from} of the barn at 60 m altitude, ` +
  `the camera is tilted about 45° down and looks ${lookTo} straight at the barn. THE BARN IS EXACTLY IN THE CENTRE OF THE FRAME ` +
  `and fills about one third of the image width. ${layout}`

export default {
  reference: 'scenarios/src/basis-referenz.webp',
  shots: {
    // Flight 1 · overview (100 m, tilt 60°)
    'flug1:1': { from: 'reference', fire: 1, view: 'New overview photo of exactly this scene from about 100 m altitude, camera tilted 60° down, drone NORTH-WEST of the barn looking SOUTH-EAST: the farm road in the foreground left, the barn in the middle, the asphalt road with the fire engines behind it, the smoke drifting to the left.' },
    'flug1:2': { from: 'reference', fire: 1, view: 'New overview photo of exactly this scene from about 100 m altitude, camera tilted 60° down, drone NORTH-EAST of the barn above the meadow looking SOUTH-WEST: the meadow in the foreground, the barn in the middle, the smoke drifting towards the camera, the asphalt road with the fire engines behind the barn.' },
    'flug1:3': { from: 'reference', fire: 1, view: 'New overview photo of exactly this scene from about 100 m altitude, camera tilted 60° down, drone SOUTH-EAST of the barn looking NORTH-WEST: the asphalt road crosses the foreground diagonally, the fire engines on the left part of the road, the barn in the middle, the farm road and houses behind it, smoke drifting to the right.' },
    'flug1:4': { from: 'reference-as-is' }, // the reference itself (south-west, looking north-east)

    // Flight 2 · control flight 1 (waypoints, 60 m, tilt 45°; top view straight down)
    'flug2:1': { from: 'reference', fire: 2, view: oblique('NORTH', 'SOUTH', 'Behind the barn the asphalt road with the fire engines crosses the image; the farm road is on the RIGHT side of the image; the meadow on the left; smoke drifts to the LEFT.') },
    'flug2:2': { from: 'reference', fire: 2, view: oblique('EAST', 'WEST', 'The meadow in the foreground; behind the barn the gardens and the farm road with the small fire vehicle; the asphalt road on the LEFT side of the image; smoke drifts towards the camera.') },
    'flug2:3': { from: 'reference', fire: 2, view: oblique('SOUTH', 'NORTH', 'The asphalt road with the two fire engines in the foreground, the farm road on the LEFT, the meadow behind the barn on the right; smoke drifts to the RIGHT.') },
    'flug2:4': { from: 'reference', fire: 2, view: oblique('WEST', 'EAST', 'The farm road with the small fire vehicle and firefighters in the foreground, the asphalt road on the RIGHT side of the image, the meadow behind the barn; smoke drifts away from the camera.') },
    'flug2:5': { from: 'reference', fire: 2, view: 'New photo of exactly this scene, camera pointing STRAIGHT DOWN (nadir, 90°) from 60 m directly above the barn, north is up: the barn roof fills the centre of the image, the asphalt road along the bottom, the farm road on the left, smoke drifting to the right.' },

    // Flight 3 · control flight 2: same framing as flight 2, only the fire state changes
    'flug3:1': { from: 'flug2:1', fire: 3 },
    'flug3:2': { from: 'flug2:2', fire: 3 },
    'flug3:3': { from: 'flug2:3', fire: 3 },
    'flug3:4': { from: 'flug2:4', fire: 3 },
    'flug3:5': { from: 'flug2:5', fire: 3 },

    // Flight 3 · special assignment "Zufahrt für die Drehleiter prüfen" (35 m, tilt 30°)
    'flug3:6': { from: 'reference', fire: 3, view: 'New low oblique photo of this scene from 35 m altitude, camera tilted 30° down, drone above the T-junction of the asphalt road and the gravel farm road, looking NORTH along the farm road: its width, verges, hedges and garden fences, a narrow spot between a hedge and a fence, the small fire vehicle on it, hoses on the ground; the burned barn is visible at the RIGHT edge.' },
    'flug3:7': { from: 'reference', fire: 3, view: 'New low oblique photo from 35 m, camera tilted 30° down, drone above the farm road a bit further north than the junction, looking NORTH along the farm road: overhanging tree branches above the road, garden fences, the road narrowing; the barn is NOT in the picture.' },
    'flug3:8': { from: 'reference', fire: 3, view: 'New low oblique photo from 35 m, camera tilted 30° down, drone above the farm road west of the barn, looking WEST: a paved yard of a neighbouring farmstead with an entrance gate that could serve as set-up area for a turntable ladder; the barn is NOT in the picture.' },
  },
  fire: FIRE,
}

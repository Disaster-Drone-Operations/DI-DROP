// "Nächster Schritt": where does a mission / an assignment stand, and what should happen next?
// The red guiding thread of the app: Einsatz → Auftrag → Bilder → Vergleichsbilder → Bereitstellen → Erledigt.
//
//   const states = await assignmentStates(assignments, counts)       // per assignment, for the cards
//   const step = missionNextStep(mission, open, all, states)         // one red button on the mission page
//   const { open, done, counts, steps, nextStep } = await missionProgress(mission)   // all of it

import { db } from '/lib/db.js'
import { nowMs } from '/lib/clock.js'
import Assignment from '/app/models/assignment.js'
import Comparison from '/app/models/comparison.js'
import { providedKeys, pendingKeys } from '/app/services/provisioning.js'
import { completionOptions } from '/app/services/control_planner.js'

const DUE_SOON_MS = 5 * 60_000

// „A“, „B“ und 3 weitere
const titles = (assignments, max = 2) => {
  const shown = assignments.slice(0, max).map((a) => `„${a.title}“`).join(', ')
  const more = assignments.length - max
  return more > 0 ? `${shown} und ${more} ${more === 1 ? 'weiterer' : 'weitere'}` : shown
}

// Map(id → { hasImages, comparisons, needsComparisons, missing, inProgress, provided, done })
//   missing: images + comparison images neither provided nor on their way (to any target) – images only
//   as long as nothing of the assignment was provided (the selection counts as made, e.g. only thermal images)
export async function assignmentStates(assignments, counts) {
  const ids = assignments.map((a) => a.id)
  const [provided, pending] = await Promise.all([providedKeys(ids), pendingKeys(ids)])
  const states = new Map()
  for (const a of assignments) {
    const hasImages = !!counts.get(a.id)?.shots
    const comparisons = hasImages ? await Comparison.forAssignment(a) : []
    const fileKeys = hasImages ? (await db.select('SELECT id FROM media_files WHERE assignment_id = ?', [a.id])).map((f) => `m${f.id}`) : []
    const keys = [...fileKeys, ...comparisons.map((c) => `c${c.id}`)]
    const open = (k) => !provided.has(k) && !pending.has(k)
    const selectionMade = fileKeys.some((k) => !open(k))
    const missing = (selectionMade ? 0 : fileKeys.length) + comparisons.filter((c) => open(`c${c.id}`)).length
    // Comparison images only make sense once a viewpoint of this flight was also flown before
    const comparable = a.processing === 'comparison' && hasImages && !comparisons.length && (await db.select(
      `SELECT 1 FROM media_files m WHERE m.assignment_id = ? AND m.viewpoint_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM media_files o WHERE o.viewpoint_id = m.viewpoint_id AND o.flight_id <> m.flight_id) LIMIT 1`,
      [a.id],
    )).length > 0
    states.set(a.id, {
      hasImages,
      comparisons: comparisons.length,
      needsComparisons: comparable,
      missing,
      inProgress: keys.some((k) => pending.has(k)),
      provided: hasImages && !missing && keys.some((k) => provided.has(k)) && !keys.some((k) => pending.has(k)),
      done: !a.isOpen,
    })
  }
  return states
}

// Steps shown on an assignment card: [{ label, done }]
export function cardSteps(assignment, state) {
  if (!state || assignment.kind === 'other') return []
  return [
    { label: 'Bilder', done: state.hasImages },
    // "Vergleich" only where it is (or will be) possible – not for the first control flight
    ...(assignment.processing === 'comparison' && (!state.hasImages || state.comparisons > 0 || state.needsComparisons)
      ? [{ label: 'Vergleich', done: state.comparisons > 0 }] : []),
    { label: 'Bereitgestellt', done: state.provided },
    { label: 'Erledigt', done: state.done },
  ]
}

// The one next step of a mission → { kind, text, label, icon, href?, assignment?, dueAt? }
//   kinds: import (opens the folder picker) · comparisons · provide · complete · add · wait
export function missionNextStep(mission, open, all, states) {
  const path = `/missions/${mission.id}`
  if (!mission.isActive) return null
  const state = (a) => states.get(a.id) ?? {}

  const due = open.filter((a) => a.kind !== 'other' && !state(a).hasImages && a.effectiveDue.getTime() <= nowMs() + DUE_SOON_MS)
  if (due.length) {
    return { kind: 'import', icon: 'import', label: 'Bilder importieren …',
      text: `„${due[0].title}“ ist ${due[0].dueAt ? 'fällig' : 'zu fliegen'} – nach dem Flug die SD-Karte einstecken oder die Bilder importieren.` }
  }
  const compare = open.find((a) => state(a).needsComparisons)
  if (compare) {
    return { kind: 'comparisons', icon: 'control', label: 'Vergleichsbilder erstellen', href: `${path}/comparisons?from=${compare.id}`,
      text: `„${compare.title}“: Vergleichsbilder aus diesem und früheren Kontrollflügen erstellen.` }
  }
  const missing = all.filter((a) => state(a).missing > 0)
  if (missing.length) {
    // Provided per assignment (its page has the selection) – the button leads to the first one
    const [first, ...rest] = missing
    const count = state(first).missing
    return { kind: 'provide', icon: 'upload', label: 'Zum Auftrag', href: `${path}/assignments/${first.id}`,
      text: `„${first.title}“: ${count} ${count === 1 ? 'Bild ist' : 'Bilder sind'} noch nicht bereitgestellt – im Auftrag „Bereitstellen …“ wählen.` +
        (rest.length ? ` Danach: ${titles(rest)}.` : '') }
  }
  // Provided or still on its way (the queue keeps running) → can be marked as done
  const finished = open.find((a) => state(a).provided || (state(a).inProgress && !state(a).missing))
  if (finished) {
    return { kind: 'complete', icon: 'check', label: 'Erledigt', assignment: finished,
      text: state(finished).provided
        ? `„${finished.title}“ ist bereitgestellt – als erledigt markieren.`
        : `„${finished.title}“ wird gerade bereitgestellt (läuft im Hintergrund weiter) – kann schon als erledigt markiert werden.` }
  }
  if (!open.length) {
    // Missions usually go on (new tasks come in) – closing stays in the page header
    return { kind: 'add', icon: 'plus', label: 'Auftrag anlegen …',
      text: 'Alle Aufträge sind erledigt. Neue Aufträge der Einsatzleitung hier anlegen – ist der Einsatz vorbei, oben „Abschließen“.' }
  }
  // Next assignment that still needs a flight, otherwise the next open one
  const byDue = [...open].sort((a, b) => a.effectiveDue - b.effectiveDue)
  const next = byDue.find((a) => a.kind !== 'other' && !state(a).hasImages) ?? byDue[0]
  return { kind: 'wait', icon: 'import', label: 'Bilder importieren …', dueAt: next.dueAt,
    text: `Als Nächstes: „${next.title}“` }
}

// Everything the mission page needs for its guidance (also used to refresh it live during uploads)
export async function missionProgress(mission) {
  const [open, done, counts] = await Promise.all([
    Assignment.open(mission.id),
    Assignment.done(mission.id),
    Assignment.mediaCounts(mission.id),
  ])
  for (const a of open) a.completion = await completionOptions(a)
  const all = [...open, ...done]
  const states = await assignmentStates(all, counts)
  const steps = new Map(all.map((a) => [a.id, cardSteps(a, states.get(a.id))]))
  return { open, done, counts, states, steps, nextStep: missionNextStep(mission, open, all, states) }
}

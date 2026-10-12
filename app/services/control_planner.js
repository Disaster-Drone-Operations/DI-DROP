// Planung wiederkehrender Kontrollflüge: "Erledigt" → nächsten Termin wählen.
//
// Optionen im Dialog: 30 / 60 / X Minuten nach Start des letzten Flugs oder feste Uhrzeit.
// "Start" = erste Aufnahme des erledigten Kontrollflugs (sonst geplante Zeit, sonst jetzt).

import AssignmentSeries from '/app/models/assignment_series.js'
import Assignment from '/app/models/assignment.js'
import MediaFile from '/app/models/media_file.js'
import { addMinutes, toDate, parseLocal } from '/lib/time.js'

export async function baseTime(assignment) {
  return (await assignment.startedAt()) ?? assignment.dueAt ?? new Date()
}

// next: { mode: '30' | '60' | 'custom' | 'at' | 'none', minutes, time }
export async function nextDue(assignment, next) {
  if (next.mode === 'at' && next.time) return { dueAt: parseLocal(`${toDate()}T${next.time}`) }
  const minutes = (next.mode === 'custom' ? Number(next.minutes) : Number(next.mode)) || 30
  return { dueAt: addMinutes(await baseTime(assignment), minutes), minutes }
}

// Daten für den "Erledigt"-Dialog – null, wenn es keine laufende Serie gibt
export async function completionOptions(assignment) {
  if (!assignment.isControl || !assignment.isOpen || !assignment.series_id) return null
  const series = await AssignmentSeries.findBy('id = ? AND status = ?', [assignment.series_id, 'aktiv'])
  if (!series) return null
  const started = await assignment.startedAt()
  return { base: started ?? assignment.dueAt ?? new Date(), fromImages: !!started, interval: series.interval_minutes || 30 }
}

// Auftrag erledigen; bei Kontrollflügen den nächsten planen oder die Serie beenden.
// → { notice, planned, finishedSeries } (für Meldung und Widerrufen)
export async function completeAssignment(assignment, next = {}) {
  await assignment.complete()
  let notice = `„${assignment.title}“ erledigt.`
  let planned = null
  let finishedSeries = null

  const series = assignment.series_id ? await AssignmentSeries.findBy('id = ? AND status = ?', [assignment.series_id, 'aktiv']) : null
  if (series && next.mode === 'none') {
    await series.finish()
    finishedSeries = series
    notice += ' Kontrollflüge beendet.'
  } else if (series && next.mode) {
    const { dueAt, minutes } = await nextDue(assignment, next)
    if (minutes) await series.update({ interval_minutes: minutes })
    planned = await series.plan({ dueAt })
    notice += ` ${planned.title} geplant für ${planned.due_at.slice(11, 16)} Uhr.`
  }
  return { notice, planned, finishedSeries }
}

// Widerrufen von completeAssignment: wieder offen, geplanten Folgeauftrag entfernen, Serie fortsetzen
export async function revertCompletion(assignmentId, { planned, finishedSeries }) {
  if (planned) {
    const next = await Assignment.findBy('id = ?', [planned.id])
    if (next) {
      if (await MediaFile.count('assignment_id = ?', [next.id])) throw new Error(`„${next.title}“ hat schon Bilder`)
      await next.destroy()
    }
  }
  if (finishedSeries) await finishedSeries.update({ status: 'aktiv' })
  const assignment = await Assignment.find(assignmentId)
  await assignment.reopen()
}

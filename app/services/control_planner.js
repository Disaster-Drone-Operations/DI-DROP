// Planning of recurring control flights: "Erledigt" → choose the next appointment.
//
// Options in the dialog: 30 / 60 / X minutes after the start of the last flight, or a fixed time.
// "Start" = first shot of the completed control flight (otherwise scheduled time, otherwise now).

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

// Data for the "Erledigt" dialog – null if there is no running series
export async function completionOptions(assignment) {
  if (!assignment.isControl || !assignment.isOpen || !assignment.series_id) return null
  const series = await AssignmentSeries.findBy('id = ? AND status = ?', [assignment.series_id, 'active'])
  if (!series) return null
  const started = await assignment.startedAt()
  return { base: started ?? assignment.dueAt ?? new Date(), fromImages: !!started, interval: series.interval_minutes || 30 }
}

// Complete an assignment; for control flights schedule the next one or end the series.
// → { notice, planned, finishedSeries } (for the notice and undo)
export async function completeAssignment(assignment, next = {}) {
  await assignment.complete()
  let notice = `„${assignment.title}“ erledigt.`
  let planned = null
  let finishedSeries = null

  const series = assignment.series_id ? await AssignmentSeries.findBy('id = ? AND status = ?', [assignment.series_id, 'active']) : null
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

// Undo of completeAssignment: open again, remove the scheduled follow-up, continue the series
export async function revertCompletion(assignmentId, { planned, finishedSeries }) {
  if (planned) {
    const next = await Assignment.findBy('id = ?', [planned.id])
    if (next) {
      if (await MediaFile.count('assignment_id = ?', [next.id])) throw new Error(`„${next.title}“ hat schon Bilder`)
      await next.destroy()
    }
  }
  if (finishedSeries) await finishedSeries.update({ status: 'active' })
  const assignment = await Assignment.find(assignmentId)
  await assignment.reopen()
}

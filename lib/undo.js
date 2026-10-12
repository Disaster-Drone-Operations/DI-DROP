// Begrenztes Rückgängig/Wiederholen für App-Aktionen (nicht für Texteingaben – die
// erledigt das Eingabefeld selbst).
//
//   undo.record({
//     label: '„Kontrollflug 3“ erledigt',
//     undo: async () => { … },   // macht die Aktion rückgängig
//     redo: async () => { … },   // führt sie erneut aus
//   })
//
// Bewusst nicht rückgängig: Import, Löschen ganzer Einsätze – die haben eine Rückfrage.

const MAX = 20
const undoStack = []
const redoStack = []

export function record(action) {
  undoStack.push(action)
  if (undoStack.length > MAX) undoStack.shift()
  redoStack.length = 0
}

export const canUndo = () => undoStack.length > 0
export const canRedo = () => redoStack.length > 0

// → Hinweis für die Meldung oben rechts
export async function undo() {
  const action = undoStack.pop()
  if (!action) return { notice: 'Es gibt nichts zum Widerrufen.' }
  try {
    await action.undo()
    redoStack.push(action)
    return { notice: `Widerrufen: ${action.label}` }
  } catch (error) {
    console.error(error)
    return { alert: `„${action.label}“ lässt sich nicht widerrufen: ${error?.message ?? error}` }
  }
}

export async function redo() {
  const action = redoStack.pop()
  if (!action) return { notice: 'Es gibt nichts zum Wiederholen.' }
  try {
    await action.redo()
    undoStack.push(action)
    return { notice: `Wiederholt: ${action.label}`, undo: true }
  } catch (error) {
    console.error(error)
    return { alert: `„${action.label}“ lässt sich nicht wiederholen: ${error?.message ?? error}` }
  }
}

// Attribute eines Datensatzes (zum Wiederherstellen nach dem Löschen)
export function snapshot(record) {
  return Object.fromEntries(Object.keys(record.constructor.attributes).map((k) => [k, record[k]]))
}

export default { record, undo, redo, canUndo, canRedo, snapshot }

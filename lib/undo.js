// Limited undo/redo for app actions (not for text input – the input field
// handles that itself).
//
//   undo.record({
//     label: '„Kontrollflug 3“ erledigt',
//     undo: async () => { … },   // reverts the action
//     redo: async () => { … },   // performs it again
//   })
//
// Deliberately not undoable: import, deleting whole missions – those ask for confirmation.

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

// → notice for the message at the top right
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

// Attributes of a record (for restoring after deletion)
export function snapshot(record) {
  return Object.fromEntries(Object.keys(record.constructor.attributes).map((k) => [k, record[k]]))
}

export default { record, undo, redo, canUndo, canRedo, snapshot }

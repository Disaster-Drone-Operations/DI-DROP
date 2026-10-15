// Make renaming a viewpoint undoable (name + file names revert)

import undo from '/lib/undo.js'
import Viewpoint from '/app/models/viewpoint.js'
import { syncFileNames } from '/app/services/file_namer.js'

export function recordViewpointRename(viewpoint, before) {
  const after = viewpoint.custom_name
  const setName = async (name) => {
    const v = await Viewpoint.find(viewpoint.id)
    await v.update({ custom_name: name ?? '' })
    await syncFileNames(v.mission_id)
  }
  undo.record({
    label: `Wegpunkt-Name „${after || 'automatisch'}“`,
    undo: () => setName(before),
    redo: () => setName(after),
  })
}

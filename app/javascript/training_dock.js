// Browser bridge: the trainer's control docked at the bottom of the main window (there is no second
// window in the browser). Outside #app, so page changes don't remove it.
import { mountControl } from '/app/javascript/control.js'

let dock = null

export function installDock() {
  window.addEventListener('training:dock', () => {
    if (dock) return
    dock = document.createElement('div')
    dock.className = 'training-dock training-control'
    document.body.append(dock)
    const unmount = mountControl(dock, { docked: true })
    dock.addEventListener('training:undock', async () => {
      await unmount()
      dock.remove()
      dock = null
    })
  })
}

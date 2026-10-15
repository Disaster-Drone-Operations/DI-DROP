import { Controller } from '@hotwired/stimulus'
import platform from '/lib/platform/index.js'

// Open files with the default app (Preview, Photos …) or show them in Finder/Explorer
//   <button data-action="system-open#open" data-system-open-path-param="/path/image.jpg">
export default class extends Controller {
  open({ params }) {
    platform.openPath(params.path).catch((e) => this.fail(e))
  }

  reveal({ params }) {
    platform.revealPath(params.path).catch((e) => this.fail(e))
  }

  fail(error) {
    console.error(error)
    platform.confirm(`Konnte nicht geöffnet werden:\n${error}`, { okLabel: 'OK' })
  }
}

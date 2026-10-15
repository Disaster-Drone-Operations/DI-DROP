// Base class for all controllers in app/controllers.
//
//   export default class MissionsController extends ApplicationController {
//     async show() {
//       const mission = await Mission.find(this.params.id)
//       this.render('missions/show', { mission })
//     }
//   }

import { render } from '/lib/views.js'

export class Controller {
  static layout = 'layouts/application'

  constructor({ router, params, flash, path, action }) {
    this.router = router
    this.params = params
    this.flash = flash
    this.path = path
    this.action = action
  }

  async process(action) {
    await this.beforeAction()
    await this[action]()
  }

  // Hooks for subclasses
  async beforeAction() {}

  // Additional locals for the layout (e.g. navigation)
  async layoutLocals() {
    return {}
  }

  async render(view, locals = {}, { title } = {}) {
    const shared = { flash: this.flash, currentPath: this.path, params: this.params }
    const body = render(view, { ...shared, ...locals })
    const layoutLocals = await this.layoutLocals()
    const html = render(this.constructor.layout, { ...shared, ...layoutLocals, body, title })
    this.router.paint(html, { title })
  }

  redirectTo(path, flash = {}) {
    return this.router.redirectTo(path, flash)
  }
}

export default Controller

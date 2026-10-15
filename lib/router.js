// Rails-style router + dispatcher – entirely in the frontend.
//
// URLs live in the hash (#/missions/3), so back/forward, reload and deep links
// work both in Tauri and in the browser without a server.
//
// Links:   <a href="#/missions/3">
// Forms:   <form action="#/missions/3" method="post"> + <input name="_method" value="patch">
//          Optional: data-confirm="Wirklich löschen?"

import { parseParams, parseQuery } from '/lib/params.js'
import { RecordNotFound } from '/lib/record.js'
import platform from '/lib/platform/index.js'

const singular = (name) => name.replace(/ies$/, 'y').replace(/s$/, '')

// ── Routes DSL ────────────────────────────────────────────────────────────

class RouteSet {
  constructor() {
    this.routes = []
    this.prefix = ''
  }

  add(method, path, to) {
    const [controller, action] = to.split('#')
    const keys = []
    const full = (this.prefix + path).replace(/\/$/, '') || '/'
    const pattern = new RegExp('^' + full.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$')
    this.routes.push({ method, path: full, pattern, keys, controller, action })
  }

  root(to) { this.add('GET', '/', to) }
  get(path, to) { this.add('GET', path, to) }
  post(path, to) { this.add('POST', path, to) }
  patch(path, to) { this.add('PATCH', path, to) }
  delete(path, to) { this.add('DELETE', path, to) }

  resources(name, options = {}, nested) {
    if (typeof options === 'function') [nested, options] = [options, {}]
    const all = {
      index: ['GET', ''],
      new: ['GET', '/new'],
      create: ['POST', ''],
      show: ['GET', '/:id'],
      edit: ['GET', '/:id/edit'],
      update: ['PATCH', '/:id'],
      destroy: ['DELETE', '/:id'],
    }
    const only = options.only ?? Object.keys(all)
    for (const [action, [method, suffix]] of Object.entries(all)) {
      if (only.includes(action)) this.add(method, `/${name}${suffix}`, `${name}#${action}`)
    }
    if (nested) {
      const previous = this.prefix
      this.prefix = `${previous}/${name}/:${singular(name)}_id`
      nested()
      this.prefix = previous
    }
  }
}

// ── Router ────────────────────────────────────────────────────────────────

export class Router {
  static current = null

  constructor({ routes, controllers, element }) {
    Router.current = this
    this.routeSet = new RouteSet()
    routes(this.routeSet)
    this.controllers = controllers
    this.element = element
    this.flash = {}
  }

  get currentPath() {
    return decodeURI(location.hash.replace(/^#/, '')) || '/'
  }

  start() {
    addEventListener('hashchange', () => this.visit(this.currentPath))
    document.addEventListener('submit', (event) => this.handleSubmit(event))
    // For Stimulus controllers: document.dispatchEvent(new CustomEvent('router:visit', { detail: { path, flash } }))
    document.addEventListener('router:visit', ({ detail }) => this.redirectTo(detail.path, detail.flash))
    return this.visit(this.currentPath)
  }

  match(method, path) {
    for (const route of this.routeSet.routes) {
      if (route.method !== method) continue
      const m = path.match(route.pattern)
      if (m) return { route, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }
    }
    return null
  }

  visit(path) {
    return this.dispatch('GET', path)
  }

  // Redraw the current page (e.g. after undo)
  reload(flash = {}) {
    this.flash = flash
    return this.visit(this.currentPath)
  }

  // Called by controllers
  redirectTo(path, flash = {}) {
    this.flash = flash
    if (this.currentPath === path) return this.visit(path)
    location.hash = path // triggers hashchange → visit
  }

  async dispatch(method, fullPath, body = {}) {
    const [path, search = ''] = fullPath.split('?')
    const found = this.match(method, path)
    const flash = this.flash
    this.flash = {}

    try {
      if (!found) throw new RecordNotFound(`No route for ${method} ${path}`)
      const Controller = this.controllers[found.route.controller]
      if (!Controller) throw new Error(`Missing controller: ${found.route.controller}`)

      const params = { ...parseQuery(search), ...body, ...found.params }
      const controller = new Controller({ router: this, params, flash, path, action: found.route.action })
      if (typeof controller[found.route.action] !== 'function') {
        throw new Error(`Missing action: ${found.route.controller}#${found.route.action}`)
      }
      await controller.process(found.route.action)
    } catch (error) {
      console.error(error)
      const Controller = this.controllers.application
      const controller = new Controller({ router: this, params: {}, flash: {}, path })
      await controller.renderError(error)
    }
  }

  // Actually write the page into the DOM
  paint(html, { title } = {}) {
    this.element.innerHTML = html
    document.title = title ? `${title} – di-drop` : 'di-drop'
    this.element.querySelector('main')?.scrollTo?.(0, 0)
    this.element.querySelector('[autofocus]')?.focus()
  }

  async handleSubmit(event) {
    const form = event.target
    const action = form.getAttribute('action') ?? ''
    if (!action.startsWith('#/')) return
    event.preventDefault()

    if (form.dataset.confirm) {
      const ok = await platform.confirm(form.dataset.confirm, { okLabel: form.dataset.confirmButton ?? 'OK' })
      if (!ok) return
    }

    const formData = new FormData(form, event.submitter)
    const method = (formData.get('_method') || form.getAttribute('method') || 'GET').toUpperCase()
    formData.delete('_method')

    const buttons = form.querySelectorAll('button, input[type=submit]')
    buttons.forEach((b) => (b.disabled = true))
    try {
      await this.dispatch(method, action.slice(1), parseParams(formData))
    } finally {
      buttons.forEach((b) => (b.disabled = false))
    }
  }
}

export default Router

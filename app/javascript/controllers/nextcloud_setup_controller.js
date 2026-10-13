import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'
import Setting from '/app/models/setting.js'
import { formatBytes } from '/app/helpers/index.js'

// Einstellungen → Nextcloud: Anmeldung (Login Flow im Browser oder App-Passwort), Testen, Abmelden.
// Der Zugang liegt im Schlüsselbund; hier kommen nur Server und Benutzername an.
export default class extends Controller {
  static targets = ['body']

  async connect() {
    this.state = { available: !!platform.nextcloud, server: Setting.get('nextcloud.server') ?? '' }
    if (this.state.available) this.state.account = await platform.nextcloud.account().catch(() => null)
    this.paint()
  }

  disconnect() {
    this.stopPolling()
  }

  set(changes) {
    Object.assign(this.state, changes)
    this.paint()
  }

  paint() {
    morph(this.bodyTarget, render('settings/_nextcloud_body', { s: this.state }))
  }

  async login(event) {
    event.preventDefault()
    const server = new FormData(event.target).get('server')?.trim()
    if (!server) return
    this.set({ busy: true, error: null, server })
    try {
      this.flow = await platform.nextcloud.loginStart(server)
      await Setting.set('nextcloud.server', this.flow.server)
      this.set({ busy: false, waiting: true })
      this.openLogin()
      this.poll()
    } catch (error) {
      this.set({ busy: false, error: String(error) })
    }
  }

  openLogin() {
    if (this.flow) platform.openUrl(this.flow.login_url)
  }

  // Alle 2 s fragen, ob die Anmeldung im Browser fertig ist (höchstens 20 Minuten)
  poll() {
    const started = Date.now()
    const tick = async () => {
      if (!this.flow) return
      try {
        const account = await platform.nextcloud.loginPoll(this.flow.server, this.flow.endpoint, this.flow.token)
        if (account) return this.loggedIn(account)
      } catch (error) {
        this.stopPolling()
        return this.set({ waiting: false, error: String(error) })
      }
      if (Date.now() - started > 20 * 60_000) return this.cancel()
      this.pollTimer = setTimeout(tick, 2000)
    }
    tick()
  }

  stopPolling() {
    clearTimeout(this.pollTimer)
    this.flow = null
  }

  cancel() {
    this.stopPolling()
    this.set({ waiting: false })
  }

  async loginManual(event) {
    event.preventDefault()
    const data = new FormData(event.target)
    const server = this.element.querySelector('#nextcloud_server')?.value.trim() || this.state.server
    if (!server) return this.set({ error: 'Bitte zuerst oben die Adresse der Nextcloud eintragen.', manual: true })
    this.set({ busy: true, error: null, manual: true })
    try {
      const account = await platform.nextcloud.loginManual(server, data.get('login'), data.get('password'))
      await Setting.set('nextcloud.server', account.server)
      this.loggedIn(account)
    } catch (error) {
      this.set({ busy: false, error: String(error) })
    }
  }

  loggedIn(account) {
    this.stopPolling()
    this.set({ account, waiting: false, busy: false, error: null, manual: false })
    this.test()
  }

  async test() {
    this.set({ test: 'running' })
    try {
      const result = await platform.nextcloud.test()
      this.set({ test: { ok: true, display_name: result.display_name, free: result.quota_free > 0 ? formatBytes(result.quota_free) : null } })
    } catch (error) {
      this.set({ test: { error: String(error) } })
    }
  }

  async logout() {
    const ok = await platform.confirm('Von der Nextcloud abmelden? Laufende Uploads in die Nextcloud schlagen dann fehl. (Das App-Passwort kannst du zusätzlich in der Nextcloud unter Einstellungen → Sicherheit widerrufen.)', { okLabel: 'Abmelden' })
    if (!ok) return
    await platform.nextcloud.forget()
    this.set({ account: null, test: null })
  }
}

import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'
import Router from '/lib/router.js'
import Setting from '/app/models/setting.js'
import * as deployer from '/app/services/cloudflare_deployer.js'

// Settings → location transfer: wizard for the relay in your own Cloudflare account
//   account → token → install (choose account, workers.dev name if needed, upload, test)
export default class extends Controller {
  static targets = ['body', 'token', 'subdomain']
  static values = { url: String }

  async connect() {
    this.state = {
      url: this.urlValue || null,
      available: deployer.isAvailable(),
      hasToken: await deployer.hasToken().catch(() => false),
      setup: false,
      step: 'account',
    }
    if (this.state.url) this.check()
    else this.paint()
  }

  set(changes) {
    Object.assign(this.state, changes)
    this.paint()
  }

  paint() {
    morph(this.bodyTarget, render('settings/_relay_body', { s: this.state }))
    this.bodyTarget.querySelector('[data-relay-setup-target="token"]:not([disabled]), [data-relay-setup-target="subdomain"]:not([disabled])')?.focus()
  }

  // ── Existing relay ──────────────────────────────────────────────────────

  async check() {
    this.set({ health: 'checking' })
    this.set({ health: (await deployer.health(this.state.url)) ? 'ok' : 'down' })
  }

  beginSetup() {
    this.set({ setup: true, step: this.state.hasToken ? 'install' : 'token', error: null })
    if (this.state.hasToken) this.install()
  }

  cancelSetup() {
    this.set({ setup: false, error: null, progress: null, accounts: null, accountId: null, needsSubdomain: false, busy: false })
  }

  async forgetToken() {
    const ok = await platform.confirm('Den Cloudflare-Schlüssel aus dem Schlüsselbund entfernen? Der Relay läuft weiter. Zum Aktualisieren brauchst du dann einen neuen Schlüssel.', { okLabel: 'Entfernen' })
    if (!ok) return
    await deployer.deleteToken()
    this.set({ hasToken: false })
  }

  // ── Wizard ──────────────────────────────────────────────────────────────

  openSignup() {
    platform.openUrl(deployer.SIGNUP_URL)
    this.haveAccount()
  }

  haveAccount() {
    this.set({ step: 'token', error: null })
  }

  openTokenPage() {
    platform.openUrl(deployer.TOKEN_URL)
  }

  async saveToken(event) {
    event.preventDefault()
    const token = this.tokenTarget.value
    if (!token.trim()) return
    this.set({ busy: true, error: null })
    try {
      const accounts = await deployer.saveToken(token)
      this.set({ hasToken: true, accounts, accountId: accounts.length === 1 ? accounts[0].id : null, step: 'install', busy: false })
      if (this.state.accountId) this.install()
    } catch (error) {
      this.set({ busy: false, error: error.message })
    }
  }

  chooseAccount({ params: { id } }) {
    this.set({ accountId: id })
    this.install()
  }

  async createSubdomain(event) {
    event.preventDefault()
    this.set({ busy: true, error: null })
    try {
      this.subdomain = await deployer.createSubdomain(this.state.accountId, this.subdomainTarget.value)
      this.set({ needsSubdomain: false, busy: false })
      this.install()
    } catch (error) {
      this.set({ busy: false, error: error.message })
    }
  }

  async install() {
    this.set({ busy: true, error: null, progress: 'Konto prüfen …' })
    try {
      if (!this.state.accountId) {
        const accounts = this.state.accounts ?? (await deployer.listAccounts())
        if (accounts.length > 1) return this.set({ accounts, busy: false, progress: null })
        this.state.accountId = accounts[0].id
        this.state.accounts = accounts
      }
      const account = this.state.accounts?.find((a) => a.id === this.state.accountId)
      this.subdomain ??= await deployer.getSubdomain(this.state.accountId)
      if (!this.subdomain) {
        return this.set({ needsSubdomain: true, suggestion: deployer.subdomainSuggestion(account?.name), busy: false, progress: null })
      }
      const { url } = await deployer.deployRelay(this.state.accountId, this.subdomain, {
        onStep: (_key, text) => this.set({ progress: text }),
      })
      await Setting.set('relay.url', url)
      Router.current.reload({ notice: 'Standort-Übertragung ist eingerichtet.' })
    } catch (error) {
      this.set({ busy: false, progress: null, error: error.message })
    }
  }
}

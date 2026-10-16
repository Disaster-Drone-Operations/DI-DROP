import { Controller } from '@hotwired/stimulus'
import { render } from '/lib/views.js'
import { morph } from '/lib/morph.js'
import platform from '/lib/platform/index.js'
import Router from '/lib/router.js'
import Setting from '/app/models/setting.js'
import * as deployer from '/app/services/cloudflare_deployer.js'
import { RELAY_BUNDLE_VERSION } from '/relay/bundle.js'

// Settings → phone connection: status diagram + managing the relay in your own Cloudflare account
//   install wizard: account → token → install (choose account, workers.dev name if needed, upload, test)
//   installed: update (when outdated), test connection, uninstall
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
      latest: RELAY_BUNDLE_VERSION,
      // installed by di-drop on workers.dev → can be updated/uninstalled here
      managed: deployer.isAvailable() && !!deployer.parseRelayUrl(this.urlValue),
    }
    // Key already in the keychain (e.g. after uninstalling) → straight to "Relay installieren"
    if (!this.state.url && this.state.hasToken) this.state.step = 'install'
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
    this.set({ health: 'checking', error: null })
    const info = await deployer.health(this.state.url)
    // Reachable but older code (e.g. without image transfer) → offer "Jetzt aktualisieren"
    this.set({ info, health: !info ? 'down' : info.bundle === RELAY_BUNDLE_VERSION ? 'ok' : 'outdated' })
  }

  // Install the current version over the existing relay (same address)
  async update() {
    this.set({ busy: true, error: null, progress: 'Konto prüfen …' })
    try {
      await deployer.updateRelay(this.state.url, { onStep: (_key, text) => this.set({ progress: text }) })
      Router.current.reload({ notice: 'Relay ist aktualisiert.' })
    } catch (error) {
      this.set({ busy: false, progress: null })
      if (error instanceof deployer.NeedsTokenError) return this.beginSetup() // key removed → enter it again, then install
      this.set({ error: error.message })
    }
  }

  async uninstall() {
    const ok = await platform.confirm(
      'Den Relay aus deinem Cloudflare-Konto löschen?\n\nDanach funktionieren „Standort vom Telefon“ und „An Telefon senden“ erst wieder, wenn er neu installiert wird.',
      { title: 'Relay deinstallieren', okLabel: 'Deinstallieren' },
    )
    if (!ok) return
    this.set({ busy: true, error: null, progress: 'Relay wird gelöscht …' })
    try {
      await deployer.uninstallRelay(this.state.url)
      await Setting.set('relay.url', '')
      Router.current.reload({ notice: 'Relay ist deinstalliert.' })
    } catch (error) {
      const text = error instanceof deployer.NeedsTokenError
        ? 'Zum Deinstallieren wird der Cloudflare-Schlüssel gebraucht. Alternativ den Worker im Cloudflare-Dashboard löschen.'
        : error.message
      this.set({ busy: false, progress: null, error: text })
    }
  }

  beginSetup() {
    this.set({ setup: true, step: this.state.hasToken ? 'install' : 'token', error: null })
    if (this.state.hasToken) this.install()
  }

  cancelSetup() {
    this.set({ setup: false, error: null, progress: null, accounts: null, accountId: null, needsSubdomain: false, busy: false })
  }

  async forgetToken() {
    const ok = await platform.confirm('Den Cloudflare-Schlüssel aus dem Schlüsselbund entfernen? Der Relay läuft weiter. Zum Aktualisieren oder Deinstallieren brauchst du dann einen neuen Schlüssel.', { okLabel: 'Entfernen' })
    if (!ok) return
    await deployer.deleteToken()
    this.set({ hasToken: false, step: this.state.step === 'install' ? 'token' : this.state.step, accounts: null, accountId: null })
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
      Router.current.reload({ notice: 'Telefon-Verbindung ist eingerichtet.' })
    } catch (error) {
      this.set({ busy: false, progress: null, error: error.message })
    }
  }
}

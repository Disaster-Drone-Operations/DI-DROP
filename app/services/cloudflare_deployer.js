// Sets up the location relay in the user's own Cloudflare account.
//
//   verify token → choose account → workers.dev address → upload worker → test connection
//
// The API token lives only in the operating system's keychain (Rust: src-tauri/src/cloudflare.rs);
// only the Cloudflare API's responses arrive here. It is not needed for regular operation.

import platform from '/lib/platform/index.js'
import { buildWorkerScript, RELAY_BUNDLE_VERSION, RELAY_PROTOCOL_VERSION } from '/relay/bundle.js'
import worker from '/relay/worker.js?raw'
import html from '/relay/phone.html?raw'
import app from '/relay/phone.js?raw'
import protocol from '/relay/protocol.js?raw'

export const SCRIPT_NAME = 'di-drop-relay'
export const SIGNUP_URL = 'https://dash.cloudflare.com/sign-up'
// Token page with prefilled minimal permissions: edit Workers scripts, read account settings
export const TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=di-drop'
const COMPATIBILITY_DATE = '2026-09-01'

export class CloudflareError extends Error {}

export const isAvailable = () => !!platform.cloudflare

const cf = () => {
  if (!platform.cloudflare) throw new CloudflareError('Die Einrichtung bei Cloudflare geht nur in der Desktop-App.')
  return platform.cloudflare
}

// Make the API's error messages understandable
function explain({ status, body }) {
  const codes = (body?.errors ?? []).map((e) => e.code)
  if (status === 401 || codes.includes(1000) || codes.includes(9109)) return 'Der Schlüssel ist ungültig oder abgelaufen.'
  if (status === 403 || codes.includes(10000)) return 'Dem Schlüssel fehlen Rechte. Bitte über „Schlüssel bei Cloudflare erstellen“ neu anlegen.'
  if (status === 429) return 'Cloudflare bremst gerade (zu viele Anfragen). Bitte kurz warten.'
  const message = body?.errors?.[0]?.message
  return message ? `Cloudflare meldet: ${message}` : `Cloudflare antwortet mit Status ${status}.`
}

async function api(method, path, body) {
  const response = await cf().api(method, path, body)
  if (response.status >= 200 && response.status < 300 && response.body?.success !== false) return response.body?.result
  const error = new CloudflareError(explain(response))
  error.response = response
  throw error
}

// ── Token ─────────────────────────────────────────────────────────────

export const hasToken = () => (isAvailable() ? cf().hasToken() : Promise.resolve(false))
export const deleteToken = () => cf().deleteToken()

// Stores the token in the keychain and verifies it; returns the accounts
export async function saveToken(token) {
  const clean = token.trim()
  if (!/^[A-Za-z0-9_-]{30,}$/.test(clean)) {
    throw new CloudflareError('Das sieht nicht wie ein API-Schlüssel aus. Bitte den ganzen Schlüssel kopieren (nicht den „Global API Key“).')
  }
  await cf().setToken(clean)
  const check = await api('GET', '/user/tokens/verify')
  if (check?.status !== 'active') throw new CloudflareError('Der Schlüssel ist nicht aktiv.')
  return listAccounts()
}

export async function listAccounts() {
  const accounts = (await api('GET', '/accounts?per_page=50')) ?? []
  if (!accounts.length) throw new CloudflareError('Der Schlüssel hat Zugriff auf kein Konto. Beim Erstellen „Alle Konten“ auswählen.')
  return accounts.map((a) => ({ id: a.id, name: a.name }))
}

// ── workers.dev address ───────────────────────────────────────────────────

export async function getSubdomain(accountId) {
  try {
    return (await api('GET', `/accounts/${accountId}/workers/subdomain`))?.subdomain ?? null
  } catch (error) {
    if (error.response?.status === 404 || error.response?.body?.errors?.some((e) => e.code === 10007)) return null
    throw error
  }
}

export const subdomainSuggestion = (accountName = '') =>
  `${accountName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'drohne'}`

export async function createSubdomain(accountId, name) {
  const subdomain = name.trim().toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    throw new CloudflareError('Nur Kleinbuchstaben, Ziffern und Bindestriche (nicht am Anfang oder Ende).')
  }
  try {
    return (await api('PUT', `/accounts/${accountId}/workers/subdomain`, { subdomain })).subdomain
  } catch (error) {
    if (error.response?.status === 409 || /taken|unavailable|exists/i.test(error.message)) {
      throw new CloudflareError(`„${subdomain}“ ist schon vergeben. Bitte einen anderen Namen wählen.`)
    }
    throw error
  }
}

export const relayUrl = (scriptName, subdomain) => `https://${scriptName}.${subdomain}.workers.dev`

// ── Install relay ────────────────────────────────────────────────────

export async function health(baseUrl, { timeout = 8000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) return null
    const json = await response.json()
    return json?.ok && json.protocol === RELAY_PROTOCOL_VERSION ? json : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Only overwrite an existing worker with the same name if it comes from di-drop
async function chooseScript(accountId, subdomain) {
  const scripts = (await api('GET', `/accounts/${accountId}/workers/scripts`)) ?? []
  for (const name of [SCRIPT_NAME, `${SCRIPT_NAME}-2`, `${SCRIPT_NAME}-3`]) {
    const existing = scripts.find((s) => s.id === name)
    if (!existing) return { name, migrationTag: null }
    const ours = existing.tags?.includes(SCRIPT_NAME) || (await health(relayUrl(name, subdomain)))?.relay === 'cloudflare'
    if (ours) return { name, migrationTag: existing.migration_tag ?? null }
  }
  throw new CloudflareError('Im Konto gibt es schon mehrere fremde Worker mit dem Namen „di-drop-relay“.')
}

// onStep(key, text) reports progress: 'script' → 'upload' → 'route' → 'check'
export async function deployRelay(accountId, subdomain, { onStep = () => {} } = {}) {
  onStep('script', 'Worker vorbereiten …')
  const target = await chooseScript(accountId, subdomain)
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: COMPATIBILITY_DATE,
    tags: [SCRIPT_NAME],
    bindings: [{ type: 'durable_object_namespace', name: 'SESSIONS', class_name: 'RelaySession' }],
  }
  if (target.migrationTag !== 'v1') metadata.migrations = { new_tag: 'v1', new_sqlite_classes: ['RelaySession'] }

  onStep('upload', 'Relay hochladen …')
  const script = buildWorkerScript({ worker, html, app, protocol })
  const response = await cf().uploadWorker(accountId, target.name, metadata, script)
  if (response.status < 200 || response.status >= 300 || response.body?.success === false) {
    const error = new CloudflareError(explain(response))
    error.response = response
    throw error
  }

  onStep('route', 'Adresse freischalten …')
  await api('POST', `/accounts/${accountId}/workers/scripts/${target.name}/subdomain`, { enabled: true, previews_enabled: false })

  // A new workers.dev address sometimes takes a minute or two until it is reachable
  const url = relayUrl(target.name, subdomain)
  const started = Date.now()
  for (let attempt = 1; Date.now() - started < 180_000; attempt++) {
    onStep('check', attempt === 1 ? 'Verbindung testen …' : 'Cloudflare schaltet die Adresse frei – das kann bis zu drei Minuten dauern …')
    const info = await health(url)
    if (info?.bundle === RELAY_BUNDLE_VERSION) return { url, scriptName: target.name }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new CloudflareError(`Der Relay wurde installiert, ist aber unter ${url} noch nicht erreichbar. Bitte später „Verbindung testen“ wählen.`)
}

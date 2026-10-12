// Baut aus Worker-Quelltext und Smartphone-Webseite ein einziges Worker-Modul.
// Genutzt vom Cloudflare-Deployer in der Desktop-App (Dateien per Vite "?raw")
// und von relay/dev.mjs für den lokalen Test mit wrangler.

export const RELAY_BUNDLE_VERSION = '1.0.0'
export const RELAY_PROTOCOL_VERSION = 1

export function buildWorkerScript({ worker, html, app, protocol }) {
  const assets = {
    '/': { type: 'text/html; charset=utf-8', body: html },
    '/app.js': { type: 'text/javascript; charset=utf-8', body: app },
    '/protocol.js': { type: 'text/javascript; charset=utf-8', body: protocol },
  }
  const fill = (source, marker, value) => {
    const token = `/*@@${marker}@@*/ {}`
    if (!source.includes(token)) throw new Error(`Platzhalter ${marker} fehlt im Worker`)
    return source.replace(token, () => JSON.stringify(value)) // Funktion: keine $-Ersetzungsmuster
  }
  return fill(fill(worker, 'ASSETS', assets), 'BUNDLE', { version: RELAY_BUNDLE_VERSION, protocol: RELAY_PROTOCOL_VERSION })
}

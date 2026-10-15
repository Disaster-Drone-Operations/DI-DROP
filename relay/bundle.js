// Builds a single worker module from the worker source and the phone web page.
// Used by the Cloudflare deployer in the desktop app (files via Vite "?raw")
// and by relay/dev.mjs for local testing with wrangler.

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
    return source.replace(token, () => JSON.stringify(value)) // function: no $ replacement patterns
  }
  return fill(fill(worker, 'ASSETS', assets), 'BUNDLE', { version: RELAY_BUNDLE_VERSION, protocol: RELAY_PROTOCOL_VERSION })
}

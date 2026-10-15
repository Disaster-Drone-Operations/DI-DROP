// Local test of the relay without a Cloudflare account:
//   node relay/dev.mjs && npx wrangler dev --config relay/wrangler.dev.toml
// Builds relay/.dev/worker.js from the same files the app uploads on deployment.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorkerScript } from './bundle.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8')
const script = buildWorkerScript({ worker: read('worker.js'), html: read('phone.html'), app: read('phone.js'), protocol: read('protocol.js') })
fs.mkdirSync(path.join(dir, '.dev'), { recursive: true })
fs.writeFileSync(path.join(dir, '.dev/worker.js'), script)
console.log(`relay/.dev/worker.js (${script.length} characters)`)

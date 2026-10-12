import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import ejsPlugin from './config/vite/ejs_plugin.js'
import devBridge from './config/vite/dev_bridge.js'

const root = fileURLToPath(new URL('.', import.meta.url))
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [ejsPlugin({ root }), devBridge({ root })],

  // Tauri erwartet einen festen Port und soll Rust-Fehler nicht wegräumen
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**', '**/tmp/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})

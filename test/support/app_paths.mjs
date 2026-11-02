// Node: resolve the app's absolute imports ("/app/…", "/lib/…") against the repository – for unit tests of
// pure modules:  node --import ./test/support/app_paths.mjs --test test/*.test.mjs
import { register } from 'node:module'

register('./app_paths_hooks.mjs', import.meta.url)

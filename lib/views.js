// View registry: all templates from app/views are precompiled at build time
// (see config/vite/ejs_plugin.js) and registered here under their path:
//   app/views/missions/show.ejs → 'missions/show'

import { escapeHtml } from '/app/helpers/index.js'

const modules = import.meta.glob('/app/views/**/*.ejs', { import: 'default', eager: true })

const templates = Object.fromEntries(
  Object.entries(modules).map(([file, fn]) => [file.replace('/app/views/', '').replace(/\.ejs$/, ''), fn]),
)

function rethrow(err, lines, filename, lineno) {
  const all = lines.split('\n')
  const start = Math.max(lineno - 3, 0)
  const context = all
    .slice(start, Math.min(all.length, lineno + 3))
    .map((line, i) => `${i + start + 1 === lineno ? ' >> ' : '    '}${i + start + 1}| ${line}`)
    .join('\n')
  err.message = `${filename}:${lineno}\n${context}\n\n${err.message}`
  throw err
}

export function render(name, locals = {}) {
  const template = templates[name]
  if (!template) throw new Error(`View not found: ${name}`)
  // include('missions/_card', { mission }) — partials inherit the caller's locals
  const include = (partial, data = {}) => render(partial, { ...locals, ...data })
  return template(locals, escapeHtml, include, rethrow)
}

export default { render }

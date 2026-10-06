// View-Registry: alle Templates aus app/views werden beim Build vorkompiliert
// (siehe config/vite/ejs_plugin.js) und hier unter ihrem Pfad registriert:
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
  if (!template) throw new Error(`View nicht gefunden: ${name}`)
  // include('missions/_card', { mission }) — Partials erben die Locals des Aufrufers
  const include = (partial, data = {}) => render(partial, { ...locals, ...data })
  return template(locals, escapeHtml, include, rethrow)
}

export default { render }

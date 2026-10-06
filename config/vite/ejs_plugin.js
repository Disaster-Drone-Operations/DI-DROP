// Vite-Plugin: kompiliert app/views/**/*.ejs beim Build zu normalen JS-Funktionen.
//
// Vorteile gegenüber Rendern zur Laufzeit:
//   * kein eval/new Function nötig → strenge Content-Security-Policy möglich
//   * Syntaxfehler in Templates fallen schon beim Build auf
//
// Weil ES-Module immer im Strict Mode laufen (kein `with`), müssen die Locals
// eines Templates deklariert werden – wie bei Rails' "strict locals":
//
//   <%# locals: mission, flights %>
//
// Alle Helper aus app/helpers/*.js stehen in jedem Template automatisch zur Verfügung.

import ejs from 'ejs'
import fs from 'node:fs'
import path from 'node:path'

const LOCALS_COMMENT = /<%#\s*locals:\s*([\w\s,]*?)\s*-?%>/

function helperNames(helpersDir) {
  const names = new Set()
  for (const file of fs.readdirSync(helpersDir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(helpersDir, file), 'utf8')
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)) names.add(m[1])
  }
  return [...names]
}

export default function ejsPlugin({ root }) {
  const helpersDir = path.join(root, 'app/helpers')

  return {
    name: 'di-drop:ejs',
    enforce: 'pre',

    transform(text, id) {
      if (!id.endsWith('.ejs')) return null

      const declared = (text.match(LOCALS_COMMENT)?.[1] ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean)
      const helpers = helperNames(helpersDir).filter((h) => !declared.includes(h))
      const filename = path.relative(root, id)

      const template = new ejs.Template(text, {
        strict: true,
        _with: false,
        compileDebug: true,
        destructuredLocals: declared,
        filename,
      })
      template.compile()

      const code = `
import * as __helpers from '/app/helpers/index.js'
const { ${helpers.join(', ')} } = __helpers
export default function render(locals, escapeFn, include, rethrow) {
  let __line = 1
  const __lines = ${JSON.stringify(text)}
  const __filename = ${JSON.stringify(filename)}
  try {
${template.source}
  } catch (e) {
    rethrow(e, __lines, __filename, __line, escapeFn)
  }
}
`
      return { code, map: null }
    },

    // Neue Helper-Funktionen → alle Templates neu kompilieren
    handleHotUpdate({ file, server }) {
      if (file.startsWith(helpersDir)) {
        server.moduleGraph.invalidateAll()
        server.ws.send({ type: 'full-reload' })
        return []
      }
    },
  }
}

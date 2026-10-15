// Generates public/data/licenses.json: all libraries included in the app, with license texts
// (for the "Über di-drop" (About) page). Rerun after changes to package.json or Cargo.toml:
//   node script/build_licenses.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i
const entries = []

function licenseTexts(dir) {
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort()
  } catch {
    return ''
  }
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n---\n\n')
}

// ── JavaScript: runtime dependencies only ("dependencies"), recursively ──
const seen = new Set()
function addNpm(name, from = '.') {
  let dir = path.join(from, 'node_modules', name)
  while (!fs.existsSync(dir) && from !== '.') {
    from = path.dirname(path.dirname(from)) // look in parent node_modules
    dir = path.join(from, 'node_modules', name)
  }
  if (!fs.existsSync(dir)) dir = path.join('node_modules', name)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (seen.has(key)) return
  seen.add(key)
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'unbekannt'
  entries.push({ name: pkg.name, version: pkg.version, license, text: licenseTexts(dir), kind: 'JavaScript' })
  for (const dep of Object.keys(pkg.dependencies ?? {})) addNpm(dep, dir)
}
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'))
for (const dep of Object.keys(root.dependencies)) addNpm(dep)

// ── Rust: normal dependencies of the app (without dev/build tools) ──
const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], { maxBuffer: 1 << 28 }))
const packages = new Map(meta.packages.map((p) => [p.id, p]))
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
const visit = new Set()
const queue = [meta.resolve.root]
while (queue.length) {
  const id = queue.shift()
  if (visit.has(id)) continue
  visit.add(id)
  for (const dep of nodes.get(id)?.deps ?? []) {
    if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg)
  }
}
visit.delete(meta.resolve.root)
for (const id of visit) {
  const p = packages.get(id)
  const authors = (p.authors ?? []).map((a) => a.replace(/\s*<[^>]*>/, '')).join(', ')
  entries.push({ name: p.name, version: p.version, license: p.license ?? 'unbekannt', text: licenseTexts(path.dirname(p.manifest_path)), kind: 'Rust', authors })
}

// Packages without a license file: insert the standard text of the (first matching) license
const apacheText = entries.find((e) => /Apache License\s+Version 2\.0, January 2004/.test(e.text) && e.text.length < 12_000)?.text
const MIT = (holders) => `MIT License

Copyright (c) ${holders}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
const fallback = {
  MIT: (e) => MIT(e.authors || `the ${e.name} authors`),
  'Apache-2.0': () => apacheText,
  'BSD-3-Clause': (e) => `BSD 3-Clause License\n\nCopyright (c) ${e.authors || `the ${e.name} authors`}\n\nRedistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  'MPL-2.0': () => 'This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.\nQuelltext: https://crates.io/crates/selectors',
}
for (const e of entries) {
  if (e.text) continue
  const ids = e.license.split(/\s+OR\s+|\//).map((x) => x.trim())
  const id = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'MPL-2.0'].find((x) => ids.includes(x))
  if (id) e.text = fallback[id](e) ?? ''
}

// Merge identical texts (e.g. hundreds of identical MIT/Apache texts).
// The texts end up in the About page, so the fallback strings ('unbekannt' etc.) stay German.
const groups = new Map()
for (const e of entries) {
  const text = e.text || `Kein Lizenztext im Paket enthalten. Lizenz laut Paketangabe: ${e.license}.`
  const hash = crypto.createHash('sha1').update(`${e.license}\n${text}`).digest('hex')
  if (!groups.has(hash)) groups.set(hash, { license: e.license, text, packages: [] })
  groups.get(hash).packages.push(`${e.name} ${e.version}`)
}
const result = [...groups.values()]
  .map((g) => ({ ...g, packages: g.packages.sort((a, b) => a.localeCompare(b)) }))
  .sort((a, b) => a.packages[0].localeCompare(b.packages[0]))
fs.mkdirSync('public/data', { recursive: true })
fs.writeFileSync('public/data/licenses.json', JSON.stringify({ count: entries.length, groups: result }))
const withoutText = entries.filter((e) => !e.text)
console.log(`${entries.length} packages (${entries.filter((e) => e.kind === 'Rust').length} Rust), ${result.length} license texts, ${withoutText.length} without text`)
console.log(`Size: ${(fs.statSync('public/data/licenses.json').size / 1024).toFixed(0)} KB`)
if (withoutText.length) console.log('Without license file:', withoutText.map((e) => `${e.name} (${e.license})`).join(', '))

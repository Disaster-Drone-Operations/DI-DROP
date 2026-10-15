// Sets the version number everywhere at once: package.json, tauri.conf.json, Cargo.toml
//   node script/bump_version.mjs 0.2.0
import fs from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: node script/bump_version.mjs 1.2.3')
  process.exit(1)
}

const json = (file, change) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  change(data)
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}
json('package.json', (d) => (d.version = version))
json('src-tauri/tauri.conf.json', (d) => (d.version = version))
json('package-lock.json', (d) => {
  d.version = version
  if (d.packages?.['']) d.packages[''].version = version
})

const cargo = 'src-tauri/Cargo.toml'
const toml = fs.readFileSync(cargo, 'utf8')
fs.writeFileSync(cargo, toml.replace(/^version = "[^"]+"/m, `version = "${version}"`))

console.log(`Version ${version} set. Next:\n  git commit -am "Version ${version}" && git tag v${version} && git push && git push --tags`)

// Erzeugt die Ortsliste für die Adress-Ermittlung ohne Internet (public/data/places_de.tsv).
//   curl -O https://download.geonames.org/export/dump/DE.zip && unzip DE.zip
//   node script/build_places.mjs /pfad/zu/DE.txt
// Quelle: GeoNames (https://www.geonames.org), Lizenz CC BY 4.0.
// Behalten werden bewohnte Orte und Ortsteile (Klasse P), ohne historische/verlassene.
import fs from 'node:fs'

const source = process.argv[2]
if (!source) throw new Error('Pfad zu DE.txt angeben')
const skip = new Set(['PPLH', 'PPLQ', 'PPLW', 'PPLCH'])
const rows = []
for (const line of fs.readFileSync(source, 'utf8').split('\n')) {
  const c = line.split('\t')
  if (c[6] !== 'P' || skip.has(c[7])) continue
  const name = c[1].replace(/\s+/g, ' ').trim()
  if (!name) continue
  // Name, Breite, Länge (5 Nachkommastellen ≈ 1 m), Einwohner (0 = unbekannt)
  rows.push(`${name}\t${Number(c[4]).toFixed(5)}\t${Number(c[5]).toFixed(5)}\t${Number(c[14]) || 0}`)
}
fs.mkdirSync('public/data', { recursive: true })
fs.writeFileSync('public/data/places_de.tsv', `# GeoNames (geonames.org), CC BY 4.0 – erzeugt mit script/build_places.mjs\n${rows.join('\n')}\n`)
console.log(`${rows.length} Orte → public/data/places_de.tsv`)

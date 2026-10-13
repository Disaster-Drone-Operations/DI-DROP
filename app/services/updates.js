// Einstellungen → Aktualisierungen: Daten, die di-drop bei Bedarf selbst nachlädt.
// Neuer Eintrag = neues Objekt in dieser Liste:
//   { key, title, description, action?, available(), status() → Text, run(report) → Text }
//   report(text) zeigt Zwischenstände (z. B. Download-Fortschritt)

import platform from '/lib/platform/index.js'
import { placesInfo, reloadPlaces } from '/app/services/address_service.js'
import * as appUpdater from '/app/services/app_updater.js'

const number = (n) => n.toLocaleString('de-DE')
const date = (ms) => new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

export default [
  {
    key: 'app',
    title: 'di-drop',
    description: 'Neue Versionen mit Verbesserungen und Fehlerbehebungen. di-drop sieht beim Start von selbst nach und fragt, bevor etwas installiert wird.',
    action: 'Nach Updates suchen',
    available: () => appUpdater.isAvailable(),
    async status() {
      return `Installiert: Version ${await appUpdater.currentVersion()}`
    },
    async run(report) {
      report('Suche nach Updates …')
      const info = await appUpdater.findUpdate()
      if (!info) return `Aktuell – Version ${await appUpdater.currentVersion()} ist die neueste.`
      if (!(await appUpdater.askToInstall(info))) return `Version ${info.version} ist verfügbar – später installieren.`
      await appUpdater.installUpdate(report)
      return 'di-drop startet neu …'
    },
  },
  {
    key: 'places',
    title: 'Ortsnamen',
    description: 'Damit di-drop auch ohne Internet sagen kann, wo ein Standort liegt („Musterdorf, 1,2 km nordöstlich“). Quelle: GeoNames (geonames.org), etwa 7 MB Download.',
    available: () => !!platform.places,
    async status() {
      const info = await platform.places?.info().catch(() => null)
      if (info) return `Aktualisiert am ${date(info.updatedAt)} · ${number(info.count)} Orte`
      const { count } = await placesInfo()
      return `Mit der App mitgeliefert · ${number(count)} Orte`
    },
    async run() {
      const info = await platform.places.update()
      reloadPlaces()
      return `Aktualisiert · ${number(info.count)} Orte`
    },
  },
]

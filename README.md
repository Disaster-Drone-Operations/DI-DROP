# di-drop – Disaster Drone Operator

Werkzeug für den Drone Operator im Katastrophenschutz: Einsätze und Übungen anlegen,
Flüge (Initial-, Kontroll- und Spezialflüge) erfassen und später Bilder von der
SD-Karte übernehmen und bereitstellen (USB-Stick, Ordner, Nextcloud).

Läuft als native Desktop-App unter **macOS und Windows** (Tauri 2) und – mit
eingeschränkten Funktionen – auch im **Browser**. Komplett offline.

## Installieren

Installer für macOS und Windows: [Releases](https://github.com/Disaster-Drone-Operations/DI-DROP/releases/latest).
di-drop aktualisiert sich danach selbst. Wie ein Release entsteht: [docs/release.md](docs/release.md).

## Entwickeln

Voraussetzungen: Node 22 (`nvm use`), Rust (`rustup`), unter macOS die Xcode Command Line Tools.

```bash
npm install
npm run tauri dev     # Desktop-App mit Hot Reload
npm run dev           # nur Browser-Variante: http://localhost:1420
npm run tauri build   # Installer bauen (.dmg / .msi) → src-tauri/target/release/bundle/
```

### Testen mit echten Bildern im Browser

Im Dev-Server kann die Browser-Variante den echten Rust-Code nutzen – praktisch zum
Testen von Import & Co. ohne Desktop-Fenster:

```bash
(cd src-tauri && cargo build --example didrop-dev)
npm run dev               # dann http://localhost:1420/?bridge öffnen
```

Importierte Dateien landen dabei in `tmp/dev-media/`. Testbilder im DJI-Format erzeugt
`script/make_test_images.sh <ordner>`; Rust-Tests mit echten Bildern:
`DIDROP_TEST_IMAGES=/pfad cargo test -- --ignored --nocapture` (in `src-tauri/`).

## Aufbau (Rails-Leute fühlen sich zu Hause)

```
app/
  controllers/        Controller mit Actions (index, show, new, create …)
  models/             Models auf Basis von lib/record.js (ActiveRecord-light)
  views/              EJS-Templates (ERB-Syntax), Partials mit _ und include()
  helpers/            Helper – automatisch in allen Views verfügbar
  javascript/
    application.js    Einstiegspunkt
    controllers/      Stimulus-Controller (automatisch registriert)
  assets/stylesheets/ CSS (Light/Dark, macOS/Windows-Feinschliff)
config/
  routes.js           Routen-DSL: r.resources('missions', () => …)
  settings.js         Schema für das Einstellungs-Menü (neue Rubrik = neuer Eintrag)
db/migrate/           SQL-Migrations, laufen beim Start automatisch
lib/                  Mini-Framework: Router, Controller, Record, Views, Platform-Adapter
app/services/         Abläufe über mehrere Models hinweg (z. B. MediaImporter)
src-tauri/            Rust-Seite: Bild-Scan, Metadaten, Import, Vorschaubilder
```

### Konventionen

- **URLs** leben im Hash: `<a href="#/missions/3">`.
- **Formulare** wie in Rails: `<form action="#/missions/3" method="post">` plus
  `<input type="hidden" name="_method" value="patch">`, Parameter als `mission[title]`.
  `data-confirm="…"` zeigt vorher einen nativen Bestätigungsdialog.
- **Views deklarieren ihre Locals** in der ersten Zeile (wie Rails' strict locals):
  `<%# locals: mission, flights -%>`. Die Templates werden beim Build zu JS
  vorkompiliert – kein `eval`, strenge Content-Security-Policy.
- **Alles Plattformspezifische** (Datenbank, Dialoge, später Laufwerke) läuft über
  `lib/platform/` – `tauri.js` für Desktop, `browser.js` für die Web-Variante.

## Daten

SQLite. Desktop: `~/Library/Application Support/app.didrop.desktop/di-drop.db`
bzw. `%APPDATA%\app.didrop.desktop\di-drop.db`. Browser: SQLite als WebAssembly,
gespeichert in IndexedDB.

## Mein Standort (Location Relay)

Der Rechner hat oft kein GPS – das Smartphone liefert die Position. di-drop zeigt einen
QR-Code, das Smartphone öffnet die Relay-Webseite, verbindet sich und sendet die Position
Ende-zu-Ende-verschlüsselt (AES-GCM, Schlüssel nur im QR-Fragment). Protokoll:
[`docs/location-relay-protocol.md`](docs/location-relay-protocol.md).

- `relay/` – Cloudflare Worker + Durable Object (`worker.js`), Smartphone-Seite
  (`phone.html`, `phone.js`), gemeinsames Protokoll (`protocol.js`), Bundle-Bauer.
- `lib/location/` – Desktop-Client des Protokolls, Koordinaten (Dezimal, GMS, UTM 32) und Kartenlinks.
- `app/services/location_service.js` – aktuelle Position nur im Arbeitsspeicher, keine Historie.
- `app/services/cloudflare_deployer.js` – Assistent unter *Einstellungen → Telefon-Verbindung*:
  installiert den Relay im **eigenen** Cloudflare-Konto des Nutzers (API-Token mit
  „Workers-Skripte bearbeiten“ + „Kontoeinstellungen lesen“). Der Token liegt nur im
  Schlüsselbund (`src-tauri/src/cloudflare.rs`) und wird im Betrieb nicht gebraucht.

Lokal ohne Cloudflare testen:

```bash
node relay/dev.mjs && npx wrangler dev --config relay/wrangler.dev.toml --port 8787 --ip 127.0.0.1
RELAY_URL=http://127.0.0.1:8787 node --test test/relay.contract.test.mjs
```

In der App unter *Telefon-Verbindung → Eigenen Relay-Server verwenden* `http://127.0.0.1:8787`
eintragen; den QR-Link in einem zweiten Browser-Tab öffnen (Geolocation ggf. per Konsole simulieren).

### Ortsangabe aus Koordinaten

`app/services/address_service.js`: ohne Internet der nächste Ort aus der Ortsliste
(„Musterdorf, 1,3 km nordöstlich“), mit Internet die Adresse von OpenStreetMap Nominatim
(Rust: `src-tauri/src/geocode.rs`, App-Kennung, max. 1 Anfrage/s). Genutzt auf „Mein Standort“
und beim Knopf „Hier“ neben dem Einsatzort.

Die Ortsliste (`public/data/places_de.tsv`, GeoNames, CC BY 4.0) wird mitgeliefert und kann unter
*Einstellungen → Aktualisierungen* neu geladen werden (`src-tauri/src/places.rs`, gespeichert in
den App-Daten). Mitgelieferte Fassung neu erzeugen: `node script/build_places.mjs /pfad/DE.txt`.

### Lizenzen

„Über di-drop“ (App-Menü bzw. Einstellungen) zeigt Quellenangaben für OpenStreetMap und GeoNames
sowie alle Bibliotheken mit Lizenztexten aus `public/data/licenses.json`
(neu erzeugen: `node script/build_licenses.mjs`).

## Bereitstellen (Nextcloud, USB-Stick)

Auf der Seite eines Auftrags „Bereitstellen …“: Ziel wählen, Bilder auswählen (Wärme- und
Sichtbild getrennt), hochladen. Die Warteschlange läuft im Hintergrund weiter; links unten zeigt
ein Balken Fortschritt, Geschwindigkeit und Restzeit, ein Klick öffnet die Übersicht mit
Pausieren, Abbrechen, „An den Anfang“ und „Ans Ende“.

- Nextcloud: *Einstellungen → Nextcloud* (Anmeldung im Browser per Login Flow v2 oder App-Passwort;
  Zugang im Schlüsselbund). Pro Einsatz ein Basisordner, darin ein Ordner pro Auftrag.
- Ordner: beliebiger Ordner/USB-Stick; darin Einsatzordner und Auftragsordner wie auf der Festplatte.
- Rust: `src-tauri/src/transfer/` (Kopieren mit Fortschritt/Abbruch, WebDAV-Upload als Datenstrom).
- Test-Nextcloud: `node test/support/nextcloud_mock.mjs 8088 tmp/nextcloud-mock 500`.

## Lizenz

di-drop steht unter der [MIT-Lizenz](LICENSE). Verwendete Bibliotheken und Daten (OpenStreetMap,
GeoNames) behalten ihre eigenen Lizenzen – siehe „Über di-drop“ in der App.

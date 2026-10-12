# di-drop – Disaster Drone Operator

Werkzeug für den Drone Operator im Katastrophenschutz: Einsätze und Übungen anlegen,
Flüge (Initial-, Kontroll- und Spezialflüge) erfassen und später Bilder von der
SD-Karte übernehmen und bereitstellen (USB-Stick, Ordner, Nextcloud).

Läuft als native Desktop-App unter **macOS und Windows** (Tauri 2) und – mit
eingeschränkten Funktionen – auch im **Browser**. Komplett offline.

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
(cd src-tauri && cargo build --bin didrop-dev)
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

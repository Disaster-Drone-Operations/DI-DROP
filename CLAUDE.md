# di-drop – Hinweise für die Entwicklung

Desktop-App (Tauri 2) für den Drone Operator der Bergwacht im Katastrophenschutz.
Aufbau und Konventionen: siehe README.md.

**Code ist durchgehend englisch** (Kommentare, Bezeichner, gespeicherte Werte wie
`operation`/`exercise`, `open`/`done`, `control`). Deutsch nur, was Nutzer sehen: Texte,
Meldungen, Menüs sowie Datei- und Ordnernamen auf der Festplatte („Flugprotokolle“, „…_Wärmebild.JPG“).

## Datenmodell (Kurzfassung)

```
Einsatz (missions)
 ├─ Aufträge (assignments)      Lageerkundung, Kontrollflug n, Spezialauftrag „…“, Sonstiges …
 │   status open/done, due_at (leer = sofort); Kontrollflüge gehören zu einer
 │   Serie (assignment_series) – „Erledigt“ plant den nächsten oder beendet die Serie
 ├─ Flüge (flights)             entstehen intern beim Import (für ein späteres Flugprotokoll);
 │                              in der Oberfläche nicht sichtbar – dort zählt nur der Auftrag
 ├─ Bilder (media_files)        gehören zu einem Auftrag; Duplikate werden pro Einsatz erkannt
 ├─ Wegpunkte (viewpoints)      gleiche Kameraposition über mehrere Flüge → Vergleichsbilder
 ├─ Vergleichsbilder (comparisons)
 └─ Bereitstellungen (upload_batches → upload_items)
                                pro Auftrag + Ziel (Nextcloud, Ordner …); Warteschlange in
                                app/services/upload_queue.js, Ziele in app/services/upload_targets.js

Flugprotokolle (flight_logs)    Flüge aus den Protokollen der DJI-Fernsteuerung (unabhängig von Einsätzen;
                                mission_id für eine spätere Zuordnung). Originaldateien unverändert in
                                <Bildablage>/Flugprotokolle (src-tauri/src/flightlogs.rs)
```

Neuer Einsatz → Auftrag „Lageerkundung“ wird automatisch angelegt.

## Leitlinie für die Oberfläche

Die App wird im Einsatz, oft unter Zeitdruck, von Kameraden bedient, die nicht alle
Funktionen kennen und teils wenig Computererfahrung haben. Vorbild ist macOS:

- **Grundfunktionen sehr einfach und übersichtlich.** Pro Seite eine klar erkennbare
  Hauptaktion (roter Knopf). Der häufigste Weg braucht keine Entscheidungen –
  sinnvolle Vorgaben statt Pflichtfragen.
- **Spezielles ist selbsterklärend, nicht versteckt, aber dezent.** Seltene oder optionale
  Felder hinter einer Aufklappzeile („Weitere Angaben“, `<details class="disclosure">`).
  Sie öffnet sich von selbst, wenn darin Fehler oder Werte stehen.
- **Klare Wörter statt Kürzel.** „Sichtbild“/„Wärmebild“ statt „V“/„T“; Fachbegriffe nur,
  wo sie im Einsatz gebräuchlich sind.
- **Immer den nächsten Schritt zeigen** (z. B. nach dem Import: „Vergleichsbilder erstellen“).
- **Nichts geht unbemerkt verloren:** Löschen/Abschließen immer mit Rückfrage,
  Rückmeldung nach jeder Aktion (Hinweis oben rechts).
- Native Bedienelemente und Systemschrift; Mauszeiger und Markierverhalten wie in
  nativen Apps.

## Tastenkürzel, Menü, Widerrufen

- Neue App-Befehle: in `app/javascript/shortcuts.js` (Befehl + Taste für Windows/Browser)
  **und** in `src-tauri/src/menu.rs` (deutsches macOS-Menü, sendet die Befehls-Kennung).
  Kürzel-Übersicht: `app/views/layouts/_shortcuts.ejs`.
- Widerrufbare Aktionen: `undo.record({ label, undo, redo })` aus `lib/undo.js` und in der
  Meldung `{ notice, undo: true }` mitgeben (zeigt den Knopf „Widerrufen“).
  Nicht widerrufbar (dafür mit Rückfrage): Import, Einsatz löschen.

## Migrationen

- `db/migrate/*.sql`, laufen beim Start atomar (eine Transaktion pro Datei).
- Tabellen-Umbau: Zeile `-- migrate: foreign_keys=off` in die Datei schreiben.
- Achtung: Die laufende Desktop-App lädt Codeänderungen sofort nach – eine Migration
  daher erst speichern, wenn sie vollständig ist (sonst läuft eine halbe Version).

## Mein Standort / Relay (auch „An Telefon senden“)

- Derselbe Relay überträgt Positionen (Smartphone → Desktop) und Bilder (Desktop → Smartphone,
  `lib/relay/image_client.js`, `app/services/image_share.js`, Dialog `images/_send_dialog` im Layout).
  Bilder gehen vorerst immer als Original (mit EXIF); Sichtbilder verkleinern kommt später.
  Gemeinsamer Client: `lib/relay/relay_client.js` (Verbindung, Pairing, Reconnect).

- Protokolländerungen nur zusammen mit `docs/location-relay-protocol.md` und den
  Vertrags-Tests (`test/relay.contract.test.mjs`). Nach Änderungen an `relay/*`
  `RELAY_BUNDLE_VERSION` in `relay/bundle.js` erhöhen (der Assistent prüft sie per `/health`).
- Sicherheitsregeln: Cloudflare-Token nie im Worker, auf der Smartphone-Seite, im QR-Code,
  in WebSocket-Nachrichten oder Logs; kein Global API Key; Positionen nie dauerhaft speichern;
  im Zweifel Verbindung abbrechen (fail closed).
- QR-Dialog überall per `<%- include('location/_transfer_dialog') %>` einbinden und nur
  `startTransfer()` aufrufen – der Dialog öffnet sich selbst.
- Nachladbare Daten (Ortsliste u. Ä.) als Eintrag in `app/services/updates.js`
  (Einstellungen → Aktualisierungen).
- Ansichten, die oft neu gezeichnet werden, mit `morph()` aus `lib/morph.js` aktualisieren
  (sonst gehen Klicks verloren).

## Bereitstellen / Uploads

- Reihenfolge: Wärmebilder → Vergleichsbilder → Sichtbilder (über alle Aufträge).
- Neues Ziel: Eintrag in `app/services/upload_targets.js` + Übertragung in
  `src-tauri/src/transfer/` + `lib/platform/*`. Die Warteschlange bleibt unverändert.
- Zugangsdaten (Nextcloud-App-Passwort) nur im Schlüsselbund, nie in der Datenbank.
- Sicherheitsregeln (in Rust erzwungen, `src-tauri/src/transfer/`): Nextcloud nur PROPFIND (Ordnernamen),
  HEAD, MKCOL, PUT – nie DELETE/MOVE/COPY/GET. Hochladen nur in den übergebenen Ordner (nie in `/`,
  kein `..`), reiner Dateiname; vorhandene Dateien werden nie überschrieben (`If-None-Match: *`,
  sonst Ausweichname `…_2.JPG`). Gilt genauso für den Ordner-Export.
- Nie selbst in die echte Nextcloud der Desktop-App hochladen – nur Browser-Brücke + Test-Nextcloud.
- Testen ohne echte Nextcloud: `node test/support/nextcloud_mock.mjs 8088 tmp/nextcloud-mock 500`
  (Adresse `http://127.0.0.1:8088`, letzter Wert = KB/s-Drossel); Browser-Brücke speichert
  den Zugang in `tmp/dev-nextcloud.json`.

## Flugprotokolle

- DJI Pilot 2 legt `DJIFlightRecord_*.txt` auf der Fernsteuerung unter
  `DJI/com.dji.industry.pilot/FlightRecord` ab. Zugriff per MTP mit `mtp-rs` (Windows: WPD,
  macOS: USB – dort kann der Systemdienst `ptpcamerad` das Gerät blockieren).
- Ab Format 13 sind die Messreihen verschlüsselt (DJI-Schlüssel nötig); die Eckdaten
  (Start, Dauer, Strecke in km, Akku-SN …) nicht – nur diese werden bisher ausgewertet.
- Immer alle übernehmen, nie überschreiben (gleicher Name + Größe = schon da).
- Mit übernommen (gleiche Ordnerstruktur): `FlightTaskReplay/` immer, `MCDatFlightRecords/`
  (Rohdaten des Flugcontrollers, ~20 MB je Flug) nur mit Einstellung `flightlogs.include_dat`.
- Testen ohne Fernsteuerung: Ordner-Import in der Browser-Brücke (`flightlogs-import` im Hilfsprogramm).

## SD-Karten

- Erkennung: `src-tauri/src/sdcard.rs` prüft alle 2 s die eingehängten Laufwerke auf einen `DCIM`-Ordner
  (Ereignisse `sdcard:inserted`/`sdcard:removed`); `app/services/sdcard_watcher.js` öffnet den
  Import-Dialog auf der passenden Einsatzseite (nur wenn Bilder neu in *allen* Einsätzen sind).
- Aufnahmen vor Einsatzbeginn = „Ältere Aufnahmen“: nicht vorausgewählt, nie von der Karte gelöscht.
- Löschen von der Karte nur in Rust (`sdcard::delete_imported`): Quelle unter `<Karte>/DCIM`, Bild-/Videoformat,
  Kopie außerhalb der Karte mit gleicher Größe und gleichem Fingerabdruck – sonst bleibt die Datei.
  Danach nur leer gewordene Ordner unter DCIM entfernen, nie DCIM selbst.
- RTK-Rohdaten neben den Bildern (`.MRK` Zeit/Position/Antennenversatz je Foto, `.OBS`/`.NAV` RINEX-Satellitendaten,
  `.RTK` DJI-Rohdaten, `ppk_file_name.pbk`): bisher ungenutzt (auch nicht fürs Orthophoto), werden mit dem zweiten
  Haken gelöscht – nur in Ordnern ohne verbliebene Aufnahme. Für eine spätere PPK-Nachberechnung (Orthophoto bei
  RTK float/single, XMP `RtkFlag` ≠ 50) wären sie die Grundlage; bei RTK fixed stehen die Positionen schon im Bild.
- Testen nie mit echter Karte: in der Browser-Brücke gilt jeder Ordner in `tmp/dev-sdcards/` als Karte
  (dort Kopien von Testbildern ablegen; gelöscht wird in der Brücke nur dort).

## Akkunutzung

- `app/services/battery_usage.js`: Flugstunden je Akku aus `flight_logs`, verglichen als
  Flugstunden je Einsatzjahr (erster Flug → heute bzw. → Ausmusterung; mind. 30 Tage).
  Empfehlung: die 2 aktiven Akkus mit den wenigsten Stunden je Einsatzjahr. Lagerhinweis ab 60 Tagen.
- Starts werden nur angezeigt (ein Akku kann mehrere kurze Flüge mit einer Ladung machen).
- Ausmustern: `battery_states.retired_at`; Namen in `device_names`.

## Releases & Auto-Update

- Ablauf: `docs/release.md` – `node script/bump_version.mjs X.Y.Z`, Tag `vX.Y.Z` pushen,
  GitHub Actions baut macOS (universal) + Windows, Release-Entwurf veröffentlichen.
- Update-Signatur: privater Schlüssel nur in `~/.tauri/di-drop-updater.key` bzw. GitHub-Secret
  `TAURI_SIGNING_PRIVATE_KEY` – nie ins Repository. Öffentlicher Schlüssel in `tauri.conf.json`.
- `app.security.csp` gilt für Releases (ohne lokale Test-Adressen), `devCsp` für die Entwicklung.
- Lokal wird kein DMG gebaut (das Skript braucht Finder-Fernsteuerung); `--bundles app` genügt zum Prüfen.

## Lizenzen & Quellenangaben

- Nach jeder Änderung an Abhängigkeiten (package.json, Cargo.toml):
  `node script/build_licenses.mjs` → `public/data/licenses.json` (Seite „Über di-drop“).
- Daten von Dritten immer dort kennzeichnen, wo sie erscheinen (OpenStreetMap:
  „© OpenStreetMap-Mitwirkende“, GeoNames: „CC BY 4.0“), und auf „Über di-drop“ aufführen.

## Testen

- Browser + echter Rust-Code: `http://localhost:1420/?bridge` (siehe README).
- Desktop-App für den Entwickler bauen: als App-Paket (nur so wirken `src-tauri/Info.plist` –
  deutsche App – und das Suchfeld im Hilfe-Menü):
  `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/di-drop-updater.key)" npx tauri build --debug --bundles app`,
  dann `open -n src-tauri/target/debug/bundle/macos/di-drop.app`. Schneller ohne Paket:
  `npx tauri build --debug --no-bundle` und `src-tauri/target/debug/di-drop` starten. So ist die Oberfläche fest eingebaut und die App
  läuft auch ohne Vite-Server (den beendet die Claude-App am Ende jeder Antwort).
  `cargo build` allein baut eine Variante, die die Oberfläche von `localhost:1420` lädt.
- Desktop-App per Skript bedienen: `script/ui/` (Fenster-Screenshots, Klicks).
  Nur das di-drop-Fenster fotografieren, nie den ganzen Bildschirm.
- Echte Einsatzbilder gehören nie ins Repository (Datenschutz). Zum Testen eigene DJI-Aufnahmen
  verwenden oder mit `script/make_test_images.sh` Testbilder erzeugen.

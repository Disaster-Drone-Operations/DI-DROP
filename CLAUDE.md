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
 │   └─ Markierungen (annotations)  je Bild oder Vergleichsbild; Kopie „…_markiert.JPG“ daneben
 ├─ Wegpunkte (viewpoints)      gleiche Kameraposition über mehrere Flüge → Vergleichsbilder
 ├─ Vergleichsbilder (comparisons)
 └─ Bereitstellungen (upload_batches → upload_items)
                                pro Auftrag + Ziel (Nextcloud, Ordner …); Warteschlange in
                                app/services/upload_queue.js, Ziele in app/services/upload_targets.js

Flugprotokolle (flight_logs)    Flüge aus den Protokollen der DJI-Fernsteuerung. Originaldateien unverändert in
                                <Bildablage>/Flugprotokolle (src-tauri/src/flightlogs.rs). Einsatz: mission_id,
                                mission_source auto (Bilder während des Flugs, sonst Zeitfenster genau eines
                                Einsatzes) | manual (von Hand, auch „kein Einsatz“) – app/services/flight_missions.js
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

## Nutzerführung und Begriffe

- **Roter Faden:** Einsatz → Auftrag → Bilder → Vergleichsbilder → Bereitstellen → Erledigt. Bilder gehören immer
  zu einem Einsatz (kein eigenes „Bilddaten“-Modul mehr; `/media` leitet um).
- **Nächster Schritt:** `app/services/next_step.js` bestimmt ihn für Einsatz (Leiste oben auf der Einsatzseite,
  einziger roter Knopf) und Auftragskarten (Stand: Bilder · Vergleich · Bereitgestellt · Erledigt).
  Neue Arbeitsschritte dort einordnen. Bereitgestellt wird je Auftrag (`/missions/:id/assignments/:id/provide`).
  „Fehlt noch“: Ist von einem Auftrag schon etwas bereitgestellt, gilt die Auswahl als getroffen (z. B. nur
  Wärmebilder) – danach fehlen nur noch neue Vergleichsbilder (`assignmentStates`).
  Vergleichsbilder erst vorschlagen, wenn ein Wegpunkt mehrfach angeflogen wurde. Die Leiste aktualisiert sich
  live (`next_step_controller.js`: Bereitstellungen, Uhr).
- **Eine Hauptaktion pro Seite** (roter Knopf) – weitere Knöpfe grau.
- **Begriffe:** *Bilder* (Dateien aus der Drohne), *Aufnahme* (ein Auslösen: Sicht- + Wärmebild), *Bereitstellen*
  (Oberbegriff für Nextcloud/USB-Stick; Seite „Bereitstellungen“ – nicht „Upload“), *Telefon* (nicht Smartphone),
  *Flug* nur für echte Flüge aus Flugprotokollen, Bildarten ausgeschrieben (*Sichtbild, Wärmebild, Weitwinkel, Zoom*).
- Ist genau ein Einsatz aktiv, öffnet di-drop beim Start direkt diesen Einsatz.

## Ältere Einsätze nachtragen

- Seite `/missions/history` (Einsätze → „Ältere Einsätze nachtragen …“, Flugprotokolle → „Einsätze nachtragen …“).
  Vorschläge aus freien Flugprotokollen und – nach Ordnerwahl – aus alten Bildern, egal wie tief verschachtelt
  (`media::list` + Scan je Ordner). Logik: `app/services/history_import.js` (Scan, Anlegen),
  rein und getestet: `app/services/history_grouping.js` (Drohne an DJI-XMP/Modell/Seriennummer, Gruppen bei > 4 h oder > 5 km,
  Titel aus Ordnernamen – nur Hinweis, Sammelordner wie „Einsätze“/„2025“/„DCIM“ zählen nicht).
- Angelegt wird abgeschlossen, alle Aufträge erledigt zum Einsatzende, nie eine Kontrollflug-Serie; Bilder über den
  normalen `MediaImporter`, Flugprotokolle per `assign()` (gilt als von Hand). Fehlende Angaben zeigt `missingDetails()`.
- Bilder ↔ Flüge: `media_files.flight_log_id` (`linkMedia()` in `flight_missions.js`, Regeln in `flight_matching.js`) –
  Reihenfolge von Bild- und Protokoll-Import egal. Die internen `flights` bleiben (noch) daneben bestehen.
- Drone Operator: Zeitpunkt = erster Import, höchstens „erledigt“ (`operatorMoment()`), sonst landen nachgetragene
  Einsätze in der Erfahrung im falschen Zeitraum.

## Markierungen auf Bildern

- Formen (Kreis, Rechteck, Pfeil, Text; Rand oder deckend gefüllt; 6 Farben) je Bild bzw. Vergleichsbild in `annotations`
  (relative Koordinaten 0…1, `version` +1 je Änderung). Zeichnen für Editor, Vorschau und Export an einer Stelle:
  `app/services/annotation_renderer.js` (auch `drawOnThumbnail` für Vorschaubilder mit `object-fit: cover`).
- Editor in der Großansicht: `app/javascript/annotation_editor.js` (Canvas über dem Bild im `gallery__frame`, zoomt mit).
  Esc = Fertig, ⌘Z über `annotations:undo` (shortcuts.js), M blendet ein/aus. Markierungen gelten je Bild, nicht je Aufnahme
  (Sicht- und Wärmebild haben andere Ausschnitte).
- Das Original wird nie verändert: Speichern schreibt `…_markiert.JPG` daneben (`app/services/annotations.js`), Rust
  übernimmt EXIF/XMP ohne das alte Vorschaubild (`src-tauri/src/media/marked.rs`). Wandert beim Umbenennen mit
  (`file_namer.js`), Import/Nachtragen überspringen `_markiert`-Dateien.
- Bereitstellen: Kategorie „Markierte Bilder“ zuerst, zusätzlich zum Original; Schlüssel `a<id>:<version>` – geänderte
  Markierung = fehlt wieder, kommt als neue Datei (`…_markiert_2`). Telefon/Öffnen/Finder nehmen die markierte Fassung,
  solange sie eingeblendet ist.

## Tastenkürzel, Menü, Widerrufen

- Neue App-Befehle: in `app/javascript/shortcuts.js` (Befehl + Taste für Windows/Browser)
  **und** in `src-tauri/src/menu.rs` (deutsches macOS-Menü, sendet die Befehls-Kennung).
  Kürzel-Übersicht: `app/views/layouts/_shortcuts.ejs`.
- Leertaste = Sichtbild ↔ Wärmebild (Galerie, Bildübersicht, Verlauf, Vergleichsbilder): `isVariantSpace()` aus
  `lib/keys.js` + `toggledVariant()` aus `media_helper.js`. Auf einem ausgewählten Bild der Übersicht öffnet sie es groß.
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
- Einstellungen → „Telefon-Verbindung“ (Schlüssel `relay`): Schaubild di-drop ↔ Relay ↔ Telefon mit Version;
  Aktualisieren/Deinstallieren über `cloudflare_deployer.updateRelay/uninstallRelay` (findet Konto und Worker
  anhand der workers.dev-Adresse, löscht nur eigene Worker). Veralteter Relay → direkt im Sende-Dialog
  „Jetzt aktualisieren“, danach wird automatisch gesendet.

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
- Auswahl wie im Finder/Explorer (⇧-Klick = Bereich, Ziehen = mehrere): `range_select_controller.js`
  (`data-range-item`, Bereitgestelltes mit `data-range-skip` wird in Bereichen übersprungen) – auch für andere Kästchen-Listen.
- Neues Ziel: Eintrag in `app/services/upload_targets.js` + Übertragung in
  `src-tauri/src/transfer/` + `lib/platform/*`. Die Warteschlange bleibt unverändert.
- Zugangsdaten (Nextcloud-App-Passwort) nur im Schlüsselbund, nie in der Datenbank.
- Ordner-Auswahl (`nextcloud_folder_controller.js`): beginnt beim Ordner im Feld, sonst beim Grund-Ordner aus den
  Einstellungen (`nextcloud.base_path`, fehlt er → ganz oben). Der Grund-Ordner wird in die Schulung übernommen.
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
- Aufnahmen vor Einsatzbeginn = „Ältere Aufnahmen“: nicht vorausgewählt; von der Karte gelöscht nur, wenn sie importiert wurden.
- „Anschließend auswerfen“ erst, wenn alles zu Löschende wirklich weg ist – sonst bleibt der Import-Dialog offen und nennt,
  was warum noch auf der Karte liegt („Trotzdem auswerfen“ möglich).
- Löschen von der Karte nur in Rust (`sdcard::delete_imported`): Quelle unter `<Karte>/DCIM`, Bild-/Videoformat,
  Kopie außerhalb der Karte mit gleicher Größe und gleichem Fingerabdruck – sonst bleibt die Datei.
  Danach nur leer gewordene Ordner unter DCIM entfernen, nie DCIM selbst.
- RTK-Rohdaten neben den Bildern (`.MRK` Zeit/Position/Antennenversatz je Foto, `.OBS`/`.NAV` RINEX-Satellitendaten,
  `.RTK` DJI-Rohdaten, `ppk_file_name.pbk`): bisher ungenutzt (auch nicht fürs Orthophoto), werden mit dem zweiten
  Haken gelöscht – nur in Ordnern ohne verbliebene Aufnahme. Für eine spätere PPK-Nachberechnung (Orthophoto bei
  RTK float/single, XMP `RtkFlag` ≠ 50) wären sie die Grundlage; bei RTK fixed stehen die Positionen schon im Bild.
- Testen nie mit echter Karte: in der Browser-Brücke gilt jeder Ordner in `tmp/dev-sdcards/` als Karte
  (dort Kopien von Testbildern ablegen; gelöscht wird in der Brücke nur dort).
- Auswerfen (`sdcard::eject`, Seitenleiste „SD-Karten“ ⏏ und „SD-Karte anschließend auswerfen“ beim Import):
  nur gerade erkannte Karten auf einem eigenen Laufwerk – Testordner nie (Brücke: nur ausblenden).
  Mit eigenem Disk-Image testen (`hdiutil create -fs MS-DOS -srcfolder <Ordner mit DCIM>` + `hdiutil attach`).
- Schreibschutz (Schieber „Lock“): `Card.read_only` (macOS/Linux `statvfs` ST_RDONLY, Windows Laufwerksinfo +
  `IOCTL_DISK_IS_WRITABLE`) → rot „Schreibgeschützt“ in der Seitenleiste, Löschen im Import-Dialog gesperrt.
  Klick auf die Karte öffnet sie im Finder/Explorer.
- Importierte Bilder wieder entfernen (Auftragsseite ganz unten, `app/services/media_removal.js`): Kopien samt
  `_markiert` und betroffenen Vergleichsbildern in den Papierkorb (`media::trash_files`, nur Bild-/Videodateien, nur leere
  Ordner), Bereitstellungs-Verlauf/Markierungen/leere Wegpunkte und Flüge weg – danach lassen sich dieselben Bilder neu
  importieren. Nicht während einer laufenden Bereitstellung.
- Neu eingesteckte Karte holt di-drop nach vorne (`bring_to_front`). Windows erlaubt das zuverlässig nur, wenn
  di-drop in der Automatischen Wiedergabe für Speicherkarten gewählt ist: der Installer trägt es dafür ein
  (`src-tauri/windows/hooks.nsh`), ein zweiter Start landet per `tauri-plugin-single-instance` im laufenden di-drop.

## Schulungsmodus

- Start über Einstellungen → Schulung (oder Menü „Schulungsmodus …“): Das Hauptfenster lädt sich mit
  `?training=<szenario>` neu. `lib/platform/simulation.js` tauscht dann Datenbank, Bildordner, SD-Karten,
  Fernsteuerung und Nextcloud gegen die Schulungsfassung (`<App-Daten>/Schulung/Daten/<id>/`); echte
  Einsätze sind unsichtbar und unberührt. Logik, Drehbuch, Befehle: `app/services/training.js`.
- **Uhr:** fachliche Zeiten (Fälligkeit, Countdown, created_at, „heute“ …) nur über `lib/clock.js`
  (`now()`/`nowMs()`), nie `Date.now()`/`new Date()` – sonst stimmt der Schulungsmodus nicht.
  Technische Zeiten (Zeitlimits, Geschwindigkeit, Relay) bleiben echt.
- Steuerung: eigenes Fenster `control` (`app/javascript/control.js`, Tauri-Ereignisse
  `training:command`/`training:state`), in der Browser-Brücke angedockt (dort hinter modalen Dialogen nicht
  klickbar – Befehl dann per `platform.training.emit('training:command', …)`).
- Teilnehmer legen den Einsatz selbst an (Szenario `missionSuggestion` → Hinweis mit „Übernehmen“ im Formular)
  und schließen ihn am Ende ab; das Drehbuch führt mit `note`-Schritten dorthin.
- Simulierte Nextcloud: Szenario `nextcloud.folders` wird bei jedem Start angelegt (Klickpfad üben), `nextcloud.target`
  zeigt die Steuerung als „Richtiger Ordner für die Bilder“.
- Standort vom Telefon ist simuliert (`lib/location/simulated_client.js`, `location_service.simulateLocation`):
  QR-Code wie echt, „QR-Code scannen“/„Verweigern“/„Am Telefon beenden“ in der Steuerung (Befehle `location.*`).
- Telefon als Fernbedienung: `lib/relay/control_client.js` (Relay-Modus `control`, Protokoll §7). Das Telefon
  darf nur die Befehle in `PHONE_COMMANDS` (`training.js`) – nie beenden/zurücksetzen. Es verbindet sich nach
  Unterbrechungen selbst neu (Kopplung im sessionStorage des Telefon-Tabs).
- Szenario-Format: `docs/scenario-format.md`; aus echten Bildordnern bauen mit `script/build_scenario.mjs`.
  **Szenarien mit echten Einsatzbildern nie ins Repository** (liegen z. B. in `~/di-drop-Szenarien`).
- Mitgeliefert (öffentlich, gezeichnete Bilder): `scenarios/basis`, `scenarios/alle-funktionen` – erzeugt mit
  `script/generate_scenario.mjs` aus `scenarios/src/*.mjs`, im App-Paket über `bundle.resources`.
  **Bei jeder neuen Funktion `scenarios/src/alle-funktionen.mjs` mitwachsen lassen** (siehe `scenarios/README.md`).
  `basis` hat fotorealistische Schrägaufnahmen aus einem Referenzbild (`script/ai_scenario_photos.mjs`, Plan
  `scenarios/src/basis-photos.mjs`, OpenAI, Schlüssel im Schlüsselbund) – `generate_scenario.mjs` für `basis`
  überschreibt sie (nur Drehbuch geändert: `--json-only`). Wärmebild = Mittelausschnitt des Sichtbilds (Wärmekamera 52 mm vs. 24 mm).
- Testen in der Brücke: `http://localhost:1420/?bridge&training=<id>` (Daten in `tmp/dev-training`).

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
- Unit-Tests reiner JS-Module (ohne Datenbank/Plattform, z. B. `history_grouping.js`):
  `node --import ./test/support/app_paths.mjs --test test/history_grouping.test.mjs`.
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

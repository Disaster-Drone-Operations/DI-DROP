# di-drop – Hinweise für die Entwicklung

Desktop-App (Tauri 2) für den Drone Operator der Bergwacht im Katastrophenschutz.
Aufbau und Konventionen: siehe README.md.

## Datenmodell (Kurzfassung)

```
Einsatz (missions)
 ├─ Aufträge (assignments)      Lageerkundung, Kontrollflug n, Spezialauftrag „…“, Sonstiges …
 │   status offen/erledigt, due_at (leer = sofort); Kontrollflüge gehören zu einer
 │   Serie (assignment_series) – „Erledigt“ plant den nächsten oder beendet die Serie
 ├─ Flüge (flights)             entstehen intern beim Import (für ein späteres Flugprotokoll);
 │                              in der Oberfläche nicht sichtbar – dort zählt nur der Auftrag
 ├─ Bilder (media_files)        gehören zu einem Auftrag; Duplikate werden pro Einsatz erkannt
 ├─ Wegpunkte (viewpoints)      gleiche Kameraposition über mehrere Flüge → Vergleichsbilder
 └─ Vergleichsbilder (comparisons)
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

## Mein Standort / Relay

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

## Lizenzen & Quellenangaben

- Nach jeder Änderung an Abhängigkeiten (package.json, Cargo.toml):
  `node script/build_licenses.mjs` → `public/data/licenses.json` (Seite „Über di-drop“).
- Daten von Dritten immer dort kennzeichnen, wo sie erscheinen (OpenStreetMap:
  „© OpenStreetMap-Mitwirkende“, GeoNames: „CC BY 4.0“), und auf „Über di-drop“ aufführen.

## Testen

- Browser + echter Rust-Code: `http://localhost:1420/?bridge` (siehe README).
- Desktop-App per Skript bedienen: `script/ui/` (Fenster-Screenshots, Klicks).
  Nur das di-drop-Fenster fotografieren, nie den ganzen Bildschirm.
- Echte Beispieldaten (DJI M4TD) liegen beim Entwickler unter `~/Downloads/drohne-beispieldaten`.

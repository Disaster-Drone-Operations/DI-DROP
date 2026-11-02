# Schulungsszenarien (Schulungsmodus)

Ein Szenario ist ein Ordner (oder eine ZIP-Datei mit diesem Ordner), den di-drop unter
*Einstellungen → Schulung → Szenario hinzufügen …* einliest. Im Schulungsmodus arbeitet di-drop mit
**eigenen Daten** (Datenbank, Bilder, simulierte Nextcloud unter `<App-Daten>/Schulung/Daten/<id>/`),
einer **simulierten Uhr** und **simulierten Geräten**. Echte Einsätze bleiben unberührt.

> Szenarien mit echten Einsatzbildern nie veröffentlichen und nie ins Repository legen.

## Aufbau

```
szenario.json
karten/<karten-id>/DCIM/DJI_…_001/…   Bilder je simulierter SD-Karte (wie auf der Drohnen-Karte,
                                       mehrere DCIM-Unterordner möglich, auch .MRK usw.)
flugprotokolle/DJIFlightRecord_….txt   echte Flugprotokolle (optional)
```

## szenario.json

```json
{
  "id": "unterhain",                       // nur Buchstaben, Ziffern, - und _
  "title": "Unterhain",
  "description": "Kurzbeschreibung für die Liste",
  "start": "2026-09-11T11:30",             // Startzeit der simulierten Uhr
  "settings": { "general.default_mission_kind": "exercise" },   // optional, beliebige Einstellungen
  "missionSuggestion": {                   // Vorschlag für „Neuer Einsatz“ – die Teilnehmer legen den Einsatz
    "kind": "exercise", "title": "Unterhain",  // selbst an („Übernehmen“ oder eigenes Stichwort)
    "location": "Unterhain", "coordinates": "50.63522, 11.12861"
  },
  "phone": { "lat": 50.6351, "lon": 11.1284, "accuracy": 6 },   // simuliertes Telefon der Teilnehmer
                                           // (optional, sonst die Koordinaten des Vorschlags)
  "nextcloud": {                           // optional: Ordner in der simulierten Nextcloud
    "folders": ["/Documents", "/Einsätze/2026/2026_09_11_Unterhain/Fotos/Drohne"],   // werden angelegt (mit Elternordnern)
    "target": "/Einsätze/2026/2026_09_11_Unterhain/Fotos/Drohne"                      // dorthin gehören die Bilder
  },
  "cards": [{ "id": "flug1", "label": "Flug 1 · 11:48" }],
  "remote": {
    "name": "DJI RC Plus 2 (Simulation)",
    "logs": [
      { "start": "2026-09-11T11:44:00", "file": "DJIFlightRecord_2026-09-11_[11-44-00].txt" },
      { "start": "2026-09-11T12:07:00", "duration_s": 631, "distance_m": 1390, "max_height_m": 80,
        "aircraft_name": "Matrice 4TD", "aircraft_sn": "SIM-0001", "battery_sn": "SIM-AKKU-B" }
    ]
  },
  "script": [
    { "at": "11:52", "action": "card.insert", "card": "flug1", "text": "Flug 1 gelandet – SD-Karte einstecken" },
    { "at": "12:04", "action": "card.remove", "card": "flug1" },
    { "at": "12:30", "action": "remote.connect" },
    { "at": "12:35", "action": "note", "text": "Einsatzleitung fordert Kontrollflüge an" }
  ]
}
```

- **Zeiten:** `"HH:MM"` gilt am Tag von `start`, sonst `"YYYY-MM-DDTHH:MM"` (Ortszeit).
- **Flugprotokolle:** mit `file` eine echte Datei aus `flugprotokolle/`. Ohne `file` die **Eckdaten**
  direkt aus dem Szenario (für öffentliche Szenarien – echte DJI-Dateien lassen sich nicht erzeugen);
  beim Übernehmen legt di-drop dafür eine kurze Platzhalter-Textdatei im Ordner `Flugprotokolle` ab.
  Die simulierte Fernsteuerung liefert nur, was laut simulierter Uhr schon geflogen ist.
- **Drehbuch:** `card.insert`, `card.remove`, `remote.connect`, `remote.disconnect`, `note`
  (nur ein Hinweis für den Ausbilder). Die Steuerung zeigt immer den nächsten Schritt;
  „Ausführen“ stellt die Uhr bei Bedarf auf dessen Zeit. Ein Drehbuch beginnt mit „Neuen Einsatz anlegen“
  und endet mit „Einsatz abschließen“ – Aufträge der Einsatzleitung (Kontrollflüge, Spezialaufträge) als `note`,
  die Teilnehmer legen sie selbst an.
- **Standort vom Telefon:** Im Schulungsmodus braucht „Hier“ bzw. „Mein Standort“ keinen Relay. di-drop zeigt
  den QR-Code wie gewohnt; in der Steuerung (oder auf dem Telefon als Fernbedienung) unter „Telefon der
  Teilnehmer“ „QR-Code scannen“ bzw. „Verweigern“, beim Live-Standort später „Am Telefon beenden“. Gesendet
  wird `phone` (mit ein paar Metern GPS-Rauschen).
- **Nextcloud-Ordner:** `nextcloud.folders` legt di-drop bei jedem Start der Schulung an (vorhandene bleiben), damit
  die Teilnehmer den echten Klickpfad bis zum richtigen Ordner üben. `target` zeigt die Steuerung dem Ausbilder
  („Richtiger Ordner für die Bilder“); `build_scenario.mjs` nennt ihn auch im Drehbuch.
- **Fertig angelegter Einsatz (Ausnahme):** Statt `missionSuggestion` legt `"mission": {…}` (dazu optional
  `"assignments": [{ "kind": "special", "title": "…", "due": "12:30" }, { "kind": "control", "interval": 30, "due": "12:45" }]`)
  den Einsatz schon beim Start an – z. B. für Übungen, die mitten im Einsatz beginnen.

## Mitgelieferte Szenarien

`scenarios/basis` und `scenarios/alle-funktionen` (gezeichnete Bilder, fiktiver Ort) bringt di-drop mit;
ein eingelesenes Szenario mit derselben `id` hat Vorrang. Erzeugt werden sie mit
`node script/generate_scenario.mjs scenarios/src/<name>.mjs scenarios/<name>` – siehe `scenarios/README.md`.
Nur Drehbuch/Vorschlag geändert: `--json-only` schreibt nur `szenario.json` (Bilder bleiben, wichtig für die
KI-Fotos von `basis`).

## Szenario aus vorhandenen Bildern bauen

```
node script/build_scenario.mjs <konfig.json> <zielordner>
```

Kopiert die Flugordner als simulierte SD-Karten, übernimmt echte Flugprotokolle des Tages
(`"flightlogs": "/pfad/FlightRecord"`) oder erzeugt Eckdaten aus den Bildzeiten, und schlägt ein
Drehbuch vor (Karte nach jeder Landung, Fernsteuerung nach dem zweiten und letzten Flug).
Aufbau der Konfiguration: Kopf von `script/build_scenario.mjs`.

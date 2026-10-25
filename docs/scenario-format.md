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
  "settings": { "general.operator_name": "Max Mustermann" },   // optional, beliebige Einstellungen
  "mission": {                             // optional – fehlt es, legen die Teilnehmer den Einsatz selbst an
    "kind": "exercise", "title": "Unterhain", "location": "Unterhain",
    "coordinates": "50.63522, 11.12861", "control_interval_minutes": 30
  },
  "assignments": [                         // zusätzlich zur automatisch angelegten Lageerkundung
    { "kind": "special", "title": "Zufahrt prüfen", "due": "12:30" },
    { "kind": "control", "interval": 30, "due": "12:45" }
  ],
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
  direkt aus dem Szenario (für öffentliche Szenarien – echte DJI-Dateien lassen sich nicht erzeugen).
  Die simulierte Fernsteuerung liefert nur, was laut simulierter Uhr schon geflogen ist.
- **Drehbuch:** `card.insert`, `card.remove`, `remote.connect`, `remote.disconnect`, `note`
  (nur ein Hinweis für den Ausbilder). Die Steuerung zeigt immer den nächsten Schritt;
  „Ausführen“ stellt die Uhr bei Bedarf auf dessen Zeit.

## Mitgelieferte Szenarien

`scenarios/basis` und `scenarios/alle-funktionen` (gezeichnete Bilder, fiktiver Ort) bringt di-drop mit;
ein eingelesenes Szenario mit derselben `id` hat Vorrang. Erzeugt werden sie mit
`node script/generate_scenario.mjs scenarios/src/<name>.mjs scenarios/<name>` – siehe `scenarios/README.md`.

## Szenario aus vorhandenen Bildern bauen

```
node script/build_scenario.mjs <konfig.json> <zielordner>
```

Kopiert die Flugordner als simulierte SD-Karten, übernimmt echte Flugprotokolle des Tages
(`"flightlogs": "/pfad/FlightRecord"`) oder erzeugt Eckdaten aus den Bildzeiten, und schlägt ein
Drehbuch vor (Karte nach jeder Landung, Fernsteuerung nach dem zweiten und letzten Flug).
Aufbau der Konfiguration: Kopf von `script/build_scenario.mjs`.

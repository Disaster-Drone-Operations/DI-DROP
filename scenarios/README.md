# Mitgelieferte Schulungsszenarien

Fiktiver Ort, **gezeichnete** Bilder (keine echten Einsatzdaten) – dürfen öffentlich sein.
di-drop bringt sie mit (Einstellungen → Schulung, „Mitgeliefert“).

| Ordner | Inhalt |
|---|---|
| `basis/` | Einstieg: Einsatz anlegen, Lageerkundung, Spezialauftrag, zwei Kontrollflüge mit Vergleichsbildern, Bereitstellen, Einsatz abschließen |
| `alle-funktionen/` | möglichst jede Funktion: ältere Bilder auf der Karte, Karte mit zwei Ordnern (Kontrollflug + Kartierung mit RTK-Dateien), drei Kontrollflüge, Spezialauftrag, Fernsteuerung mit mehreren Akkus (einer lange im Lager), Karte erneut einstecken, Nextcloud, An Telefon |

Erzeugt aus den Beschreibungen in `src/`:

```
node script/generate_scenario.mjs scenarios/src/basis.mjs scenarios/basis
node script/generate_scenario.mjs scenarios/src/alle-funktionen.mjs scenarios/alle-funktionen
```

(braucht ImageMagick und exiftool; die Bilder sind reproduzierbar).

**Fotorealistisch (KI):** `basis` hat fotorealistische Schrägaufnahmen. Grundlage ist **ein**
Referenzbild (`src/basis-referenz.webp`, KI-erzeugt, fiktiv); der Plan `src/basis-photos.mjs` legt je Aufnahme
fest, aus welcher Richtung sie entsteht. Spätere Flüge eines Wegpunkts sind Bearbeitungen des früheren Fotos
(nur der Brand ändert sich) → gleicher Bildausschnitt für Vergleichsbilder.

```
node script/ai_scenario_photos.mjs scenarios/src/basis.mjs scenarios/src/basis-photos.mjs scenarios/basis --only flug2:3,flug3:3  # Probe
node script/ai_scenario_photos.mjs scenarios/src/basis.mjs scenarios/src/basis-photos.mjs scenarios/basis --apply                 # alle
```

- Wärmebild = Mittelausschnitt des Sichtbilds (Wärmekamera 52 mm statt 24 mm), von der KI in ein DJI-Wärmebild
  umgesetzt – die Glut sitzt daher genau dort, wo sie im Foto ist.
- Metadaten (Zeit, GPS, Kamerawinkel, Wegpunkt) kommen aus den Zeichnungen (`tmp/ai-backup/`).
- KI-Ergebnisse liegen in `tmp/ai-photos-cache/` und werden nicht doppelt bezahlt (`--force` = neu).
- OpenAI-Schlüssel im Schlüsselbund: `security add-generic-password -s di-drop-openai -a api -U -w "$(pbpaste)"`,
  Modell `gpt-image-2` (`--model=…`).
- `script/ai_scenario_images.mjs` ist die einfachere Variante (KI behält die Draufsicht der Zeichnung).
- Achtung: `generate_scenario.mjs` für `basis` überschreibt die Fotos (danach Foto-Skript erneut, aus dem Cache).
  Nur Drehbuch oder Einsatz-Vorschlag geändert: `node script/generate_scenario.mjs scenarios/src/basis.mjs scenarios/basis --json-only`.

**Neue Funktion in di-drop?** Dann `src/alle-funktionen.mjs` so erweitern, dass man sie dort ausprobieren
kann (und `basis` nur, wenn es eine Grundfunktion ist). Szenarien mit echten Bildern gehören nie hierher.

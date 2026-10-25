# Mitgelieferte Schulungsszenarien

Fiktiver Ort, **gezeichnete** Bilder (keine echten Einsatzdaten) – dürfen öffentlich sein.
di-drop bringt sie mit (Einstellungen → Schulung, „Mitgeliefert“).

| Ordner | Inhalt |
|---|---|
| `basis/` | Einstieg: Lageerkundung, Spezialauftrag, zwei Kontrollflüge mit Vergleichsbildern, Bereitstellen |
| `alle-funktionen/` | möglichst jede Funktion: ältere Bilder auf der Karte, Karte mit zwei Ordnern (Kontrollflug + Kartierung mit RTK-Dateien), drei Kontrollflüge, Spezialauftrag, Fernsteuerung mit mehreren Akkus (einer lange im Lager), Karte erneut einstecken, Nextcloud, An Telefon |

Erzeugt aus den Beschreibungen in `src/`:

```
node script/generate_scenario.mjs scenarios/src/basis.mjs scenarios/basis
node script/generate_scenario.mjs scenarios/src/alle-funktionen.mjs scenarios/alle-funktionen
```

(braucht ImageMagick und exiftool; die Bilder sind reproduzierbar).

**Fotorealistisch (KI):** `basis` hat KI-Bilder. Sie entstehen aus den Zeichnungen – die KI behält deren
Anordnung, daher bleiben die Wegpunkte über die Flüge gleich:

```
node script/generate_scenario.mjs scenarios/src/basis.mjs scenarios/basis        # Zeichnungen (überschreibt!)
node script/ai_scenario_images.mjs scenarios/src/basis.mjs scenarios/basis --only flug2:1,flug3:1   # Probe → tmp/ai-preview
node script/ai_scenario_images.mjs scenarios/src/basis.mjs scenarios/basis --apply                  # alle ersetzen
```

OpenAI-Schlüssel im Schlüsselbund (`security add-generic-password -s di-drop-openai -a api -U -w "$(pbpaste)"`),
Modell `gpt-image-2` (`--model=…`). Wärmebilder rechnet das Skript selbst aus dem Mittelausschnitt des
Sichtbilds (Wärmekamera 52 mm statt 24 mm) plus den Glutnestern der Zeichnung; `--thermal-only` berechnet
nur sie neu (ohne API-Kosten). Originale der Zeichnungen: `tmp/ai-backup/`.

**Neue Funktion in di-drop?** Dann `src/alle-funktionen.mjs` so erweitern, dass man sie dort ausprobieren
kann (und `basis` nur, wenn es eine Grundfunktion ist). Szenarien mit echten Bildern gehören nie hierher.

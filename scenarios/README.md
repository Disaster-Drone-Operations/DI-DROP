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

(braucht ImageMagick und exiftool; die Bilder sind reproduzierbar). Später lassen sich die Zeichnungen
gegen KI-Bilder tauschen – gleiche Dateinamen, Metadaten mit exiftool übernehmen.

**Neue Funktion in di-drop?** Dann `src/alle-funktionen.mjs` so erweitern, dass man sie dort ausprobieren
kann (und `basis` nur, wenn es eine Grundfunktion ist). Szenarien mit echten Bildern gehören nie hierher.

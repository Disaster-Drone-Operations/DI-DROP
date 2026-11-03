# TODO

Offene Punkte, die beim Entwickeln aufgefallen sind (noch nicht umgesetzt).

## Bilder & Aufträge

- **Zweiter Bildordner eines Auftrags:** Kommen Bilder eines späteren Flugs in denselben Auftrag, legt der
  Import einen zweiten Ordner an (z. B. `…_10_45_Kontrollflug_1` und `…_11_18_Kontrollflug_1`). Der Auftrag kennt
  aber nur einen Ordner (`assignments.media_dir`). Vergleichsbilder, die im zweiten Ordner landen (Ordner der
  neuesten Aufnahme, `comparison_renderer.js`), findet `Comparison.forAssignment()` deshalb nicht – sie fehlen
  auf der Auftragsseite. Lösung prüfen: alle Ordner eines Auftrags berücksichtigen oder immer in `media_dir` ablegen.
- **Aufnahmen zwischen Aufträgen verschieben / beim Import teilen:** Aufnahmen eines Auftrags nachträglich in einen
  anderen Auftrag desselben Einsatzes verschieben (Auswahl wie beim Bereitstellen, `range_select_controller.js`) –
  Dateien in dessen Ordner verschieben und umbenennen (`file_namer.js`), Markierungen, Vergleichsbilder und
  Bereitstellungs-Stand mitnehmen. Und schon im Import-Dialog eine Gruppe (ein Flug/Ordner) auf mehrere Aufträge
  aufteilen können, z. B. per Auswahl unter „Auswahl anpassen“. Seit Import-Gruppen nur noch nach Ordner entstehen
  (keine Pausen-Regel mehr), landet ein Flug mit zwei Aufgaben sonst in einem Auftrag.

## Karte

- **Mini-Karte im exportierten Bild:** die Karte mit Aufnahmeort und Bildausschnitt wie den Kompass ins bereitgestellte
  Bild einblenden (Quellenangabe der Kartendaten muss dann mit ins Bild: basemap.de/BKG, GDI-Th).
- **Karte offline:** Kartenpaket für Thüringen (Vektorkacheln basemap.de, ggf. Luftbild in niedriger Auflösung,
  Höhenmodell) unter Einstellungen → Aktualisierungen herunterladbar machen (`app/services/updates.js`) – im Einsatz
  gibt es oft kein Netz.

## Flugprotokolle

- **Detailansicht je Flug:** eigene Seite pro Flug (Eckdaten, später Flugweg/Karte aus den Messreihen, Akku, Fotos
  während des Flugs). Von dort auf den zugeordneten Einsatz verlinken – in der Liste ändert ein Doppelklick auf die
  Spalte „Einsatz“ nur die Zuordnung (`flight_logs_controller.js#editMission`).

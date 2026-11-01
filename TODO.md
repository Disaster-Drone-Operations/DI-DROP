# TODO

Offene Punkte, die beim Entwickeln aufgefallen sind (noch nicht umgesetzt).

## Bilder & Aufträge

- **Zweiter Bildordner eines Auftrags:** Kommen Bilder eines späteren Flugs in denselben Auftrag, legt der
  Import einen zweiten Ordner an (z. B. `…_10_45_Kontrollflug_1` und `…_11_18_Kontrollflug_1`). Der Auftrag kennt
  aber nur einen Ordner (`assignments.media_dir`). Vergleichsbilder, die im zweiten Ordner landen (Ordner der
  neuesten Aufnahme, `comparison_renderer.js`), findet `Comparison.forAssignment()` deshalb nicht – sie fehlen
  auf der Auftragsseite. Lösung prüfen: alle Ordner eines Auftrags berücksichtigen oder immer in `media_dir` ablegen.

## Flugprotokolle

- **Detailansicht je Flug:** eigene Seite pro Flug (Eckdaten, später Flugweg/Karte aus den Messreihen, Akku, Fotos
  während des Flugs). Von dort auf den zugeordneten Einsatz verlinken – in der Liste ändert ein Doppelklick auf die
  Spalte „Einsatz“ nur die Zuordnung (`flight_logs_controller.js#editMission`).

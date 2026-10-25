// Public training scenario "Basis" – the most important functions for new members.
// Generated with: node script/generate_scenario.mjs scenarios/src/basis.mjs scenarios/basis
// Fictional place and drawn images (no real mission data).
export default {
  id: 'basis',
  title: 'Basis: Scheunenbrand Musterdorf',
  description: 'Einstieg: Lageerkundung, Spezialauftrag, zwei Kontrollflüge mit Vergleichsbildern, Bereitstellen.',
  start: '2026-05-16T10:00',
  seed: 4711,
  center: { lat: 50.68412, lon: 10.91873 },
  groundAltitude: 452,
  mission: {
    kind: 'exercise', title: 'Scheunenbrand Musterdorf', location: 'Musterdorf, Scheune am Ortsrand',
    coordinates: '50.68412, 10.91873', control_interval_minutes: 30,
  },
  assignments: [{ kind: 'special', title: 'Zufahrt für die Drehleiter prüfen', due: '11:15' }],
  cards: [
    { id: 'flug1', label: 'Flug 1 · Lageerkundung 10:12', folders: [{ time: '10:12', shots: 'overview', fire: 1, trucks: true }] },
    { id: 'flug2', label: 'Flug 2 · Kontrollflug 10:45', folders: [{ time: '10:45', shots: 'waypoints', fire: 0.7, trucks: true }] },
    { id: 'flug3', label: 'Flug 3 · Kontrollflug + Zufahrt 11:18', folders: [
      { time: '11:18', shots: 'waypoints', fire: 0.4, trucks: true },
      { time: '11:22', shots: 'manual', fire: 0.4, trucks: true },
    ] },
  ],
  remote: { name: 'DJI RC Plus 2 (Simulation)' },
  script: [
    { at: '10:05', action: 'note', text: 'Alarmierung: Scheunenbrand am Ortsrand. Einsatz ist angelegt – Lageerkundung fliegen.' },
    { at: '10:18', action: 'card.insert', card: 'flug1', text: 'Flug 1 gelandet – SD-Karte einstecken (Lageerkundung)' },
    { at: '10:30', action: 'note', text: 'Lageerkundung als erledigt markieren. Einsatzleitung: Kontrollflüge alle 30 Minuten, Zufahrt für die Drehleiter prüfen.' },
    { at: '10:32', action: 'card.remove', card: 'flug1' },
    { at: '10:52', action: 'card.insert', card: 'flug2', text: 'Kontrollflug 1 gelandet – SD-Karte einstecken' },
    { at: '11:05', action: 'card.remove', card: 'flug2' },
    { at: '11:15', action: 'note', text: 'Kontrollflug 1 als erledigt markieren – di-drop plant den nächsten.' },
    { at: '11:27', action: 'card.insert', card: 'flug3', text: 'Kontrollflug 2 + Zufahrt gelandet – SD-Karte einstecken (zwei Blöcke)' },
    { at: '11:35', action: 'note', text: 'Vergleichsbilder erstellen und alles in die Nextcloud bereitstellen.' },
    { at: '11:40', action: 'remote.connect', text: 'Fernsteuerung anschließen – Flugprotokolle übernehmen' },
    { at: '11:45', action: 'remote.disconnect' },
  ],
}

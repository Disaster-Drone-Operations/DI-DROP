// Public training scenario "Alle Funktionen" – covers (as far as possible) every feature of di-drop.
// Generated with: node script/generate_scenario.mjs scenarios/src/alle-funktionen.mjs scenarios/alle-funktionen
// Fictional place and drawn images (no real mission data).
//
// When adding a feature to di-drop: extend this scenario so it can be tried here (CLAUDE.md).
export default {
  id: 'alle-funktionen',
  title: 'Alle Funktionen: Großbrand Musterdorf',
  description: 'Alles zum Ausprobieren: Einsatz anlegen mit Standort vom (simulierten) Telefon, Live-Standort, ältere Bilder auf der Karte, Kartierung mit RTK-Dateien, drei Kontrollflüge, Spezialauftrag, Fernsteuerung mit mehreren Akkus, Karte leeren, Nextcloud, An Telefon.',
  start: '2026-06-20T13:00',
  seed: 815,
  center: { lat: 50.68412, lon: 10.91873 },
  groundAltitude: 452,
  // The participants create the mission themselves – the script only suggests it (other names are fine)
  missionSuggestion: { kind: 'exercise', title: 'Großbrand Musterdorf', location: 'Musterdorf, Scheune am Ortsrand' },
  // Where the drone team stands (simulated phone for „Hier“ / „Mein Standort“)
  phone: { lat: 50.68305, lon: 10.91760, alt: 451, accuracy: 6 },
  // Simulated Nextcloud: a small folder structure; the images belong into "target" (the click path is practised)
  nextcloud: {
    folders: [
      '/Documents',
      '/Photos',
      '/Templates',
      '/Einsätze/2025/2025_08_09_Waldbrand_Hohe_Warte',
      '/Einsätze/2025/2025_11_22_Personensuche_Schneekopf',
      '/Einsätze/2026/2026_02_07_Vermisstensuche_Kickelhahn',
      '/Einsätze/2026/2026_04_18_Flächenbrand_Gehlberg',
      '/Einsätze/2026/2026_05_16_Scheunenbrand_Musterdorf',
      '/Einsätze/2026/2026_06_20_Großbrand_Musterdorf/Fotos/Drohne',
      '/Einsätze/2026/2026_06_20_Großbrand_Musterdorf/Lagekarten',
      '/Einsätze/2026/2026_06_20_Großbrand_Musterdorf/Protokolle',
    ],
    target: '/Einsätze/2026/2026_06_20_Großbrand_Musterdorf/Fotos/Drohne',
  },
  cards: [
    // Old test flight from the day before + first flight → "Ältere Aufnahmen" in the import dialog
    { id: 'flug1', label: 'Flug 1 · Lageerkundung (+ alter Testflug)', folders: [
      { time: '2026-06-19T17:40', shots: 'older', fire: 0, trucks: false, name: 'Testflug' },
      { time: '13:10', shots: 'overview', fire: 1, trucks: true },
    ] },
    // Two tasks in one flight: control flight + mapping (orthophoto) with RTK raw data
    { id: 'flug2', label: 'Flug 2 · Kontrollflug + Kartierung', folders: [
      { time: '13:40', shots: 'waypoints', fire: 0.8, trucks: true },
      { time: '13:46', shots: 'mapping', fire: 0.8, trucks: true, rtk: true, name: 'Kartierung' },
    ] },
    { id: 'flug3', label: 'Flug 3 · Kontrollflug + Zufahrt', folders: [
      { time: '14:10', shots: 'waypoints', fire: 0.5, trucks: true },
      { time: '14:14', shots: 'manual', fire: 0.5, trucks: true },
    ] },
    { id: 'flug4', label: 'Flug 4 · Kontrollflug', folders: [{ time: '14:40', shots: 'waypoints', fire: 0.25, trucks: true }] },
  ],
  remote: {
    name: 'DJI RC Plus 2 (Simulation)',
    batteries: ['SIM-AKKU-A', 'SIM-AKKU-B'],
    // A battery that hasn't flown for a long time → storage hint in "Akkunutzung"
    extraLogs: [{ start: '2026-03-28T15:02:00', duration_s: 1260, distance_m: 2900, max_height_m: 90, max_speed_ms: 9,
      aircraft_name: 'Matrice 4TD', aircraft_sn: 'SIM-M4TD-0001', battery_sn: 'SIM-AKKU-C', rc_sn: 'SIM-RC-0001',
      latitude: 50.68412, longitude: 10.91873, photos: 0 }],
  },
  script: [
    { at: '13:01', action: 'note', text: 'Alarmierung Großbrand. Neuen Einsatz anlegen (Vorschlag: „Großbrand Musterdorf“), unter „Weitere Angaben“ Pilot, Luftraumbeobachter und Gruppenführer eintragen. Einsatzort mit „Hier“ – in der Steuerung „QR-Code scannen“ (oder „Verweigern“ ausprobieren).' },
    { at: '13:04', action: 'note', text: 'Einsatzleitung: Zufahrt für die Drehleiter bis 14:00 prüfen (Spezialauftrag anlegen), Kontrollflüge alle 30 Minuten. Auf „Mein Standort“ den Live-Standort starten und in der Steuerung scannen – später „Am Telefon beenden“.' },
    { at: '13:18', action: 'card.insert', card: 'flug1', text: 'Flug 1 gelandet – Karte einstecken: auch ein alter Testflug von gestern ist drauf' },
    { at: '13:25', action: 'note', text: 'Ein Wärmebild der Lageerkundung per „An Telefon“ an die Einsatzleitung schicken, Lageerkundung als erledigt markieren.' },
    { at: '13:28', action: 'card.remove', card: 'flug1' },
    { at: '13:58', action: 'card.insert', card: 'flug2', text: 'Flug 2 gelandet – zwei Ordner: Kontrollflug und Kartierung (mit RTK-Dateien)' },
    { at: '14:05', action: 'card.remove', card: 'flug2' },
    { at: '14:08', action: 'remote.connect', text: 'Fernsteuerung anschließen – Flugprotokolle, ein Akku lag lange im Lager' },
    { at: '14:09', action: 'remote.disconnect' },
    { at: '14:20', action: 'note', text: 'Kontrollflug 1 als erledigt markieren – di-drop plant Kontrollflug 2.' },
    { at: '14:22', action: 'card.insert', card: 'flug3', text: 'Flug 3 gelandet – Kontrollflug und Zufahrt (Spezialauftrag)' },
    { at: '14:30', action: 'card.remove', card: 'flug3' },
    { at: '14:32', action: 'card.insert', card: 'flug1', text: 'Karte von Flug 1 noch einmal einstecken – nur der alte Testflug ist noch drauf (oder, falls nicht gelöscht wurde: Karte leeren)' },
    { at: '14:34', action: 'card.remove', card: 'flug1' },
    { at: '14:48', action: 'card.insert', card: 'flug4', text: 'Flug 4 gelandet – dritter Kontrollflug' },
    { at: '14:55', action: 'note', text: 'Vergleichsbilder aus drei Kontrollflügen erstellen, dann je Auftrag „Bereitstellen …“ (simulierte Nextcloud, Ordner: Einsätze › 2026 › 2026_06_20_Großbrand_Musterdorf › Fotos › Drohne), Aufträge erledigen, Einsatz abschließen.' },
    { at: '15:00', action: 'remote.connect', text: 'Fernsteuerung erneut anschließen – nur die neuen Flüge' },
    { at: '15:02', action: 'remote.disconnect' },
    { at: '15:10', action: 'note', text: 'Einsatzleitung: Einsatz beendet. Letzten Kontrollflug mit „Keine weiteren Kontrollflüge“ erledigen, alle Aufträge erledigen und den Einsatz abschließen.' },
  ],
}

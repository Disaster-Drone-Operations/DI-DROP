// Schema for the settings menu.
//
// A new section = a new object in this list. Form, saving and default
// values follow automatically. Stored as "<section>.<field>",
// readable via Setting.get('general.unit_name').
//
// Field types: text, textarea, number, select, url, folder
// partial: custom view instead of the default form (e.g. a setup assistant)
// appendix: { partial, os } – extra view below the form (with os: only on that platform, e.g. 'windows')
//   folder opens the native folder dialog in the desktop app.

export default [
  {
    key: 'general',
    title: 'Allgemein',
    icon: 'sliders',
    description: 'Angaben zu deiner Einheit und wie eure Rollen heißen.',
    fields: [
      { key: 'unit_name', label: 'Einheit', type: 'text', default: 'Bergwacht Thüringen',
        hint: 'Erscheint in der Seitenleiste und später in Berichten.' },
      { key: 'default_mission_kind', label: 'Standard für neue Einträge', type: 'select', default: 'exercise',
        options: [['operation', 'Einsatz'], ['exercise', 'Übung']] },
      // Names of the four roles – other units call them differently (Mission.ROLES are the keys)
      { key: 'role_group_leader', label: 'Rolle: Führung der Drohnengruppe', type: 'text', default: 'Gruppenführer' },
      { key: 'role_pilot', label: 'Rolle: steuert die Drohne', type: 'text', default: 'Pilot' },
      { key: 'role_observer', label: 'Rolle: beobachtet den Luftraum', type: 'text', default: 'Luftraumbeobachter' },
      { key: 'role_operator', label: 'Rolle: wertet die Bilder aus', type: 'text', default: 'Drone Operator',
        hint: 'So heißen die Rollen überall in di-drop – bei anderen Einheiten oft anders.' },
    ],
  },
  {
    key: 'unit',
    title: 'Einheit',
    icon: 'users',
    description: 'Mindest-Flugpraxis und welche Nachweise ihr je Person erfasst. Die Personen selbst stehen unter „Einheit“ in der Seitenleiste.',
    fields: [
      { key: 'recency_days', label: 'Flugpraxis prüfen für die letzten', type: 'select', default: '90',
        options: [['30', '30 Tage'], ['60', '60 Tage'], ['90', '90 Tage'], ['180', '180 Tage']] },
      { key: 'min_flights', label: 'Mindestens … Flüge als Pilot', type: 'number', default: '3' },
      { key: 'min_minutes', label: 'Mindestens … Minuten Flugzeit als Pilot', type: 'number', default: '60',
        hint: 'Wer schon einmal geflogen ist und darunter liegt, bekommt unter „Einheit“ einen Hinweis. 0 = keine Mindestanzahl.' },
    ],
    // Kinds of qualifications (settings/_qualification_types.ejs)
    appendix: { partial: 'settings/_qualification_types' },
  },
  {
    key: 'flights',
    title: 'Flugplanung',
    icon: 'clock',
    description: 'Vorgaben für die zeitliche Planung von Kontrollflügen.',
    fields: [
      { key: 'control_interval_minutes', label: 'Standard-Intervall für Kontrollflüge', type: 'select', default: '30',
        options: [['15', 'alle 15 Minuten'], ['20', 'alle 20 Minuten'], ['30', 'alle 30 Minuten'],
          ['45', 'alle 45 Minuten'], ['60', 'alle 60 Minuten'], ['90', 'alle 90 Minuten'], ['120', 'alle 2 Stunden']],
        hint: 'Kann pro Einsatz angepasst werden.' },
    ],
  },
  {
    key: 'storage',
    title: 'Bildablage',
    icon: 'folder',
    description: 'Wohin importierte Bilder kopiert werden.',
    fields: [
      { key: 'base_path', label: 'Basisordner', type: 'folder', default: '',
        hint: 'Leer lassen für den Standard: Ordner „Bilder/di-drop“ in deinem Benutzerordner. Darin entsteht pro Einsatz „2026_10_06__Einsatzname“ und pro Flug „2026_10_06__1430“. Gilt für Einsätze, die noch keine Bilder haben.' },
      { key: 'compass_default', label: 'Kompass auf den Bildern', type: 'select', default: 'yes',
        options: [['yes', 'Standardmäßig auf jedem Bild'], ['no', 'Nur wenn in der Großansicht eingeschaltet']],
        hint: 'Zeigt Norden und die Neigung der Kamera (aus den Drohnendaten). Er wird in die bereitgestellten Bilder eingezeichnet – die Originale in der Bildablage bleiben unverändert. In der Großansicht lässt er sich je Aufnahme an- und ausschalten und verschieben.' },
    ],
    // Windows opens an Explorer window for every inserted memory card – how to get di-drop instead
    appendix: { partial: 'settings/_autoplay', os: 'windows' },
  },
  {
    key: 'flightlogs',
    title: 'Flugprotokolle',
    icon: 'protocol',
    description: 'Was beim Anschließen der DJI-Fernsteuerung übernommen wird. Flugprotokolle und Flugwiedergaben (FlightTaskReplay) kommen immer mit.',
    fields: [
      { key: 'include_dat', label: 'Rohdaten des Flugcontrollers mitsichern', type: 'select', default: 'no',
        options: [['no', 'Nein'], ['yes', 'Ja – Ordner „MCDatFlightRecords“ mit übernehmen']],
        hint: 'Sehr genaue Aufzeichnung der Drohne (ca. 20 MB je Flug), z. B. für den DJI-Support oder Versicherungen nach einem Zwischenfall. Die Fernsteuerung behält nur die jüngsten – wer sie braucht, sollte sie mitsichern.' },
    ],
  },
  {
    key: 'nextcloud',
    title: 'Nextcloud',
    icon: 'cloud',
    description: 'Bilder eines Auftrags direkt in die Nextcloud laden, damit Einsatzleitung und Kameraden sie sofort sehen.',
    partial: 'settings/_nextcloud',
    fields: [
      // Starting point of the folder selection (e.g. "/Führungsmittel/Einsatzdokumentation/2026")
      { key: 'base_path', label: 'Grund-Ordner', type: 'text', default: '', placeholder: '/Einsätze/2026',
        normalize: (v) => (v ? `/${v.replace(/\\/g, '/').split('/').filter(Boolean).join('/')}`.replace(/^\/$/, '') : '') },
    ],
  },
  {
    key: 'relay',
    title: 'Telefon-Verbindung',
    icon: 'phone',
    description: 'Standort vom Telefon empfangen und Bilder ans Telefon senden – per QR-Code, ohne App. Dafür braucht es einen kleinen Vermittlungsdienst („Relay“). Er läuft kostenlos in deinem eigenen Cloudflare-Konto und reicht nur verschlüsselte Daten weiter.',
    partial: 'settings/_relay',
    fields: [
      { key: 'url', label: 'Adresse des Relays', type: 'url', default: '', placeholder: 'https://di-drop-relay.….workers.dev',
        hint: 'Wird bei der Einrichtung automatisch eingetragen. Nur ändern, wenn du einen eigenen Relay-Server betreibst.' },
    ],
  },
  {
    key: 'training',
    title: 'Schulung',
    icon: 'missions',
    description: 'Übungsszenarien zum Vorführen und Üben: eigene Daten, simulierte Uhr, SD-Karten, Fernsteuerung und Nextcloud. Echte Einsätze bleiben dabei unberührt und unsichtbar.',
    partial: 'settings/_training',
    fields: [],
  },
  {
    key: 'updates',
    title: 'Aktualisierungen',
    icon: 'import',
    description: 'Daten, die di-drop bei Bedarf aus dem Internet nachlädt. Alles funktioniert auch ohne – die Aktualisierung macht es nur genauer.',
    partial: 'settings/_updates',
    fields: [],
  },
]

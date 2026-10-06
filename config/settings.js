// Schema für das Einstellungs-Menü.
//
// Eine neue Rubrik = ein neues Objekt in dieser Liste. Formular, Speichern und
// Standardwerte ergeben sich automatisch. Gespeichert wird als "<section>.<field>",
// abrufbar über Setting.get('general.unit_name').
//
// Feldtypen: text, textarea, number, select, url, folder
//   folder öffnet in der Desktop-App den nativen Ordner-Dialog.

export default [
  {
    key: 'general',
    title: 'Allgemein',
    icon: 'sliders',
    description: 'Angaben zu deiner Einheit und zu dir als Drone Operator.',
    fields: [
      { key: 'unit_name', label: 'Einheit', type: 'text', default: 'Bergwacht Thüringen',
        hint: 'Erscheint in der Seitenleiste und später in Berichten.' },
      { key: 'operator_name', label: 'Dein Name (Drone Operator)', type: 'text', default: '',
        hint: 'Wird bei neuen Einsätzen automatisch als Drone Operator eingetragen.' },
      { key: 'default_mission_kind', label: 'Standard für neue Einträge', type: 'select', default: 'uebung',
        options: [['einsatz', 'Einsatz'], ['uebung', 'Übung']] },
    ],
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
    badge: 'Vorschau',
    description: 'Wohin die Bilder von der SD-Karte kopiert werden. Wird mit dem Bilder-Import aktiv.',
    fields: [
      { key: 'base_path', label: 'Basisordner', type: 'folder', default: '',
        hint: 'Unter diesem Ordner wird pro Einsatz ein Unterordner angelegt.' },
      { key: 'folder_pattern', label: 'Ordnerstruktur', type: 'text',
        default: '{datum}_{einsatz}/{flug_nr}_{flugtyp}',
        hint: 'Platzhalter: {datum} {uhrzeit} {einsatz} {ort} {flug_nr} {flugtyp}' },
    ],
  },
  {
    key: 'nextcloud',
    title: 'Nextcloud',
    icon: 'cloud',
    badge: 'Vorschau',
    description: 'Upload von Einsatzbildern in eine Nextcloud. Die Verbindung wird in einer späteren Version eingerichtet.',
    fields: [
      { key: 'url', label: 'Server-Adresse', type: 'url', default: '', placeholder: 'https://cloud.example.de' },
      { key: 'username', label: 'Benutzername', type: 'text', default: '' },
      { key: 'remote_path', label: 'Zielordner in der Nextcloud', type: 'text', default: '/Einsätze',
        hint: 'App-Passwort und Verbindungstest folgen – Zugangsdaten werden dann im Schlüsselbund des Betriebssystems gespeichert, nicht in der Datenbank.' },
    ],
  },
]

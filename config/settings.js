// Schema für das Einstellungs-Menü.
//
// Eine neue Rubrik = ein neues Objekt in dieser Liste. Formular, Speichern und
// Standardwerte ergeben sich automatisch. Gespeichert wird als "<section>.<field>",
// abrufbar über Setting.get('general.unit_name').
//
// Feldtypen: text, textarea, number, select, url, folder
// partial: eigene Ansicht statt des Standardformulars (z. B. ein Einrichtungs-Assistent)
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
    description: 'Wohin importierte Bilder kopiert werden.',
    fields: [
      { key: 'base_path', label: 'Basisordner', type: 'folder', default: '',
        hint: 'Leer lassen für den Standard: Ordner „Bilder/di-drop“ in deinem Benutzerordner. Darin entsteht pro Einsatz „2026_10_06__Einsatzname“ und pro Flug „2026_10_06__1430“. Gilt für Einsätze, die noch keine Bilder haben.' },
    ],
  },
  {
    key: 'nextcloud',
    title: 'Nextcloud',
    icon: 'cloud',
    description: 'Bilder eines Auftrags direkt in die Nextcloud laden, damit Einsatzleitung und Kameraden sie sofort sehen.',
    partial: 'settings/_nextcloud',
    fields: [],
  },
  {
    key: 'relay',
    title: 'Standort-Übertragung',
    icon: 'pin',
    description: 'Damit das Smartphone seinen Standort an di-drop senden kann, braucht es einen kleinen Vermittlungsdienst („Relay“). Er läuft kostenlos in deinem eigenen Cloudflare-Konto und sieht nur verschlüsselte Daten.',
    partial: 'settings/_relay',
    fields: [
      { key: 'url', label: 'Adresse des Relays', type: 'url', default: '', placeholder: 'https://di-drop-relay.….workers.dev',
        hint: 'Wird bei der Einrichtung automatisch eingetragen. Nur ändern, wenn du einen eigenen Relay-Server betreibst.' },
    ],
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

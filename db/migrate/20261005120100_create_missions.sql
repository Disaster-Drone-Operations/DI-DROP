-- Ein Einsatz oder eine Übung
CREATE TABLE missions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                     TEXT NOT NULL DEFAULT 'einsatz',  -- einsatz | uebung
  title                    TEXT NOT NULL,                    -- Stichwort
  reference                TEXT,                             -- Einsatznummer
  date                     TEXT NOT NULL,                    -- YYYY-MM-DD
  start_time               TEXT,                             -- HH:MM
  location                 TEXT NOT NULL,
  coordinates              TEXT,                             -- "50.6789, 10.9876"
  requested_by             TEXT,                             -- anfordernde Stelle
  group_leader             TEXT,                             -- Gruppenführer
  pilot                    TEXT,
  observer                 TEXT,                             -- Luftraumbeobachter
  operator                 TEXT,                             -- Drone Operator
  control_interval_minutes INTEGER,
  status                   TEXT NOT NULL DEFAULT 'aktiv',    -- aktiv | abgeschlossen
  notes                    TEXT,
  created_at               TEXT,
  updated_at               TEXT
);

CREATE INDEX index_missions_on_date ON missions (date);

-- Einzelne Flüge innerhalb eines Einsatzes
CREATE TABLE flights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions (id),
  number     INTEGER NOT NULL,              -- laufende Nummer im Einsatz
  kind       TEXT NOT NULL,                 -- initial | kontrolle | spezial
  flown_at   TEXT NOT NULL,                 -- YYYY-MM-DDTHH:MM (lokale Zeit)
  task       TEXT,                          -- Auftrag
  notes      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX index_flights_on_mission_id ON flights (mission_id);

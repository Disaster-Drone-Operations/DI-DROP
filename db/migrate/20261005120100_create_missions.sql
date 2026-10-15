-- A mission (operation) or an exercise
CREATE TABLE missions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                     TEXT NOT NULL DEFAULT 'einsatz',  -- einsatz | uebung
  title                    TEXT NOT NULL,                    -- keyword (incident title)
  reference                TEXT,                             -- mission/incident number
  date                     TEXT NOT NULL,                    -- YYYY-MM-DD
  start_time               TEXT,                             -- HH:MM
  location                 TEXT NOT NULL,
  coordinates              TEXT,                             -- "50.6789, 10.9876"
  requested_by             TEXT,                             -- requesting authority
  group_leader             TEXT,                             -- group leader
  pilot                    TEXT,
  observer                 TEXT,                             -- airspace observer
  operator                 TEXT,                             -- Drone Operator
  control_interval_minutes INTEGER,
  status                   TEXT NOT NULL DEFAULT 'aktiv',    -- aktiv | abgeschlossen
  notes                    TEXT,
  created_at               TEXT,
  updated_at               TEXT
);

CREATE INDEX index_missions_on_date ON missions (date);

-- Individual flights within a mission
CREATE TABLE flights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions (id),
  number     INTEGER NOT NULL,              -- sequence number within the mission
  kind       TEXT NOT NULL,                 -- initial | kontrolle | spezial
  flown_at   TEXT NOT NULL,                 -- YYYY-MM-DDTHH:MM (local time)
  task       TEXT,                          -- assignment
  notes      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX index_flights_on_mission_id ON flights (mission_id);

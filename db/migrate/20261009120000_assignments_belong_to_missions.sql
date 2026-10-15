-- migrate: foreign_keys=off
--
-- Restructuring: assignments now belong to the mission (no longer to a flight).
-- Flights are created on import; one flight can serve several assignments.

-- Series of recurring assignments (control flights)
CREATE TABLE assignment_series (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id       INTEGER NOT NULL REFERENCES missions (id),
  kind             TEXT NOT NULL DEFAULT 'kontrolle',
  interval_minutes INTEGER,         -- last chosen interval (suggestion for the next one)
  status           TEXT NOT NULL DEFAULT 'aktiv',   -- aktiv | beendet
  created_at       TEXT,
  updated_at       TEXT
);

CREATE TABLE assignments_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id   INTEGER NOT NULL REFERENCES missions (id),
  series_id    INTEGER REFERENCES assignment_series (id),
  sequence     INTEGER,             -- number within the series ("Kontrollflug 3")
  kind         TEXT NOT NULL,       -- initial | kontrolle | spezial | kartierung | position | gebiet | sonstiges
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'offen',       -- offen | erledigt
  due_at       TEXT,                -- planned for (local, YYYY-MM-DDTHH:MM); empty = immediately
  completed_at TEXT,
  media_dir    TEXT,
  notes        TEXT,
  created_at   TEXT,
  updated_at   TEXT
);

-- A mission's existing control flights become one (finished) series
INSERT INTO assignment_series (mission_id, kind, interval_minutes, status, created_at, updated_at)
  SELECT m.id, 'kontrolle', m.control_interval_minutes, 'beendet', m.created_at, m.updated_at
    FROM missions m
   WHERE EXISTS (SELECT 1 FROM flights f WHERE f.mission_id = m.id AND f.kind = 'kontrolle');

-- Carry over existing assignments (all as done – they come from past flights)
INSERT INTO assignments_new (id, mission_id, series_id, sequence, kind, title, status, due_at, completed_at, media_dir, notes, created_at, updated_at)
  SELECT a.id,
         a.mission_id,
         CASE WHEN a.title IS NULL AND f.kind = 'kontrolle'
              THEN (SELECT s.id FROM assignment_series s WHERE s.mission_id = a.mission_id) END,
         CASE WHEN a.title IS NULL AND f.kind = 'kontrolle'
              THEN (SELECT COUNT(*) FROM flights f2 WHERE f2.mission_id = f.mission_id AND f2.kind = 'kontrolle' AND f2.flown_at <= f.flown_at) END,
         CASE WHEN a.kind = 'orthophoto' THEN 'kartierung'
              WHEN a.kind = 'position' THEN 'position'
              WHEN a.kind = 'gebietszuordnung' THEN 'gebiet'
              WHEN a.title IS NOT NULL THEN 'spezial'
              WHEN f.kind = 'kontrolle' THEN 'kontrolle'
              WHEN f.kind = 'spezial' THEN 'spezial'
              ELSE 'initial' END,
         COALESCE(a.title,
           CASE f.kind
             WHEN 'kontrolle' THEN 'Kontrollflug ' || (SELECT COUNT(*) FROM flights f2 WHERE f2.mission_id = f.mission_id AND f2.kind = 'kontrolle' AND f2.flown_at <= f.flown_at)
             WHEN 'spezial' THEN COALESCE(f.task, 'Spezialauftrag')
             ELSE 'Initiale Lage' END),
         'erledigt',
         f.flown_at,
         a.updated_at,
         a.media_dir,
         a.notes,
         a.created_at,
         a.updated_at
    FROM assignments a
    JOIN flights f ON f.id = a.flight_id;

DROP TABLE assignments;
ALTER TABLE assignments_new RENAME TO assignments;
CREATE INDEX index_assignments_on_mission_id ON assignments (mission_id);
CREATE INDEX index_assignments_on_series_id ON assignments (series_id);

-- Flights: end of the flight (last shot)
ALTER TABLE flights ADD COLUMN landed_at TEXT;
UPDATE flights SET landed_at = (SELECT MAX(substr(taken_at, 1, 16)) FROM media_files WHERE media_files.flight_id = flights.id);
UPDATE flights SET flown_at = (SELECT MIN(substr(taken_at, 1, 16)) FROM media_files WHERE media_files.flight_id = flights.id)
 WHERE EXISTS (SELECT 1 FROM media_files WHERE media_files.flight_id = flights.id AND taken_at IS NOT NULL);

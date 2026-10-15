-- Assignment within a flight (usually exactly one per flight)
CREATE TABLE assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions (id),
  flight_id  INTEGER NOT NULL REFERENCES flights (id),
  kind       TEXT NOT NULL,      -- lagebild | vergleich | orthophoto | position | gebietszuordnung
  media_dir  TEXT,               -- target folder of the images (set on first import)
  notes      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX index_assignments_on_flight_id ON assignments (flight_id);

-- Existing flights get a default assignment
INSERT INTO assignments (mission_id, flight_id, kind, created_at, updated_at)
  SELECT mission_id, id, 'lagebild', created_at, updated_at FROM flights;

ALTER TABLE missions ADD COLUMN media_dir TEXT;
ALTER TABLE flights ADD COLUMN media_dir TEXT;

-- An imported file. Files of one shot (wide/zoom/thermal) share the shot_key.
CREATE TABLE media_files (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id        INTEGER NOT NULL REFERENCES missions (id),
  flight_id         INTEGER NOT NULL REFERENCES flights (id),
  assignment_id     INTEGER NOT NULL REFERENCES assignments (id),
  kind              TEXT NOT NULL,     -- image | raw | video
  shot_key          TEXT NOT NULL,
  variant           TEXT,              -- W | Z | T | V …
  original_name     TEXT NOT NULL,
  original_path     TEXT,
  path              TEXT NOT NULL,
  thumb_path        TEXT,
  size              INTEGER,
  fingerprint       TEXT NOT NULL,
  taken_at          TEXT,              -- YYYY-MM-DDTHH:MM:SS (local)
  camera            TEXT,
  width             INTEGER,
  height            INTEGER,
  lat               REAL,
  lon               REAL,
  abs_alt           REAL,
  rel_alt           REAL,
  gimbal_yaw        REAL,
  gimbal_pitch      REAL,
  flight_yaw        REAL,
  focal_length      REAL,
  focal_length_35mm REAL,
  digital_zoom      REAL,
  metadata          TEXT,              -- JSON with all raw DJI values
  created_at        TEXT,
  updated_at        TEXT
);

CREATE UNIQUE INDEX index_media_files_on_fingerprint ON media_files (fingerprint);
CREATE INDEX index_media_files_on_flight_id ON media_files (flight_id);
CREATE INDEX index_media_files_on_assignment_id ON media_files (assignment_id);
CREATE INDEX index_media_files_on_shot_key ON media_files (shot_key);

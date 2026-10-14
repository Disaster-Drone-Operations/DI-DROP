-- Flugprotokolle der DJI-Fernsteuerung (Eckdaten; die Originaldateien liegen unverändert im
-- Ordner „Flugprotokolle“ und können später genauer ausgewertet werden)
CREATE TABLE flight_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name      TEXT NOT NULL UNIQUE,
  path           TEXT NOT NULL,
  size           INTEGER,
  log_version    INTEGER,
  started_at     TEXT NOT NULL,      -- UTC, ISO 8601
  landed_at      TEXT,               -- UTC = Start + Dauer
  duration_s     REAL,
  distance_m     REAL,
  max_height_m   REAL,
  max_speed_ms   REAL,
  battery_sn     TEXT,
  aircraft_name  TEXT,
  aircraft_sn    TEXT,
  rc_sn          TEXT,
  camera_sn      TEXT,
  latitude       REAL,
  longitude      REAL,
  photos         INTEGER,
  video_s        INTEGER,
  app_version    TEXT,
  mission_id     INTEGER REFERENCES missions (id),   -- später: Zuordnung zu Einsätzen
  notes          TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX index_flight_logs_on_started_at ON flight_logs (started_at);
CREATE INDEX index_flight_logs_on_battery_sn ON flight_logs (battery_sn);

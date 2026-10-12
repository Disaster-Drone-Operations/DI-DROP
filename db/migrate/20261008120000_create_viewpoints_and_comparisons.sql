-- Wegpunkt = eine Kameraposition/Blickrichtung, die (meist in mehreren Flügen) angeflogen wird
CREATE TABLE viewpoints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id    INTEGER NOT NULL REFERENCES missions (id),
  flight_line   TEXT,             -- DJI-Wegpunkt-Kennung (Flugauftrag), sonst NULL
  direction     TEXT NOT NULL,    -- gezeigte Seite: Nord, Nordost … oder Draufsicht
  side_deg      REAL,             -- Richtung vom Ziel zur Drohne, 0 = Norden
  custom_name   TEXT,             -- vom Benutzer vergebener Name
  lat           REAL,             -- Drohnenposition (Referenz)
  lon           REAL,
  rel_alt       REAL,
  target_lat    REAL,             -- Zielpunkt (Laser)
  target_lon    REAL,
  gimbal_yaw    REAL,
  gimbal_pitch  REAL,
  digital_zoom  REAL,
  created_at    TEXT,
  updated_at    TEXT
);

CREATE INDEX index_viewpoints_on_mission_id ON viewpoints (mission_id);

ALTER TABLE media_files ADD COLUMN viewpoint_id INTEGER REFERENCES viewpoints (id);
CREATE INDEX index_media_files_on_viewpoint_id ON media_files (viewpoint_id);

-- Erzeugte Vergleichsbilder (für die spätere Ablage)
CREATE TABLE comparisons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id     INTEGER NOT NULL REFERENCES missions (id),
  viewpoint_id   INTEGER REFERENCES viewpoints (id),
  variant        TEXT,
  path           TEXT NOT NULL,
  media_file_ids TEXT,            -- JSON-Liste der verwendeten Dateien
  created_at     TEXT,
  updated_at     TEXT
);

CREATE INDEX index_comparisons_on_mission_id ON comparisons (mission_id);

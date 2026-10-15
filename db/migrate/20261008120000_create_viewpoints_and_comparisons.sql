-- Viewpoint = a camera position/viewing direction that is flown to (usually in several flights)
CREATE TABLE viewpoints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id    INTEGER NOT NULL REFERENCES missions (id),
  flight_line   TEXT,             -- DJI waypoint id (flight mission), otherwise NULL
  direction     TEXT NOT NULL,    -- side shown: Nord, Nordost … or Draufsicht (top view)
  side_deg      REAL,             -- direction from target to drone, 0 = north
  custom_name   TEXT,             -- name given by the user
  lat           REAL,             -- drone position (reference)
  lon           REAL,
  rel_alt       REAL,
  target_lat    REAL,             -- target point (laser)
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

-- Generated comparison images (for later filing)
CREATE TABLE comparisons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id     INTEGER NOT NULL REFERENCES missions (id),
  viewpoint_id   INTEGER REFERENCES viewpoints (id),
  variant        TEXT,
  path           TEXT NOT NULL,
  media_file_ids TEXT,            -- JSON list of the files used
  created_at     TEXT,
  updated_at     TEXT
);

CREATE INDEX index_comparisons_on_mission_id ON comparisons (mission_id);

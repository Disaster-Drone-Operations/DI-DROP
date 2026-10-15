-- Delivery: an assignment's files into a folder (USB stick …) or into the Nextcloud.
-- An assignment can be delivered several times (e.g. first Nextcloud, then USB stick).

ALTER TABLE missions ADD COLUMN nextcloud_path TEXT;   -- the mission's base folder in the Nextcloud

-- One delivery: assignment → target
CREATE TABLE upload_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id     INTEGER NOT NULL REFERENCES missions (id),
  assignment_id  INTEGER REFERENCES assignments (id),
  target         TEXT NOT NULL,      -- folder | nextcloud | …
  destination    TEXT NOT NULL,      -- target folder (local, or path in the Nextcloud)
  label          TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX index_upload_batches_on_assignment_id ON upload_batches (assignment_id);

-- One file in the queue
CREATE TABLE upload_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id       INTEGER NOT NULL REFERENCES upload_batches (id),
  mission_id     INTEGER NOT NULL,
  assignment_id  INTEGER,
  target         TEXT NOT NULL,
  media_file_id  INTEGER,            -- image …
  comparison_id  INTEGER,            -- … or comparison image
  category       TEXT NOT NULL,      -- thermal | comparison | visible | other (order)
  variant        TEXT,
  viewpoint_id   INTEGER,
  source_path    TEXT NOT NULL,
  dest_path      TEXT NOT NULL,      -- full target path incl. file name
  size           INTEGER,
  position       REAL NOT NULL,      -- order in the queue (small = first)
  status         TEXT NOT NULL,      -- queued | running | paused | done | failed | canceled
  skipped        INTEGER DEFAULT 0,  -- target already had the file
  error          TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX index_upload_items_on_status ON upload_items (status);
CREATE INDEX index_upload_items_on_assignment_id ON upload_items (assignment_id);
CREATE INDEX index_upload_items_on_batch_id ON upload_items (batch_id);

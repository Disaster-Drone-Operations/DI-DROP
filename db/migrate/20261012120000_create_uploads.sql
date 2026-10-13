-- Bereitstellen: Dateien eines Auftrags in einen Ordner (USB-Stick …) oder in die Nextcloud.
-- Ein Auftrag kann mehrfach bereitgestellt werden (z. B. erst Nextcloud, dann USB-Stick).

ALTER TABLE missions ADD COLUMN nextcloud_path TEXT;   -- Basisordner des Einsatzes in der Nextcloud

-- Ein Bereitstellungs-Vorgang: Auftrag → Ziel
CREATE TABLE upload_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id     INTEGER NOT NULL REFERENCES missions (id),
  assignment_id  INTEGER REFERENCES assignments (id),
  target         TEXT NOT NULL,      -- folder | nextcloud | …
  destination    TEXT NOT NULL,      -- Zielordner (lokal bzw. Pfad in der Nextcloud)
  label          TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX index_upload_batches_on_assignment_id ON upload_batches (assignment_id);

-- Eine Datei in der Warteschlange
CREATE TABLE upload_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id       INTEGER NOT NULL REFERENCES upload_batches (id),
  mission_id     INTEGER NOT NULL,
  assignment_id  INTEGER,
  target         TEXT NOT NULL,
  media_file_id  INTEGER,            -- Bild …
  comparison_id  INTEGER,            -- … oder Vergleichsbild
  category       TEXT NOT NULL,      -- thermal | comparison | visible | other (Reihenfolge)
  variant        TEXT,
  viewpoint_id   INTEGER,
  source_path    TEXT NOT NULL,
  dest_path      TEXT NOT NULL,      -- vollständiger Zielpfad inkl. Dateiname
  size           INTEGER,
  position       REAL NOT NULL,      -- Reihenfolge in der Warteschlange (klein = zuerst)
  status         TEXT NOT NULL,      -- queued | running | paused | done | failed | canceled
  skipped        INTEGER DEFAULT 0,  -- Ziel hatte die Datei schon
  error          TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX index_upload_items_on_status ON upload_items (status);
CREATE INDEX index_upload_items_on_assignment_id ON upload_items (assignment_id);
CREATE INDEX index_upload_items_on_batch_id ON upload_items (batch_id);

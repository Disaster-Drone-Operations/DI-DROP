-- Eigene Namen für Seriennummern (z. B. Akku „87UPN2LCA00061“ → „Akku A“, Drohne → „Drohne 1“)
CREATE TABLE device_names (
  kind        TEXT NOT NULL,      -- aircraft | battery
  serial      TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TEXT,
  updated_at  TEXT,
  PRIMARY KEY (kind, serial)
);

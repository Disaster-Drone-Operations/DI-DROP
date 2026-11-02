-- Qualifications of the people (EU competency certificates, own trainings …): which kinds the unit records,
-- and who holds which one until when (valid_until NULL = no expiry recorded).
CREATE TABLE qualification_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX index_qualification_types_on_name ON qualification_types (name COLLATE NOCASE);

INSERT INTO qualification_types (name, position, created_at, updated_at) VALUES
  ('EU A1/A3', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('EU A2', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('EU STS', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE person_qualifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES people (id),
  type_id     INTEGER NOT NULL REFERENCES qualification_types (id),
  valid_until TEXT,                 -- date "2027-03-31"
  created_at  TEXT,
  updated_at  TEXT
);

CREATE UNIQUE INDEX index_person_qualifications ON person_qualifications (person_id, type_id);

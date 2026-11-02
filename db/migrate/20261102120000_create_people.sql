-- People of the drone unit. Roles (crew of a mission, pilot/observer of a flight, operator of an
-- assignment) refer to them – inactive people stay for the history.
CREATE TABLE people (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  initials   TEXT,                  -- own short form; NULL = automatic (first + last word of the name)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);

CREATE UNIQUE INDEX index_people_on_name ON people (name COLLATE NOCASE);

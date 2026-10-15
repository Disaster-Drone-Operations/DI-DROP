-- Battery status that the flight logs can't tell: retired batteries no longer count for the
-- recommendation and the average (names live in device_names)
CREATE TABLE battery_states (
  serial      TEXT PRIMARY KEY,
  retired_at  TEXT,               -- ISO 8601; NULL = in service
  created_at  TEXT,
  updated_at  TEXT
);

-- Crew of a mission as a history: from from_at on, role X is filled by person Y (NULL = nobody).
-- Who had a role at a certain time = the latest entry with from_at <= that time.
-- from_at in local time like the other mission times ("2026-06-20T14:05").
CREATE TABLE mission_crew (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id INTEGER NOT NULL REFERENCES missions (id),
  role       TEXT NOT NULL,          -- group_leader | pilot | observer | operator
  person_id  INTEGER REFERENCES people (id),
  from_at    TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX index_mission_crew_on_mission_id ON mission_crew (mission_id, role, from_at);

-- Names typed into missions so far (and the former setting "Dein Name") → people
INSERT INTO people (name, active, created_at, updated_at)
SELECT trim(name), 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM (
    SELECT group_leader AS name FROM missions UNION ALL
    SELECT pilot FROM missions UNION ALL
    SELECT observer FROM missions UNION ALL
    SELECT operator FROM missions UNION ALL
    SELECT json_extract(value, '$') FROM settings WHERE key = 'general.operator_name'
  )
 WHERE trim(coalesce(name, '')) <> ''
   AND trim(name) NOT IN (SELECT name FROM people)
 GROUP BY trim(name) COLLATE NOCASE;

-- … and the crew of each mission from its start
INSERT INTO mission_crew (mission_id, role, person_id, from_at, created_at, updated_at)
SELECT m.id, r.role, p.id, m.date || 'T' || coalesce(m.start_time, '00:00'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM missions m
  JOIN (SELECT 'group_leader' AS role UNION ALL SELECT 'pilot' UNION ALL SELECT 'observer' UNION ALL SELECT 'operator') r
  JOIN people p ON p.name = trim(CASE r.role WHEN 'group_leader' THEN m.group_leader WHEN 'pilot' THEN m.pilot
                                                WHEN 'observer' THEN m.observer ELSE m.operator END) COLLATE NOCASE;

-- No preset Drone Operator any more: every role is chosen freely per mission
DELETE FROM settings WHERE key = 'general.operator_name';

-- Stored enum values in English (code is English; user-facing labels stay German in the models).
-- Column defaults in older migrations still name the old values, but the app always sets them explicitly.

UPDATE missions SET kind = CASE kind WHEN 'einsatz' THEN 'operation' WHEN 'uebung' THEN 'exercise' ELSE kind END;
UPDATE missions SET status = CASE status WHEN 'aktiv' THEN 'active' WHEN 'abgeschlossen' THEN 'closed' ELSE status END;

UPDATE assignments SET kind = CASE kind
  WHEN 'spezial' THEN 'special' WHEN 'kontrolle' THEN 'control' WHEN 'sonstiges' THEN 'other'
  WHEN 'kartierung' THEN 'mapping' WHEN 'gebiet' THEN 'area' ELSE kind END;
UPDATE assignments SET status = CASE status WHEN 'offen' THEN 'open' WHEN 'erledigt' THEN 'done' ELSE status END;

UPDATE assignment_series SET kind = CASE kind WHEN 'kontrolle' THEN 'control' ELSE kind END;
UPDATE assignment_series SET status = CASE status WHEN 'aktiv' THEN 'active' WHEN 'beendet' THEN 'ended' ELSE status END;

UPDATE flights SET kind = CASE kind
  WHEN 'flug' THEN 'flight' WHEN 'kontrolle' THEN 'control' WHEN 'spezial' THEN 'special' ELSE kind END;

UPDATE settings SET value = '"operation"' WHERE key = 'general.default_mission_kind' AND value = '"einsatz"';
UPDATE settings SET value = '"exercise"' WHERE key = 'general.default_mission_kind' AND value = '"uebung"';

-- Pilot and airspace observer of a flight. Automatic (source NULL/'auto'): from the crew of its mission
-- at the flight's start time (app/services/flight_crew.js); 'manual': set by hand – also without a mission.
ALTER TABLE flight_logs ADD COLUMN pilot_id INTEGER REFERENCES people (id);
ALTER TABLE flight_logs ADD COLUMN pilot_source TEXT;
ALTER TABLE flight_logs ADD COLUMN observer_id INTEGER REFERENCES people (id);
ALTER TABLE flight_logs ADD COLUMN observer_source TEXT;

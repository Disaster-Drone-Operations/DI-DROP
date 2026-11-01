-- Flight logs ↔ missions: how the mission was assigned (app/services/flight_missions.js)
--   NULL   never assigned (the automatic assignment may decide)
--   auto   assigned automatically (images taken during the flight / time window) – may change again
--   manual chosen by hand, also "Kein Einsatz" (mission_id NULL) – never changed automatically
ALTER TABLE flight_logs ADD COLUMN mission_source TEXT;
CREATE INDEX index_flight_logs_on_mission_id ON flight_logs (mission_id);

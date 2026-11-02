-- Real flight (remote controller's flight log) an image was taken in: taken between start and landing
-- (± 2 min), several candidates → same drone serial number. Kept up to date by linkMedia()
-- in app/services/flight_missions.js – after image and flight log imports.
ALTER TABLE media_files ADD COLUMN flight_log_id INTEGER REFERENCES flight_logs (id) ON DELETE SET NULL;
CREATE INDEX index_media_files_on_flight_log_id ON media_files (flight_log_id);

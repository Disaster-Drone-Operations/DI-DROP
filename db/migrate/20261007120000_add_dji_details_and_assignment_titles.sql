-- Camera, waypoint and laser target point (DJI M4TD) – basis for comparison shots
ALTER TABLE media_files ADD COLUMN image_source TEXT;        -- InfraredCamera | WideCamera | ZoomCamera
ALTER TABLE media_files ADD COLUMN flight_line TEXT;         -- waypoint id of a flight mission
ALTER TABLE media_files ADD COLUMN target_lat REAL;
ALTER TABLE media_files ADD COLUMN target_lon REAL;
ALTER TABLE media_files ADD COLUMN target_distance REAL;

CREATE INDEX index_media_files_on_flight_line ON media_files (flight_line);

-- Name of an assignment, e.g. "Überblick"
ALTER TABLE assignments ADD COLUMN title TEXT;

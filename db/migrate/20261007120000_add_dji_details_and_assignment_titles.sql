-- Kamera, Wegpunkt und Laser-Zielpunkt (DJI M4TD) – Grundlage für Vergleichsaufnahmen
ALTER TABLE media_files ADD COLUMN image_source TEXT;        -- InfraredCamera | WideCamera | ZoomCamera
ALTER TABLE media_files ADD COLUMN flight_line TEXT;         -- Wegpunkt-Kennung eines Flugauftrags
ALTER TABLE media_files ADD COLUMN target_lat REAL;
ALTER TABLE media_files ADD COLUMN target_lon REAL;
ALTER TABLE media_files ADD COLUMN target_distance REAL;

CREATE INDEX index_media_files_on_flight_line ON media_files (flight_line);

-- Name eines Auftrags, z. B. "Überblick"
ALTER TABLE assignments ADD COLUMN title TEXT;

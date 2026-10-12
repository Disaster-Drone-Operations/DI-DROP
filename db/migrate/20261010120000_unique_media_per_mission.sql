-- Dieselben Bilder dürfen in verschiedenen Einsätzen vorkommen (z. B. zum Testen).
-- Innerhalb eines Einsatzes bleibt jede Datei einmalig.
DROP INDEX index_media_files_on_fingerprint;
CREATE UNIQUE INDEX index_media_files_on_mission_and_fingerprint ON media_files (mission_id, fingerprint);

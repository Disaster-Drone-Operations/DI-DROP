-- The same images may appear in different missions (e.g. for testing).
-- Within a mission each file stays unique.
DROP INDEX index_media_files_on_fingerprint;
CREATE UNIQUE INDEX index_media_files_on_mission_and_fingerprint ON media_files (mission_id, fingerprint);

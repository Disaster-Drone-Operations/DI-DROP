-- Marked copies ("…_markiert.JPG") in the upload queue: annotation + the version that was uploaded
-- (annotations.updated_at) – changed markings count as not provided again and are uploaded as a new file.
ALTER TABLE upload_items ADD COLUMN annotation_id INTEGER REFERENCES annotations (id) ON DELETE SET NULL;
ALTER TABLE upload_items ADD COLUMN annotation_version TEXT;

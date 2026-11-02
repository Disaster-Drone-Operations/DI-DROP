-- Markings on an image or a comparison image (circle, rectangle, arrow, text): shapes as JSON in coordinates
-- relative to the image (0…1), so they fit thumbnail, large view and original alike. The image file is never
-- changed – a copy "…_markiert.JPG" next to it carries the markings (app/services/annotations.js).
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_file_id INTEGER REFERENCES media_files (id) ON DELETE CASCADE,
  comparison_id INTEGER REFERENCES comparisons (id) ON DELETE CASCADE,
  shapes TEXT NOT NULL DEFAULT '[]',
  marked_size INTEGER, -- bytes of the marked copy (for provisioning)
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX index_annotations_on_media_file_id ON annotations (media_file_id) WHERE media_file_id IS NOT NULL;
CREATE UNIQUE INDEX index_annotations_on_comparison_id ON annotations (comparison_id) WHERE comparison_id IS NOT NULL;

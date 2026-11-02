-- Version of the markings, counted up on every change – identifies what was provided (upload_items.annotation_version);
-- not the time: in training mode the clock may stand still.
ALTER TABLE annotations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

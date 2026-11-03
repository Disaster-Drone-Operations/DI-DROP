-- Compass on an image (drawn into what is provided, see app/services/compass.js): per shot on/off
-- (NULL = as in the settings, images.compass_default) and where (centre, relative to the image 0…1).
ALTER TABLE media_files ADD COLUMN compass INTEGER;
ALTER TABLE media_files ADD COLUMN compass_x REAL;
ALTER TABLE media_files ADD COLUMN compass_y REAL;

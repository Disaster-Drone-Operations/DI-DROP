-- Drone Operator of an assignment. Automatic (source NULL/'auto', app/services/flight_crew.js): who was Drone
-- Operator in the mission's crew when its first images were imported – without images: when it was done.
-- 'manual': set by hand on the assignment page.
ALTER TABLE assignments ADD COLUMN operator_id INTEGER REFERENCES people (id);
ALTER TABLE assignments ADD COLUMN operator_source TEXT;

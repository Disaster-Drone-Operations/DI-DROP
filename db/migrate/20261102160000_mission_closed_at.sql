-- When a mission was closed – end of the crew's last period (experience as group leader, app/services/experience.js).
-- Missions closed before: estimated there from their last activity.
ALTER TABLE missions ADD COLUMN closed_at TEXT;

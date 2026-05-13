-- Make audit_start_year NOT NULL and remove the default.
-- All existing rows already have a value (DB default was 2025).
-- Going forward, application code must always provide the value.

ALTER TABLE monitored_applications
  ALTER COLUMN audit_start_year SET NOT NULL,
  ALTER COLUMN audit_start_year DROP DEFAULT;

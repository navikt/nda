-- Remove the DB default for audit_start_year.
-- Going forward, application code must always provide the value explicitly.
-- The column remains nullable: NULL means "no audit window restriction".

ALTER TABLE monitored_applications
  ALTER COLUMN audit_start_year DROP DEFAULT;

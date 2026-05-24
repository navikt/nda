-- Remove the DB default for default_branch and enforce NOT NULL.
-- Going forward, application code must always provide the value explicitly.
-- The auto-sync (default-branch-sync.server.ts) detects the real branch from
-- GitHub within 24h; the application-code default ('main') is just a safe
-- starting value until then.

-- All existing rows already have a non-null value, so this is safe.
ALTER TABLE monitored_applications
  ALTER COLUMN default_branch SET NOT NULL,
  ALTER COLUMN default_branch DROP DEFAULT;

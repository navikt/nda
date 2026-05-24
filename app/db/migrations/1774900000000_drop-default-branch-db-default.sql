-- Remove the DB default for default_branch.
-- Going forward, application code determines the value: either from GitHub at
-- creation time, or via the auto-sync (default-branch-sync.server.ts) within
-- 5 minutes. The column is nullable — NULL means "not yet determined".

ALTER TABLE monitored_applications
  ALTER COLUMN default_branch DROP DEFAULT;

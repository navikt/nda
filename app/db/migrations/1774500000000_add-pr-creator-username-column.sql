-- Add a stored generated column for the lowercased PR creator username.
-- This avoids repeated JSONB extraction and LOWER() calls per row in queries,
-- and allows an index to be used for equality lookups.

ALTER TABLE deployments
  ADD COLUMN pr_creator_username TEXT
    GENERATED ALWAYS AS (LOWER(github_pr_data -> 'creator' ->> 'username')) STORED;

CREATE INDEX IF NOT EXISTS idx_deployments_pr_creator_username
  ON deployments(pr_creator_username);

-- Migration: Add raw GitHub pulls.get response snapshots
-- Purpose: Store the unmodified pulls.get response for each PR fetched via
-- getMergedPullRequestsInWindow() and lookupLegacyByPR(), so reports built on
-- these responses can be extended (e.g. with labels/description) later without
-- a new, potentially non-reproducible, GitHub call.

CREATE TABLE github_pr_window_raw_snapshots (
  id SERIAL PRIMARY KEY,

  -- GitHub's global, immutable repo id (guards against owner/repo reuse
  -- after a repository is deleted and recreated with the same name)
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,

  -- GitHub API version this response was served under
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The unmodified GitHub pulls.get API response
  data JSONB NOT NULL
);

CREATE INDEX idx_pr_window_raw_snapshots_lookup
  ON github_pr_window_raw_snapshots(github_repo_id, pr_number, fetched_at DESC);

CREATE INDEX idx_pr_window_raw_snapshots_owner_repo
  ON github_pr_window_raw_snapshots(owner, repo, pr_number, fetched_at DESC);

COMMENT ON TABLE github_pr_window_raw_snapshots IS 'Unmodified GitHub pulls.get API responses fetched via getMergedPullRequestsInWindow() and lookupLegacyByPR(), so reports built on these responses can be extended without a new, non-reproducible GitHub call';
COMMENT ON COLUMN github_pr_window_raw_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id (distinct from schema_version-style app versioning)';
COMMENT ON COLUMN github_pr_window_raw_snapshots.api_version IS 'GitHub API version selected for this response (x-github-api-version-selected header)';
COMMENT ON COLUMN github_pr_window_raw_snapshots.api_deprecated_at IS 'Value of the Deprecation response header, if the API version used is deprecated';
COMMENT ON COLUMN github_pr_window_raw_snapshots.api_sunset_at IS 'Value of the Sunset response header, if the API version used has a scheduled removal date';

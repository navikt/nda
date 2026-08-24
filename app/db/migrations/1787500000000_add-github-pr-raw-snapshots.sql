-- Migration: Add raw GitHub PR response snapshots
-- Purpose: Store unmodified GitHub API responses for PR data, so the app's
-- transformed data shape can be re-derived without re-fetching from GitHub.

CREATE TABLE github_pr_raw_snapshots (
  id SERIAL PRIMARY KEY,

  -- Identification (github_repo_id is GitHub's global, immutable repo id;
  -- owner/repo/pr_number are the human-readable identifiers within it)
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,

  -- 'pr', 'reviews', 'commits', 'comments', 'review_comments'
  data_type TEXT NOT NULL,

  -- GitHub API version this response was served under
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The unmodified GitHub API response
  data JSONB NOT NULL
);

CREATE INDEX idx_pr_raw_snapshots_lookup
  ON github_pr_raw_snapshots(github_repo_id, pr_number, data_type, fetched_at DESC);

CREATE INDEX idx_pr_raw_snapshots_pr
  ON github_pr_raw_snapshots(github_repo_id, pr_number);

CREATE INDEX idx_pr_raw_snapshots_owner_repo_pr
  ON github_pr_raw_snapshots(owner, repo, pr_number, fetched_at DESC);

COMMENT ON TABLE github_pr_raw_snapshots IS 'Unmodified GitHub API responses for PR data, used to re-derive transformed data without re-fetching from GitHub';
COMMENT ON COLUMN github_pr_raw_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id (distinct from schema_version-style app versioning)';
COMMENT ON COLUMN github_pr_raw_snapshots.data_type IS 'Type of raw response: pr, reviews, commits, comments, review_comments';
COMMENT ON COLUMN github_pr_raw_snapshots.api_version IS 'GitHub API version selected for this response (x-github-api-version-selected header)';
COMMENT ON COLUMN github_pr_raw_snapshots.api_deprecated_at IS 'Value of the Deprecation response header, if the API version used is deprecated';
COMMENT ON COLUMN github_pr_raw_snapshots.api_sunset_at IS 'Value of the Sunset response header, if the API version used has a scheduled removal date';

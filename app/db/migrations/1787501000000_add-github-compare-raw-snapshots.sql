-- Migration: Add raw GitHub compare response snapshots
-- Purpose: Store the unmodified GitHub compareCommits response, so the app's
-- transformed compare data can be re-derived without re-fetching from GitHub.

CREATE TABLE github_compare_raw_snapshots (
  id SERIAL PRIMARY KEY,

  -- GitHub's global, immutable repo id (guards against owner/repo reuse
  -- after a repository is deleted and recreated with the same name)
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,

  -- GitHub API version this response was served under
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The unmodified GitHub API response
  data JSONB NOT NULL
);

CREATE INDEX idx_compare_raw_snapshots_lookup
  ON github_compare_raw_snapshots(github_repo_id, base_sha, head_sha, fetched_at DESC);

CREATE INDEX idx_compare_raw_snapshots_owner_repo
  ON github_compare_raw_snapshots(owner, repo, base_sha, head_sha, fetched_at DESC);

COMMENT ON TABLE github_compare_raw_snapshots IS 'Unmodified GitHub compareCommits API responses, used to re-derive transformed compare data without re-fetching from GitHub';
COMMENT ON COLUMN github_compare_raw_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id (distinct from schema_version-style app versioning)';
COMMENT ON COLUMN github_compare_raw_snapshots.api_version IS 'GitHub API version selected for this response (x-github-api-version-selected header)';
COMMENT ON COLUMN github_compare_raw_snapshots.api_deprecated_at IS 'Value of the Deprecation response header, if the API version used is deprecated';
COMMENT ON COLUMN github_compare_raw_snapshots.api_sunset_at IS 'Value of the Sunset response header, if the API version used has a scheduled removal date';

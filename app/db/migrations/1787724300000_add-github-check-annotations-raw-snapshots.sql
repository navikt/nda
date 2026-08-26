-- Migration: Add raw GitHub checks.listAnnotations response snapshots
-- Purpose: Store the unmodified checks.listAnnotations response fetched by the
-- /api/checks/annotations fallback route (used for older check runs whose
-- annotations were not yet captured by the main checks archival), so the
-- response is not discarded when it happens to be available from GitHub.

CREATE TABLE github_check_annotations_raw_snapshots (
  id SERIAL PRIMARY KEY,

  -- GitHub's global, immutable repo id (guards against owner/repo reuse
  -- after a repository is deleted and recreated with the same name)
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  check_run_id BIGINT NOT NULL,

  -- GitHub API version this response was served under
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The unmodified GitHub checks.listAnnotations API response
  data JSONB NOT NULL
);

CREATE INDEX idx_check_annotations_raw_snapshots_lookup
  ON github_check_annotations_raw_snapshots(github_repo_id, check_run_id, fetched_at DESC);

CREATE INDEX idx_check_annotations_raw_snapshots_owner_repo
  ON github_check_annotations_raw_snapshots(owner, repo, check_run_id, fetched_at DESC);

COMMENT ON TABLE github_check_annotations_raw_snapshots IS 'Unmodified GitHub checks.listAnnotations API responses fetched by the /api/checks/annotations fallback route, so the response is not discarded when it happens to be available from GitHub';
COMMENT ON COLUMN github_check_annotations_raw_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id (distinct from schema_version-style app versioning)';
COMMENT ON COLUMN github_check_annotations_raw_snapshots.api_version IS 'GitHub API version selected for this response (x-github-api-version-selected header)';
COMMENT ON COLUMN github_check_annotations_raw_snapshots.api_deprecated_at IS 'Value of the Deprecation response header, if the API version used is deprecated';
COMMENT ON COLUMN github_check_annotations_raw_snapshots.api_sunset_at IS 'Value of the Sunset response header, if the API version used has a scheduled removal date';

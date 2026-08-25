-- Migration: Add raw GitHub check runs snapshots
-- Purpose: Store the unmodified checks.listForRef (+ listAnnotations) response, so the
-- app's transformed checks data can be re-derived without re-fetching from GitHub.

CREATE TABLE github_checks_raw_snapshots (
  id SERIAL PRIMARY KEY,

  -- GitHub's global, immutable repo id (guards against owner/repo reuse
  -- after a repository is deleted and recreated with the same name)
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,

  -- The commit SHA the check runs were fetched for (may differ from a caller's
  -- originally requested SHA due to fallback-SHA resolution in getChecksForCommit)
  sha TEXT NOT NULL,

  -- Check suite the caller scoped the lookup to, if any
  check_suite_id BIGINT,

  -- True only when every check run has status = 'completed' (or none exist).
  -- A false snapshot reflects an in-progress result and must never be reused
  -- for derivation without re-fetching from GitHub.
  is_definitive BOOLEAN NOT NULL,

  -- GitHub API version this response was served under
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The unmodified GitHub API response (check runs + annotations)
  data JSONB NOT NULL
);

CREATE INDEX idx_checks_raw_snapshots_lookup
  ON github_checks_raw_snapshots(github_repo_id, sha, fetched_at DESC);

CREATE INDEX idx_checks_raw_snapshots_owner_repo
  ON github_checks_raw_snapshots(owner, repo, sha, fetched_at DESC);

COMMENT ON TABLE github_checks_raw_snapshots IS 'Unmodified GitHub check runs API responses, used to re-derive transformed checks data without re-fetching from GitHub';
COMMENT ON COLUMN github_checks_raw_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id (distinct from schema_version-style app versioning)';
COMMENT ON COLUMN github_checks_raw_snapshots.sha IS 'Commit SHA the check runs were matched against, which may be a fallback SHA rather than the originally requested one';
COMMENT ON COLUMN github_checks_raw_snapshots.check_suite_id IS 'Check suite the lookup was scoped to, if any';
COMMENT ON COLUMN github_checks_raw_snapshots.is_definitive IS 'True only if every check run had status=completed (or none existed) at fetch time; false snapshots must not be reused without re-fetching';
COMMENT ON COLUMN github_checks_raw_snapshots.api_version IS 'GitHub API version selected for this response (x-github-api-version-selected header)';
COMMENT ON COLUMN github_checks_raw_snapshots.api_deprecated_at IS 'Value of the Deprecation response header, if the API version used is deprecated';
COMMENT ON COLUMN github_checks_raw_snapshots.api_sunset_at IS 'Value of the Sunset response header, if the API version used has a scheduled removal date';

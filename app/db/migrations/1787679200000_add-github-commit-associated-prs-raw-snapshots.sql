-- Migration: Add raw GitHub commit-associated-PRs response snapshots
-- Purpose: Store the unmodified listPullRequestsAssociatedWithCommit response behind
-- findPrForCommit()/getPullRequestForCommit(), so PR matching for a commit can be
-- re-derived without re-fetching from GitHub. This call is time-sensitive (new PRs can
-- be associated with a commit later), so each snapshot is a point-in-time record.

CREATE TABLE github_commit_associated_prs_raw_snapshots (
  id SERIAL PRIMARY KEY,

  -- GitHub's global, immutable repo id (guards against owner/repo reuse
  -- after a repository is deleted and recreated with the same name)
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,

  -- GitHub API version this response was served under
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The unmodified GitHub API response (array of associated PRs)
  data JSONB NOT NULL
);

CREATE INDEX idx_commit_associated_prs_raw_snapshots_lookup
  ON github_commit_associated_prs_raw_snapshots(github_repo_id, sha, fetched_at DESC);

CREATE INDEX idx_commit_associated_prs_raw_snapshots_owner_repo
  ON github_commit_associated_prs_raw_snapshots(owner, repo, sha, fetched_at DESC);

COMMENT ON TABLE github_commit_associated_prs_raw_snapshots IS 'Unmodified GitHub listPullRequestsAssociatedWithCommit API responses behind findPrForCommit()/getPullRequestForCommit(); time-sensitive, so each snapshot is an audit record rather than a reusable cache';
COMMENT ON COLUMN github_commit_associated_prs_raw_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id (distinct from schema_version-style app versioning)';
COMMENT ON COLUMN github_commit_associated_prs_raw_snapshots.api_version IS 'GitHub API version selected for this response (x-github-api-version-selected header)';
COMMENT ON COLUMN github_commit_associated_prs_raw_snapshots.api_deprecated_at IS 'Value of the Deprecation response header, if the API version used is deprecated';
COMMENT ON COLUMN github_commit_associated_prs_raw_snapshots.api_sunset_at IS 'Value of the Sunset response header, if the API version used has a scheduled removal date';

-- Migration: Add raw GitHub commit-on-branch response snapshots
-- Purpose: Store the unmodified GitHub compareCommits response behind isCommitOnBranch()
-- (the commitOnBaseBranch four-eyes decision gate), so that decision can be reconstructed
-- later even though a new call against the branch's current HEAD would not necessarily
-- reproduce the same result.

CREATE TABLE github_commit_on_branch_raw_snapshots (
  id SERIAL PRIMARY KEY,

  -- GitHub's global, immutable repo id (guards against owner/repo reuse
  -- after a repository is deleted and recreated with the same name)
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,

  -- GitHub API version this response was served under
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The unmodified GitHub API response
  data JSONB NOT NULL
);

CREATE INDEX idx_commit_on_branch_raw_snapshots_lookup
  ON github_commit_on_branch_raw_snapshots(github_repo_id, commit_sha, branch, fetched_at DESC);

CREATE INDEX idx_commit_on_branch_raw_snapshots_owner_repo
  ON github_commit_on_branch_raw_snapshots(owner, repo, commit_sha, branch, fetched_at DESC);

COMMENT ON TABLE github_commit_on_branch_raw_snapshots IS 'Unmodified GitHub compareCommits API responses behind isCommitOnBranch(), archived at decision time since the branch HEAD moves and a later re-fetch would not reproduce the same result';
COMMENT ON COLUMN github_commit_on_branch_raw_snapshots.github_repo_id IS 'GitHub''s global, immutable repository id (distinct from schema_version-style app versioning)';
COMMENT ON COLUMN github_commit_on_branch_raw_snapshots.branch IS 'Branch name compared against at decision time; the branch HEAD moves, so this snapshot cannot be reused as a cache, only as an audit trail';
COMMENT ON COLUMN github_commit_on_branch_raw_snapshots.api_version IS 'GitHub API version selected for this response (x-github-api-version-selected header)';
COMMENT ON COLUMN github_commit_on_branch_raw_snapshots.api_deprecated_at IS 'Value of the Deprecation response header, if the API version used is deprecated';
COMMENT ON COLUMN github_commit_on_branch_raw_snapshots.api_sunset_at IS 'Value of the Sunset response header, if the API version used has a scheduled removal date';

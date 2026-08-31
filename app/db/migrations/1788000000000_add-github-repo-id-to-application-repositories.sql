-- Add github_repo_id to application_repositories
--
-- Context:
-- application_repositories currently identifies a repository only by
-- (github_owner, github_repo_name). GitHub repository names/owners can
-- change (rename, org transfer), while github_repo_id is GitHub's global,
-- immutable repository id. Monorepo detection and the previous-deployment
-- resolution logic need a stable identity to key on, so we add
-- github_repo_id here. It is nullable and backfilled asynchronously (see
-- app/lib/sync/github-repo-id-backfill.server.ts) since populating it
-- requires a GitHub API call per distinct repository.

ALTER TABLE application_repositories
ADD COLUMN IF NOT EXISTS github_repo_id BIGINT NULL;

COMMENT ON COLUMN application_repositories.github_repo_id IS
  'GitHub''s global, immutable repository id. NULL until backfilled. Prefer this over (github_owner, github_repo_name) for repo identity once populated, since owner/name can change on rename or org transfer.';

CREATE INDEX IF NOT EXISTS idx_application_repositories_github_repo_id
  ON application_repositories (github_repo_id)
  WHERE github_repo_id IS NOT NULL;

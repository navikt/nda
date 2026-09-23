-- Add github_repo_id to deployments
--
-- Context:
-- deployments currently identifies the source repository only via
-- (detected_github_owner, detected_github_repo_name). GitHub repository
-- names can be freed and reused by an entirely different repository later,
-- which can make owner/name-based joins (e.g. status-history and
-- verification-diff lookups) match the wrong repository's rows. Adding the
-- immutable github_repo_id here lets those lookups key on GitHub's stable
-- id instead, same as application_repositories.github_repo_id and
-- repositories.github_repo_id.
--
-- Nullable. New deployments get it populated at creation time going
-- forward (see app/lib/sync/nais-sync.server.ts).
--
-- Existing rows are NOT backfilled by this migration: naive owner/name-based
-- backfill is unsafe, since a repository can be renamed and its old name
-- later reused by an unrelated repository, making owner/name resolve to the
-- wrong id for old rows. Instead, scripts/backfill-deployment-github-repo-id.ts
-- backfills existing rows via each deployment's GitHub Actions workflow run
-- (trigger_url), which is safe: a workflow run id is globally unique and
-- permanently tied to the repository it ran in, so the lookup either
-- resolves to the correct repository (including across renames, via GitHub's
-- redirect) or 404s (e.g. if the name was later reused by a different
-- repository) — it can never silently resolve to the wrong repository.
-- Deployments without a resolvable workflow run (e.g. manual `nais deploy`,
-- or an expired/deleted run) keep github_repo_id NULL and continue falling
-- back to owner/name matching, exactly as before this migration.

ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS github_repo_id BIGINT NULL;

COMMENT ON COLUMN deployments.github_repo_id IS
  'GitHub''s global, immutable repository id for the detected repository. NULL for deployments where it could not be resolved (see migration comment above and scripts/backfill-deployment-github-repo-id.ts); populated at creation time for all newer rows. Prefer this over (detected_github_owner, detected_github_repo_name) once populated, since owner/name can change on rename, org transfer, or be reused by a different repository.';

CREATE INDEX IF NOT EXISTS idx_deployments_github_repo_id
  ON deployments (github_repo_id)
  WHERE github_repo_id IS NOT NULL;

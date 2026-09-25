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
-- Nullable. Incremental sync (the common case — new deployments discovered a
-- few at a time) resolves it via a live GitHub lookup at creation time (see
-- app/lib/sync/nais-sync.server.ts). Full sync (first-time app registration,
-- which can insert up to ~1000 rows in one run) inserts it NULL instead, to
-- avoid doing that many live lookups serially in one request; those rows are
-- resolved afterwards by the separate backfill below.
--
-- Existing rows are NOT backfilled by this migration: naive owner/name-based
-- backfill is unsafe, since a repository can be renamed and its old name
-- later reused by an unrelated repository, making owner/name resolve to the
-- wrong id for old rows. Instead, a separate backfill
-- (app/lib/github/backfill-deployment-github-repo-id.server.ts) resolves
-- existing rows via each deployment's GitHub Actions workflow run
-- (trigger_url), which is safe: a workflow run id is globally unique and
-- permanently tied to the repository it ran in, so the lookup either
-- resolves to the correct repository (including across renames, via GitHub's
-- redirect) or 404s (e.g. if the name was later reused by a different
-- repository) — it can never silently resolve to the wrong repository.
-- Deployments without a resolvable workflow run (e.g. manual `nais deploy`)
-- keep github_repo_id NULL and continue falling back to owner/name matching,
-- exactly as before this migration. Deployments with an expired/deleted
-- workflow run also keep github_repo_id NULL, but do NOT fall back to
-- owner/name matching: the read-side queries treat any trigger_url pointing
-- at a workflow run as unsafe to fall back on, since the run's repository
-- could not be confirmed and the name may since have been reused.

ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS github_repo_id BIGINT NULL;

COMMENT ON COLUMN deployments.github_repo_id IS
  'GitHub''s global, immutable repository id for the detected repository. NULL for deployments where it could not be resolved (see migration comment above); resolved at creation time for incrementally-synced rows, asynchronously by the admin backfill route for full-sync and historical rows. Prefer this over (detected_github_owner, detected_github_repo_name) once populated, since owner/name can change on rename, org transfer, or be reused by a different repository.';

CREATE INDEX IF NOT EXISTS idx_deployments_github_repo_id
  ON deployments (github_repo_id)
  WHERE github_repo_id IS NOT NULL;

-- Track backfill attempts for deployments.github_repo_id
--
-- Context:
-- The github_repo_id backfill (app/lib/github/backfill-deployment-github-repo-id.server.ts)
-- repeatedly selects candidate rows via `github_repo_id IS NULL`. A row whose
-- workflow run could not be resolved (e.g. 404, deleted run) stays NULL
-- forever, so it kept being re-selected as a candidate on every call —
-- blocking progress to later candidates and preventing the pending count
-- from ever reaching 0.
--
-- github_repo_id_backfill_attempted_at records that a resolution attempt was
-- made and failed, so the candidate query can exclude it from future runs.
-- It is cleared (back to NULL) whenever github_repo_id is later resolved, so
-- it never coexists with a populated github_repo_id.

ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS github_repo_id_backfill_attempted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN deployments.github_repo_id_backfill_attempted_at IS
  'Set when a github_repo_id backfill attempt could not resolve a repository id. Excludes the row from future backfill attempts. NULL once github_repo_id is populated.';

-- The backfill's candidate query and remaining-count query both filter on
-- `github_repo_id IS NULL AND github_repo_id_backfill_attempted_at IS NULL`
-- (see BACKFILL_CANDIDATE_WHERE), ordering by id. idx_deployments_github_repo_id
-- above only indexes rows where github_repo_id IS NOT NULL, so it cannot help
-- either query here — without this index both fall back to a full scan of
-- deployments as the table grows, undermining the backfill's time budget.
CREATE INDEX IF NOT EXISTS idx_deployments_pending_github_repo_id_backfill
  ON deployments (id)
  WHERE github_repo_id IS NULL AND github_repo_id_backfill_attempted_at IS NULL;

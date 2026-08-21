-- Store GitHub check runs for the deployed commit, used as the primary checks source
-- for all deployment types (pull request, direct push, etc.), fetched via
-- checks.listForRef against the commit SHA. Shape: { checked_sha, checks_passed, checks }.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS commit_checks_data JSONB;

-- Tracks when a checks fetch attempt last completed successfully (with a definitive
-- answer, found or confirmed-empty) for a deployment's commit, independent of
-- whether commit_checks_data itself is populated. Used by the bulk backfill job to
-- avoid endlessly re-fetching commits that genuinely have zero check runs.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS commit_checks_checked_at TIMESTAMPTZ;

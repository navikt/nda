-- Store GitHub check runs for the deployed commit when there is no associated PR
-- (direct push deployments). Same shape as the `checks`/`checks_passed`/`checks_ref`
-- fields inside github_pr_data, fetched via checks.listForRef against the commit SHA.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS commit_checks_data JSONB;

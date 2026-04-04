-- Remove the deprecated has_four_eyes column from deployments table.
-- All approval checks now use four_eyes_status via isApprovedStatus().
-- Historical tables (deployment_status_history, verification_runs, verification_diffs)
-- retain their has_four_eyes columns for audit history.

DROP INDEX IF EXISTS idx_deployments_four_eyes;

ALTER TABLE deployments DROP COLUMN IF EXISTS has_four_eyes;

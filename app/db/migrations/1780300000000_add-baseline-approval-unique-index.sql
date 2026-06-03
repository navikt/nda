-- Enforce at most one attributed baseline_approval per deployment.
-- This makes recordBaselineApproval idempotent at the DB level,
-- allowing INSERT ... ON CONFLICT DO NOTHING instead of SELECT + INSERT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_status_history_baseline_approval_unique
ON deployment_status_history (deployment_id)
WHERE change_source = 'baseline_approval' AND changed_by IS NOT NULL;

-- Migration: M2M Audit Reports API
-- Adds columns needed for the M2M audit report endpoints used by KISS.

-- Track how many deployments have change origin (goal links) per report
ALTER TABLE audit_reports
  ADD COLUMN IF NOT EXISTS change_origin_count INTEGER;

COMMENT ON COLUMN audit_reports.change_origin_count IS
  'Number of deployments with at least one deployment_goal_link (excl. Dependabot). NULL for reports generated before this column existed.';

-- Track which M2M application generated the report (azp from token)
ALTER TABLE audit_reports
  ADD COLUMN IF NOT EXISTS generated_by_app TEXT;

COMMENT ON COLUMN audit_reports.generated_by_app IS
  'Fully qualified name (azp_name) of the M2M application that ordered this report, with client ID (azp) as fallback. NULL for user-generated reports.';

-- Link completed report jobs to the audit_reports row they created
ALTER TABLE report_jobs
  ADD COLUMN IF NOT EXISTS audit_report_id INTEGER REFERENCES audit_reports(id);

COMMENT ON COLUMN report_jobs.audit_report_id IS
  'FK to the audit_reports row created when this job completed successfully. NULL while job is pending/processing or if it failed.';

-- Track when a job was claimed for processing (staleness detection for crashed processors)
ALTER TABLE report_jobs
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

COMMENT ON COLUMN report_jobs.started_at IS
  'Timestamp when the job was claimed for processing. Used for staleness detection of crashed processors. NULL while pending.';

-- Clean up duplicate in-flight jobs before adding unique constraint.
-- Keep the newest row per (monitored_app_id, period_type, period_start) and fail the rest.
UPDATE report_jobs SET status = 'failed', error = 'Deduplication cleanup during migration'
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY monitored_app_id, period_type, period_start
      ORDER BY created_at DESC
    ) AS rn
    FROM report_jobs
    WHERE status IN ('pending', 'processing')
  ) ranked
  WHERE rn > 1
);

-- Prevent duplicate in-flight jobs for the same app and period (race condition guard)
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_jobs_inflight
  ON report_jobs (monitored_app_id, period_type, period_start)
  WHERE status IN ('pending', 'processing');

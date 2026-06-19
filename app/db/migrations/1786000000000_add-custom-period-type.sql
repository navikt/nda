-- Update CHECK constraint on period_type to include 'custom' for arbitrary date ranges

-- audit_reports
ALTER TABLE audit_reports DROP CONSTRAINT IF EXISTS audit_reports_period_type_check;
ALTER TABLE audit_reports ADD CONSTRAINT audit_reports_period_type_check
  CHECK (period_type IN ('yearly', 'tertiary', 'quarterly', 'monthly', 'custom'));

-- Extend the active-period uniqueness index on audit_reports to include period_end so that
-- two custom periods with the same period_start but different period_end can coexist.
DROP INDEX IF EXISTS idx_audit_reports_active_period;
CREATE UNIQUE INDEX idx_audit_reports_active_period
  ON audit_reports(monitored_app_id, period_type, period_start, period_end)
  WHERE superseded_at IS NULL AND archived_at IS NULL;

-- report_jobs
ALTER TABLE report_jobs DROP CONSTRAINT IF EXISTS report_jobs_period_type_check;
ALTER TABLE report_jobs ADD CONSTRAINT report_jobs_period_type_check
  CHECK (period_type IN ('yearly', 'tertiary', 'quarterly', 'monthly', 'custom'));

-- Extend the inflight uniqueness index to include period_end so that two custom
-- periods sharing the same period_start but different period_end are not conflated.
DROP INDEX IF EXISTS idx_report_jobs_inflight;
CREATE UNIQUE INDEX idx_report_jobs_inflight
  ON report_jobs(monitored_app_id, period_type, period_start, period_end)
  WHERE status IN ('pending', 'processing');

ALTER TABLE audit_reports
  ADD COLUMN assessment_model TEXT NOT NULL DEFAULT 'application'
    CHECK (assessment_model IN ('application', 'repository'));

ALTER TABLE report_jobs
  ADD COLUMN assessment_model TEXT NOT NULL DEFAULT 'application'
    CHECK (assessment_model IN ('application', 'repository'));

DROP INDEX idx_audit_reports_active_period;
CREATE UNIQUE INDEX idx_audit_reports_active_period
  ON audit_reports(monitored_app_id, assessment_model, period_type, period_start, period_end)
  WHERE superseded_at IS NULL AND archived_at IS NULL;

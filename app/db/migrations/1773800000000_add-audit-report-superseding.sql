-- Add superseding support for audit reports
-- Allows keeping previous versions of reports when regenerating for the same period

-- Add superseding columns
ALTER TABLE audit_reports
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by TEXT,
  ADD COLUMN IF NOT EXISTS supersede_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by_report_id INTEGER REFERENCES audit_reports(id);

-- Drop the unique constraint to allow multiple reports per period
ALTER TABLE audit_reports DROP CONSTRAINT IF EXISTS audit_reports_app_period_unique;

-- Add index for efficient lookup of active (non-superseded, non-archived) reports per period
-- Use UNIQUE to enforce at most one active report per (app, period_type, period_start)
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_reports_active_period
  ON audit_reports(monitored_app_id, period_type, period_start)
  WHERE superseded_at IS NULL AND archived_at IS NULL;

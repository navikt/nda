SET LOCAL lock_timeout = '5s';

ALTER TABLE deployments
  ADD COLUMN sibling_wait_candidate_id INTEGER REFERENCES deployments(id) ON DELETE SET NULL,
  ADD COLUMN sibling_wait_basis JSONB,
  ADD COLUMN sibling_wait_checked_at TIMESTAMPTZ,
  ADD COLUMN sibling_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN sibling_refresh_after TIMESTAMPTZ,
  ADD COLUMN sibling_retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_deployments_sibling_wait_due
  ON deployments (monitored_app_id, sibling_next_attempt_at, created_at, id)
  WHERE four_eyes_status = 'pending_sibling_resolution';

CREATE INDEX idx_deployments_sibling_wait_candidate
  ON deployments (sibling_wait_candidate_id)
  WHERE four_eyes_status = 'pending_sibling_resolution';

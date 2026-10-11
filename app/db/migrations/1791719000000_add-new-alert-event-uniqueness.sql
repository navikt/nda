ALTER TABLE repository_alerts
  ADD COLUMN idempotency_key_enabled BOOLEAN;

ALTER TABLE repository_alerts
  ALTER COLUMN idempotency_key_enabled SET DEFAULT TRUE;

CREATE UNIQUE INDEX idx_repository_alerts_event_identity
  ON repository_alerts (
    deployment_id,
    alert_type,
    expected_github_owner,
    expected_github_repo_name,
    detected_github_owner,
    detected_github_repo_name
  )
  WHERE idempotency_key_enabled IS TRUE AND deployment_id IS NOT NULL;

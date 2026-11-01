CREATE INDEX idx_deployments_code_delivery_chronology
  ON deployments (repository_code_delivery_id, created_at, id)
  WHERE repository_code_delivery_id IS NOT NULL;

CREATE INDEX idx_deployments_repository_id
  ON deployments (repository_id)
  WHERE repository_id IS NOT NULL;

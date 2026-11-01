CREATE INDEX idx_deployments_missing_repository_chronology
  ON deployments (created_at, id)
  WHERE repository_id IS NULL;

CREATE TABLE repository_code_delivery_deployment_repositories (
  deployment_id INTEGER PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id)
);

CREATE INDEX idx_code_delivery_deployment_repositories_repository
  ON repository_code_delivery_deployment_repositories (repository_id, deployment_id);

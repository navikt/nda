CREATE TABLE repository_code_delivery_unresolved (
  deployment_id INTEGER PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  reason VARCHAR(40) NOT NULL CHECK (reason IN ('ancestry_unknown', 'ancestry_diverged', 'source_unauthorized')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_repository_code_delivery_unresolved_open
  ON repository_code_delivery_unresolved(deployment_id)
  WHERE resolved_at IS NULL;

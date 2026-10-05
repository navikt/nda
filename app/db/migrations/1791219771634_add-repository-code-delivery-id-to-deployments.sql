ALTER TABLE deployments
  ADD COLUMN repository_code_delivery_id INTEGER
  REFERENCES repository_code_deliveries(id) ON DELETE RESTRICT;

CREATE INDEX idx_deployments_repository_code_delivery
  ON deployments(repository_code_delivery_id)
  WHERE repository_code_delivery_id IS NOT NULL;

CREATE INDEX idx_deployments_code_delivery_chronology
  ON deployments (repository_code_delivery_id, created_at, id)
  WHERE repository_code_delivery_id IS NOT NULL;

CREATE INDEX idx_deployments_missing_repository_chronology
  ON deployments (created_at, id)
  WHERE repository_id IS NULL;

CREATE TABLE repository_code_delivery_deployment_repositories (
  deployment_id INTEGER PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL REFERENCES repositories(id)
);

CREATE INDEX idx_code_delivery_deployment_repositories_repository
  ON repository_code_delivery_deployment_repositories (repository_id, deployment_id);

ALTER TABLE repositories ADD COLUMN code_delivery_history_worker_required BOOLEAN NOT NULL DEFAULT false;

CREATE FUNCTION require_code_delivery_history_worker() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM repositories WHERE id = NEW.repository_id AND code_delivery_history_worker_required
  ) AND current_setting('nda.code_delivery_history_worker', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Repository % requires a chronological code delivery worker', NEW.repository_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repository_code_deliveries_require_history_worker
  BEFORE INSERT ON repository_code_deliveries
  FOR EACH ROW EXECUTE FUNCTION require_code_delivery_history_worker();

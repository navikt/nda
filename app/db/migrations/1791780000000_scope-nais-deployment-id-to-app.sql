ALTER TABLE deployments
  DROP CONSTRAINT deployments_nais_deployment_id_key;

CREATE UNIQUE INDEX idx_deployments_monitored_app_nais_deployment_id
  ON deployments (monitored_app_id, nais_deployment_id);

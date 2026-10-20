ALTER TABLE deployments
  ALTER COLUMN nais_deployment_id DROP NOT NULL;

ALTER TABLE deployments
  ADD COLUMN deployment_source VARCHAR(50) NOT NULL DEFAULT 'nais_deployment',
  ADD COLUMN slack_notifications_suppressed_at TIMESTAMPTZ,
  ADD COLUMN deployment_source_id VARCHAR(255);

UPDATE deployments
SET deployment_source_id = nais_deployment_id
WHERE deployment_source_id IS NULL;

ALTER TABLE deployments
  ADD CONSTRAINT deployments_source_identity_unique
  UNIQUE (monitored_app_id, deployment_source, deployment_source_id),
  ADD CONSTRAINT deployments_source_identity_check
  CHECK (
    (deployment_source = 'nais_deployment' AND nais_deployment_id IS NOT NULL) OR
    (deployment_source = 'nais_apply' AND nais_deployment_id IS NULL AND deployment_source_id IS NOT NULL)
  );

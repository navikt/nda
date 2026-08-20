-- Store the GitHub Actions workflow trigger configuration (the `on:` block) that applied
-- when a deployment's workflow run was triggered. Collected during the GitHub verification
-- sync step, alongside the other GitHub-derived deployment data.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS workflow_trigger_config JSONB;

-- Speed up filtering deployments by workflow trigger type (e.g. 'workflow_dispatch', 'push')
-- for the planned admin search page.
CREATE INDEX IF NOT EXISTS idx_deployments_workflow_trigger_event
  ON deployments ((workflow_trigger_config ->> 'triggerEvent'));

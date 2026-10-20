ALTER TABLE github_workflow_runs_raw_snapshots
  ADD COLUMN run_attempt BIGINT;

UPDATE github_workflow_runs_raw_snapshots
SET run_attempt = (data->>'run_attempt')::BIGINT
WHERE data ? 'run_attempt'
  AND data->>'run_attempt' ~ '^[0-9]+$';

CREATE INDEX idx_workflow_runs_raw_snapshots_attempt_lookup
  ON github_workflow_runs_raw_snapshots(github_repo_id, run_id, run_attempt, fetched_at DESC);

CREATE TABLE github_workflow_run_attempt_sha_failures (
  github_repo_id BIGINT NOT NULL,
  run_id BIGINT NOT NULL,
  run_attempt BIGINT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (github_repo_id, run_id, run_attempt)
);

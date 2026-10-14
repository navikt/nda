CREATE TABLE github_workflow_jobs_raw_snapshots (
  id SERIAL PRIMARY KEY,
  github_repo_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  run_id BIGINT NOT NULL,
  attempt_number INTEGER,
  api_version TEXT NOT NULL,
  api_deprecated_at TIMESTAMPTZ,
  api_sunset_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL,
  CHECK (attempt_number IS NULL OR attempt_number > 0)
);

CREATE INDEX idx_workflow_jobs_raw_snapshots_lookup
  ON github_workflow_jobs_raw_snapshots (github_repo_id, run_id, attempt_number, fetched_at DESC);

COMMENT ON TABLE github_workflow_jobs_raw_snapshots IS
  'Raw GitHub Actions jobs and steps by workflow run and attempt.';

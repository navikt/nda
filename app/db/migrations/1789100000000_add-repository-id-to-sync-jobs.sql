-- Step 1 of app-to-repository verification migration.
-- Adds repository_id to sync_jobs so that verification jobs (fetch_verification_data,
-- reverification, etc.) can eventually be scoped to a GitHub repository instead of a
-- single monitored application. Purely additive: no existing job types are changed here.

ALTER TABLE sync_jobs ADD COLUMN repository_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE;

-- The existing global lock index only guarded against duplicate *global* jobs
-- (monitored_app_id IS NULL). Once repository-scoped jobs also use monitored_app_id IS NULL,
-- they would incorrectly serialize against each other under the same job_type regardless of
-- which repository they target. Narrow the global index to true global jobs only.
DROP INDEX IF EXISTS sync_jobs_active_global_lock;

CREATE UNIQUE INDEX sync_jobs_active_global_lock
  ON sync_jobs (job_type)
  WHERE status = 'running' AND monitored_app_id IS NULL AND repository_id IS NULL;

-- One running job per (job_type, repository_id) so concurrent repositories don't block
-- each other, but the same repository can't run the same job type twice at once.
CREATE UNIQUE INDEX sync_jobs_active_repo_lock
  ON sync_jobs (job_type, repository_id)
  WHERE status = 'running' AND repository_id IS NOT NULL;

-- Index for repository-scoped job history queries.
CREATE INDEX sync_jobs_repo_history ON sync_jobs (repository_id, created_at DESC);

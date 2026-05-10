-- Prevent duplicate running global sync jobs (where monitored_app_id IS NULL).
-- The existing unique index only covers non-NULL monitored_app_id values.
CREATE UNIQUE INDEX sync_jobs_active_global_lock
  ON sync_jobs (job_type)
  WHERE status = 'running' AND monitored_app_id IS NULL;

-- Speeds up the correlated subquery in app/db/repository-settings-sql.ts
-- (LINKED_REPO_ROW_SQL, used by effectiveAuditStartYearSql/effectiveDefaultBranchSql
-- across dashboard-stats, verification, monorepo, deployments and more), which looks
-- up the most recently created active repository link per monitored app
-- (WHERE monitored_app_id = ? AND status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1).
-- Previously only single-column indexes existed on monitored_app_id and status separately,
-- forcing a filter + sort per app row instead of a direct ordered index lookup.

CREATE INDEX IF NOT EXISTS idx_application_repositories_active_app_created
  ON application_repositories (monitored_app_id, created_at DESC, id DESC)
  WHERE status = 'active';

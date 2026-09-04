const LINKED_REPO_ROW_SQL = (maAlias: string, column: string) => `(
  SELECT r.${column} AS value, true AS repo_linked
  FROM application_repositories ar
  JOIN repositories r ON r.github_repo_id = ar.github_repo_id
  WHERE ar.monitored_app_id = ${maAlias}.id AND ar.status = 'active' AND ar.github_repo_id IS NOT NULL
  ORDER BY ar.created_at DESC, ar.id DESC
  LIMIT 1
)`

const EFFECTIVE_COLUMN_SQL = (maAlias: string, column: string, fallbackToAppWhenUnset: boolean) => `(
  SELECT CASE
           WHEN linked.repo_linked
             THEN ${fallbackToAppWhenUnset ? `COALESCE(linked.value, ${maAlias}.${column})` : 'linked.value'}
           ELSE ${maAlias}.${column}
         END
  FROM (SELECT true) AS _one
  LEFT JOIN ${LINKED_REPO_ROW_SQL(maAlias, column)} AS linked ON true
)`

export function effectiveAuditStartYearSql(maAlias = 'ma'): string {
  return EFFECTIVE_COLUMN_SQL(maAlias, 'audit_start_year', false)
}

export function effectiveDefaultBranchSql(maAlias = 'ma'): string {
  return EFFECTIVE_COLUMN_SQL(maAlias, 'default_branch', true)
}

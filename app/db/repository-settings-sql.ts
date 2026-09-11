const LINKED_REPO_ROW_SQL = (maAlias: string, column: string) => `(
  SELECT r.${column} AS value, true AS repo_linked
  FROM (
    SELECT ar.github_repo_id
    FROM application_repositories ar
    WHERE ar.monitored_app_id = ${maAlias}.id AND ar.status = 'active'
    ORDER BY ar.created_at DESC, ar.id DESC
    LIMIT 1
  ) active_link
  LEFT JOIN repositories r ON r.github_repo_id = active_link.github_repo_id
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
  return `(
    SELECT linked.value
    FROM ${LINKED_REPO_ROW_SQL(maAlias, 'audit_start_year')} AS linked
  )`
}

export function effectiveDefaultBranchSql(maAlias = 'ma'): string {
  return EFFECTIVE_COLUMN_SQL(maAlias, 'default_branch', true)
}

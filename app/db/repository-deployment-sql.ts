export function repositoryDeploymentSql(repositoryIdSql: string): string {
  return `(
    d.repository_id = ${repositoryIdSql}
    OR (
      d.repository_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM application_repositories ar
        JOIN repositories r ON r.github_repo_id = ar.github_repo_id
        WHERE r.id = ${repositoryIdSql}
          AND ar.monitored_app_id = d.monitored_app_id
          AND ar.github_owner = d.detected_github_owner
          AND ar.github_repo_name = d.detected_github_repo_name
          AND ar.status IN ('active', 'historical')
      )
      AND NOT EXISTS (
        SELECT 1 FROM repositories other
        WHERE other.github_owner = d.detected_github_owner
          AND other.github_repo_name = d.detected_github_repo_name
          AND other.id != ${repositoryIdSql}
      )
      AND NOT EXISTS (
        SELECT 1 FROM repository_name_history other
        WHERE other.github_owner = d.detected_github_owner
          AND other.github_repo_name = d.detected_github_repo_name
          AND other.repository_id != ${repositoryIdSql}
      )
    )
  )`
}

import { canShareApprovalSql, recordedComparisonRangeSql } from '~/db/verification-root-sql'
import {
  NON_DIFFABLE_STATUSES_SQL,
  PROPAGATABLE_STATUSES,
  REVERIFIABLE_STATUSES,
  ROOT_APPROVED_STATUSES,
  SHAREABLE_REJECTION_STATUSES,
  UNAUTHORIZED_STATUSES_SQL,
} from '~/lib/four-eyes-status'
import { LATEST_ACTIVE_REPOSITORY_LINK_SQL } from './application-repositories.server'
import { pool } from './connection.server'
import { effectiveAuditStartYearSql, effectiveDefaultBranchSql } from './repository-settings-sql'

interface MonorepoAppEntry {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
  default_branch: string | null
  audit_start_year: number | null
}

export interface MonorepoGroup {
  github_owner: string
  github_repo_name: string
  repository_id: number | null
  apps: MonorepoAppEntry[]
  base_branch_mismatch: boolean
  audit_year_mismatch: boolean
  repository_linked: boolean
}

export interface MonorepoSiblingInfo {
  github_owner: string
  github_repo_name: string
  repository_id: number | null
  siblings: MonorepoAppEntry[]
  base_branch_mismatch: boolean
  audit_year_mismatch: boolean
  repository_linked: boolean
}

interface MonorepoRow extends MonorepoAppEntry {
  github_owner: string
  github_repo_name: string
  repository_id: number | null
  repository_linked: boolean
}

const ACTIVE_REPO_PER_APP = LATEST_ACTIVE_REPOSITORY_LINK_SQL

const MONOREPO_ROWS_SELECT = `
  SELECT ar.github_owner, ar.github_repo_name,
         ma.id, ma.app_name, ma.team_slug, ma.environment_name,
         ${effectiveDefaultBranchSql('ma')} AS default_branch,
         ${effectiveAuditStartYearSql('ma')} AS audit_start_year,
         r.id AS repository_id,
         (r.id IS NOT NULL) AS repository_linked
  FROM (${ACTIVE_REPO_PER_APP}) ar
  JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
  LEFT JOIN repositories r ON r.github_repo_id = ar.github_repo_id
  WHERE ma.is_active = true
`

function hasMismatch(values: (string | number | null)[]): boolean {
  return new Set(values).size > 1
}

function sharedRepositoryId(rows: { repository_id: number | null }[]): number | null {
  const repositoryIds = new Set(rows.map((row) => row.repository_id))
  return repositoryIds.size === 1 && rows[0]?.repository_id !== null ? rows[0].repository_id : null
}

function toAppEntry({
  github_owner: _owner,
  github_repo_name: _repo,
  repository_id: _repositoryId,
  repository_linked: _linked,
  ...app
}: MonorepoRow): MonorepoAppEntry {
  return app
}

export async function getAllMonorepoGroups(): Promise<MonorepoGroup[]> {
  const result = await pool.query<MonorepoRow>(
    `${MONOREPO_ROWS_SELECT}
       AND (ar.github_owner, ar.github_repo_name) IN (
         SELECT ar2.github_owner, ar2.github_repo_name
         FROM (${ACTIVE_REPO_PER_APP}) ar2
         JOIN monitored_applications ma2 ON ma2.id = ar2.monitored_app_id
         WHERE ma2.is_active = true
         GROUP BY ar2.github_owner, ar2.github_repo_name
         HAVING COUNT(DISTINCT ar2.monitored_app_id) > 1
       )
     ORDER BY ar.github_owner, ar.github_repo_name, ma.environment_name, ma.team_slug, ma.app_name`,
  )

  return groupMonorepoRows(result.rows)
}

export async function searchMonorepoGroups(query: string, limit: number): Promise<MonorepoGroup[]> {
  const matchingRepos = await pool.query<{ github_owner: string; github_repo_name: string }>(
    `SELECT ar.github_owner, ar.github_repo_name
     FROM (${ACTIVE_REPO_PER_APP}) ar
     JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
     WHERE ma.is_active = true AND concat(ar.github_owner, '/', ar.github_repo_name) ILIKE $1
     GROUP BY ar.github_owner, ar.github_repo_name
     HAVING COUNT(DISTINCT ar.monitored_app_id) > 1
     ORDER BY ar.github_owner, ar.github_repo_name
     LIMIT $2`,
    [`%${query}%`, limit],
  )
  if (matchingRepos.rows.length === 0) return []

  const result = await pool.query<MonorepoRow>(
    `${MONOREPO_ROWS_SELECT}
       AND (ar.github_owner, ar.github_repo_name) IN (
         SELECT owner, repo_name FROM UNNEST($1::text[], $2::text[]) AS repos(owner, repo_name)
       )
     ORDER BY ar.github_owner, ar.github_repo_name, ma.environment_name, ma.team_slug, ma.app_name`,
    [matchingRepos.rows.map((r) => r.github_owner), matchingRepos.rows.map((r) => r.github_repo_name)],
  )

  return groupMonorepoRows(result.rows)
}

function groupMonorepoRows(rows: MonorepoRow[]): MonorepoGroup[] {
  const groups = new Map<string, MonorepoRow[]>()
  for (const row of rows) {
    const key = `${row.github_owner}/${row.github_repo_name}`
    const existing = groups.get(key)
    if (existing) {
      existing.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  return [...groups.values()].map((groupRows) => {
    const appsById = new Map<number, MonorepoAppEntry>()
    for (const row of groupRows) {
      appsById.set(row.id, toAppEntry(row))
    }
    const apps = [...appsById.values()]
    const sharedId = sharedRepositoryId(groupRows)
    return {
      github_owner: groupRows[0].github_owner,
      github_repo_name: groupRows[0].github_repo_name,
      repository_id: sharedId,
      apps,
      base_branch_mismatch: hasMismatch(apps.map((a) => a.default_branch)),
      audit_year_mismatch: hasMismatch(apps.map((a) => a.audit_start_year)),
      repository_linked: groupRows.every((row) => row.repository_linked),
    }
  })
}

export async function getMonorepoSiblings(monitoredAppId: number): Promise<MonorepoSiblingInfo | null> {
  const ownRepo = await pool.query<{ github_owner: string; github_repo_name: string }>(
    `SELECT ar.github_owner, ar.github_repo_name
     FROM application_repositories ar
     WHERE ar.monitored_app_id = $1 AND ar.status = 'active'
     ORDER BY ar.created_at DESC, ar.id DESC
     LIMIT 1`,
    [monitoredAppId],
  )
  if (ownRepo.rows.length === 0) return null
  const { github_owner: ownerName, github_repo_name: repoName } = ownRepo.rows[0]

  const result = await pool.query<MonorepoRow>(
    `${MONOREPO_ROWS_SELECT}
       AND ar.github_owner = $1 AND ar.github_repo_name = $2
     ORDER BY ma.environment_name, ma.team_slug, ma.app_name`,
    [ownerName, repoName],
  )

  const appsById = new Map<number, MonorepoAppEntry>()
  for (const row of result.rows) {
    appsById.set(row.id, toAppEntry(row))
  }

  const siblings = [...appsById.values()].filter((a) => a.id !== monitoredAppId)
  if (siblings.length === 0) return null

  const repositoryIdRows: { repository_id: number | null }[] = [...result.rows]

  if (!appsById.has(monitoredAppId)) {
    const ownApp = await pool.query<MonorepoAppEntry & { repository_id: number | null }>(
      `SELECT ma.id, ma.app_name, ma.team_slug, ma.environment_name,
              ${effectiveDefaultBranchSql('ma')} AS default_branch,
              ${effectiveAuditStartYearSql('ma')} AS audit_start_year,
              r.id AS repository_id
       FROM monitored_applications ma
       LEFT JOIN (${ACTIVE_REPO_PER_APP}) ar ON ar.monitored_app_id = ma.id
       LEFT JOIN repositories r ON r.github_repo_id = ar.github_repo_id
       WHERE ma.id = $1`,
      [monitoredAppId],
    )
    if (ownApp.rows.length > 0) {
      const { repository_id: ownRepositoryId, ...ownAppEntry } = ownApp.rows[0]
      appsById.set(monitoredAppId, ownAppEntry)
      repositoryIdRows.push({ repository_id: ownRepositoryId })
    }
  }

  const allApps = [...appsById.values()]

  return {
    github_owner: ownerName,
    github_repo_name: repoName,
    repository_id: sharedRepositoryId(repositoryIdRows),
    siblings,
    base_branch_mismatch: hasMismatch(allApps.map((a) => a.default_branch)),
    audit_year_mismatch: hasMismatch(allApps.map((a) => a.audit_start_year)),
    repository_linked: result.rows.every((row) => row.repository_linked),
  }
}

const PROPAGATABLE_STATUSES_SET = new Set<string>(PROPAGATABLE_STATUSES)

const ROOT_APPROVED_STATUSES_SET = new Set<string>(ROOT_APPROVED_STATUSES)

const PROPAGATION_TARGET_STATUSES = [...REVERIFIABLE_STATUSES, 'error']

export async function propagateVerificationToSiblings(
  deploymentId: number,
  status: string,
  commitSha: string,
  monitoredAppId: number,
  hasFourEyes = true,
  changedBy?: string,
): Promise<number> {
  if (!hasFourEyes || status === 'verified_via_sibling' || !PROPAGATABLE_STATUSES_SET.has(status)) return 0

  // A sibling never inherits the exact same "root" approval reason as the source deployment
  // — it wasn't itself reviewed, it just shares the same commit. Always attribute it as
  // verified_via_sibling instead, so the displayed status is consistent regardless of whether
  // the sibling was caught by this instant bulk propagation or resolved later via its own,
  // slower verification run reaching the same conclusion. Non-root statuses (e.g.
  // approved_pr_with_unreviewed) are propagated as-is since they aren't a full approval.
  const propagatedStatus = ROOT_APPROVED_STATUSES_SET.has(status) ? 'verified_via_sibling' : status
  const targetStatuses = ROOT_APPROVED_STATUSES_SET.has(status)
    ? [...PROPAGATION_TARGET_STATUSES, ...SHAREABLE_REJECTION_STATUSES]
    : PROPAGATION_TARGET_STATUSES

  const result = await pool.query(
    `WITH active_repo_per_app AS MATERIALIZED (
       ${LATEST_ACTIVE_REPOSITORY_LINK_SQL}
     ),
    source_repository AS MATERIALIZED (
        SELECT ar.github_repo_id
        FROM deployments d
        JOIN active_repo_per_app ar ON ar.monitored_app_id = d.monitored_app_id
        WHERE d.id = $4 AND d.monitored_app_id = $5 AND d.commit_sha = $2
    ),
    repo_deployments AS MATERIALIZED (
      SELECT DISTINCT d.id, d.created_at, d.monitored_app_id, d.commit_sha, d.four_eyes_status,
             ar.github_repo_id
      FROM deployments d
      JOIN application_repositories deployment_ar
        ON deployment_ar.monitored_app_id = d.monitored_app_id
        AND deployment_ar.github_owner = d.detected_github_owner
        AND deployment_ar.github_repo_name = d.detected_github_repo_name
        AND deployment_ar.status IN ('active', 'historical')
      JOIN active_repo_per_app ar
        ON ar.monitored_app_id = d.monitored_app_id
        AND ar.github_repo_id = deployment_ar.github_repo_id
      WHERE ar.github_repo_id = (SELECT github_repo_id FROM source_repository)
        AND d.commit_sha IS NOT NULL
        AND d.commit_sha !~ '^refs/'
        AND d.four_eyes_status NOT IN (${NON_DIFFABLE_STATUSES_SQL})
        AND d.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
    ),
    source_repo AS MATERIALIZED (
      SELECT source.id, source.github_repo_id, recorded.comparison_range->>'baseSha' AS comparison_base_sha
      FROM repo_deployments source
      JOIN LATERAL ${recordedComparisonRangeSql('source')} recorded ON true
      WHERE source.id = $4
        AND source.monitored_app_id = $5
        AND source.commit_sha = $2
        AND source.four_eyes_status = $7
        AND ${canShareApprovalSql('source')}
    ),
    targets AS MATERIALIZED (
      SELECT d.id, d.four_eyes_status AS from_status
      FROM deployments d
      JOIN repo_deployments current_repo ON current_repo.id = d.id
      LEFT JOIN LATERAL (
        SELECT prior.commit_sha
        FROM repo_deployments prior
        WHERE prior.github_repo_id = current_repo.github_repo_id
          AND (prior.created_at, prior.id) < (current_repo.created_at, current_repo.id)
          AND prior.commit_sha != current_repo.commit_sha
        ORDER BY prior.created_at DESC, prior.id DESC
        LIMIT 1
      ) previous ON true
      CROSS JOIN source_repo source
      WHERE current_repo.commit_sha = $2
        AND current_repo.github_repo_id = source.github_repo_id
        AND previous.commit_sha IS NOT DISTINCT FROM source.comparison_base_sha
        AND d.four_eyes_status = ANY($3::text[])
        AND d.monitored_app_id != $5
        AND EXISTS (
          SELECT 1 FROM monitored_applications ma
          WHERE ma.id = d.monitored_app_id AND ma.is_active = true
        )
       ORDER BY d.id
       FOR UPDATE OF d
     ),
     updated AS (
       UPDATE deployments d
       SET four_eyes_status = $1,
           unverified_commits = CASE WHEN $1::varchar = 'verified_via_sibling' THEN NULL ELSE d.unverified_commits END
       FROM targets t
       WHERE d.id = t.id
       RETURNING d.id
     )
     INSERT INTO deployment_status_history
       (deployment_id, from_status, to_status, changed_by, change_source, details)
     SELECT t.id, t.from_status, $1, $6, 'sibling_propagation',
            jsonb_build_object('source_deployment_id', $4::integer, 'source_status', $7::text, 'commit_sha', $2::text,
                               'comparison_base_sha', (SELECT source.comparison_base_sha FROM source_repo source))
     FROM targets t
     JOIN updated u ON u.id = t.id`,
    [propagatedStatus, commitSha, targetStatuses, deploymentId, monitoredAppId, changedBy ?? null, status],
  )

  return result.rowCount ?? 0
}

import { reconcileAuditStartYearOnRepoActivation } from '~/db/audit-start-year-baseline.server'
import { getRepositoryId } from '~/lib/github/git.server'
import { logger } from '~/lib/logger.server'
import { pool } from './connection.server'

async function reconcileAuditStartYearBestEffort(appId: number, hadDifferentActiveRepoBefore: boolean): Promise<void> {
  try {
    await reconcileAuditStartYearOnRepoActivation(appId, hadDifferentActiveRepoBefore)
  } catch (error) {
    logger.error(
      'Failed to reconcile audit_start_year after repo activation',
      error instanceof Error ? error : new Error(String(error)),
    )
  }
}

interface ApplicationRepository {
  id: number
  monitored_app_id: number
  github_owner: string
  github_repo_name: string
  github_repo_id: string | null
  status: 'active' | 'historical' | 'pending_approval'
  redirects_to_owner: string | null
  redirects_to_repo: string | null
  notes: string | null
  approved_at: Date | null
  approved_by: string | null
  created_at: Date
}

export async function getRepositoriesByAppId(appId: number): Promise<ApplicationRepository[]> {
  const result = await pool.query(
    `SELECT * FROM application_repositories 
     WHERE monitored_app_id = $1 
     ORDER BY 
       CASE status 
         WHEN 'active' THEN 1 
         WHEN 'historical' THEN 2 
         WHEN 'pending_approval' THEN 3 
       END,
       created_at DESC`,
    [appId],
  )
  return result.rows
}

export async function findRepositoryForApp(
  appId: number,
  owner: string,
  repoName: string,
): Promise<{
  repository: ApplicationRepository | null
  effectiveOwner: string
  effectiveRepo: string
  isRedirected: boolean
}> {
  const result = await pool.query(
    `SELECT * FROM application_repositories 
     WHERE monitored_app_id = $1 
       AND github_owner = $2 
       AND github_repo_name = $3`,
    [appId, owner, repoName],
  )

  if (result.rows.length === 0) {
    return {
      repository: null,
      effectiveOwner: owner,
      effectiveRepo: repoName,
      isRedirected: false,
    }
  }

  const repo = result.rows[0]

  if (repo.redirects_to_owner && repo.redirects_to_repo) {
    return {
      repository: repo,
      effectiveOwner: repo.redirects_to_owner,
      effectiveRepo: repo.redirects_to_repo,
      isRedirected: true,
    }
  }

  return {
    repository: repo,
    effectiveOwner: owner,
    effectiveRepo: repoName,
    isRedirected: false,
  }
}

export async function upsertApplicationRepository(data: {
  monitoredAppId: number
  githubOwner: string
  githubRepoName: string
  status: 'active' | 'historical' | 'pending_approval'
  redirectsToOwner?: string | null
  redirectsToRepo?: string | null
  notes?: string | null
  approvedBy?: string | null
}): Promise<ApplicationRepository> {
  const approvedAt = data.status !== 'pending_approval' ? new Date() : null
  const githubRepoId = await getRepositoryId(data.githubOwner, data.githubRepoName)

  let hadDifferentActiveRepoBefore = false
  if (data.status === 'active') {
    const { rows: previousActiveRows } = await pool.query<{
      github_owner: string
      github_repo_name: string
      github_repo_id: string | null
    }>(
      `SELECT github_owner, github_repo_name, github_repo_id FROM application_repositories
       WHERE monitored_app_id = $1 AND status = 'active'`,
      [data.monitoredAppId],
    )
    hadDifferentActiveRepoBefore =
      previousActiveRows.length === 0 ||
      previousActiveRows.some((row) => {
        if (row.github_repo_id !== null && githubRepoId !== null) {
          return row.github_repo_id !== String(githubRepoId)
        }
        return row.github_owner !== data.githubOwner || row.github_repo_name !== data.githubRepoName
      })
  }

  const result = await pool.query(
    `INSERT INTO application_repositories (
      monitored_app_id, github_owner, github_repo_name, github_repo_id, status,
      redirects_to_owner, redirects_to_repo, notes, approved_at, approved_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (monitored_app_id, github_owner, github_repo_name)
    DO UPDATE SET
      github_repo_id = COALESCE(application_repositories.github_repo_id, EXCLUDED.github_repo_id),
      status = EXCLUDED.status,
      redirects_to_owner = EXCLUDED.redirects_to_owner,
      redirects_to_repo = EXCLUDED.redirects_to_repo,
      notes = EXCLUDED.notes,
      approved_at = EXCLUDED.approved_at,
      approved_by = EXCLUDED.approved_by
    RETURNING *`,
    [
      data.monitoredAppId,
      data.githubOwner,
      data.githubRepoName,
      githubRepoId,
      data.status,
      data.redirectsToOwner || null,
      data.redirectsToRepo || null,
      data.notes || null,
      approvedAt,
      data.approvedBy || null,
    ],
  )

  if (data.status === 'active') {
    await reconcileAuditStartYearBestEffort(data.monitoredAppId, hadDifferentActiveRepoBefore)
  }

  return result.rows[0]
}

export async function approveRepository(
  repoId: number,
  approvedBy: string,
  setAsActive: boolean = false,
): Promise<ApplicationRepository> {
  const status = setAsActive ? 'active' : 'historical'

  let hadDifferentActiveRepoBefore = false
  let monitoredAppId: number | null = null

  if (setAsActive) {
    const repo = await pool.query<{ monitored_app_id: number; github_repo_id: string | null; status: string }>(
      'SELECT monitored_app_id, github_repo_id, status FROM application_repositories WHERE id = $1',
      [repoId],
    )

    if (repo.rows.length > 0) {
      monitoredAppId = repo.rows[0].monitored_app_id
      const targetRepoId = repo.rows[0].github_repo_id
      const wasAlreadyActive = repo.rows[0].status === 'active'
      const { rows: demotedRows } = await pool.query<{ github_repo_id: string | null }>(
        `UPDATE application_repositories 
         SET status = 'historical' 
         WHERE monitored_app_id = $1 
           AND status = 'active' 
           AND id != $2
         RETURNING github_repo_id`,
        [monitoredAppId, repoId],
      )
      hadDifferentActiveRepoBefore =
        !wasAlreadyActive &&
        (demotedRows.length === 0 ||
          demotedRows.some(
            (row) => row.github_repo_id === null || targetRepoId === null || row.github_repo_id !== targetRepoId,
          ))
    }
  }

  const result = await pool.query(
    `UPDATE application_repositories 
     SET status = $1, approved_at = NOW(), approved_by = $2
     WHERE id = $3
     RETURNING *`,
    [status, approvedBy, repoId],
  )

  if (result.rows.length === 0) {
    throw new Error(`Repository with id ${repoId} not found`)
  }

  if (setAsActive && monitoredAppId !== null) {
    await reconcileAuditStartYearBestEffort(monitoredAppId, hadDifferentActiveRepoBefore)
  }

  return result.rows[0]
}

export async function rejectRepository(repoId: number): Promise<void> {
  await pool.query(`DELETE FROM application_repositories WHERE id = $1 AND status = 'pending_approval'`, [repoId])
}

export async function setRepositoryAsActive(repoId: number): Promise<ApplicationRepository> {
  const repo = await pool.query<{ monitored_app_id: number; github_repo_id: string | null; status: string }>(
    'SELECT monitored_app_id, github_repo_id, status FROM application_repositories WHERE id = $1',
    [repoId],
  )

  if (repo.rows.length === 0) {
    throw new Error(`Repository with id ${repoId} not found`)
  }

  const monitoredAppId = repo.rows[0].monitored_app_id
  const targetRepoId = repo.rows[0].github_repo_id
  const wasAlreadyActive = repo.rows[0].status === 'active'

  const { rows: demotedRows } = await pool.query<{ github_repo_id: string | null }>(
    `UPDATE application_repositories 
     SET status = 'historical' 
     WHERE monitored_app_id = $1 AND id != $2 AND status = 'active'
     RETURNING github_repo_id`,
    [monitoredAppId, repoId],
  )

  const result = await pool.query(
    `UPDATE application_repositories 
     SET status = 'active' 
     WHERE id = $1 
     RETURNING *`,
    [repoId],
  )

  const hadDifferentActiveRepoBefore =
    !wasAlreadyActive &&
    (demotedRows.length === 0 ||
      demotedRows.some(
        (row) => row.github_repo_id === null || targetRepoId === null || row.github_repo_id !== targetRepoId,
      ))
  await reconcileAuditStartYearBestEffort(monitoredAppId, hadDifferentActiveRepoBefore)

  return result.rows[0]
}

export async function getAllActiveRepositories(): Promise<Map<number, string>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (monitored_app_id) monitored_app_id, github_owner, github_repo_name
     FROM application_repositories 
     WHERE status = 'active'
     ORDER BY monitored_app_id, created_at DESC, id DESC`,
  )

  const map = new Map<number, string>()
  for (const row of result.rows) {
    map.set(row.monitored_app_id, `${row.github_owner}/${row.github_repo_name}`)
  }
  return map
}

export async function getAppIdsSharingRepo(appIds: number[]): Promise<Map<string, number[]>> {
  if (appIds.length === 0) return new Map()

  const result = await pool.query<{ github_repo_id: string; monitored_app_id: number }>(
    `SELECT DISTINCT ON (ar.monitored_app_id) ar.github_repo_id, ar.monitored_app_id
     FROM application_repositories ar
     JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
     WHERE ar.status = 'active'
       AND ma.is_active = true
       AND ar.github_repo_id IN (
         SELECT DISTINCT ON (monitored_app_id) github_repo_id FROM application_repositories
         WHERE monitored_app_id = ANY($1) AND status = 'active' AND github_repo_id IS NOT NULL
         ORDER BY monitored_app_id, created_at DESC, id DESC
       )
     ORDER BY ar.monitored_app_id, ar.created_at DESC, ar.id DESC`,
    [appIds],
  )

  const map = new Map<string, number[]>()
  for (const row of result.rows) {
    const ids = map.get(row.github_repo_id) ?? []
    ids.push(row.monitored_app_id)
    map.set(row.github_repo_id, ids)
  }
  return map
}

export function pendingBaselineAutoVerifyEligibleSql(maAlias = 'ma'): string {
  return `(
    EXISTS (
      SELECT 1 FROM application_repositories ar
      WHERE ar.monitored_app_id = ${maAlias}.id AND ar.status = 'active'
        AND (
          ar.github_repo_id IS NULL
          OR EXISTS (
            SELECT 1 FROM application_repositories ar2
            JOIN monitored_applications ma2 ON ma2.id = ar2.monitored_app_id
            WHERE ar2.github_repo_id = ar.github_repo_id AND ar2.status = 'active' AND ar2.monitored_app_id != ${maAlias}.id
              AND ma2.is_active = true
          )
        )
    )
  )`
}

export async function getPendingBaselineAutoVerifyEligibleAppIds(appIds: number[]): Promise<Set<number>> {
  if (appIds.length === 0) return new Set()

  const result = await pool.query<{ id: number }>(
    `SELECT ma.id
     FROM monitored_applications ma
     WHERE ma.id = ANY($1::int[])
       AND ${pendingBaselineAutoVerifyEligibleSql('ma')}`,
    [appIds],
  )

  return new Set(result.rows.map((r) => r.id))
}

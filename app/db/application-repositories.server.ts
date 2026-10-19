import type { PoolClient } from 'pg'
import { getRepositoryId } from '~/lib/github/git.server'
import {
  lockRepositoryAdminForWrite,
  lockRepositoryForVerificationJob,
  pool,
  withTransaction,
} from './connection.server'

async function lockRepositoriesForVerificationCoordination(
  client: PoolClient,
  githubRepoIds: Array<string | null>,
): Promise<void> {
  const uniqueSortedGithubRepoIds = [...new Set(githubRepoIds.filter((id): id is string => id !== null))].sort(
    (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0),
  )
  for (const githubRepoId of uniqueSortedGithubRepoIds) {
    await lockRepositoryForVerificationJob(client, githubRepoId)
  }
}

export const LATEST_ACTIVE_REPOSITORY_LINK_SQL = `
  SELECT DISTINCT ON (monitored_app_id) monitored_app_id, github_owner, github_repo_name, github_repo_id
  FROM application_repositories
  WHERE status = 'active'
  ORDER BY monitored_app_id, created_at DESC, id DESC
`

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

export async function getMonitoredAppIdsForRepository(repositoryId: number): Promise<number[]> {
  const result = await pool.query<{ monitored_app_id: number }>(
    `SELECT DISTINCT ar.monitored_app_id
     FROM application_repositories ar
     JOIN repositories r ON r.github_repo_id = ar.github_repo_id
     JOIN monitored_applications ma ON ma.id = ar.monitored_app_id
     WHERE r.id = $1 AND ar.status IN ('active', 'historical') AND ma.is_active = true`,
    [repositoryId],
  )
  return result.rows.map((row) => row.monitored_app_id)
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
       created_at DESC, id DESC`,
    [appId],
  )
  return result.rows
}

export async function findRepositoryForApp(
  appId: number,
  owner: string,
  repoName: string,
  repositoryId?: number,
): Promise<{
  repository: ApplicationRepository | null
  effectiveOwner: string
  effectiveRepo: string
  isRedirected: boolean
}> {
  const result =
    repositoryId == null
      ? await pool.query(
          `SELECT * FROM application_repositories
           WHERE monitored_app_id = $1
             AND github_owner = $2
             AND github_repo_name = $3`,
          [appId, owner, repoName],
        )
      : await pool.query(
          `SELECT ar.*, r.github_owner AS canonical_owner, r.github_repo_name AS canonical_repo_name
           FROM application_repositories ar
           JOIN repositories r ON r.github_repo_id = ar.github_repo_id
           WHERE monitored_app_id = $1
             AND ar.github_repo_id = (SELECT github_repo_id FROM repositories WHERE id = $2)
             AND ar.status IN ('active', 'historical')
           ORDER BY CASE ar.status WHEN 'active' THEN 1 WHEN 'historical' THEN 2 ELSE 3 END,
                    ar.created_at DESC, ar.id DESC
           LIMIT 1`,
          [appId, repositoryId],
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

  if (repositoryId == null && repo.redirects_to_owner && repo.redirects_to_repo) {
    return {
      repository: repo,
      effectiveOwner: repo.redirects_to_owner,
      effectiveRepo: repo.redirects_to_repo,
      isRedirected: true,
    }
  }

  return {
    repository: repo,
    effectiveOwner: repo.canonical_owner ?? owner,
    effectiveRepo: repo.canonical_repo_name ?? repoName,
    isRedirected: false,
  }
}

type UpsertApplicationRepositoryData = {
  monitoredAppId: number
  githubOwner: string
  githubRepoName: string
  status: 'active' | 'historical' | 'pending_approval'
  redirectsToOwner?: string | null
  redirectsToRepo?: string | null
  notes?: string | null
  approvedBy?: string | null
  approvedAt?: Date | null
  expectedGithubRepoId?: string
}

async function upsertApplicationRepositoryWithClient(
  client: PoolClient,
  data: UpsertApplicationRepositoryData,
  githubRepoId: number | string | null,
): Promise<ApplicationRepository> {
  const approvedAt =
    data.approvedAt !== undefined ? data.approvedAt : data.status !== 'pending_approval' ? new Date() : null
  if (data.expectedGithubRepoId && String(githubRepoId) !== data.expectedGithubRepoId) {
    throw new Error(
      `GitHub repository identity changed while linking ${data.githubOwner}/${data.githubRepoName}: expected ${data.expectedGithubRepoId}, received ${githubRepoId}`,
    )
  }

  const { rows: existingRows } = await client.query<{ github_repo_id: string | null }>(
    `SELECT github_repo_id FROM application_repositories
     WHERE monitored_app_id = $1 AND github_owner = $2 AND github_repo_name = $3`,
    [data.monitoredAppId, data.githubOwner, data.githubRepoName],
  )
  const isGenuinelyNewPendingLink = existingRows.length === 0 && data.status === 'pending_approval'
  if (!isGenuinelyNewPendingLink) {
    const effectiveGithubRepoId =
      existingRows[0]?.github_repo_id ?? (githubRepoId === null ? null : String(githubRepoId))
    await lockRepositoriesForVerificationCoordination(client, [effectiveGithubRepoId])
  }

  const result = await client.query(
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
  return result.rows[0]
}

export async function upsertApplicationRepository(
  data: UpsertApplicationRepositoryData,
): Promise<ApplicationRepository> {
  const githubRepoId = await getRepositoryId(data.githubOwner, data.githubRepoName)
  if (data.expectedGithubRepoId && String(githubRepoId) !== data.expectedGithubRepoId) {
    throw new Error(
      `GitHub repository identity changed while linking ${data.githubOwner}/${data.githubRepoName}: expected ${data.expectedGithubRepoId}, received ${githubRepoId}`,
    )
  }

  return withTransaction(async (client) => {
    await lockRepositoryAdminForWrite(client)
    return upsertApplicationRepositoryWithClient(client, data, githubRepoId)
  })
}

export async function upsertNaisApplyRepository(data: {
  monitoredAppId: number
  githubOwner: string
  githubRepoName: string
  githubRepoId: string
}): Promise<ApplicationRepository | null> {
  return withTransaction(async (client) => {
    await lockRepositoryAdminForWrite(client)

    const { rows: namedLinks } = await client.query<ApplicationRepository>(
      `SELECT * FROM application_repositories
       WHERE monitored_app_id = $1 AND github_owner = $2 AND github_repo_name = $3
       FOR UPDATE`,
      [data.monitoredAppId, data.githubOwner, data.githubRepoName],
    )
    const namedLink = namedLinks[0]

    const { rows: approvedLinks } = await client.query<ApplicationRepository>(
      `SELECT * FROM application_repositories
       WHERE monitored_app_id = $1 AND github_repo_id = $2
         AND status IN ('active', 'historical')
       ORDER BY CASE status WHEN 'active' THEN 1 ELSE 2 END, created_at DESC, id DESC
       LIMIT 1`,
      [data.monitoredAppId, data.githubRepoId],
    )
    const { rows: rejectedRows } = await client.query<{ rejected: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM nais_apply_rejected_repositories
         WHERE monitored_app_id = $1 AND github_repo_id = $2::bigint
       ) AS rejected`,
      [data.monitoredAppId, data.githubRepoId],
    )
    if (rejectedRows[0]?.rejected) return approvedLinks[0] ?? null
    if (approvedLinks[0]) return approvedLinks[0]
    if (namedLink?.github_repo_id && namedLink.github_repo_id !== data.githubRepoId) return namedLink

    if (namedLink) {
      return upsertApplicationRepositoryWithClient(
        client,
        {
          monitoredAppId: data.monitoredAppId,
          githubOwner: namedLink.github_owner,
          githubRepoName: namedLink.github_repo_name,
          status: namedLink.status,
          redirectsToOwner: namedLink.redirects_to_owner,
          redirectsToRepo: namedLink.redirects_to_repo,
          notes: namedLink.notes,
          approvedBy: namedLink.approved_by,
          approvedAt: namedLink.approved_at,
          expectedGithubRepoId: data.githubRepoId,
        },
        data.githubRepoId,
      )
    }

    const { rows: countRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM application_repositories WHERE monitored_app_id = $1',
      [data.monitoredAppId],
    )
    const isFirstRepository = Number(countRows[0]?.count ?? 0) === 0
    return upsertApplicationRepositoryWithClient(
      client,
      {
        monitoredAppId: data.monitoredAppId,
        githubOwner: data.githubOwner,
        githubRepoName: data.githubRepoName,
        status: isFirstRepository ? 'active' : 'pending_approval',
        expectedGithubRepoId: data.githubRepoId,
        ...(isFirstRepository ? { approvedBy: 'system' } : {}),
      },
      data.githubRepoId,
    )
  })
}

export async function approveRepository(
  repoId: number,
  approvedBy: string,
  setAsActive: boolean = false,
): Promise<ApplicationRepository> {
  const status = setAsActive ? 'active' : 'historical'

  return withTransaction(async (client) => {
    await lockRepositoryAdminForWrite(client)

    const repo = await client.query<{ monitored_app_id: number; github_repo_id: string | null }>(
      'SELECT monitored_app_id, github_repo_id FROM application_repositories WHERE id = $1',
      [repoId],
    )
    if (repo.rows.length === 0) {
      throw new Error(`Repository with id ${repoId} not found`)
    }

    const affectedGithubRepoIds = [repo.rows[0].github_repo_id]
    if (setAsActive) {
      const otherActiveLinks = await client.query<{ github_repo_id: string | null }>(
        `SELECT github_repo_id FROM application_repositories
         WHERE monitored_app_id = $1 AND status = 'active' AND id != $2`,
        [repo.rows[0].monitored_app_id, repoId],
      )
      affectedGithubRepoIds.push(...otherActiveLinks.rows.map((row) => row.github_repo_id))
    }
    await lockRepositoriesForVerificationCoordination(client, affectedGithubRepoIds)

    if (setAsActive) {
      await client.query(
        `UPDATE application_repositories 
         SET status = 'historical' 
         WHERE monitored_app_id = $1 
           AND status = 'active' 
           AND id != $2`,
        [repo.rows[0].monitored_app_id, repoId],
      )
    }

    const result = await client.query(
      `UPDATE application_repositories 
       SET status = $1, approved_at = NOW(), approved_by = $2
       WHERE id = $3
       RETURNING *`,
      [status, approvedBy, repoId],
    )

    if (result.rows.length === 0) {
      throw new Error(`Repository with id ${repoId} not found`)
    }

    return result.rows[0]
  })
}

export async function rejectRepository(repoId: number): Promise<void> {
  await withTransaction(async (client) => {
    await lockRepositoryAdminForWrite(client)
    const pendingRepository = await client.query<{
      monitored_app_id: number
      github_repo_id: string | null
    }>(
      `SELECT monitored_app_id, github_repo_id
       FROM application_repositories
       WHERE id = $1 AND status = 'pending_approval'
       FOR UPDATE`,
      [repoId],
    )
    const repository = pendingRepository.rows[0]
    if (repository?.github_repo_id) {
      await client.query(
        `INSERT INTO nais_apply_rejected_repositories (monitored_app_id, github_repo_id)
         VALUES ($1, $2)
         ON CONFLICT (monitored_app_id, github_repo_id) DO NOTHING`,
        [repository.monitored_app_id, repository.github_repo_id],
      )
    }
    await client.query(`DELETE FROM application_repositories WHERE id = $1 AND status = 'pending_approval'`, [repoId])
  })
}

export async function isNaisApplyRepositoryRejected(monitoredAppId: number, githubRepoId: string): Promise<boolean> {
  const result = await pool.query<{ rejected: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM nais_apply_rejected_repositories
       WHERE monitored_app_id = $1 AND github_repo_id = $2::bigint
     ) AS rejected`,
    [monitoredAppId, githubRepoId],
  )
  return result.rows[0]?.rejected === true
}

export async function setRepositoryAsActive(repoId: number): Promise<ApplicationRepository> {
  return withTransaction(async (client) => {
    await lockRepositoryAdminForWrite(client)

    const repo = await client.query<{ monitored_app_id: number; github_repo_id: string | null }>(
      'SELECT monitored_app_id, github_repo_id FROM application_repositories WHERE id = $1',
      [repoId],
    )
    if (repo.rows.length === 0) {
      throw new Error(`Repository with id ${repoId} not found`)
    }

    const otherActiveLinks = await client.query<{ github_repo_id: string | null }>(
      `SELECT github_repo_id FROM application_repositories
       WHERE monitored_app_id = $1 AND id != $2 AND status = 'active'`,
      [repo.rows[0].monitored_app_id, repoId],
    )
    await lockRepositoriesForVerificationCoordination(client, [
      repo.rows[0].github_repo_id,
      ...otherActiveLinks.rows.map((row) => row.github_repo_id),
    ])

    await client.query(
      `UPDATE application_repositories 
       SET status = 'historical' 
       WHERE monitored_app_id = $1 AND id != $2 AND status = 'active'`,
      [repo.rows[0].monitored_app_id, repoId],
    )

    const result = await client.query(
      `UPDATE application_repositories 
       SET status = 'active' 
       WHERE id = $1 
       RETURNING *`,
      [repoId],
    )

    return result.rows[0]
  })
}

export async function getAllActiveRepositories(): Promise<Map<number, string>> {
  const result = await pool.query(`${LATEST_ACTIVE_REPOSITORY_LINK_SQL}`)

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
